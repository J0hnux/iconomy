import {
  buildingFaces,
  buildingsByDepth,
  buildingVisuals,
  type BuildingVisualSet,
} from "./buildings";
import {
  chunkOf,
  chunkRegions,
  type SurfaceCell,
  type WorldChunk,
  type WorldPosition,
  type WorldSnapshot,
} from "../../world/domain/world";
export type Point = { x: number; y: number };
export type Camera = { focus: Point; zoom: number };
export type Viewport = { width: number; height: number };
export const TILE_WIDTH = 48;
export const TILE_HEIGHT = 24;
export const ELEVATION_HEIGHT = 16;

// Position identifies the top vertex; cells span [x,x+1) and [y,y+1).
export function project({ x, y, z }: WorldPosition): Point {
  return {
    x: ((x - y) * TILE_WIDTH) / 2,
    y: ((x + y) * TILE_HEIGHT) / 2 - z * ELEVATION_HEIGHT,
  };
}
export function unproject(point: Point, z = 0): Point {
  const y = point.y + z * ELEVATION_HEIGHT;
  return {
    x: point.x / TILE_WIDTH + y / TILE_HEIGHT,
    y: y / TILE_HEIGHT - point.x / TILE_WIDTH,
  };
}
export function toScreen(
  position: WorldPosition,
  camera: Camera,
  viewport: Viewport,
): Point {
  const point = project(position);
  const focus = project({ ...camera.focus, z: 0 });
  return {
    x: (point.x - focus.x) * camera.zoom + viewport.width / 2,
    y: (point.y - focus.y) * camera.zoom + viewport.height / 2,
  };
}
export function screenToWorld(
  point: Point,
  camera: Camera,
  viewport: Viewport,
  z = 0,
): Point {
  const focus = project({ ...camera.focus, z: 0 });
  return unproject(
    {
      x: (point.x - viewport.width / 2) / camera.zoom + focus.x,
      y: (point.y - viewport.height / 2) / camera.zoom + focus.y,
    },
    z,
  );
}
export function clampCamera(camera: Camera, size: number): Camera {
  return {
    zoom: Math.max(0.25, Math.min(3, camera.zoom)),
    focus: {
      x: Math.max(0, Math.min(size, camera.focus.x)),
      y: Math.max(0, Math.min(size, camera.focus.y)),
    },
  };
}
export function panCamera(camera: Camera, delta: Point, size: number): Camera {
  const movement = unproject({
    x: delta.x / camera.zoom,
    y: delta.y / camera.zoom,
  });
  return clampCamera(
    {
      ...camera,
      focus: { x: camera.focus.x - movement.x, y: camera.focus.y - movement.y },
    },
    size,
  );
}
export function zoomCamera(
  camera: Camera,
  factor: number,
  anchor: Point,
  viewport: Viewport,
  size: number,
): Camera {
  const before = screenToWorld(anchor, camera, viewport);
  const next = clampCamera({ ...camera, zoom: camera.zoom * factor }, size);
  const after = screenToWorld(anchor, next, viewport);
  return clampCamera(
    {
      ...next,
      focus: {
        x: next.focus.x + before.x - after.x,
        y: next.focus.y + before.y - after.y,
      },
    },
    size,
  );
}
export type TerrainFace = { kind: "left" | "right" | "top"; points: Point[] };

// One painter order for rendering and picking. No sorting or mutation of domain data.
const orderedWorlds = new WeakMap<WorldSnapshot, WorldSnapshot["cells"]>();
const chunkCells = new WeakMap<
  WorldSnapshot,
  ReadonlyMap<string, readonly SurfaceCell[]>
>();
const worldElevations = new WeakMap<WorldSnapshot, number>();
export function orderedCells(world: WorldSnapshot) {
  let cells = orderedWorlds.get(world);
  if (!cells) {
    cells = [...world.cells].sort((a, b) => a.x + a.y - b.x - b.y || a.x - b.x);
    orderedWorlds.set(world, cells);
  }
  return cells;
}

function cellsByChunk(world: WorldSnapshot) {
  let chunks = chunkCells.get(world);
  if (!chunks) {
    const mutable = new Map<string, SurfaceCell[]>();
    for (const cell of world.cells) {
      const chunk = chunkOf(cell, world.chunkSize);
      const id = `${chunk.x},${chunk.y}`;
      const cells = mutable.get(id) ?? [];
      cells.push(cell);
      mutable.set(id, cells);
    }
    chunks = mutable;
    chunkCells.set(world, chunks);
  }
  return chunks;
}

function maximumElevation(world: WorldSnapshot) {
  let elevation = worldElevations.get(world);
  if (elevation === undefined) {
    elevation = world.cells.reduce(
      (highest, cell) => Math.max(highest, cell.z),
      0,
    );
    worldElevations.set(world, elevation);
  }
  return elevation;
}

export type VisibleScene = Readonly<{
  chunks: readonly WorldChunk[];
  cells: readonly SurfaceCell[];
  chunkIds: ReadonlySet<string>;
}>;

