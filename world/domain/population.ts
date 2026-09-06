import type { BuildingType } from "./settlement";
import type { WorldSnapshot } from "./world";

export const populationPolicy = {
  workingAgeNumerator: 3,
  workingAgeDenominator: 5,
  housingCapacity: {
    camp: 4,
    house: 2,
  } satisfies Partial<Record<BuildingType, number>>,
} as const;

export type PopulationSnapshot = Readonly<{
  totalPopulation: number;
  workingAgePopulation: number;
  availableWorkers: number;
  employedWorkers: number;
  unemployedWorkers: number;
  housingCapacity: number;
  foodSupply: number;
}>;

export function describePopulation(
  world: WorldSnapshot,
  employedWorkers: number,
  foodSupply: number,
): PopulationSnapshot {
  const totalPopulation = world.settlement?.population ?? 0;
  if (
    !Number.isInteger(totalPopulation) ||
    totalPopulation < 0 ||
    !Number.isInteger(employedWorkers) ||
    employedWorkers < 0 ||
    !Number.isInteger(foodSupply) ||
    foodSupply < 0
  )
    throw new RangeError("Population inputs must be nonnegative integers.");
  const workingAgePopulation = Math.floor(
    (totalPopulation * populationPolicy.workingAgeNumerator) /
      populationPolicy.workingAgeDenominator,
  );
  if (employedWorkers > workingAgePopulation)
    throw new RangeError("Employed workers cannot exceed working-age population.");
  const unemployedWorkers = workingAgePopulation - employedWorkers;
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
    workingAgePopulation,
    availableWorkers: unemployedWorkers,
    employedWorkers,
    unemployedWorkers,
    housingCapacity,
    foodSupply,
  };
}
