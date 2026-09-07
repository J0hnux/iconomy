import type { BuildingType } from "./settlement";
import {
  commodityDefinitions,
  normalizeCommodityInventory,
  type Commodity,
  type CommodityInventory,
} from "./commodities";
import type { WorldSnapshot } from "./world";

export const populationPolicy = {
  workingAgeNumerator: 3,
  workingAgeDenominator: 5,
  foodValuePerCitizen: 1,
  foodConsumptionPeriodMs: 60_000,
  foodSources: [
    { commodity: "prepared_meal", foodValue: 4 },
    { commodity: "cooked_meat", foodValue: 3 },
    { commodity: "food", foodValue: 2 },
    { commodity: "crops", foodValue: 1 },
  ] satisfies readonly Readonly<{
    commodity: Commodity;
    foodValue: number;
  }>[],
  housingCapacity: {
    camp: 4,
    house: 2,
  } satisfies Partial<Record<BuildingType, number>>,
  /**
   * Migration responds to named economic conditions, never to a single opaque
   * happiness score. Each threshold below belongs to exactly one signal, so a
   * population change can always be explained by the conditions that caused it.
   */
  migration: {
    /** A multiple of the consumption period, so food security has settled. */
    periodMs: 120_000,
    /** Largest number of citizens that may arrive or leave in one period. */
    maximumMovePerPeriod: 2,
    /** Food supply at or above this percent is secure enough to attract. */
    attractiveFoodSupplyPercent: 100,
    /** Food supply below this percent drives citizens away. */
    hungryFoodSupplyPercent: 75,
    /** Free housing needed before newcomers will arrive. */
    minimumHousingHeadroom: 1,
    /** Open positions needed before job opportunity attracts newcomers. */
    minimumOpenPositions: 1,
    /** Share of the workforce idle, in basis points, that drives departures. */
    idleWorkforceBasisPoints: 5_000,
    /** Population never falls below this through migration alone. */
    minimumPopulation: 1,
    /**
     * Weight of each signal. Food outweighs employment when it is short:
     * an open position is no reason to stay somewhere with nothing to eat,
     * and without this the two would cancel and a famine would never empty a
     * settlement. Weights are named per factor, never pooled into one score.
     */
    foodAttractWeight: 1,
    foodRepelWeight: 2,
    employmentAttractWeight: 1,
    employmentRepelWeight: 1,
  },
} as const;

export type FoodConsumptionSource = Readonly<{
  commodity: Commodity;
  name: string;
  unitsConsumed: number;
  foodValue: number;
  totalFoodValue: number;
}>;

export type FoodConsumptionResult = Readonly<{
  requiredFoodValue: number;
  availableFoodValue: number;
  consumedFoodValue: number;
  supplyPercent: number;
  sources: readonly FoodConsumptionSource[];
}>;

export type FoodNeedSnapshot = Readonly<{
  foodRequired: number;
  foodAvailable: number;
  foodConsumed: number;
  foodSupplyPercent: number;
  mainFoodSources: readonly FoodConsumptionSource[];
}>;

