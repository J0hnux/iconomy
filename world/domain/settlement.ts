import type { WorldPosition, WorldSnapshot } from "./world";

export const buildingDefinitions = {
  camp: {
    name: "Settler Camp",
    width: 2,
    depth: 2,
    purpose: "Administrative anchor for the starting settlement.",
  },
  house: {
    name: "House",
    width: 1,
    depth: 1,
    purpose: "Housing for the founding citizens.",
  },
  warehouse: {
    name: "Warehouse",
    width: 2,
    depth: 2,
    purpose:
      "Receives and stores goods delivered through Novagrad's road network.",
  },
  workshop: {
    name: "Workshop",
    width: 2,
    depth: 1,
    purpose: "Processes raw and intermediate goods through a selected recipe.",
  },
  farm: {
    name: "Farm",
    width: 2,
    depth: 2,
    purpose: "Turns cultivated farmland into food for Novagrad.",
  },
  lumber_camp: {
    name: "Lumber Camp",
    width: 2,
    depth: 2,
    purpose: "Harvests timber from a managed forest site.",
  },
  quarry: {
    name: "Quarry",
    width: 2,
    depth: 2,
    purpose: "Extracts stone from the exposed ridge.",
  },
  iron_mine: {
    name: "Iron Mine",
    width: 2,
    depth: 2,
    purpose: "Extracts iron ore from an exposed iron deposit.",
  },
} as const;
export type BuildingType = keyof typeof buildingDefinitions;
export type BuildingRotation = "north" | "east" | "south" | "west";
export type Building = WorldPosition &
  Readonly<{
    id: string;
    type: BuildingType;
    settlementId: string;
    rotation: BuildingRotation;
  }>;
export type Settlement = Readonly<{
  id: string;
  name: string;
  population: number;
  anchor: WorldPosition;
}>;

export function footprintOf(type: BuildingType, rotation: BuildingRotation) {
  const definition = buildingDefinitions[type];
  return rotation === "east" || rotation === "west"
    ? { width: definition.depth, depth: definition.width }
    : { width: definition.width, depth: definition.depth };
}

export function buildingAt(world: WorldSnapshot, x: number, y: number) {
  return world.buildings?.find((building) => {
    const footprint = footprintOf(building.type, building.rotation);
    return (
      x >= building.x &&
      x < building.x + footprint.width &&
      y >= building.y &&
      y < building.y + footprint.depth
    );
  });
}

// Find a naturally flat site; never flatten terrain or put buildings over water.
export function withStartingSettlement(world: WorldSnapshot): WorldSnapshot {
  const candidates = world.cells
    .filter(
      (cell) =>
        cell.x >= 1 &&
        cell.y >= 1 &&
        cell.x + 9 < world.size &&
        cell.y + 9 < world.size,
    )
    .sort(
      (a, b) =>
        Math.hypot(a.x + 4 - world.size / 2, a.y + 4 - world.size / 2) -
        Math.hypot(b.x + 4 - world.size / 2, b.y + 4 - world.size / 2),
    );
  const site = candidates.find((origin) => {
    for (let y = 0; y < 9; y++)
      for (let x = 0; x < 9; x++) {
        const cell = world.cells[(origin.y + y) * world.size + origin.x + x];
        if (cell.terrain !== "grassland" || cell.z !== origin.z) return false;
      }
    return true;
  });
  if (!site) return { ...world, buildings: [], roads: [] };
  const settlement: Settlement = {
    id: "novagrad",
    name: "Novagrad",
    population: 10,
    anchor: { x: site.x + 2, y: site.y + 2, z: site.z },
  };
  const layout = [
    ["camp", 2, 2],
    ["warehouse", 5, 2],
    ["house", 1, 5],
    ["house", 3, 5],
    ["house", 5, 5],
    ["house", 7, 5],
  ] as const;
  const buildings = layout.map(
    ([type, dx, dy], index): Building => ({
      id: `novagrad-${index}`,
      type,
      x: site.x + dx,
      y: site.y + dy,
      z: site.z,
      settlementId: settlement.id,
      rotation: "north",
    }),
  );
  const roads: WorldPosition[] = [];
  for (let offset = 1; offset <= 7; offset++) {
    roads.push({ x: site.x + offset, y: site.y + 4, z: site.z });
    if (offset !== 4)
      roads.push({ x: site.x + 4, y: site.y + offset, z: site.z });
  }
  return { ...world, settlement, buildings, roads };
}
