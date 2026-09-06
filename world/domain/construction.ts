import { buildingAt, footprintOf, type Building, type BuildingRotation, type BuildingType } from "./settlement";
import type { SurfaceCell, WorldSnapshot } from "./world";

export const constructibleBuildingTypes = ["house", "warehouse", "workshop"] as const satisfies readonly BuildingType[];

export type PlacementRequest = Readonly<{
  type: BuildingType;
  x: number;
  y: number;
  rotation: BuildingRotation;
}>;

export type PlacementValidation = Readonly<{
  valid: boolean;
  reasons: readonly string[];
  cells: readonly SurfaceCell[];
  elevation: number | null;
}>;

export function validatePlacement(world: WorldSnapshot, request: PlacementRequest): PlacementValidation {
  const reasons: string[] = [];
  const cells: SurfaceCell[] = [];
  if (!constructibleBuildingTypes.includes(request.type as typeof constructibleBuildingTypes[number])) {
    return { valid: false, reasons: ["Building type is unavailable"], cells, elevation: null };
  }
  if (!["north", "east", "south", "west"].includes(request.rotation)) {
    return { valid: false, reasons: ["Rotation is unavailable"], cells, elevation: null };
  }
  if (!Number.isInteger(request.x) || !Number.isInteger(request.y)) {
    return { valid: false, reasons: ["Origin must be a grid cell"], cells, elevation: null };
  }
  const footprint = footprintOf(request.type, request.rotation);
  for (let dy = 0; dy < footprint.depth; dy++) {
    for (let dx = 0; dx < footprint.width; dx++) {
      const x = request.x + dx;
      const y = request.y + dy;
      if (x < 0 || y < 0 || x >= world.size || y >= world.size) {
        reasons.push("Footprint extends beyond the world");
        continue;
      }
      cells.push(world.cells[y * world.size + x]);
    }
  }
  if (cells.some(cell => cell.terrain !== "grassland")) reasons.push("Requires grassland");
  const elevation = cells[0]?.z ?? null;
  if (cells.some(cell => cell.z !== elevation)) reasons.push("Requires level ground");
  if (cells.some(cell => buildingAt(world, cell.x, cell.y))) reasons.push("Footprint is occupied");
  const roads = new Set((world.roads ?? []).map(road => `${road.x},${road.y}`));
  if (cells.some(cell => roads.has(`${cell.x},${cell.y}`))) reasons.push("Cannot build over a road");
  const footprintKeys = new Set(cells.map(cell => `${cell.x},${cell.y}`));
  const roadAccess = cells.some(cell => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) =>
    !footprintKeys.has(`${cell.x + dx},${cell.y + dy}`) && roads.has(`${cell.x + dx},${cell.y + dy}`)));
  if (!roadAccess) reasons.push("Requires adjacent road access");
  return { valid: reasons.length === 0 && cells.length === footprint.width * footprint.depth, reasons: [...new Set(reasons)], cells, elevation };
}

export function placeBuilding(world: WorldSnapshot, request: PlacementRequest, id: string): WorldSnapshot {
  const validation = validatePlacement(world, request);
  if (!validation.valid || validation.elevation === null || !world.settlement) return world;
  const building: Building = {
    id,
    type: request.type,
    x: request.x,
    y: request.y,
    z: validation.elevation,
    rotation: request.rotation,
    settlementId: world.settlement.id,
  };
  return { ...world, buildings: [...(world.buildings ?? []), building] };
}
