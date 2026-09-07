import {
  commodityDefinitions,
  commodityIds,
  type Commodity,
} from "./commodities";
import { productionRecipes } from "./production";

export type CommodityProductionChain = Readonly<{
  id: string;
  label: string;
  commodities: readonly Commodity[];
}>;

export type CommodityRelationships = Readonly<{
  madeFrom: readonly Commodity[];
  usedToMake: readonly Commodity[];
}>;

const commodityOrder = new Map(
  commodityIds.map((commodity, index) => [commodity, index]),
);
const byCatalogOrder = (first: Commodity, second: Commodity) =>
  commodityOrder.get(first)! - commodityOrder.get(second)!;
const recipeOutputs = (recipe: (typeof productionRecipes)[keyof typeof productionRecipes]) =>
  Object.keys(recipe.outputs) as Commodity[];
const recipeInputs = (recipe: (typeof productionRecipes)[keyof typeof productionRecipes]) =>
  Object.keys(recipe.consumableInputs) as Commodity[];

function uniqueCommodities(commodities: readonly Commodity[]) {
  return [...new Set(commodities)].sort(byCatalogOrder);
}

export function filterCommodityCatalog(
  commodities: readonly Commodity[],
  query: string,
) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return [...commodities];
  return commodities.filter((commodity) =>
    commodityDefinitions[commodity].name
      .toLocaleLowerCase()
      .includes(normalizedQuery),
  );
}

export function commodityRelationships(
  commodity: Commodity,
): CommodityRelationships {
  const recipes = Object.values(productionRecipes);
  return {
    madeFrom: uniqueCommodities(
      recipes.flatMap((recipe) =>
        recipeOutputs(recipe).includes(commodity) ? recipeInputs(recipe) : [],
      ),
    ),
    usedToMake: uniqueCommodities(
      recipes.flatMap((recipe) =>
        recipeInputs(recipe).includes(commodity) ? recipeOutputs(recipe) : [],
      ),
    ),
  };
}

export function buildCommodityProductionChains(
  availableCommodities: readonly Commodity[] = commodityIds,
): CommodityProductionChain[] {
  const available = new Set(availableCommodities);
  const neighbors = new Map<Commodity, Set<Commodity>>(
    availableCommodities.map((commodity) => [commodity, new Set()]),
  );
  const outgoing = new Map<Commodity, Set<Commodity>>(
    availableCommodities.map((commodity) => [commodity, new Set()]),
  );
  for (const recipe of Object.values(productionRecipes)) {
    for (const input of recipeInputs(recipe)) {
      if (!available.has(input)) continue;
      for (const output of recipeOutputs(recipe)) {
        if (!available.has(output)) continue;
        neighbors.get(input)!.add(output);
        neighbors.get(output)!.add(input);
        outgoing.get(input)!.add(output);
      }
    }
  }

  const remaining = new Set(availableCommodities);
  const groups: CommodityProductionChain[] = [];
  while (remaining.size) {
    const first = [...remaining].sort(byCatalogOrder)[0];
    const pending = [first];
    const members = new Set<Commodity>();
    while (pending.length) {
      const commodity = pending.shift()!;
      if (members.has(commodity)) continue;
      members.add(commodity);
      remaining.delete(commodity);
      for (const neighbor of neighbors.get(commodity) ?? [])
        if (!members.has(neighbor)) pending.push(neighbor);
    }

    const indegree = new Map(
      [...members].map((commodity) => [commodity, 0]),
    );
    for (const commodity of members)
      for (const output of outgoing.get(commodity) ?? [])
        if (members.has(output)) indegree.set(output, indegree.get(output)! + 1);
    const ordered: Commodity[] = [];
    const availableNext = [...members]
      .filter((commodity) => indegree.get(commodity) === 0)
      .sort(byCatalogOrder);
    while (availableNext.length) {
      const commodity = availableNext.shift()!;
      ordered.push(commodity);
      for (const output of outgoing.get(commodity) ?? []) {
        if (!members.has(output)) continue;
        indegree.set(output, indegree.get(output)! - 1);
        if (indegree.get(output) === 0) {
          availableNext.push(output);
          availableNext.sort(byCatalogOrder);
        }
      }
    }
    for (const commodity of [...members].sort(byCatalogOrder))
      if (!ordered.includes(commodity)) ordered.push(commodity);
    const roots = ordered.filter(
      (candidate) =>
        ![...members].some((commodity) =>
          outgoing.get(commodity)?.has(candidate),
        ),
    );
    groups.push({
      id: ordered.join("-"),
      label: `${roots.map((commodity) => commodityDefinitions[commodity].name).join(" + ")} Chain`,
      commodities: ordered,
    });
  }
  return groups;
}
