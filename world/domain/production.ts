import {
  buildingAt,
  footprintOf,
  type Building,
  type BuildingType,
} from "./settlement";
import type { LogisticsSnapshot } from "./logistics";
import type { MarketSnapshot } from "./market";
import type { PopulationSnapshot } from "./population";
import type { NpcCityState } from "./npc-cities";
import type { NpcCompanyState } from "./npc-companies";
import type { RegionalLogisticsSnapshot } from "./regional-logistics";
import type { SurfaceCell, WorldPosition, WorldSnapshot } from "./world";
import {
  commodityDefinitions,
  normalizeCommodityInventory,
  type Commodity,
  type CommodityInventory,
} from "./commodities";
import {
  advanceLaborWork,
  laborEfficiency,
  laborStatus,
  type LaborSnapshot,
  type LaborStatus,
} from "./labor";

export type { Commodity } from "./commodities";

export const producerTypes = [
  "farm",
  "lumber_camp",
  "quarry",
  "iron_mine",
  "workshop",
] as const satisfies readonly BuildingType[];
export type ProducerType = (typeof producerTypes)[number];

export const recipeIds = [
  "grow_crops",
  "harvest_logs",
  "quarry_stone",
  "mine_iron_ore",
  "saw_lumber",
  "make_basic_food",
  "make_animal_feed",
  "raise_livestock",
  "butcher_meat",
  "cook_meat",
  "prepare_meal",
  "cut_stone",
  "smelt_iron",
  "forge_iron_tools",
] as const;
export type RecipeId = (typeof recipeIds)[number];

export type ProductionRecipe = Readonly<{
  id: RecipeId;
  name: string;
  producer: ProducerType;
  consumableInputs: Readonly<Partial<Record<Commodity, number>>>;
  equipmentRequirements: Readonly<Partial<Record<Commodity, number>>>;
  requiredWorkers: number;
  durationMs: number;
  outputs: Readonly<Partial<Record<Commodity, number>>>;
  storageCapacity: number;
  destinationStorage: "site";
}>;

const recipe = (
  definition: Omit<
    ProductionRecipe,
    "destinationStorage" | "equipmentRequirements"
  >,
): ProductionRecipe => ({
  ...definition,
  equipmentRequirements: {},
  destinationStorage: "site",
});

