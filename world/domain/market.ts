import type { WarehouseInventory } from "./logistics";
import type { Commodity, ProductionSite } from "./production";

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
    name: "Food",
    basePriceCents: 600,
    desiredStock: 12,
    demandPerTick: 4,
  },
  wood: {
    name: "Wood",
    basePriceCents: 850,
    desiredStock: 10,
    demandPerTick: 3,
  },
  stone: {
    name: "Stone",
    basePriceCents: 1_100,
    desiredStock: 8,
    demandPerTick: 2,
  },
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
  const phase = commodity === "food" ? 0 : commodity === "wood" ? 2 : 4;
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
    const history = histories[commodity];
    const priceCents =
      history.at(-1)?.priceCents ??
      marketPriceCents(commodity, inventory[commodity], tick);
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
      available: inventory[commodity],
      desiredStock: definition.desiredStock,
      demandPerTick: definition.demandPerTick,
      shortage: shortageLevel(commodity, inventory[commodity]),
      history,
    };
  });
}

export function buildEconomicOpportunities(
  listings: readonly MarketListing[],
  sites: readonly ProductionSite[],
): EconomicOpportunity[] {
  const producerFor: Record<Commodity, ProductionSite["type"]> = {
    food: "farm",
    wood: "lumber_camp",
    stone: "quarry",
  };
  return listings
    .flatMap((listing) => {
      const site = sites.find(
        (candidate) => candidate.type === producerFor[listing.commodity],
      );
      if (!site || listing.shortage === "none") return [];
      const price = `$${(listing.priceCents / 100).toFixed(2)}`;
      if (site.status === "missing_workers")
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
