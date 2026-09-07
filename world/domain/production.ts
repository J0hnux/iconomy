import {
  buildingAt,
  footprintOf,
  type Building,
  type BuildingType,
} from "./settlement";
import type { LogisticsSnapshot } from "./logistics";
import type { MarketSnapshot } from "./market";
import type { MarketIntelligenceSnapshot } from "./market-intelligence";
import type { CompetitionSnapshot } from "./competition";
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
  "grow_crops_improved",
  "harvest_logs_improved",
  "quarry_stone_improved",
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
  /** Technology level. Primitive tiers never require equipment to run. */
  tier: ProductionTier;
  /** The primitive recipe this tier industrialises, when it is an upgrade. */
  upgradeOf?: RecipeId;
}>;

export const productionTiers = ["primitive", "improved"] as const;
export type ProductionTier = (typeof productionTiers)[number];

/**
 * Capital cost of industrialising a site, on top of the equipment it must hold.
 *
 * Without a real cost an upgrade would strictly dominate building more
 * primitive capacity, and the choice the player is meant to weigh would
 * collapse into an obvious answer.
 */
export const productionUpgradePolicy = {
  upgradeCostCents: 18_000,
} as const;

export type UpgradeOption = Readonly<{
  recipeId: RecipeId;
  name: string;
  costCents: number;
  equipmentRequirements: Readonly<Partial<Record<Commodity, number>>>;
  currentWorkers: number;
  upgradedWorkers: number;
  workersFreed: number;
  currentOutputPerCycle: number;
  upgradedOutputPerCycle: number;
  currentOutputPerWorker: number;
  upgradedOutputPerWorker: number;
  affordable: boolean;
  equipmentHeld: boolean;
  blockedReasons: readonly string[];
}>;

export type ExpansionOption = Readonly<{
  producerType: ProducerType;
  buildingName: string;
  recipeId: RecipeId;
  costCents: number;
  materials: Readonly<Partial<Record<Commodity, number>>>;
  requiredWorkers: number;
  outputPerCycle: number;
  outputPerWorker: number;
  affordable: boolean;
  blockedReasons: readonly string[];
}>;

const recipe = (
  definition: Omit<
    ProductionRecipe,
    "destinationStorage" | "equipmentRequirements" | "tier"
  >,
): ProductionRecipe => ({
  ...definition,
  equipmentRequirements: {},
  tier: "primitive",
  destinationStorage: "site",
});

/**
 * An industrialised tier of an existing recipe.
 *
 * Industrialisation is configuration, not a new production system: a tier is
 * the same producer running a recipe that needs fewer workers, yields more, and
 * requires manufactured equipment it holds rather than consumes. A site without
 * that equipment produces nothing, so upgrading is a genuine trade of labor for
 * capital rather than a free bonus.
 */
