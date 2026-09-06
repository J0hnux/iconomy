import type { Building, Settlement } from "./settlement";
import type { LogisticsRoute } from "./logistics";
export type WorldPosition = Readonly<{ x: number; y: number; z: number }>;
export type TerrainType =
  | "grassland"
  | "water"
  | "mountain"
  | "forest_ground"
  | "farmland";
export type ResourceType = "forest" | "stone" | "iron";
export type SurfaceCell = WorldPosition &
  Readonly<{ terrain: TerrainType; resourceNodeId?: string }>;
export type WorldChunk = Readonly<{
  id: string;
  x: number;
  y: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}>;
export type ResourceNode = Readonly<{
  id: string;
  name: string;
  type: ResourceType;
  anchor: WorldPosition;
  cellCount: number;
  estimatedReserve: number;
}>;
export type WorldSnapshot = Readonly<{
  seed: string;
  size: number;
  chunkSize: number;
  chunks: readonly WorldChunk[];
  cells: readonly SurfaceCell[];
  resourceNodes: readonly ResourceNode[];
  settlement?: Settlement;
  buildings?: readonly Building[];
  roads?: readonly WorldPosition[];
  logisticsRoutes?: readonly LogisticsRoute[];
}>;

export function chunkRegions(
  size: number,
  chunkSize: number,
): readonly WorldChunk[] {
  if (!Number.isInteger(size) || size < 1)
    throw new RangeError("World size must be a positive integer.");
  if (!Number.isInteger(chunkSize) || chunkSize < 1)
    throw new RangeError("Chunk size must be a positive integer.");
  const chunks: WorldChunk[] = [];
  for (let y = 0; y < Math.ceil(size / chunkSize); y++) {
    for (let x = 0; x < Math.ceil(size / chunkSize); x++) {
      chunks.push({
        id: `${x},${y}`,
        x,
        y,
        minX: x * chunkSize,
        minY: y * chunkSize,
        maxX: Math.min(size, (x + 1) * chunkSize),
        maxY: Math.min(size, (y + 1) * chunkSize),
      });
    }
  }
  return chunks;
}

// Semantic world data; never browser objects or visual coordinates.
export function generateWorld(
  seed = "prototype-001",
  size = 128,
): WorldSnapshot {
  if (!Number.isInteger(size) || size < 8 || size > 256)
    throw new RangeError("World size must be an integer between 8 and 256.");
  let hash = 2166136261;
  for (const character of seed)
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  const phase = ((hash >>> 0) / 0xffffffff) * Math.PI * 2;
  const cells: SurfaceCell[] = [];
  const resourceCells = new Map<string, SurfaceCell[]>();
  const rememberResource = (id: string, cell: SurfaceCell) => {
    const found = resourceCells.get(id) ?? [];
    found.push(cell);
    resourceCells.set(id, found);
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const river = size * (0.44 + 0.09 * Math.sin((y / size) * 9 + phase));
      const coast = size * (0.85 + 0.025 * Math.sin((x / size) * 13 + phase));
      const water = Math.abs(x - river) < size * 0.025 || y > coast;
      const nx = x / size;
      const ny = y / size;
      const peak = (cx: number, cy: number, radius: number, height: number) =>
        Math.max(0, 1 - Math.hypot(nx - cx, ny - cy) / radius) * height;
      const mountains = Math.max(
        peak(0.28, 0.32, 0.22, 9),
        peak(0.7, 0.47, 0.2, 8),
      );
      const hills =
        Math.max(0, Math.sin(nx * 12 + phase) * Math.cos(ny * 10 - phase)) * 2;
      // River banks and coast descend toward sea level; all heights are logical integers.
      const shoreDistance = Math.min(
        Math.abs(x - river) - size * 0.025,
        coast - y,
      );
      const z = water
        ? 0
        : Math.max(
            1,
            Math.min(
              1 + Math.floor(mountains + hills),
              Math.ceil(shoreDistance / 2),
            ),
          );
      let terrain: TerrainType = water
        ? "water"
        : z >= 5
          ? "mountain"
          : "grassland";
      let resourceNodeId: string | undefined;
      const centralReserve = Math.hypot(nx - 0.5, ny - 0.5) < 0.13;
      if (terrain === "grassland" && !centralReserve) {
        const northwood = Math.hypot((nx - 0.18) / 1.15, ny - 0.22) < 0.13;
        const eastwood = Math.hypot((nx - 0.78) / 1.1, ny - 0.25) < 0.12;
        const farmBelt =
          z <= 2 &&
          (Math.hypot((nx - 0.22) / 1.35, ny - 0.68) < 0.09 ||
            Math.hypot((nx - 0.72) / 1.5, ny - 0.73) < 0.08);
        if (northwood || eastwood) {
          terrain = "forest_ground";
          resourceNodeId = northwood ? "northwood" : "eastwood";
        } else if (farmBelt) {
          terrain = "farmland";
        }
      } else if (terrain === "mountain") {
        resourceNodeId = nx < 0.5 ? "stone-ridge" : "iron-heights";
      }
      const cell: SurfaceCell = {
        x,
        y,
        z,
        terrain,
        ...(resourceNodeId ? { resourceNodeId } : {}),
      };
      cells.push(cell);
      if (resourceNodeId) rememberResource(resourceNodeId, cell);
    }
  }
  const nodeDefinitions = [
    {
      id: "northwood",
      name: "Northwood Forest",
      type: "forest",
      reservePerCell: 120,
    },
    {
      id: "eastwood",
      name: "Eastwood Forest",
      type: "forest",
      reservePerCell: 105,
    },
    {
      id: "stone-ridge",
      name: "Stone Ridge",
      type: "stone",
      reservePerCell: 180,
    },
    {
      id: "iron-heights",
      name: "Iron Heights",
      type: "iron",
      reservePerCell: 90,
    },
  ] as const;
  const resourceNodes: ResourceNode[] = nodeDefinitions.flatMap(
    (definition) => {
      const nodeCells = resourceCells.get(definition.id) ?? [];
      if (nodeCells.length === 0) return [];
      const anchor = nodeCells[Math.floor(nodeCells.length / 2)];
      return [
        {
          id: definition.id,
          name: definition.name,
          type: definition.type,
          anchor: { x: anchor.x, y: anchor.y, z: anchor.z },
          cellCount: nodeCells.length,
          estimatedReserve: nodeCells.length * definition.reservePerCell,
        },
      ];
    },
  );
  const chunkSize = 32;
  return {
    seed,
    size,
    chunkSize,
    chunks: chunkRegions(size, chunkSize),
    cells,
    resourceNodes,
  };
}

export function chunkOf(position: WorldPosition, chunkSize: number) {
  return {
    x: Math.floor(position.x / chunkSize),
    y: Math.floor(position.y / chunkSize),
  };
}

export function resourceAt(world: WorldSnapshot, cell: SurfaceCell) {
  return cell.resourceNodeId
    ? world.resourceNodes.find((node) => node.id === cell.resourceNodeId)
    : undefined;
}
