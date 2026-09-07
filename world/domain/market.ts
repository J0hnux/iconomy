import type { WarehouseInventory } from "./logistics";
import type { Commodity, ProductionSite } from "./production";
import { commodityDefinitions, commodityIds } from "./commodities";

export const marketDefinitions: Record<
  Commodity,
  Readonly<{
    name: string;
    basePriceCents: number;
    desiredStock: number;
    demandPerTick: number;
  }>
> = {
  food: {
    name: commodityDefinitions.food.name,
    basePriceCents: 600,
    desiredStock: 12,
    demandPerTick: 4,
  },
  wood: {
    name: commodityDefinitions.wood.name,
    basePriceCents: 850,
    desiredStock: 10,
    demandPerTick: 3,
  },
  stone: {
    name: commodityDefinitions.stone.name,
    basePriceCents: 1_100,
    desiredStock: 8,
    demandPerTick: 2,
  },
  crops: { name: commodityDefinitions.crops.name, basePriceCents: 450, desiredStock: 10, demandPerTick: 2 },
  lumber: { name: commodityDefinitions.lumber.name, basePriceCents: 1_250, desiredStock: 8, demandPerTick: 1 },
  cut_stone: { name: commodityDefinitions.cut_stone.name, basePriceCents: 1_600, desiredStock: 7, demandPerTick: 1 },
  animal_feed: { name: commodityDefinitions.animal_feed.name, basePriceCents: 700, desiredStock: 8, demandPerTick: 1 },
  livestock: { name: commodityDefinitions.livestock.name, basePriceCents: 1_500, desiredStock: 5, demandPerTick: 1 },
  raw_meat: { name: commodityDefinitions.raw_meat.name, basePriceCents: 1_100, desiredStock: 6, demandPerTick: 1 },
  cooked_meat: { name: commodityDefinitions.cooked_meat.name, basePriceCents: 1_700, desiredStock: 6, demandPerTick: 1 },
  prepared_meal: { name: commodityDefinitions.prepared_meal.name, basePriceCents: 2_400, desiredStock: 6, demandPerTick: 1 },
  iron_ore: { name: commodityDefinitions.iron_ore.name, basePriceCents: 1_300, desiredStock: 8, demandPerTick: 1 },
  iron: { name: commodityDefinitions.iron.name, basePriceCents: 2_100, desiredStock: 6, demandPerTick: 1 },
  iron_tools: { name: commodityDefinitions.iron_tools.name, basePriceCents: 3_800, desiredStock: 4, demandPerTick: 1 },
};

export type PricePoint = Readonly<{ time: number; priceCents: number }>;
export type ShortageLevel = "none" | "low" | "critical";
export type MarketListing = Readonly<{
  commodity: Commodity;
  name: string;
  priceCents: number;
  previousPriceCents: number;
  trendPercent: number;
  available: number;
  desiredStock: number;
  demandPerTick: number;
  shortage: ShortageLevel;
  history: readonly PricePoint[];
}>;

export type EconomyEvent = Readonly<{
  id: string;
  time: number;
  category: "market" | "production" | "logistics";
  message: string;
}>;

export type EconomicOpportunity = Readonly<{
  id: string;
  commodity: Commodity;
  title: string;
  reason: string;
  actionLabel: string;
  targetBuildingId: string;
  priority: number;
}>;

export type MarketSnapshot = Readonly<{
  updatedAt: number;
  cashCents: number;
  listings: readonly MarketListing[];
  opportunities: readonly EconomicOpportunity[];
  events: readonly EconomyEvent[];
}>;

export function marketPriceCents(
  commodity: Commodity,
  available: number,
  tick: number,
) {
  const definition = marketDefinitions[commodity];
  const scarcity = Math.max(
    -0.5,
    Math.min(
      1,
      (definition.desiredStock - available) / definition.desiredStock,
    ),
  );
  const phase = commodityIds.indexOf(commodity) * 2;
  const demandPulse = Math.sin((tick + phase) * 0.7) * 0.025;
  return Math.max(
    100,
    Math.round(definition.basePriceCents * (1 + scarcity * 0.7 + demandPulse)),
  );
}