export function isFoodConsumptionResult(
  value: unknown,
): value is FoodConsumptionResult {
  if (typeof value !== "object" || value === null) return false;
  const result = value as Record<string, unknown>;
  if (
    !Number.isSafeInteger(result.requiredFoodValue) ||
    (result.requiredFoodValue as number) < 0 ||
    !Number.isSafeInteger(result.availableFoodValue) ||
    (result.availableFoodValue as number) < 0 ||
    !Number.isSafeInteger(result.consumedFoodValue) ||
    (result.consumedFoodValue as number) < 0 ||
    !Number.isInteger(result.supplyPercent) ||
    (result.supplyPercent as number) < 0 ||
    (result.supplyPercent as number) > 100 ||
    !Array.isArray(result.sources)
  )
    return false;
  const validSources = result.sources.every((source) => {
    if (typeof source !== "object" || source === null) return false;
    const entry = source as Record<string, unknown>;
    const policy = populationPolicy.foodSources.find(
      (candidate) => candidate.commodity === entry.commodity,
    );
    return (
      policy !== undefined &&
      entry.name === commodityDefinitions[policy.commodity].name &&
      Number.isSafeInteger(entry.unitsConsumed) &&
      (entry.unitsConsumed as number) > 0 &&
      entry.foodValue === policy.foodValue &&
      Number.isSafeInteger(entry.totalFoodValue) &&
      entry.totalFoodValue ===
        (entry.unitsConsumed as number) * policy.foodValue
    );
  });
  if (!validSources) return false;
  const consumedFromSources = result.sources.reduce(
    (total, source) => total + source.totalFoodValue,
    0,
  );
  const required = result.requiredFoodValue as number;
  const consumed = result.consumedFoodValue as number;
  return (
    consumedFromSources === consumed &&
    consumed <= (result.availableFoodValue as number) &&
    result.supplyPercent ===
      (required === 0
        ? 100
        : Math.min(100, Math.round((consumed / required) * 100)))
  );
}

export type PopulationSnapshot = Readonly<{
  totalPopulation: number;
  workingAgePopulation: number;
  availableWorkers: number;
  employedWorkers: number;
  unemployedWorkers: number;
  housingCapacity: number;
  openPositions: number;
  lastMigration: MigrationResult | null;
}> &
  FoodNeedSnapshot;

export function foodRequired(totalPopulation: number) {
  if (!Number.isInteger(totalPopulation) || totalPopulation < 0)
    throw new RangeError("Population must be a nonnegative integer.");
  return totalPopulation * populationPolicy.foodValuePerCitizen;
}

export function availableFoodValue(inventory: CommodityInventory) {
  return populationPolicy.foodSources.reduce(
    (total, source) =>
      total + inventory[source.commodity] * source.foodValue,
    0,
  );
}

export function consumeHouseholdFood(
  inventory: CommodityInventory,
  totalPopulation: number,
): Readonly<{
  inventory: CommodityInventory;
  consumption: FoodConsumptionResult;
}> {
  const requiredFoodValue = foodRequired(totalPopulation);
  const availableAtStart = availableFoodValue(inventory);
  const nextInventory = normalizeCommodityInventory(inventory);
  const sources: FoodConsumptionSource[] = [];
  let remainingFoodValue = requiredFoodValue;
  let consumedFoodValue = 0;
  for (const source of populationPolicy.foodSources) {
    if (remainingFoodValue <= 0) break;
    const availableUnits = nextInventory[source.commodity];
    const unitsConsumed = Math.min(
      availableUnits,
      Math.ceil(remainingFoodValue / source.foodValue),
    );
    if (unitsConsumed === 0) continue;
    const totalFoodValue = unitsConsumed * source.foodValue;
    nextInventory[source.commodity] -= unitsConsumed;
    consumedFoodValue += totalFoodValue;
    remainingFoodValue = Math.max(0, remainingFoodValue - totalFoodValue);
    sources.push({
      commodity: source.commodity,
      name: commodityDefinitions[source.commodity].name,
      unitsConsumed,
      foodValue: source.foodValue,
      totalFoodValue,
    });
  }
  return {
    inventory: nextInventory,
    consumption: {
      requiredFoodValue,
      availableFoodValue: availableAtStart,
      consumedFoodValue,
      supplyPercent:
        requiredFoodValue === 0
          ? 100
          : Math.min(100, Math.round((consumedFoodValue / requiredFoodValue) * 100)),
      sources,
    },
  };
}

export function describeFoodNeed(
  inventory: CommodityInventory,
  totalPopulation: number,
  lastConsumption: FoodConsumptionResult | null,
): FoodNeedSnapshot {
  const required = foodRequired(totalPopulation);
  const available = availableFoodValue(inventory);
  return {
    foodRequired: required,
    foodAvailable: available,
    foodConsumed: lastConsumption?.consumedFoodValue ?? 0,
    foodSupplyPercent:
      lastConsumption?.supplyPercent ??
      (required === 0
        ? 100
        : Math.min(100, Math.round((available / required) * 100))),
    mainFoodSources: lastConsumption?.sources ?? [],
  };
}

