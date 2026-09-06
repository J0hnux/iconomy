import { buildingAt } from "../../world/domain/settlement";
import type { PlacementRequest, PlacementValidation } from "../../world/domain/construction";
import { buildingFaces, buildingsByDepth, buildingVisuals } from "./buildings";
import type { SurfaceCell, WorldSnapshot } from "../../world/domain/world";
import { orderedCells, terrainFaces, toScreen, TILE_WIDTH, TILE_HEIGHT, ELEVATION_HEIGHT, type Camera, type Viewport } from "./projection";

const grass = ["#668568", "#6c8b6d", "#718e6c", "#68866a", "#748f70"];
const forestGround = ["#3e6748", "#456f4d", "#49764f", "#3b6244", "#527a55"];
const farmland = ["#9a8b50", "#a39351", "#8d8148", "#aa9652", "#93864d"];
const water = ["#28667d", "#2b6d83", "#2c7187", "#306d82", "#296a81"];
const rock = ["#89918b", "#92988f", "#838d88", "#9ba098", "#8e9791"];

export type PlacementPreview = Readonly<{ request: PlacementRequest; validation: PlacementValidation }>;

export function drawWorld(ctx: CanvasRenderingContext2D, world: WorldSnapshot, camera: Camera, viewport: Viewport, selected: SurfaceCell | null, grid: boolean, preview: PlacementPreview | null = null) {
  ctx.clearRect(0, 0, viewport.width, viewport.height);
  const buildings = buildingsByDepth(world);
  const roads = new Set((world.roads ?? []).map(road => `${road.x},${road.y}`));
  const selectedBuilding = selected ? buildingAt(world, selected.x, selected.y) : undefined;
  const previewCells = new Set(preview?.validation.cells.map(cell => `${cell.x},${cell.y}`) ?? []);
  for (const cell of orderedCells(world)) {
    const p = toScreen(cell, camera, viewport);
    const building = buildings.get(`${cell.x},${cell.y}`);
    const halfWidth = TILE_WIDTH * camera.zoom / 2;
    // Include the full cliff height: a top may be offscreen while its side is visible.
    if (!building && (p.x + halfWidth < 0 || p.x - halfWidth > viewport.width || p.y + (TILE_HEIGHT + cell.z * ELEVATION_HEIGHT) * camera.zoom < 0 || p.y > viewport.height)) continue;
    const palette = cell.terrain === "water" ? water : cell.terrain === "mountain" ? rock : cell.terrain === "forest_ground" ? forestGround : cell.terrain === "farmland" ? farmland : grass;
    for (const face of terrainFaces(cell, world, camera, viewport)) {
      ctx.beginPath();
      face.points.forEach((point, index) => index === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y));
      ctx.closePath();
      ctx.fillStyle = face.kind === "top" ? palette[(cell.x * 17 + cell.y * 31) % 5] : face.kind === "left" ? "#655d4c" : "#80765f";
      ctx.fill();
      ctx.strokeStyle = grid ? "#112d3045" : ctx.fillStyle;
      ctx.lineWidth = grid ? 0.65 : 0.5;
      ctx.stroke();
      if (face.kind === "top" && roads.has(`${cell.x},${cell.y}`)) {
        const center = toScreen({ x: cell.x + 0.5, y: cell.y + 0.5, z: cell.z }, camera, viewport);
        ctx.strokeStyle = "#b5a17b";
        ctx.lineWidth = 9 * camera.zoom;
        ctx.lineCap = "square";
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (!roads.has(`${cell.x + dx},${cell.y + dy}`)) continue;
          const edge = toScreen({ x: cell.x + 0.5 + dx / 2, y: cell.y + 0.5 + dy / 2, z: cell.z }, camera, viewport);
          ctx.beginPath(); ctx.moveTo(center.x, center.y); ctx.lineTo(edge.x, edge.y); ctx.stroke();
        }
        ctx.lineCap = "butt";
        // Restore the terrain path before drawing the selection overlay.
        ctx.beginPath(); face.points.forEach((point, index) => index === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y)); ctx.closePath();
      }
      if (face.kind === "top" && previewCells.has(`${cell.x},${cell.y}`)) {
        ctx.fillStyle = preview?.validation.valid ? "#42d87880" : "#ef5b5b80";
        ctx.fill();
        ctx.strokeStyle = preview?.validation.valid ? "#8dffb0" : "#ff9b9b";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      // Selection is drawn with its cell so nearer terrain correctly occludes it.
      if (selected?.x === cell.x && selected.y === cell.y) {
        ctx.fillStyle = face.kind === "top" ? "#e7d89938" : "#e7d89918";
        ctx.fill();
        ctx.strokeStyle = "#ffedb0";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
    if (camera.zoom >= 0.45 && cell.terrain === "farmland") {
      ctx.strokeStyle = "#d8c66b";
      ctx.lineWidth = Math.max(1, camera.zoom);
      for (const offset of [0.25, 0.5, 0.75]) {
        const start = toScreen({ x: cell.x + 0.12, y: cell.y + offset, z: cell.z + 0.02 }, camera, viewport);
        const end = toScreen({ x: cell.x + 0.88, y: cell.y + offset, z: cell.z + 0.02 }, camera, viewport);
        ctx.beginPath(); ctx.moveTo(start.x, start.y); ctx.lineTo(end.x, end.y); ctx.stroke();
      }
    }
    if (camera.zoom >= 0.55 && cell.terrain === "forest_ground" && (cell.x * 13 + cell.y * 7) % 3 === 0) {
      const base = toScreen({ x: cell.x + 0.5, y: cell.y + 0.5, z: cell.z }, camera, viewport);
      const scale = camera.zoom;
      ctx.fillStyle = "#5e4630";
      ctx.fillRect(base.x - 2 * scale, base.y - 10 * scale, 4 * scale, 11 * scale);
      ctx.fillStyle = "#174b31";
      ctx.beginPath();
      ctx.moveTo(base.x, base.y - 27 * scale);
      ctx.lineTo(base.x + 10 * scale, base.y - 9 * scale);
      ctx.lineTo(base.x, base.y - 4 * scale);
      ctx.lineTo(base.x - 10 * scale, base.y - 9 * scale);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "#103923"; ctx.lineWidth = scale; ctx.stroke();
    }
    if (camera.zoom >= 0.5 && cell.resourceNodeId && cell.terrain === "mountain" && (cell.x * 5 + cell.y * 11) % 4 === 0) {
      const center = toScreen({ x: cell.x + 0.5, y: cell.y + 0.5, z: cell.z + 0.04 }, camera, viewport);
      const scale = camera.zoom;
      ctx.fillStyle = cell.resourceNodeId === "iron-heights" ? "#69483d" : "#c4cbc6";
      ctx.beginPath();
      ctx.moveTo(center.x, center.y - 8 * scale);
      ctx.lineTo(center.x + 8 * scale, center.y - 2 * scale);
      ctx.lineTo(center.x + 4 * scale, center.y + 5 * scale);
      ctx.lineTo(center.x - 7 * scale, center.y + 4 * scale);
      ctx.lineTo(center.x - 9 * scale, center.y - 2 * scale);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "#3f4845"; ctx.lineWidth = scale; ctx.stroke();
    }
    if (building) {
      for (const face of buildingFaces(building, camera, viewport)) {
        ctx.beginPath(); face.points.forEach((point, index) => index === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y)); ctx.closePath();
        ctx.fillStyle = face.color; ctx.fill();
        ctx.strokeStyle = selectedBuilding?.id === building.id ? "#ffedb0" : "#263830";
        ctx.lineWidth = selectedBuilding?.id === building.id ? 2 : 0.7; ctx.stroke();
      }
      const roof = buildingFaces(building, camera, viewport)[2].points;
      const center = roof.reduce((sum, point) => ({ x: sum.x + point.x / 4, y: sum.y + point.y / 4 }), { x: 0, y: 0 });
      ctx.fillStyle = "#16272b"; ctx.font = `bold ${Math.max(7, 8 * camera.zoom)}px Arial`; ctx.textAlign = "center";
      ctx.fillText(buildingVisuals[building.type].mark, center.x, center.y + 3);
    }
  }
}
