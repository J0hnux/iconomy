import type { WorldPosition, WorldSnapshot } from "./world";

export const buildingDefinitions = {
  camp: { name: "Settler Camp", width: 2, depth: 2, purpose: "Administrative anchor for the starting settlement." },
  house: { name: "House", width: 1, depth: 1, purpose: "Housing for the founding citizens." },
  warehouse: { name: "Warehouse", width: 2, depth: 2, purpose: "Local storage site. Inventory and production arrive later." },
} as const;
export type Building = WorldPosition & Readonly<{ id: string; type: keyof typeof buildingDefinitions; settlementId: string; rotation: "north" }>;
export type Settlement = Readonly<{ id: string; name: string; population: number; anchor: WorldPosition }>;

export function buildingAt(world: WorldSnapshot, x: number, y: number) {
  return world.buildings?.find(building => {
    const definition = buildingDefinitions[building.type];
    return x >= building.x && x < building.x + definition.width && y >= building.y && y < building.y + definition.depth;
  });
}

// Find a naturally flat site; never flatten terrain or put buildings over water.
export function withStartingSettlement(world: WorldSnapshot): WorldSnapshot {
  const candidates = world.cells.filter(cell => cell.x >= 1 && cell.y >= 1 && cell.x + 9 < world.size && cell.y + 9 < world.size)
    .sort((a, b) => Math.hypot(a.x + 4 - world.size / 2, a.y + 4 - world.size / 2) - Math.hypot(b.x + 4 - world.size / 2, b.y + 4 - world.size / 2));
  const site = candidates.find(origin => {
    for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) {
      const cell = world.cells[(origin.y + y) * world.size + origin.x + x];
      if (cell.terrain !== "grassland" || cell.z !== origin.z) return false;
    }
    return true;
  });
  if (!site) return { ...world, buildings: [], roads: [] };
  const settlement: Settlement = { id: "novagrad", name: "Novagrad", population: 10, anchor: { x: site.x + 2, y: site.y + 2, z: site.z } };
  const layout = [["camp", 2, 2], ["warehouse", 5, 2], ["house", 1, 5], ["house", 3, 5], ["house", 5, 5], ["house", 7, 5]] as const;
  const buildings = layout.map(([type, dx, dy], index): Building => ({ id: `novagrad-${index}`, type, x: site.x + dx, y: site.y + dy, z: site.z, settlementId: settlement.id, rotation: "north" }));
  const roads: WorldPosition[] = [];
  for (let offset = 1; offset <= 7; offset++) {
    roads.push({ x: site.x + offset, y: site.y + 4, z: site.z });
    if (offset !== 4) roads.push({ x: site.x + 4, y: site.y + offset, z: site.z });
  }
  return { ...world, settlement, buildings, roads };
}