export type MigrationSignal = Readonly<{
  factor: "food" | "housing" | "employment";
  direction: "attract" | "repel" | "neutral";
  reason: string;
}>;

export type MigrationResult = Readonly<{
  arrivals: number;
  departures: number;
  netMigration: number;
  population: number;
  housingCapacity: number;
  housingHeadroom: number;
  openPositions: number;
  idleWorkers: number;
  foodSupplyPercent: number;
  signals: readonly MigrationSignal[];
}>;

export type MigrationConditions = Readonly<{
  population: number;
  housingCapacity: number;
  workingAgePopulation: number;
  employedWorkers: number;
  openPositions: number;
  foodSupplyPercent: number;
}>;

/**
 * Resolves one migration period from named economic conditions.
 *
 * Aggregate and deterministic: no individual migrant is simulated and no
 * randomness is used, so the same conditions always produce the same movement.
 * Each factor contributes its own signal, and the returned reasons are exactly
 * the signals that fired.
 */
export function resolveMigration(
  conditions: MigrationConditions,
): MigrationResult {
  const policy = populationPolicy.migration;
  const values = [
    conditions.population,
    conditions.housingCapacity,
    conditions.workingAgePopulation,
    conditions.employedWorkers,
    conditions.openPositions,
    conditions.foodSupplyPercent,
  ];
  if (values.some((value) => !Number.isInteger(value) || value < 0))
    throw new RangeError("Migration conditions must be nonnegative integers.");
  if (conditions.employedWorkers > conditions.workingAgePopulation)
    throw new RangeError("Employed workers cannot exceed the working-age population.");

  const housingHeadroom = Math.max(
    0,
    conditions.housingCapacity - conditions.population,
  );
  const idleWorkers = conditions.workingAgePopulation - conditions.employedWorkers;
  const idleBasisPoints =
    conditions.workingAgePopulation === 0
      ? 0
      : Math.round((idleWorkers / conditions.workingAgePopulation) * 10_000);

  const signals: MigrationSignal[] = [];
  let pull = 0;
  let push = 0;

  if (conditions.foodSupplyPercent >= policy.attractiveFoodSupplyPercent) {
    pull += policy.foodAttractWeight;
    signals.push({
      factor: "food",
      direction: "attract",
      reason: `Food supply is secure at ${conditions.foodSupplyPercent}%.`,
    });
  } else if (conditions.foodSupplyPercent < policy.hungryFoodSupplyPercent) {
    push += policy.foodRepelWeight;
    signals.push({
      factor: "food",
      direction: "repel",
      reason: `Food supply is short at ${conditions.foodSupplyPercent}%.`,
    });
  } else
    signals.push({
      factor: "food",
      direction: "neutral",
      reason: `Food supply is adequate at ${conditions.foodSupplyPercent}%.`,
    });

  if (housingHeadroom >= policy.minimumHousingHeadroom)
    signals.push({
      factor: "housing",
      direction: "attract",
      reason: `Housing has room for ${housingHeadroom} more ${housingHeadroom === 1 ? "citizen" : "citizens"}.`,
    });
  else
    signals.push({
      factor: "housing",
      direction: "neutral",
      reason: `Housing is full at ${conditions.housingCapacity} capacity.`,
    });

  if (conditions.openPositions >= policy.minimumOpenPositions) {
    pull += policy.employmentAttractWeight;
    signals.push({
      factor: "employment",
      direction: "attract",
      reason: `${conditions.openPositions} open ${conditions.openPositions === 1 ? "position needs" : "positions need"} workers.`,
    });
  } else if (idleBasisPoints >= policy.idleWorkforceBasisPoints) {
    push += policy.employmentRepelWeight;
    signals.push({
      factor: "employment",
      direction: "repel",
      reason: `${idleWorkers} of ${conditions.workingAgePopulation} workers have no work.`,
    });
  } else
    signals.push({
      factor: "employment",
      direction: "neutral",
      reason: `Employment is steady with ${idleWorkers} idle ${idleWorkers === 1 ? "worker" : "workers"}.`,
    });

  // Housing gates arrivals but never causes departures: a full settlement
  // simply stops attracting rather than expelling the people already in it.
  const arrivals =
    pull > push
      ? Math.min(policy.maximumMovePerPeriod, pull - push, housingHeadroom)
      : 0;
  const departures =
    push > pull
      ? Math.min(
          policy.maximumMovePerPeriod,
          push - pull,
          Math.max(0, conditions.population - policy.minimumPopulation),
        )
      : 0;
  return {
    arrivals,
    departures,
    netMigration: arrivals - departures,
    population: conditions.population + arrivals - departures,
    housingCapacity: conditions.housingCapacity,
    housingHeadroom,
    openPositions: conditions.openPositions,
    idleWorkers,
    foodSupplyPercent: conditions.foodSupplyPercent,
    signals,
  };
}