export function visibleChunks(
  world: WorldSnapshot,
  camera: Camera,
  viewport: Viewport,
  marginChunks = 1,
) {
  const horizontalPadding = TILE_WIDTH * camera.zoom;
  const topPadding = TILE_HEIGHT * camera.zoom;
  const bottomPadding =
    (TILE_HEIGHT + maximumElevation(world) * ELEVATION_HEIGHT) * camera.zoom;
  const corners = [
    { x: -horizontalPadding, y: -topPadding },
    { x: viewport.width + horizontalPadding, y: -topPadding },
    {
      x: viewport.width + horizontalPadding,
      y: viewport.height + bottomPadding,
    },
    { x: -horizontalPadding, y: viewport.height + bottomPadding },
  ].map((point) => screenToWorld(point, camera, viewport));
  const minimumX = Math.min(...corners.map((point) => point.x));
  const maximumX = Math.max(...corners.map((point) => point.x));
  const minimumY = Math.min(...corners.map((point) => point.y));
  const maximumY = Math.max(...corners.map((point) => point.y));
  const minimumChunkX = Math.floor(minimumX / world.chunkSize) - marginChunks;
  const maximumChunkX = Math.floor(maximumX / world.chunkSize) + marginChunks;
  const minimumChunkY = Math.floor(minimumY / world.chunkSize) - marginChunks;
  const maximumChunkY = Math.floor(maximumY / world.chunkSize) + marginChunks;
  const regions = world.chunks ?? chunkRegions(world.size, world.chunkSize);
  return regions.filter(
    (chunk) =>
      chunk.x >= minimumChunkX &&
      chunk.x <= maximumChunkX &&
      chunk.y >= minimumChunkY &&
      chunk.y <= maximumChunkY,
  );
}

export function visibleScene(
  world: WorldSnapshot,
  camera: Camera,
  viewport: Viewport,
  marginChunks = 1,
): VisibleScene {
  const chunks = visibleChunks(world, camera, viewport, marginChunks);
  const buckets = cellsByChunk(world);
  const cells = chunks
    .flatMap((chunk) => buckets.get(chunk.id) ?? [])
    .sort((a, b) => a.x + a.y - b.x - b.y || a.x - b.x);
  return { chunks, cells, chunkIds: new Set(chunks.map((chunk) => chunk.id)) };
}

export function terrainFaces(
  cell: WorldSnapshot["cells"][number],
  world: WorldSnapshot,
  camera: Camera,
  viewport: Viewport,
): TerrainFace[] {
  const { x, y, z } = cell;
  const at = (px: number, py: number, pz: number) =>
    toScreen({ x: px, y: py, z: pz }, camera, viewport);
  const neighborHeight = (nx: number, ny: number) =>
    nx < world.size && ny < world.size
      ? world.cells[ny * world.size + nx].z
      : 0;
  const left = neighborHeight(x, y + 1);
  const right = neighborHeight(x + 1, y);
  const faces: TerrainFace[] = [];
  if (z > left)
    faces.push({
      kind: "left",
      points: [
        at(x, y + 1, z),
        at(x + 1, y + 1, z),
        at(x + 1, y + 1, left),
        at(x, y + 1, left),
      ],
    });
  if (z > right)
    faces.push({
      kind: "right",
      points: [
        at(x + 1, y, z),
        at(x + 1, y + 1, z),
        at(x + 1, y + 1, right),
        at(x + 1, y, right),
      ],
    });
  faces.push({
    kind: "top",
    points: [
      at(x, y, z),
      at(x + 1, y, z),
      at(x + 1, y + 1, z),
      at(x, y + 1, z),
    ],
  });
  return faces;
}

export function containsPoint(point: Point, polygon: readonly Point[]) {
  let positive = false;
  let negative = false;
  for (let index = 0; index < polygon.length; index++) {
    const a = polygon[index];
    const b = polygon[(index + 1) % polygon.length];
    const cross = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
    if (cross > 1e-7) positive = true;
    if (cross < -1e-7) negative = true;
  }
  return !(positive && negative);
}

// Reverse painter order ensures cliffs occlude cells behind them. Side clicks inspect
// the owning surface cell, not a lower tile hidden beneath the cliff.
export function pickCell(
  point: Point,
  camera: Camera,
  viewport: Viewport,
  world: WorldSnapshot,
  scene?: VisibleScene,
  visuals: BuildingVisualSet = buildingVisuals,
) {
  const insideViewport =
    point.x >= 0 &&
    point.x <= viewport.width &&
    point.y >= 0 &&
    point.y <= viewport.height;
  const cells = insideViewport
    ? (scene ?? visibleScene(world, camera, viewport)).cells
    : orderedCells(world);
  const buildings = buildingsByDepth(world);
  for (let index = cells.length - 1; index >= 0; index--) {
    const cell = cells[index];
    const building = buildings.get(`${cell.x},${cell.y}`);
    if (
      building &&
      buildingFaces(building, camera, viewport, visuals).some((face) =>
        containsPoint(point, face.points),
      )
    )
      return world.cells[building.y * world.size + building.x];
    const top = toScreen(cell, camera, viewport);
    if (
      Math.abs(point.x - top.x) > (TILE_WIDTH * camera.zoom) / 2 ||
      point.y < top.y ||
      point.y > top.y + (TILE_HEIGHT + cell.z * ELEVATION_HEIGHT) * camera.zoom
    )
      continue;
    if (
      terrainFaces(cell, world, camera, viewport).some((face) =>
        containsPoint(point, face.points),
      )
    )
      return cell;
  }
  return null;
}

export function focusCell(cell: WorldPosition): Point {
  return unproject(project({ x: cell.x + 0.5, y: cell.y + 0.5, z: cell.z }));
}