export const productionRecipes: Record<RecipeId, ProductionRecipe> = {
  grow_crops: recipe({
    id: "grow_crops",
    name: "Grow Crops",
    producer: "farm",
    consumableInputs: {},
    requiredWorkers: 2,
    durationMs: 8_000,
    outputs: { crops: 4 },
    storageCapacity: 24,
  }),
  harvest_logs: recipe({
    id: "harvest_logs",
    name: "Harvest Logs",
    producer: "lumber_camp",
    consumableInputs: {},
    requiredWorkers: 2,
    durationMs: 10_000,
    outputs: { wood: 3 },
    storageCapacity: 18,
  }),
  quarry_stone: recipe({
    id: "quarry_stone",
    name: "Quarry Rough Stone",
    producer: "quarry",
    consumableInputs: {},
    requiredWorkers: 3,
    durationMs: 12_000,
    outputs: { stone: 2 },
    storageCapacity: 12,
  }),
  mine_iron_ore: recipe({
    id: "mine_iron_ore",
    name: "Mine Iron Ore",
    producer: "iron_mine",
    consumableInputs: {},
    requiredWorkers: 3,
    durationMs: 14_000,
    outputs: { iron_ore: 2 },
    storageCapacity: 12,
  }),
  saw_lumber: recipe({
    id: "saw_lumber",
    name: "Saw Lumber",
    producer: "workshop",
    consumableInputs: { wood: 2 },
    requiredWorkers: 2,
    durationMs: 8_000,
    outputs: { lumber: 2 },
    storageCapacity: 16,
  }),
  make_basic_food: recipe({
    id: "make_basic_food",
    name: "Make Basic Food",
    producer: "workshop",
    consumableInputs: { crops: 2 },
    requiredWorkers: 2,
    durationMs: 6_000,
    outputs: { food: 3 },
    storageCapacity: 18,
  }),
  make_animal_feed: recipe({
    id: "make_animal_feed",
    name: "Make Animal Feed",
    producer: "workshop",
    consumableInputs: { crops: 2 },
    requiredWorkers: 1,
    durationMs: 6_000,
    outputs: { animal_feed: 3 },
    storageCapacity: 18,
  }),
  raise_livestock: recipe({
    id: "raise_livestock",
    name: "Raise Livestock",
    producer: "farm",
    consumableInputs: { animal_feed: 2 },
    requiredWorkers: 2,
    durationMs: 12_000,
    outputs: { livestock: 1 },
    storageCapacity: 8,
  }),
  butcher_meat: recipe({
    id: "butcher_meat",
    name: "Butcher Meat",
    producer: "workshop",
    consumableInputs: { livestock: 1 },
    requiredWorkers: 2,
    durationMs: 8_000,
    outputs: { raw_meat: 2 },
    storageCapacity: 12,
  }),
  cook_meat: recipe({
    id: "cook_meat",
    name: "Cook Meat",
    producer: "workshop",
    consumableInputs: { raw_meat: 2 },
    requiredWorkers: 2,
    durationMs: 7_000,
    outputs: { cooked_meat: 2 },
    storageCapacity: 12,
  }),
  prepare_meal: recipe({
    id: "prepare_meal",
    name: "Prepare Meal",
    producer: "workshop",
    consumableInputs: { crops: 1, cooked_meat: 1 },
    requiredWorkers: 2,
    durationMs: 8_000,
    outputs: { prepared_meal: 2 },
    storageCapacity: 12,
  }),
  cut_stone: recipe({
    id: "cut_stone",
    name: "Cut Stone",
    producer: "workshop",
    consumableInputs: { stone: 2 },
    requiredWorkers: 2,
    durationMs: 9_000,
    outputs: { cut_stone: 2 },
    storageCapacity: 14,
  }),
  smelt_iron: recipe({
    id: "smelt_iron",
    name: "Smelt Iron",
    producer: "workshop",
    consumableInputs: { iron_ore: 2 },
    requiredWorkers: 3,
    durationMs: 12_000,
    outputs: { iron: 1 },
    storageCapacity: 10,
  }),
  forge_iron_tools: recipe({
    id: "forge_iron_tools",
    name: "Forge Iron Tools",
    producer: "workshop",
    consumableInputs: { iron: 2 },
    requiredWorkers: 3,
    durationMs: 14_000,
    outputs: { iron_tools: 1 },
    storageCapacity: 8,
  }),
};

export const defaultRecipeByProducer: Record<ProducerType, RecipeId> = {
  farm: "grow_crops",
  lumber_camp: "harvest_logs",
  quarry: "quarry_stone",
  iron_mine: "mine_iron_ore",
  workshop: "make_basic_food",
};

export const productionPriorities = ["low", "normal", "high"] as const;
export type ProductionPriority = (typeof productionPriorities)[number];

const priorityRank: Record<ProductionPriority, number> = {
  low: 0,
  normal: 1,
  high: 2,
};

export function isProductionPriority(
  value: unknown,
): value is ProductionPriority {
  return (
    typeof value === "string" &&
    productionPriorities.includes(value as ProductionPriority)
  );
}

export function compareProductionPriority(
  first: Pick<ProductionState, "buildingId" | "priority">,
  second: Pick<ProductionState, "buildingId" | "priority">,
) {
  const priorityDifference =
    priorityRank[second.priority ?? "normal"] -
    priorityRank[first.priority ?? "normal"];
  return priorityDifference || first.buildingId.localeCompare(second.buildingId);
}

export type ProductionStatus =
  | "paused"
  | "running"
  | "missing_workers"
  | "worker_shortage"
  | "missing_inputs"
  | "missing_equipment"
  | "storage_full";