export function isMigrationResult(value: unknown): value is MigrationResult {
  if (typeof value !== "object" || value === null) return false;
  const result = value as Record<string, unknown>;
  const counts = [
    result.arrivals,
    result.departures,
    result.population,
    result.housingCapacity,
    result.housingHeadroom,
    result.openPositions,
    result.idleWorkers,
    result.foodSupplyPercent,
  ];
  return (
    counts.every((count) => Number.isInteger(count) && (count as number) >= 0) &&
    Number.isInteger(result.netMigration) &&
    result.netMigration ===
      (result.arrivals as number) - (result.departures as number) &&
    Array.isArray(result.signals) &&
    result.signals.every(
      (signal) =>
        typeof signal === "object" &&
        signal !== null &&
        ["food", "housing", "employment"].includes(
          (signal as Record<string, unknown>).factor as string,
        ) &&
        ["attract", "repel", "neutral"].includes(
          (signal as Record<string, unknown>).direction as string,
        ) &&
        typeof (signal as Record<string, unknown>).reason === "string",
    )
  );
}

export function workingAgePopulation(totalPopulation: number) {
  if (!Number.isInteger(totalPopulation) || totalPopulation < 0)
    throw new RangeError("Population must be a nonnegative integer.");
  return Math.floor(
    (totalPopulation * populationPolicy.workingAgeNumerator) /
      populationPolicy.workingAgeDenominator,
  );
}

export function describePopulation(
  world: WorldSnapshot,
  employedWorkers: number,
  foodNeed: FoodNeedSnapshot,
  openPositions = 0,
  lastMigration: MigrationResult | null = null,
): PopulationSnapshot {
  const totalPopulation = world.settlement?.population ?? 0;
  if (
    !Number.isInteger(totalPopulation) ||
    totalPopulation < 0 ||
    !Number.isInteger(employedWorkers) ||
    employedWorkers < 0 ||
    !Number.isInteger(foodNeed.foodRequired) ||
    foodNeed.foodRequired < 0 ||
    !Number.isInteger(foodNeed.foodAvailable) ||
    foodNeed.foodAvailable < 0 ||
    !Number.isInteger(foodNeed.foodConsumed) ||
    foodNeed.foodConsumed < 0
  )
    throw new RangeError("Population inputs must be nonnegative integers.");
  const workingAge = workingAgePopulation(totalPopulation);
  if (employedWorkers > workingAge)
    throw new RangeError("Employed workers cannot exceed working-age population.");
  const unemployedWorkers = workingAge - employedWorkers;
  const housingCapacity = (world.buildings ?? []).reduce(
    (total, building) =>
      total +
      (populationPolicy.housingCapacity[
        building.type as keyof typeof populationPolicy.housingCapacity
      ] ?? 0),
    0,
  );
  return {
    totalPopulation,
    workingAgePopulation: workingAge,
    availableWorkers: unemployedWorkers,
    employedWorkers,
    unemployedWorkers,
    housingCapacity,
    openPositions,
    lastMigration,
    ...foodNeed,
  };
}
