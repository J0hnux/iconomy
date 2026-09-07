import {
  commodityIds,
  commodityRecord,
  normalizeCommodityInventory,
  type Commodity,
  type CommodityInventory,
} from "./commodities";
import {
  marketDefinitions,
  marketPricingPolicy,
} from "./market";
import { consumeHouseholdFood } from "./population";
import {
  isRecipeId,
  productionRecipes,
  recipeIds,
  type RecipeId,
} from "./production";
import type { SurfaceCell, WorldPosition, WorldSnapshot } from "./world";

export const npcCitySimulationPeriodMs = 60_000;

export type NpcCitySpecialization =
  | "agriculture"
  | "forestry"
  | "mining_metals"
  | "stoneworking"
  | "coastal_trade";

export type NpcResourceAdvantage = Readonly<{
  commodity: Commodity;
  label: string;
}>;

export type NpcCityState = Readonly<{
  id: string;
  name: string;
  specialization: NpcCitySpecialization;
  position: WorldPosition;
  population: number;
  resourceAdvantages: readonly NpcResourceAdvantage[];
  recipeCapacity: Readonly<Partial<Record<RecipeId, number>>>;
  tradeCapacity: number;
  inventory: CommodityInventory;
  localPrices: Readonly<Record<Commodity, number>>;
  recentProduction: CommodityInventory;
  recentConsumption: CommodityInventory;
  imports: CommodityInventory;
  exports: CommodityInventory;
}>;

type NpcCityDefinition = Readonly<{
  id: string;
  name: string;
  specialization: NpcCitySpecialization;
  population: number;
  resourceAdvantages: readonly NpcResourceAdvantage[];
  recipeCapacity: Readonly<Partial<Record<RecipeId, number>>>;
  tradeCapacity: number;
  startingInventory: Readonly<Partial<Record<Commodity, number>>>;
  preferredPosition: Readonly<{ x: number; y: number }>;
  preferredTerrain: "farmland" | "coast" | "northwood" | "stone" | "iron";
}>;

const npcCityDefinitions: readonly NpcCityDefinition[] = [
  {
    id: "greenvale",
    name: "Greenvale",
    specialization: "agriculture",
    population: 96,
    resourceAdvantages: [
      { commodity: "crops", label: "Fertile river farmland" },
      { commodity: "food", label: "Established food processing" },
    ],
    recipeCapacity: {
      grow_crops: 30,
      make_basic_food: 6,
      make_animal_feed: 3,
      raise_livestock: 2,
    },
    tradeCapacity: 8,
    startingInventory: { crops: 70, food: 24, animal_feed: 8 },
    preferredPosition: { x: 0.22, y: 0.68 },
    preferredTerrain: "farmland",
  },
  {
    id: "northwood",
    name: "Northwood",
    specialization: "forestry",
    population: 78,
    resourceAdvantages: [
      { commodity: "wood", label: "Dense managed forest" },
      { commodity: "lumber", label: "Timber milling capacity" },
    ],
    recipeCapacity: { harvest_logs: 30, saw_lumber: 20 },
    tradeCapacity: 6,
    startingInventory: { wood: 60, lumber: 28, food: 12 },
    preferredPosition: { x: 0.18, y: 0.22 },
    preferredTerrain: "northwood",
  },
  {
    id: "stonebridge",
    name: "Stonebridge",
    specialization: "stoneworking",
    population: 68,
    resourceAdvantages: [
      { commodity: "stone", label: "Stone Ridge quarries" },
      { commodity: "cut_stone", label: "Masonry workshops" },
    ],
    recipeCapacity: { quarry_stone: 30, cut_stone: 20 },
    tradeCapacity: 5,
    startingInventory: { stone: 48, cut_stone: 24, food: 10 },
    preferredPosition: { x: 0.28, y: 0.32 },
    preferredTerrain: "stone",
  },
  {
    id: "ironhold",
    name: "Ironhold",
    specialization: "mining_metals",
    population: 72,
    resourceAdvantages: [
      { commodity: "iron_ore", label: "Iron Heights deposits" },
      { commodity: "iron", label: "Smelting industry" },
      { commodity: "iron_tools", label: "Metalworking tradition" },
    ],
    recipeCapacity: {
      mine_iron_ore: 24,
      smelt_iron: 12,
      forge_iron_tools: 4,
    },
    tradeCapacity: 6,
    startingInventory: { iron_ore: 40, iron: 16, iron_tools: 6, food: 8 },
    preferredPosition: { x: 0.7, y: 0.47 },
    preferredTerrain: "iron",
  },
  {
    id: "port-azure",
    name: "Port Azure",
    specialization: "coastal_trade",
    population: 110,
    resourceAdvantages: [
      { commodity: "prepared_meal", label: "Coastal trade and kitchens" },
      { commodity: "cooked_meat", label: "Food preservation capacity" },
    ],
    recipeCapacity: {
      butcher_meat: 8,
      cook_meat: 8,
      prepare_meal: 10,
    },
    tradeCapacity: 14,
    startingInventory: {
      crops: 10,
      livestock: 10,
      raw_meat: 8,
      cooked_meat: 10,
      prepared_meal: 18,
      food: 12,
    },
    preferredPosition: { x: 0.78, y: 0.82 },
    preferredTerrain: "coast",
  },
] as const;

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, value));