export type ProductionState = Readonly<{
  buildingId: string;
  recipeId?: RecipeId;
  paused?: boolean;
  priority?: ProductionPriority;
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
    recipeId: RecipeId;
    recipeName: string;
    output: Commodity;
    outputAmount: number;
    cycleMs: number;
    requiredWorkers: number;
    storageCapacity: number;
    consumableInputs: Readonly<Partial<Record<Commodity, number>>>;
    equipmentRequirements: Readonly<Partial<Record<Commodity, number>>>;
    destinationStorage: "site";
    paused: boolean;
    priority: ProductionPriority;
    expectedOutputPerCycle: number;
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
  npcCities: readonly NpcCityState[];
  npcCompanies: readonly NpcCompanyState[];
  regionalLogistics: RegionalLogisticsSnapshot;
}>;

export type ProductionResolution = Readonly<{
  state: ProductionState;
  inventory: CommodityInventory;
  completedCycles: number;
  consumedInputs: Readonly<Partial<Record<Commodity, number>>>;
}>;

export function isProducerType(type: BuildingType): type is ProducerType {
  return producerTypes.includes(type as ProducerType);
}

export function isRecipeId(value: unknown): value is RecipeId {
  return typeof value === "string" && recipeIds.includes(value as RecipeId);
}

export function executeRecipeCycles(
  recipeId: RecipeId,
  requestedCycles: number,
  sourceInventory: Readonly<Partial<Record<Commodity, number>>>,
) {
  if (!Number.isSafeInteger(requestedCycles) || requestedCycles < 0)
    throw new RangeError("Requested production cycles must be a nonnegative integer.");
  const recipe = productionRecipes[recipeId];
  const inventory = normalizeCommodityInventory(sourceInventory);
  const consumedInputs: Partial<Record<Commodity, number>> = {};
  const producedOutputs: Partial<Record<Commodity, number>> = {};
  const equipmentAvailable = Object.entries(
    recipe.equipmentRequirements,
  ).every(
    ([commodity, quantity]) =>
      inventory[commodity as Commodity] >= (quantity ?? 0),
  );
  const inputEntries = Object.entries(recipe.consumableInputs) as [
    Commodity,
    number,
  ][];
  const inputLimitedCycles = inputEntries.length
    ? Math.min(
        ...inputEntries.map(([commodity, quantity]) =>
          Math.floor(inventory[commodity] / quantity),
        ),
      )
    : requestedCycles;
  const completedCycles = equipmentAvailable
    ? Math.min(requestedCycles, inputLimitedCycles)
    : 0;
  for (const [commodity, quantity] of inputEntries) {
    const consumed = quantity * completedCycles;
    inventory[commodity] -= consumed;
    if (consumed > 0) consumedInputs[commodity] = consumed;
  }
  for (const [commodity, quantity] of Object.entries(recipe.outputs) as [
    Commodity,
    number,
  ][]) {
    const produced = quantity * completedCycles;
    inventory[commodity] += produced;
    if (produced > 0) producedOutputs[commodity] = produced;
  }
  return {
    inventory,
    completedCycles,
    consumedInputs,
    producedOutputs,
    blockedReason:
      completedCycles === requestedCycles
        ? null
        : !equipmentAvailable
          ? "missing_equipment"
          : "missing_inputs",
  } as const;
}

export function availableRecipes(type: ProducerType) {
  return recipeIds
    .map((id) => productionRecipes[id])
    .filter((candidate) => candidate.producer === type);
}

export function recipeForState(state: ProductionState, type: ProducerType) {
  const selected = state.recipeId && productionRecipes[state.recipeId];
  return selected?.producer === type
    ? selected
    : productionRecipes[defaultRecipeByProducer[type]];
}

export function recipeOutput(recipeDefinition: ProductionRecipe) {
  const entries = Object.entries(recipeDefinition.outputs) as [
    Commodity,
    number,
  ][];
  if (entries.length !== 1)
    throw new RangeError("A site recipe must have exactly one output commodity.");
  return { commodity: entries[0][0], amount: entries[0][1] };
}

