import type { SurfaceCell, WorldSnapshot } from "../../world/domain/world";
import { toScreen, TILE_WIDTH, TILE_HEIGHT, type Camera, type Viewport } from "./projection";

export function drawWorld(ctx: CanvasRenderingContext2D, world: WorldSnapshot, camera: Camera, viewport: Viewport, selected: SurfaceCell | null, grid: boolean) {
  ctx.clearRect(0, 0, viewport.width, viewport.height);
  const width = TILE_WIDTH * camera.zoom / 2;
  const height = TILE_HEIGHT * camera.zoom / 2;
  function diamond(cell: SurfaceCell) {
    const p = toScreen(cell, camera, viewport);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + width, p.y + height);
    ctx.lineTo(p.x, p.y + height * 2);
    ctx.lineTo(p.x - width, p.y + height);
    ctx.closePath();
  }
  for (const cell of world.cells) {
    const p = toScreen(cell, camera, viewport);
    if (p.x + width < 0 || p.x - width > viewport.width || p.y + height * 2 < 0 || p.y > viewport.height) continue;
    diamond(cell);
    const shade = (cell.x * 17 + cell.y * 31) % 5;
    ctx.fillStyle = cell.terrain === "water" ? ["#28667d", "#2b6d83", "#2c7187", "#306d82", "#296a81"][shade] : ["#668568", "#6c8b6d", "#718e6c", "#68866a", "#748f70"][shade];
    ctx.fill();
    ctx.strokeStyle = grid ? "#112d3045" : ctx.fillStyle;
    ctx.lineWidth = grid ? 0.65 : 0.5;
    ctx.stroke();
  }
  if (selected) {
    diamond(selected);
    ctx.fillStyle = "#e7d89938";
    ctx.fill();
    ctx.strokeStyle = "#ffedb0";
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }
}
