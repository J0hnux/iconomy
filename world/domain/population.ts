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
    ...foodNeed,
  };
}