function missingRequirements(
  requirements: Readonly<Partial<Record<Commodity, number>>>,
  inventory: CommodityInventory,
) {
  return (Object.entries(requirements) as [Commodity, number][]).filter(
    ([commodity, quantity]) => inventory[commodity] < quantity,
  );
}

export function productionStatus(
  state: ProductionState,
  type: ProducerType,
  inventory: CommodityInventory,
): ProductionStatus {
  const selected = recipeForState(state, type);
  const output = recipeOutput(selected);
  if (state.paused) return "paused";
  if (state.stored + output.amount > selected.storageCapacity)
    return "storage_full";
  if (state.assignedWorkers === 0) return "missing_workers";
  if (missingRequirements(selected.equipmentRequirements, inventory).length)
    return "missing_equipment";
  if (missingRequirements(selected.consumableInputs, inventory).length)
    return "missing_inputs";
  if (state.assignedWorkers < selected.requiredWorkers)
    return "worker_shortage";
  return "running";
}

function cyclesAvailable(
  requirements: Readonly<Partial<Record<Commodity, number>>>,
  inventory: CommodityInventory,
) {
  const entries = Object.entries(requirements) as [Commodity, number][];
  return entries.length === 0
    ? Number.MAX_SAFE_INTEGER
    : Math.min(
        ...entries.map(([commodity, quantity]) =>
          Math.floor(inventory[commodity] / quantity),
        ),
      );
}

export function resolveProduction(
  state: ProductionState,
  type: ProducerType,
  now: number,
  inventory: CommodityInventory,
): ProductionResolution {
  const selected = recipeForState(state, type);
  const normalizedState = {
    ...state,
    recipeId: selected.id,
    paused: state.paused ?? false,
    priority: state.priority ?? "normal",
  };
  const elapsed = Math.max(0, now - state.updatedAt);
  const blocked = productionStatus(normalizedState, type, inventory);
  if (!["running", "worker_shortage"].includes(blocked))
    return {
      state: { ...normalizedState, updatedAt: now },
      inventory,
      completedCycles: 0,
      consumedInputs: {},
    };

  const laborWork = advanceLaborWork(
    elapsed,
    state.assignedWorkers,
    selected.requiredWorkers,
    state.laborRemainder ?? 0,
  );
  const totalProgress = state.progressMs + laborWork.effectiveMs;
  const completedByTime = Math.floor(totalProgress / selected.durationMs);
  if (completedByTime === 0)
    return {
      state: {
        ...normalizedState,
        progressMs: totalProgress,
        laborRemainder: laborWork.remainder,
        updatedAt: now,
      },
      inventory,
      completedCycles: 0,
      consumedInputs: {},
    };

  const output = recipeOutput(selected);
  const cyclesWithRoom = Math.floor(
    (selected.storageCapacity - state.stored) / output.amount,
  );
  const acceptedCycles = Math.min(
    completedByTime,
    cyclesWithRoom,
    cyclesAvailable(selected.consumableInputs, inventory),
  );
  const nextInventory = normalizeCommodityInventory(inventory);
  const consumedInputs: Partial<Record<Commodity, number>> = {};
  for (const [commodity, quantity] of Object.entries(
    selected.consumableInputs,
  ) as [Commodity, number][]) {
    const consumed = quantity * acceptedCycles;
    nextInventory[commodity] -= consumed;
    if (consumed > 0) consumedInputs[commodity] = consumed;
  }
  const stoppedAtRequirement = acceptedCycles < completedByTime;
  const stored = state.stored + acceptedCycles * output.amount;
  return {
    state: {
      ...normalizedState,
      stored,
      progressMs: stoppedAtRequirement
        ? 0
        : totalProgress - acceptedCycles * selected.durationMs,
      laborRemainder: stoppedAtRequirement ? 0 : laborWork.remainder,
      updatedAt: now,
    },
    inventory: nextInventory,
    completedCycles: acceptedCycles,
    consumedInputs,
  };
}