function isDryCoast(world: WorldSnapshot, cell: SurfaceCell) {
  if (cell.terrain === "water") return false;
  return ([
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const).some(([dx, dy]) => {
    const x = cell.x + dx;
    const y = cell.y + dy;
    return (
      x >= 0 &&
      y >= 0 &&
      x < world.size &&
      y < world.size &&
      world.cells[y * world.size + x].terrain === "water"
    );
  });
}

function cityPosition(world: WorldSnapshot, definition: NpcCityDefinition) {
  const nodeId =
    definition.preferredTerrain === "northwood"
      ? "northwood"
      : definition.preferredTerrain === "stone"
        ? "stone-ridge"
        : definition.preferredTerrain === "iron"
          ? "iron-heights"
          : null;
  const node = nodeId
    ? world.resourceNodes.find((candidate) => candidate.id === nodeId)
    : undefined;
  if (node) return { ...node.anchor };
  const candidates = world.cells.filter((cell) =>
    definition.preferredTerrain === "farmland"
      ? cell.terrain === "farmland"
      : definition.preferredTerrain === "coast"
        ? isDryCoast(world, cell)
        : cell.terrain !== "water",
  );
  const targetX = definition.preferredPosition.x * world.size;
  const targetY = definition.preferredPosition.y * world.size;
  const selected = [...candidates].sort(
    (first, second) =>
      Math.hypot(first.x - targetX, first.y - targetY) -
        Math.hypot(second.x - targetX, second.y - targetY) ||
      first.y - second.y ||
      first.x - second.x,
  )[0] ?? world.cells[0];
  return { x: selected.x, y: selected.y, z: selected.z };
}

export function npcCityTargetStock(city: Pick<NpcCityState, "population">, commodity: Commodity) {
  const populationScale = Math.max(1, Math.ceil(city.population / 50));
  return marketDefinitions[commodity].desiredStock * populationScale;
}

function localPrice(
  city: Pick<NpcCityState, "population">,
  commodity: Commodity,
  inventory: number,
  previousPriceCents: number,
  supply: number,
  demand: number,
) {
  const definition = marketDefinitions[commodity];
  const targetStock = npcCityTargetStock(city, commodity);
  const inventoryPressure = clamp(
    (targetStock - inventory) / targetStock,
    -1,
    1,
  );
  const flowPressure = clamp((demand - supply) / targetStock, -1, 1);
  const targetPrice = clamp(
    Math.round(
      definition.basePriceCents *
        (1 +
          inventoryPressure * marketPricingPolicy.inventoryPressureWeight +
          flowPressure * marketPricingPolicy.flowPressureWeight),
    ),
    Math.round(
      definition.basePriceCents *
        marketPricingPolicy.minimumBasePriceMultiplier,
    ),
    Math.round(
      definition.basePriceCents *
        marketPricingPolicy.maximumBasePriceMultiplier,
    ),
  );
  const previous = Math.max(1, previousPriceCents);
  const desiredChange = Math.round(
    (targetPrice - previous) * marketPricingPolicy.targetAdjustmentRate,
  );
  const maximumChange = Math.max(
    1,
    Math.round(previous * marketPricingPolicy.maximumChangePerObservation),
  );
  return Math.max(
    1,
    previous + clamp(desiredChange, -maximumChange, maximumChange),
  );
}

function productionCapacity(
  recipeCapacity: Readonly<Partial<Record<RecipeId, number>>>,
) {
  const capacity = commodityRecord(0);
  for (const recipeId of recipeIds) {
    const cycles = recipeCapacity[recipeId] ?? 0;
    for (const [commodity, quantity] of Object.entries(
      productionRecipes[recipeId].outputs,
    ) as [Commodity, number][]) capacity[commodity] += quantity * cycles;
  }
  return capacity;
}

function initialPrices(population: number, inventory: CommodityInventory) {
  return Object.fromEntries(
    commodityIds.map((commodity) => [
      commodity,
      localPrice(
        { population },
        commodity,
        inventory[commodity],
        marketDefinitions[commodity].basePriceCents,
        0,
        0,
      ),
    ]),
  ) as Record<Commodity, number>;
}

export function createNpcCities(world: WorldSnapshot): NpcCityState[] {
  return npcCityDefinitions.map((definition) => {
    const inventory = normalizeCommodityInventory(definition.startingInventory);
    return {
      id: definition.id,
      name: definition.name,
      specialization: definition.specialization,
      position: cityPosition(world, definition),
      population: definition.population,
      resourceAdvantages: definition.resourceAdvantages.map((advantage) => ({
        ...advantage,
      })),
      recipeCapacity: { ...definition.recipeCapacity },
      tradeCapacity: definition.tradeCapacity,
      inventory,
      localPrices: initialPrices(definition.population, inventory),
      recentProduction: commodityRecord(0),
      recentConsumption: commodityRecord(0),
      imports: commodityRecord(0),
      exports: commodityRecord(0),
    };
  });
}

function produceAndConsume(city: NpcCityState): NpcCityState {
  const inventory = normalizeCommodityInventory(city.inventory);
  const recentProduction = commodityRecord(0);
  const recentConsumption = commodityRecord(0);
  for (const recipeId of recipeIds) {
    const plannedCycles = city.recipeCapacity[recipeId] ?? 0;
    if (plannedCycles === 0) continue;
    const recipe = productionRecipes[recipeId];
    const inputEntries = Object.entries(recipe.consumableInputs) as [
      Commodity,
      number,
    ][];
    const equipmentAvailable = Object.entries(recipe.equipmentRequirements).every(
      ([commodity, quantity]) =>
        inventory[commodity as Commodity] >= (quantity ?? 0),
    );
    if (!equipmentAvailable) continue;
    const inputLimitedCycles = inputEntries.length
      ? Math.min(
          ...inputEntries.map(([commodity, quantity]) =>
            Math.floor(inventory[commodity] / quantity),
          ),
        )
      : plannedCycles;
    const completedCycles = Math.min(plannedCycles, inputLimitedCycles);
    for (const [commodity, quantity] of inputEntries) {
      const consumed = quantity * completedCycles;
      inventory[commodity] -= consumed;
      recentConsumption[commodity] += consumed;
    }
    for (const [commodity, quantity] of Object.entries(recipe.outputs) as [
      Commodity,
      number,
    ][]) {
      const produced = quantity * completedCycles;
      inventory[commodity] += produced;
      recentProduction[commodity] += produced;
    }
  }
  const household = consumeHouseholdFood(inventory, city.population);
  for (const source of household.consumption.sources)
    recentConsumption[source.commodity] += source.unitsConsumed;
  return {
    ...city,
    inventory: household.inventory,
    recentProduction,
    recentConsumption,
    imports: { ...city.imports },
    exports: { ...city.exports },
  };
}

export function advanceNpcCities(cities: readonly NpcCityState[]): NpcCityState[] {
  return cities.map(produceAndConsume).map((city) => ({
    ...city,
    localPrices: Object.fromEntries(
      commodityIds.map((commodity) => [
        commodity,
        localPrice(
          city,
          commodity,
          city.inventory[commodity],
          city.localPrices[commodity],
          city.recentProduction[commodity],
          city.recentConsumption[commodity],
        ),
      ]),
    ) as Record<Commodity, number>,
  }));
}

const specializations: readonly NpcCitySpecialization[] = [
  "agriculture",
  "forestry",
  "mining_metals",
  "stoneworking",
  "coastal_trade",
];

function isNonnegativeCommodityRecord(value: unknown) {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return commodityIds.every(
    (commodity) =>
      Number.isSafeInteger(record[commodity]) &&
      (record[commodity] as number) >= 0,
  );
}

export function isNpcCityState(value: unknown): value is NpcCityState {
  if (typeof value !== "object" || value === null) return false;
  const city = value as Record<string, unknown>;
  const position = city.position as Record<string, unknown> | undefined;
  const recipeCapacity = city.recipeCapacity as Record<string, unknown> | undefined;
  const advantages = city.resourceAdvantages;
  return (
    typeof city.id === "string" &&
    city.id.length > 0 &&
    typeof city.name === "string" &&
    city.name.length > 0 &&
    specializations.includes(city.specialization as NpcCitySpecialization) &&
    typeof position === "object" &&
    position !== null &&
    Number.isSafeInteger(position.x) &&
    (position.x as number) >= 0 &&
    Number.isSafeInteger(position.y) &&
    (position.y as number) >= 0 &&
    Number.isSafeInteger(position.z) &&
    (position.z as number) >= 0 &&
    Number.isSafeInteger(city.population) &&
    (city.population as number) >= 0 &&
    Number.isSafeInteger(city.tradeCapacity) &&
    (city.tradeCapacity as number) >= 0 &&
    Array.isArray(advantages) &&
    advantages.every(
      (advantage) =>
        typeof advantage === "object" &&
        advantage !== null &&
        commodityIds.includes(
          (advantage as Record<string, unknown>).commodity as Commodity,
        ) &&
        typeof (advantage as Record<string, unknown>).label === "string",
    ) &&
    typeof recipeCapacity === "object" &&
    recipeCapacity !== null &&
    Object.entries(recipeCapacity).every(
      ([recipeId, capacity]) =>
        isRecipeId(recipeId) &&
        Number.isSafeInteger(capacity) &&
        (capacity as number) >= 0,
    ) &&
    isNonnegativeCommodityRecord(city.inventory) &&
    isNonnegativeCommodityRecord(city.localPrices) &&
    commodityIds.every(
      (commodity) =>
        ((city.localPrices as Record<Commodity, number>)[commodity] ?? 0) > 0,
    ) &&
    isNonnegativeCommodityRecord(city.recentProduction) &&
    isNonnegativeCommodityRecord(city.recentConsumption) &&
    isNonnegativeCommodityRecord(city.imports) &&
    isNonnegativeCommodityRecord(city.exports)
  );
}

export function cloneNpcCity(city: NpcCityState): NpcCityState {
  return {
    ...city,
    position: { ...city.position },
    resourceAdvantages: city.resourceAdvantages.map((advantage) => ({
      ...advantage,
    })),
    recipeCapacity: { ...city.recipeCapacity },
    inventory: { ...city.inventory },
    localPrices: { ...city.localPrices },
    recentProduction: { ...city.recentProduction },
    recentConsumption: { ...city.recentConsumption },
    imports: { ...city.imports },
    exports: { ...city.exports },
  };
}

export function npcCityProductionCapacity(city: NpcCityState) {
  return productionCapacity(city.recipeCapacity);
}
