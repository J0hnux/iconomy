import {
  buildingAt,
  footprintOf,
  type Building,
  type BuildingType,
} from "./settlement";
import type { SurfaceCell, WorldPosition, WorldSnapshot } from "./world";
import type { LogisticsSnapshot } from "./logistics";
import type { MarketSnapshot } from "./market";
import type { PopulationSnapshot } from "./population";
import {
  advanceLaborWork,
  laborEfficiency,
  laborStatus,
  type LaborSnapshot,
  type LaborStatus,
} from "./labor";

export const producerTypes = [
  "farm",
  "lumber_camp",
  "quarry",
] as const satisfies readonly BuildingType[];
export type ProducerType = (typeof producerTypes)[number];
export type ProductionStatus = "running" | "missing_workers" | "storage_full";
export type Commodity = "food" | "wood" | "stone";

export const productionRecipes: Record<
  ProducerType,
  Readonly<{
    output: Commodity;
    outputAmount: number;
    cycleMs: number;
    requiredWorkers: number;
    storageCapacity: number;
  }>
> = {
  farm: {
    output: "food",
    outputAmount: 4,
    cycleMs: 8_000,
    requiredWorkers: 2,
    storageCapacity: 24,
  },
  lumber_camp: {
    output: "wood",
    outputAmount: 3,
    cycleMs: 10_000,
    requiredWorkers: 2,
    storageCapacity: 18,
  },
  quarry: {
    output: "stone",
    outputAmount: 2,
    cycleMs: 12_000,
    requiredWorkers: 3,
    storageCapacity: 12,
  },
};

export type ProductionState = Readonly<{
  buildingId: string;
  assignedWorkers: number;
  stored: number;
  progressMs: number;
  laborRemainder?: number;
  updatedAt: number;
}>;

export type ProductionSite = ProductionState &
  Readonly<{
    type: ProducerType;
    name: string;
    output: Commodity;
    outputAmount: number;
    cycleMs: number;
    requiredWorkers: number;
    storageCapacity: number;
    status: ProductionStatus;
    statusReason: string;
    laborEfficiency: number;
    laborStatus: LaborStatus;
  }>;

export type ProductionSnapshot = Readonly<{
  simulationTime: number;
  population: PopulationSnapshot;
  labor: LaborSnapshot;
  sites: readonly ProductionSite[];
  logistics: LogisticsSnapshot;
  market: MarketSnapshot;
}>;

export function isProducerType(type: BuildingType): type is ProducerType {
  return producerTypes.includes(type as ProducerType);
}

export function productionStatus(
  state: ProductionState,
  type: ProducerType,
): ProductionStatus {
  const recipe = productionRecipes[type];
  if (state.stored >= recipe.storageCapacity) return "storage_full";
  if (state.assignedWorkers < recipe.requiredWorkers) return "missing_workers";
  return "running";
}

export function advanceProduction(
  state: ProductionState,
  type: ProducerType,
  now: number,
): ProductionState {
  const recipe = productionRecipes[type];
  const elapsed = Math.max(0, now - state.updatedAt);
  if (
    state.stored >= recipe.storageCapacity ||
    laborEfficiency(state.assignedWorkers, recipe.requiredWorkers) === 0
  )
    return { ...state, updatedAt: now };
  const laborWork = advanceLaborWork(
    elapsed,
    state.assignedWorkers,
    recipe.requiredWorkers,
    state.laborRemainder ?? 0,
  );
  const totalProgress = state.progressMs + laborWork.effectiveMs;
  const completedCycles = Math.floor(totalProgress / recipe.cycleMs);
  const cyclesWithRoom = Math.floor(
    (recipe.storageCapacity - state.stored) / recipe.outputAmount,
  );
  const acceptedCycles = Math.min(completedCycles, cyclesWithRoom);
  const stored = state.stored + acceptedCycles * recipe.outputAmount;
  const progressMs =
    stored >= recipe.storageCapacity
      ? 0
      : totalProgress - acceptedCycles * recipe.cycleMs;
  return {
    ...state,
    stored,
    progressMs,
    laborRemainder: stored >= recipe.storageCapacity ? 0 : laborWork.remainder,
    updatedAt: now,
  };
}

