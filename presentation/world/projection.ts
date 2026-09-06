import type { WorldPosition, WorldSnapshot } from "../../world/domain/world";
export type Point = { x: number; y: number };
export type Camera = { focus: Point; zoom: number };
export type Viewport = { width: number; height: number };
export const TILE_WIDTH = 48;
export const TILE_HEIGHT = 24;
export const ELEVATION_HEIGHT = 16;

// Position identifies the top vertex; cells span [x,x+1) and [y,y+1).
export function project({ x, y, z }: WorldPosition): Point {
  return { x: (x - y) * TILE_WIDTH / 2, y: (x + y) * TILE_HEIGHT / 2 - z * ELEVATION_HEIGHT };
}
export function unproject(point: Point, z = 0): Point {
  const y = point.y + z * ELEVATION_HEIGHT;
  return { x: point.x / TILE_WIDTH + y / TILE_HEIGHT, y: y / TILE_HEIGHT - point.x / TILE_WIDTH };
}
export function toScreen(position: WorldPosition, camera: Camera, viewport: Viewport): Point {
  const point = project(position);
  const focus = project({ ...camera.focus, z: 0 });
  return { x: (point.x - focus.x) * camera.zoom + viewport.width / 2, y: (point.y - focus.y) * camera.zoom + viewport.height / 2 };
}
export function screenToWorld(point: Point, camera: Camera, viewport: Viewport, z = 0): Point {
  const focus = project({ ...camera.focus, z: 0 });
  return unproject({ x: (point.x - viewport.width / 2) / camera.zoom + focus.x, y: (point.y - viewport.height / 2) / camera.zoom + focus.y }, z);
}
export function clampCamera(camera: Camera, size: number): Camera {
  return { zoom: Math.max(0.25, Math.min(3, camera.zoom)), focus: { x: Math.max(0, Math.min(size, camera.focus.x)), y: Math.max(0, Math.min(size, camera.focus.y)) } };
}
export function panCamera(camera: Camera, delta: Point, size: number): Camera {
  const movement = unproject({ x: delta.x / camera.zoom, y: delta.y / camera.zoom });
  return clampCamera({ ...camera, focus: { x: camera.focus.x - movement.x, y: camera.focus.y - movement.y } }, size);
}
export function zoomCamera(camera: Camera, factor: number, anchor: Point, viewport: Viewport, size: number): Camera {
  const before = screenToWorld(anchor, camera, viewport);
  const next = clampCamera({ ...camera, zoom: camera.zoom * factor }, size);
  const after = screenToWorld(anchor, next, viewport);
  return clampCamera({ ...next, focus: { x: next.focus.x + before.x - after.x, y: next.focus.y + before.y - after.y } }, size);
}
// Milestone 0 flat-surface picking. Resolve elevated polygons here in milestone 1.
export function pickCell(point: Point, camera: Camera, viewport: Viewport, world: WorldSnapshot) {
  const position = screenToWorld(point, camera, viewport);
  const x = Math.floor(position.x);
  const y = Math.floor(position.y);
  return x >= 0 && y >= 0 && x < world.size && y < world.size ? world.cells[y * world.size + x] : null;
}
