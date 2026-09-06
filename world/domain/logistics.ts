import { buildingAt, footprintOf, type Building } from "./settlement";
import { isProducerType, type Commodity, type ProducerType } from "./production";
import type { WorldPosition, WorldSnapshot } from "./world";

export type LogisticsRoute = Readonly<{
  id: string;
  name: string;
  originBuildingId: string;
  destinationBuildingId: string;
  path: readonly WorldPosition[];
  durationMs: number;
}>;

export type ShipmentStatus = "in_transit" | "arrived";
export type Shipment = Readonly<{
  id: string;
  routeId: string;
  originBuildingId: string;
  destinationBuildingId: string;
  cargo: Readonly<{ commodity: Commodity; quantity: number }>;
  departureTime: number;
  arrivalTime: number;
  status: ShipmentStatus;
  arrivedAt?: number;
}>;

export type WarehouseInventory = Readonly<Record<Commodity, number>>;

export type LogisticsSnapshot = Readonly<{
  routes: readonly LogisticsRoute[];
  shipments: readonly Shipment[];
  warehouseBuildingId: string;
  warehouseInventory: WarehouseInventory;
}>;

const keyOf = ({ x, y }: Pick<WorldPosition, "x" | "y">) => `${x},${y}`;

function adjacentCells(world: WorldSnapshot, building: Building) {
  const footprint = footprintOf(building.type, building.rotation);
  const cells: WorldPosition[] = [];
  for (let x = building.x; x < building.x + footprint.width; x++) {
    for (const y of [building.y - 1, building.y + footprint.depth]) {
      if (x >= 0 && y >= 0 && x < world.size && y < world.size) cells.push(world.cells[y * world.size + x]);
    }
  }
  for (let y = building.y; y < building.y + footprint.depth; y++) {
    for (const x of [building.x - 1, building.x + footprint.width]) {
      if (x >= 0 && y >= 0 && x < world.size && y < world.size) cells.push(world.cells[y * world.size + x]);
    }
  }
  return cells.filter(cell => !buildingAt(world, cell.x, cell.y));
}

function shortestConnection(world: WorldSnapshot, building: Building, targets: ReadonlySet<string>) {
  const starts = adjacentCells(world, building);
  const queue = [...starts];
  const previous = new Map<string, string | null>(starts.map(cell => [keyOf(cell), null]));
  let found: WorldPosition | undefined;
  for (let index = 0; index < queue.length && !found; index++) {
    const current = queue[index];
    if (targets.has(keyOf(current))) { found = current; break; }
    for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]] as const) {
      const x = current.x + dx, y = current.y + dy;
      if (x < 0 || y < 0 || x >= world.size || y >= world.size) continue;
      const next = world.cells[y * world.size + x];
      const key = keyOf(next);
      if (previous.has(key) || buildingAt(world, x, y)) continue;
      previous.set(key, keyOf(current));
      queue.push(next);
    }
  }
  if (!found) return [];
  const path: WorldPosition[] = [];
  let cursor: string | null = keyOf(found);
  while (cursor) {
    const [x, y] = cursor.split(",").map(Number);
    path.push(world.cells[y * world.size + x]);
    cursor = previous.get(cursor) ?? null;
  }
  return path.reverse();
}

export function roadConnections(world: WorldSnapshot, position: WorldPosition) {
  const roads = new Set((world.roads ?? []).map(keyOf));
  return {
    north: roads.has(`${position.x},${position.y - 1}`),
    east: roads.has(`${position.x + 1},${position.y}`),
    south: roads.has(`${position.x},${position.y + 1}`),
    west: roads.has(`${position.x - 1},${position.y}`),
  };
}

export function withStartingLogistics(world: WorldSnapshot): WorldSnapshot {
  const warehouse = world.buildings?.find(building => building.type === "warehouse");
  const producers = world.buildings?.filter((building): building is Building & { type: ProducerType } => isProducerType(building.type)) ?? [];
  if (!warehouse || producers.length === 0 || !world.roads?.length) return { ...world, logisticsRoutes: [] };
  const settlementRoads = new Set(world.roads.map(keyOf));
  const routeNames = { farm: "Harvest Road", lumber_camp: "Northwood Road", quarry: "Ridge Road" } as const;
  const logisticsRoutes: LogisticsRoute[] = [];
  const roadIndex = new Map(world.roads.map(road => [keyOf(road), road]));
  for (const producer of producers) {
    const path = shortestConnection(world, producer, settlementRoads);
    if (path.length === 0) continue;
    for (const cell of path) roadIndex.set(keyOf(cell), cell);
    logisticsRoutes.push({
      id: `${producer.id}-to-${warehouse.id}`,
      name: routeNames[producer.type],
      originBuildingId: producer.id,
      destinationBuildingId: warehouse.id,
      path,
      durationMs: Math.max(6_000, path.length * 180),
    });
  }
  return { ...world, roads: [...roadIndex.values()], logisticsRoutes };
}

export function shipmentPosition(route: LogisticsRoute, shipment: Shipment, now: number): WorldPosition {
  if (route.path.length === 0) return { x: 0, y: 0, z: 0 };
  const progress = shipment.arrivalTime <= shipment.departureTime ? 1 : Math.max(0, Math.min(1, (now - shipment.departureTime) / (shipment.arrivalTime - shipment.departureTime)));
  const scaled = progress * Math.max(0, route.path.length - 1);
  const index = Math.min(route.path.length - 1, Math.floor(scaled));
  const nextIndex = Math.min(route.path.length - 1, index + 1);
  const local = scaled - index;
  const from = route.path[index], to = route.path[nextIndex];
  return { x: from.x + (to.x - from.x) * local, y: from.y + (to.y - from.y) * local, z: from.z + (to.z - from.z) * local };
}