export function shortageLevel(
  commodity: Commodity,
  available: number,
): ShortageLevel {
  const definition = marketDefinitions[commodity];
  if (available <= definition.demandPerTick) return "critical";
  if (available < definition.desiredStock) return "low";
  return "none";
}

export function buildMarketListings(
  inventory: WarehouseInventory,
  histories: Readonly<Record<Commodity, readonly PricePoint[]>>,
  tick: number,
): MarketListing[] {
  return (Object.keys(marketDefinitions) as Commodity[]).map((commodity) => {
    const definition = marketDefinitions[commodity];
    const history = histories[commodity] ?? [];
    const available = inventory[commodity] ?? 0;
    const priceCents =
      history.at(-1)?.priceCents ??
      marketPriceCents(commodity, available, tick);
    const previousPriceCents = history.at(-2)?.priceCents ?? priceCents;
    return {
      commodity,
      name: definition.name,
      priceCents,
      previousPriceCents,
      trendPercent:
        previousPriceCents === 0
          ? 0
          : Math.round(
              ((priceCents - previousPriceCents) / previousPriceCents) * 1_000,
            ) / 10,
      available,
      desiredStock: definition.desiredStock,
      demandPerTick: definition.demandPerTick,
      shortage: shortageLevel(commodity, available),
      history,
    };
  });
}

export function buildEconomicOpportunities(
  listings: readonly MarketListing[],
  sites: readonly ProductionSite[],
): EconomicOpportunity[] {
  return listings
    .flatMap((listing) => {
      const site = sites.find(
        (candidate) => candidate.output === listing.commodity,
      );
      if (!site || listing.shortage === "none") return [];
      const price = `$${(listing.priceCents / 100).toFixed(2)}`;
      if (site.status === "paused")
        return [
          {
            id: `${listing.commodity}-resume`,
            commodity: listing.commodity,
            title: `Resume ${site.name}`,
            reason: `${listing.name} is short at ${price}; production is paused.`,
            actionLabel: "Open producer",
            targetBuildingId: site.buildingId,
            priority: 110,
          },
        ];
      if (
        site.status === "missing_workers" ||
        site.status === "worker_shortage"
      )
        return [
          {
            id: `${listing.commodity}-staff`,
            commodity: listing.commodity,
            title: `Staff ${site.name}`,
            reason: `${listing.name} is critically short at ${price}; production needs ${site.requiredWorkers - site.assignedWorkers} more workers.`,
            actionLabel: "Assign workers",
            targetBuildingId: site.buildingId,
            priority: 100,
          },
        ];
      if (site.status === "missing_inputs")
        return [
          {
            id: `${listing.commodity}-inputs`,
            commodity: listing.commodity,
            title: `Supply ${site.recipeName}`,
            reason: `${listing.name} is short at ${price}; ${site.statusReason}`,
            actionLabel: "Inspect inputs",
            targetBuildingId: site.buildingId,
            priority: 95,
          },
        ];
      if (site.status === "storage_full")
        return [
          {
            id: `${listing.commodity}-dispatch`,
            commodity: listing.commodity,
            title: `Dispatch ${listing.name}`,
            reason: `${listing.name} supply is short while ${site.stored} units wait at ${site.name}.`,
            actionLabel: "Open producer",
            targetBuildingId: site.buildingId,
            priority: 90,
          },
        ];
      return [
        {
          id: `${listing.commodity}-supply`,
          commodity: listing.commodity,
          title: `Increase ${listing.name} supply`,
          reason: `${listing.name} stock is ${listing.available}/${listing.desiredStock} and trades at ${price}.`,
          actionLabel: "Inspect producer",
          targetBuildingId: site.buildingId,
          priority: listing.shortage === "critical" ? 80 : 50,
        },
      ];
    })
    .sort((a, b) => b.priority - a.priority);
}