const improvedRecipe = (
  definition: Omit<
    ProductionRecipe,
    "destinationStorage" | "tier"
  >,
): ProductionRecipe => ({
  ...definition,
  tier: "improved",
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
  grow_crops_improved: improvedRecipe({
    id: "grow_crops_improved",
    name: "Grow Crops (Iron Tools)",
    producer: "farm",
    consumableInputs: {},
    equipmentRequirements: { iron_tools: 1 },
    requiredWorkers: 1,
    durationMs: 8_000,
    outputs: { crops: 5 },
    storageCapacity: 30,
    upgradeOf: "grow_crops",
  }),
  harvest_logs_improved: improvedRecipe({
    id: "harvest_logs_improved",
    name: "Harvest Logs (Iron Tools)",
    producer: "lumber_camp",
    consumableInputs: {},
    equipmentRequirements: { iron_tools: 1 },
    requiredWorkers: 1,
    durationMs: 10_000,
    outputs: { wood: 4 },
    storageCapacity: 24,
    upgradeOf: "harvest_logs",
  }),
  quarry_stone_improved: improvedRecipe({
    id: "quarry_stone_improved",
    name: "Quarry Rough Stone (Iron Tools)",
    producer: "quarry",
    consumableInputs: {},
    equipmentRequirements: { iron_tools: 2 },
    requiredWorkers: 2,
    durationMs: 12_000,
    outputs: { stone: 3 },
    storageCapacity: 18,
    upgradeOf: "quarry_stone",
  }),
};

export const defaultRecipeByProducer: Record<ProducerType, RecipeId> = {
  farm: "grow_crops",
  lumber_camp: "harvest_logs",
  quarry: "quarry_stone",
  iron_mine: "mine_iron_ore",
  workshop: "make_basic_food",
};

/**
 * How a site delivers its output to the warehouse.
 *
 * Local delivery costs nothing, so these policies differ only in when goods
 * reach the market — and that timing moves the price. Continuous supplies
 * steadily and pushes the price down, when_full delivers in batches, and
 * manual lets the player hold stock back and choose the moment.
 */
export const dispatchPolicies = ["manual", "when_full", "continuous"] as const;
export type DispatchPolicy = (typeof dispatchPolicies)[number];

/** Manual keeps existing saves and existing habits working unchanged. */
export const defaultDispatchPolicy: DispatchPolicy = "manual";

/**
 * Cadence for standing orders. Matches the market observation interval so a
 * policy's effect on price is visible at the resolution the chart records.
 */
export const standingDispatchPeriodMs = 5_000;

export function isDispatchPolicy(value: unknown): value is DispatchPolicy {
  return (
    typeof value === "string" &&
    dispatchPolicies.includes(value as DispatchPolicy)
  );
}

/** Whether a standing order should ship this site's output right now. */
export function shouldDispatch(input: {
  policy: DispatchPolicy;
  stored: number;
  storageCapacity: number;
}) {
  if (input.stored <= 0) return false;
  if (input.policy === "continuous") return true;
  if (input.policy === "when_full") return input.stored >= input.storageCapacity;
  return false;
}

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
  dispatchPolicy?: DispatchPolicy;
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
    dispatchPolicy: DispatchPolicy;
    expectedOutputPerCycle: number;
    tier: ProductionTier;
    /** Output per cycle divided by the workers the recipe requires. */
    outputPerWorkerPerCycle: number;
    upgradeRecipeId: RecipeId | null;
    upgradeOption: UpgradeOption | null;
    expansionOption: ExpansionOption | null;
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
  marketIntelligence: MarketIntelligenceSnapshot;
  competition: CompetitionSnapshot;
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

/** The improved tier that industrialises this recipe, when one is configured. */
export function upgradeRecipeFor(recipeId: RecipeId) {
  return Object.values(productionRecipes).find(
    (candidate) => candidate.upgradeOf === recipeId,
  );
}

/**
 * Output per worker per cycle. Industrialisation is meant to change labor
 * economics, so this is the number that must rise for a tier to be worth it —
 * not raw output, which any additional site can also raise.
 */
export function outputPerWorker(recipeId: RecipeId) {
  const candidate = productionRecipes[recipeId];
  return recipeOutput(candidate).amount / candidate.requiredWorkers;
}

/**
 * The two ways to grow output, priced side by side so the player can weigh
 * them: industrialise this site, or build another primitive one. Neither is
 * always better, which is the decision this data exists to support.
 */
export function describeUpgradeOption(input: {
  recipeId: RecipeId;
  assignedWorkers: number;
  cashCents: number;
  inventory: CommodityInventory;
}): UpgradeOption | null {
  const current = productionRecipes[input.recipeId];
  const improved = upgradeRecipeFor(input.recipeId);
  if (!improved) return null;
  const missingEquipment = (
    Object.entries(improved.equipmentRequirements) as [Commodity, number][]
  ).filter(([commodity, quantity]) => input.inventory[commodity] < quantity);
  const affordable = input.cashCents >= productionUpgradePolicy.upgradeCostCents;
  const blockedReasons: string[] = [];
  if (!affordable)
    blockedReasons.push(
      `Needs $${((productionUpgradePolicy.upgradeCostCents - input.cashCents) / 100).toFixed(2)} more in credits.`,
    );
  for (const [commodity, quantity] of missingEquipment)
    blockedReasons.push(
      `Needs ${quantity - input.inventory[commodity]} more ${commodityDefinitions[commodity].name}.`,
    );
  return {
    recipeId: improved.id,
    name: improved.name,
    costCents: productionUpgradePolicy.upgradeCostCents,
    equipmentRequirements: { ...improved.equipmentRequirements },
    currentWorkers: current.requiredWorkers,
    upgradedWorkers: improved.requiredWorkers,
    workersFreed: Math.max(
      0,
      Math.min(input.assignedWorkers, current.requiredWorkers) -
        improved.requiredWorkers,
    ),
    currentOutputPerCycle: recipeOutput(current).amount,
    upgradedOutputPerCycle: recipeOutput(improved).amount,
    currentOutputPerWorker: Math.round(outputPerWorker(current.id) * 100) / 100,
    upgradedOutputPerWorker:
      Math.round(outputPerWorker(improved.id) * 100) / 100,
    affordable,
    equipmentHeld: missingEquipment.length === 0,
    blockedReasons,
  };
}

/**
 * The alternative to industrialising: another primitive site of the same kind.
 * Construction cost is supplied by the caller so production keeps no dependency
 * on the construction rules.
 */
export function describeExpansionOption(input: {
  producerType: ProducerType;
  buildingName: string;
  costCents: number;
  materials: Readonly<Partial<Record<Commodity, number>>>;
  cashCents: number;
  inventory: CommodityInventory;
}): ExpansionOption {
  const recipeId = defaultRecipeByProducer[input.producerType];
  const recipe = productionRecipes[recipeId];
  const blockedReasons: string[] = [];
  const affordable = input.cashCents >= input.costCents;
  if (!affordable)
    blockedReasons.push(
      `Needs $${((input.costCents - input.cashCents) / 100).toFixed(2)} more in credits.`,
    );
  for (const [commodity, quantity] of Object.entries(input.materials) as [
    Commodity,
    number,
  ][]) {
    const missing = quantity - input.inventory[commodity];
    if (missing > 0)
      blockedReasons.push(
        `Needs ${missing} more ${commodityDefinitions[commodity].name}.`,
      );
  }
  return {
    producerType: input.producerType,
    buildingName: input.buildingName,
    recipeId,
    costCents: input.costCents,
    materials: { ...input.materials },
    requiredWorkers: recipe.requiredWorkers,
    outputPerCycle: recipeOutput(recipe).amount,
    outputPerWorker: Math.round(outputPerWorker(recipeId) * 100) / 100,
    affordable,
    blockedReasons,
  };
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
  comparison?: {
    cashCents: number;
    expansionCostCents: number;
    expansionMaterials: Readonly<Partial<Record<Commodity, number>>>;
    buildingName: string;
  },
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
    dispatchPolicy: state.dispatchPolicy ?? defaultDispatchPolicy,
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
    tier: selected.tier,
    outputPerWorkerPerCycle:
      Math.round((output.amount / selected.requiredWorkers) * 100) / 100,
    upgradeRecipeId: upgradeRecipeFor(selected.id)?.id ?? null,
    upgradeOption: comparison
      ? describeUpgradeOption({
          recipeId: selected.id,
          assignedWorkers: state.assignedWorkers,
          cashCents: comparison.cashCents,
          inventory,
        })
      : null,
    expansionOption: comparison
      ? describeExpansionOption({
          producerType: building.type,
          buildingName: comparison.buildingName,
          costCents: comparison.expansionCostCents,
          materials: comparison.expansionMaterials,
          cashCents: comparison.cashCents,
          inventory,
        })
      : null,
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
