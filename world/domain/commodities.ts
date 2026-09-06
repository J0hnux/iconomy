export const commodityIds = [
  "food",
  "wood",
  "stone",
  "crops",
  "lumber",
  "cut_stone",
  "animal_feed",
  "livestock",
  "raw_meat",
  "cooked_meat",
  "prepared_meal",
  "iron_ore",
  "iron",
  "iron_tools",
] as const;

export type Commodity = (typeof commodityIds)[number];
export type CommodityInventory = Readonly<Record<Commodity, number>>;

export const commodityDefinitions: Record<
  Commodity,
  Readonly<{
    name: string;
    category: "raw" | "processed" | "consumer" | "manufactured";
  }>
> = {
  food: { name: "Basic Food", category: "consumer" },
  wood: { name: "Logs", category: "raw" },
  stone: { name: "Rough Stone", category: "raw" },
  crops: { name: "Crops", category: "raw" },
  lumber: { name: "Lumber", category: "processed" },
  cut_stone: { name: "Cut Stone", category: "processed" },
  animal_feed: { name: "Animal Feed", category: "processed" },
  livestock: { name: "Livestock", category: "processed" },
  raw_meat: { name: "Raw Meat", category: "processed" },
  cooked_meat: { name: "Cooked Meat", category: "consumer" },
  prepared_meal: { name: "Prepared Meal", category: "consumer" },
  iron_ore: { name: "Iron Ore", category: "raw" },
  iron: { name: "Iron", category: "processed" },
  iron_tools: { name: "Iron Tools", category: "manufactured" },
};

export function commodityRecord<T>(value: T): Record<Commodity, T> {
  return Object.fromEntries(
    commodityIds.map((commodity) => [commodity, value]),
  ) as Record<Commodity, T>;
}

export function normalizeCommodityInventory(
  inventory: Readonly<Partial<Record<Commodity, number>>>,
): Record<Commodity, number> {
  const normalized = commodityRecord(0);
  for (const commodity of commodityIds)
    normalized[commodity] = inventory[commodity] ?? 0;
  return normalized;
}