export function describeProduction(
  state: ProductionState,
  building: Building,
): ProductionSite | null {
  if (!isProducerType(building.type)) return null;
  const recipe = productionRecipes[building.type];
  const status = productionStatus(state, building.type);
  const efficiency = laborEfficiency(
    state.assignedWorkers,
    recipe.requiredWorkers,
  );
  const staffing = laborStatus(
    state.assignedWorkers,
    recipe.requiredWorkers,
  );
  const statusReason =
    status === "storage_full"
      ? `Storage is full. Dispatch ${recipe.output} to the warehouse to resume.`
      : staffing === "full"
        ? `Producing ${recipe.output} at 100% labor efficiency every ${recipe.cycleMs / 1000} seconds.`
        : staffing === "unassigned"
          ? `No workers assigned. Needs ${recipe.requiredWorkers} workers to produce.`
          : `Worker shortage: producing at ${Math.round(efficiency * 100)}% labor efficiency and needs ${recipe.requiredWorkers - state.assignedWorkers} more worker${recipe.requiredWorkers - state.assignedWorkers === 1 ? "" : "s"}.`;
  return {
    ...state,
    type: building.type,
    name:
      building.type === "lumber_camp"
        ? "Lumber Camp"
        : building.type === "farm"
          ? "Farm"
          : "Quarry",
    ...recipe,
    status,
    statusReason,
    laborEfficiency: efficiency,
    laborStatus: staffing,
  };
}

function findFlatSite(
  world: WorldSnapshot,
  accepts: (cell: SurfaceCell) => boolean,
  target: WorldPosition,
) {
  const footprint = footprintOf("farm", "north");
  return world.cells
    .filter(
      (cell) =>
        cell.x + footprint.width <= world.size &&
        cell.y + footprint.depth <= world.size &&
        accepts(cell),
    )
    .sort(
      (a, b) =>
        Math.hypot(a.x - target.x, a.y - target.y) -
        Math.hypot(b.x - target.x, b.y - target.y),
    )
    .find((origin) => {
      for (let dy = 0; dy < footprint.depth; dy++)
        for (let dx = 0; dx < footprint.width; dx++) {
          const cell =
            world.cells[(origin.y + dy) * world.size + origin.x + dx];
          if (
            !accepts(cell) ||
            cell.z !== origin.z ||
            buildingAt(world, cell.x, cell.y)
          )
            return false;
        }
      return true;
    });
}

export function withStartingProduction(world: WorldSnapshot): WorldSnapshot {
  if (!world.settlement) return world;
  let next = world;
  const farmland = world.cells.filter((cell) => cell.terrain === "farmland");
  const farmTarget =
    farmland[Math.floor(farmland.length / 2)] ?? world.settlement.anchor;
  const definitions: readonly [
    ProducerType,
    (cell: SurfaceCell) => boolean,
    WorldPosition,
  ][] = [
    ["farm", (cell) => cell.terrain === "farmland", farmTarget],
    [
      "lumber_camp",
      (cell) => cell.resourceNodeId === "northwood",
      world.resourceNodes.find((node) => node.id === "northwood")?.anchor ??
        world.settlement.anchor,
    ],
    [
      "quarry",
      (cell) => cell.resourceNodeId === "stone-ridge",
      world.resourceNodes.find((node) => node.id === "stone-ridge")?.anchor ??
        world.settlement.anchor,
    ],
  ];
  for (const [type, accepts, target] of definitions) {
    const site = findFlatSite(next, accepts, target);
    if (!site) continue;
    const building: Building = {
      id: `novagrad-${type}`,
      type,
      x: site.x,
      y: site.y,
      z: site.z,
      settlementId: world.settlement.id,
      rotation: "north",
    };
    next = { ...next, buildings: [...(next.buildings ?? []), building] };
  }
  return next;
}