export function advanceProduction(
  state: ProductionState,
  type: ProducerType,
  now: number,
): ProductionState {
  return resolveProduction(
    state,
    type,
    now,
    normalizeCommodityInventory({}),
  ).state;
}

function requirementText(requirements: readonly [Commodity, number][]) {
  return requirements
    .map(
      ([commodity, quantity]) =>
        `${quantity} ${commodityDefinitions[commodity].name}`,
    )
    .join(" + ");
}

export function describeProduction(
  state: ProductionState,
  building: Building,
  inventory: CommodityInventory,
): ProductionSite | null {
  if (!isProducerType(building.type)) return null;
  const selected = recipeForState(state, building.type);
  const status = productionStatus(state, building.type, inventory);
  const efficiency = laborEfficiency(
    state.assignedWorkers,
    selected.requiredWorkers,
  );
  const staffing = laborStatus(
    state.assignedWorkers,
    selected.requiredWorkers,
  );
  const output = recipeOutput(selected);
  const missingInputs = missingRequirements(
    selected.consumableInputs,
    inventory,
  );
  const missingEquipment = missingRequirements(
    selected.equipmentRequirements,
    inventory,
  );
  const statusReason =
    status === "paused"
      ? "Production is paused. Resume it, then assign workers to continue."
      : status === "storage_full"
      ? `Output storage is full. Dispatch ${commodityDefinitions[output.commodity].name} to resume.`
      : status === "missing_workers"
        ? `No workers assigned. Needs ${selected.requiredWorkers} workers to produce.`
        : status === "missing_inputs"
          ? `Missing inputs: ${requirementText(missingInputs)}.`
          : status === "missing_equipment"
            ? `Missing equipment: ${requirementText(missingEquipment)}.`
            : status === "worker_shortage"
              ? `Worker shortage: producing at ${Math.round(efficiency * 100)}% labor efficiency and needs ${selected.requiredWorkers - state.assignedWorkers} more worker${selected.requiredWorkers - state.assignedWorkers === 1 ? "" : "s"}.`
              : `Producing ${commodityDefinitions[output.commodity].name} at 100% labor efficiency every ${selected.durationMs / 1000} seconds.`;
  const expectedOutputPerCycle =
    status === "running" || status === "worker_shortage"
      ? output.amount * efficiency
      : 0;
  return {
    ...state,
    recipeId: selected.id,
    paused: state.paused ?? false,
    priority: state.priority ?? "normal",
    type: building.type,
    name:
      building.type === "lumber_camp"
        ? "Lumber Camp"
        : building.type === "iron_mine"
          ? "Iron Mine"
          : building.type === "farm"
            ? "Farm"
            : building.type === "quarry"
              ? "Quarry"
              : "Workshop",
    recipeName: selected.name,
    output: output.commodity,
    outputAmount: output.amount,
    cycleMs: selected.durationMs,
    requiredWorkers: selected.requiredWorkers,
    storageCapacity: selected.storageCapacity,
    consumableInputs: selected.consumableInputs,
    equipmentRequirements: selected.equipmentRequirements,
    destinationStorage: selected.destinationStorage,
    expectedOutputPerCycle,
    status,
    statusReason,
    laborEfficiency: efficiency,
    laborStatus: staffing,
  };
}

function findFlatSite(
  world: WorldSnapshot,
  type: ProducerType,
  accepts: (cell: SurfaceCell) => boolean,
  target: WorldPosition,
) {
  const footprint = footprintOf(type, "north");
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
    [
      "iron_mine",
      (cell) => cell.resourceNodeId === "iron-heights",
      world.resourceNodes.find((node) => node.id === "iron-heights")?.anchor ??
        world.settlement.anchor,
    ],
    [
      "workshop",
      (cell) => cell.terrain === "grassland",
      world.settlement.anchor,
    ],
  ];
  for (const [type, accepts, target] of definitions) {
    const site = findFlatSite(next, type, accepts, target);
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
