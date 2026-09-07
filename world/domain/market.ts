import type { WarehouseInventory } from "./logistics";
import type { Commodity, ProductionSite } from "./production";
import { commodityDefinitions } from "./commodities";

export const marketDefinitions: Record<
  Commodity,
  Readonly<{
    name: string;
    basePriceCents: number;
    desiredStock: number;
    criticalStock: number;
  }>
> = {
  food: {
    name: commodityDefinitions.food.name,
    basePriceCents: 600,
    desiredStock: 12,
    criticalStock: 4,
  },
  wood: {
    name: commodityDefinitions.wood.name,
    basePriceCents: 850,
    desiredStock: 10,
    criticalStock: 3,
  },
  stone: {
    name: commodityDefinitions.stone.name,
    basePriceCents: 1_100,
    desiredStock: 8,
    criticalStock: 2,
  },
  crops: { name: commodityDefinitions.crops.name, basePriceCents: 450, desiredStock: 10, criticalStock: 2 },
  lumber: { name: commodityDefinitions.lumber.name, basePriceCents: 1_250, desiredStock: 8, criticalStock: 1 },
  cut_stone: { name: commodityDefinitions.cut_stone.name, basePriceCents: 1_600, desiredStock: 7, criticalStock: 1 },
  animal_feed: { name: commodityDefinitions.animal_feed.name, basePriceCents: 700, desiredStock: 8, criticalStock: 1 },
  livestock: { name: commodityDefinitions.livestock.name, basePriceCents: 1_500, desiredStock: 5, criticalStock: 1 },
  raw_meat: { name: commodityDefinitions.raw_meat.name, basePriceCents: 1_100, desiredStock: 6, criticalStock: 1 },
  cooked_meat: { name: commodityDefinitions.cooked_meat.name, basePriceCents: 1_700, desiredStock: 6, criticalStock: 1 },
  prepared_meal: { name: commodityDefinitions.prepared_meal.name, basePriceCents: 2_400, desiredStock: 6, criticalStock: 1 },
  iron_ore: { name: commodityDefinitions.iron_ore.name, basePriceCents: 1_300, desiredStock: 8, criticalStock: 1 },
  iron: { name: commodityDefinitions.iron.name, basePriceCents: 2_100, desiredStock: 6, criticalStock: 1 },
  iron_tools: { name: commodityDefinitions.iron_tools.name, basePriceCents: 3_800, desiredStock: 4, criticalStock: 1 },
};

export type MarketActivity = Readonly<{
  supply: number;
  demand: number;
  consumption: number;
}>;

export const emptyMarketActivity = (): MarketActivity => ({
  supply: 0,
  demand: 0,
  consumption: 0,
});

export const marketPricingPolicy = {
  inventoryPressureWeight: 0.65,
  flowPressureWeight: 0.35,
  targetAdjustmentRate: 0.4,
  maximumChangePerObservation: 0.12,
  minimumBasePriceMultiplier: 0.4,
  maximumBasePriceMultiplier: 2,
} as const;

export type MarketSupplyStatus =
  | "critical_shortage"
  | "shortage"
  | "balanced"
  | "oversupplied";

export type PricePoint = Readonly<{
  time: number;
  priceCents: number;
  availableInventory?: number;
  recentSupply?: number;
  recentDemand?: number;
  recentConsumption?: number;
  priceReasons?: readonly string[];
}>;
export const marketChartTimeframes = [
  { id: "1s", label: "1s", durationMs: 1_000 },
  { id: "1m", label: "1m", durationMs: 60_000 },
  { id: "5m", label: "5m", durationMs: 5 * 60_000 },
  { id: "15m", label: "15m", durationMs: 15 * 60_000 },
  { id: "1h", label: "1H", durationMs: 60 * 60_000 },
  { id: "4h", label: "4H", durationMs: 4 * 60 * 60_000 },
  { id: "1d", label: "1D", durationMs: 24 * 60 * 60_000 },
] as const;
export type MarketChartTimeframeId =
  (typeof marketChartTimeframes)[number]["id"];
export const marketPriceHistoryRetentionMs = 4 * 60 * 60_000;
export const marketPriceHistoryLimit = 4_096;
export type PriceCandle = Readonly<{
  startTime: number;
  endTime: number;
  openCents: number;
  highCents: number;
  lowCents: number;
  closeCents: number;
  observationCount: number;
  status: "active" | "complete";
}>;
export type PriceChartPoint = Readonly<{
  startTime: number;
  endTime: number;
  priceCents: number;
  observationCount: number;
  status: "active" | "complete";
}>;
export type PriceChartReadModel = Readonly<{
  observations: readonly PricePoint[];
  candles: readonly PriceCandle[];
  linePoints: readonly PriceChartPoint[];
  candleIntervalMs: number;
}>;

export function retainMarketPriceHistory(
  history: readonly PricePoint[],
  latestTime: number,
) {
  const cutoff = latestTime - marketPriceHistoryRetentionMs;
  return history
    .filter((point) => point.time >= cutoff)
    .slice(-marketPriceHistoryLimit);
}

export function buildPriceChartReadModel(
  history: readonly PricePoint[],
  candleIntervalMs = 15_000,
  currentTime = history.at(-1)?.time ?? 0,
): PriceChartReadModel {
  if (!Number.isSafeInteger(candleIntervalMs) || candleIntervalMs <= 0)
    throw new RangeError("Candle interval must be a positive safe integer.");
  const observations = history
    .map((point, index) => ({ point: { ...point }, index }))
    .sort(
      (first, second) =>
        first.point.time - second.point.time || first.index - second.index,
    )
    .map(({ point }) => point);
  const candles: PriceCandle[] = [];
  for (const observation of observations) {
    const startTime =
      Math.floor(observation.time / candleIntervalMs) * candleIntervalMs;
    const current = candles.at(-1);
    if (!current || current.startTime !== startTime) {
      candles.push({
        startTime,
        endTime: startTime + candleIntervalMs,
        openCents: observation.priceCents,
        highCents: observation.priceCents,
        lowCents: observation.priceCents,
        closeCents: observation.priceCents,
        observationCount: 1,
        status: "active",
      });
      continue;
    }
    candles[candles.length - 1] = {
      ...current,
      highCents: Math.max(current.highCents, observation.priceCents),
      lowCents: Math.min(current.lowCents, observation.priceCents),
      closeCents: observation.priceCents,
      observationCount: current.observationCount + 1,
    };
  }
  const timedCandles = candles.map((candle) => ({
    ...candle,
    status: candle.endTime <= currentTime ? "complete" : "active",
  })) satisfies PriceCandle[];
  return {
    observations,
    candles: timedCandles,
    linePoints: timedCandles.map((candle) => ({
      startTime: candle.startTime,
      endTime: candle.endTime,
      priceCents: candle.closeCents,
      observationCount: candle.observationCount,
      status: candle.status,
    })),
    candleIntervalMs,
  };
}

export type ShortageLevel = "none" | "low" | "critical";
export type MarketListing = Readonly<{
  commodity: Commodity;
  name: string;
  priceCents: number;
  previousPriceCents: number;
  trendPercent: number;
  available: number;
  desiredStock: number;
  recentSupply: number;
  recentDemand: number;
  recentConsumption: number;
  shortage: ShortageLevel;
  supplyStatus: MarketSupplyStatus;
  priceReasons: readonly string[];
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

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, value));

export function marketPriceAnalysis(
  commodity: Commodity,
  available: number,
  previousPriceCents: number,
  activity: MarketActivity,
) {
  const definition = marketDefinitions[commodity];
  const inventoryPressure = clamp(
    (definition.desiredStock - available) / definition.desiredStock,
    -1,
    1,
  );
  const flowPressure = clamp(
    (activity.demand - activity.supply) / definition.desiredStock,
    -1,
    1,
  );
  const rawTarget =
    definition.basePriceCents *
    (1 +
      inventoryPressure * marketPricingPolicy.inventoryPressureWeight +
      flowPressure * marketPricingPolicy.flowPressureWeight);
  const targetPriceCents = clamp(
    Math.round(rawTarget),
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
    (targetPriceCents - previous) * marketPricingPolicy.targetAdjustmentRate,
  );
  const maximumChange = Math.max(
    1,
    Math.round(previous * marketPricingPolicy.maximumChangePerObservation),
  );
  const priceCents = Math.max(
    1,
    previous + clamp(desiredChange, -maximumChange, maximumChange),
  );
  const reasons: string[] = [];
  if (available < definition.desiredStock)
    reasons.push(
      `Inventory ${available} is below the target of ${definition.desiredStock}.`,
    );
  else if (available > definition.desiredStock)
    reasons.push(
      `Inventory ${available} is above the target of ${definition.desiredStock}.`,
    );
  if (activity.demand > activity.supply)
    reasons.push(
      `Recent demand ${activity.demand} exceeded delivered supply ${activity.supply}.`,
    );
  else if (activity.supply > activity.demand)
    reasons.push(
      `Delivered supply ${activity.supply} exceeded recent demand ${activity.demand}.`,
    );
  if (activity.consumption > 0)
    reasons.push(`Recent consumption used ${activity.consumption} units.`);
  if (reasons.length === 0)
    reasons.push("Inventory is at target and recent supply matched demand.");
  const previousLabel = `$${(previous / 100).toFixed(2)}`;
  const priceLabel = `$${(priceCents / 100).toFixed(2)}`;
  const targetLabel = `$${(targetPriceCents / 100).toFixed(2)}`;
  if (priceCents > previous)
    reasons.push(
      `Combined pressure moved price up from ${previousLabel} to ${priceLabel} toward ${targetLabel}.`,
    );
  else if (priceCents < previous)
    reasons.push(
      `Combined pressure moved price down from ${previousLabel} to ${priceLabel} toward ${targetLabel}.`,
    );
  else reasons.push(`Price held at ${priceLabel}; calculated target is ${targetLabel}.`);
  return { priceCents, targetPriceCents, reasons } as const;
}

export function marketPriceCents(
  commodity: Commodity,
  available: number,
  previousPriceCents = marketDefinitions[commodity].basePriceCents,
  activity: MarketActivity = emptyMarketActivity(),
) {
  return marketPriceAnalysis(
    commodity,
    available,
    previousPriceCents,
    activity,
  ).priceCents;
}

export function shortageLevel(
  commodity: Commodity,
  available: number,
): ShortageLevel {
  const definition = marketDefinitions[commodity];
  if (available <= definition.criticalStock) return "critical";
  if (available < definition.desiredStock) return "low";
  return "none";
}

export function marketSupplyStatus(
  commodity: Commodity,
  available: number,
): MarketSupplyStatus {
  const shortage = shortageLevel(commodity, available);
  if (shortage === "critical") return "critical_shortage";
  if (shortage === "low") return "shortage";
  return available > marketDefinitions[commodity].desiredStock * 1.5
    ? "oversupplied"
    : "balanced";
}

export function buildMarketListings(
  inventory: WarehouseInventory,
  histories: Readonly<Record<Commodity, readonly PricePoint[]>>,
): MarketListing[] {
  return (Object.keys(marketDefinitions) as Commodity[]).map((commodity) => {
    const definition = marketDefinitions[commodity];
    const history = histories[commodity] ?? [];
    const available = inventory[commodity] ?? 0;
    const latest = history.at(-1);
    const priceCents = latest?.priceCents ?? marketPriceCents(commodity, available);
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
      recentSupply: latest?.recentSupply ?? 0,
      recentDemand: latest?.recentDemand ?? 0,
      recentConsumption: latest?.recentConsumption ?? 0,
      shortage: shortageLevel(commodity, available),
      supplyStatus: marketSupplyStatus(commodity, available),
      priceReasons:
        latest?.priceReasons ??
        marketPriceAnalysis(
          commodity,
          available,
          priceCents,
          emptyMarketActivity(),
        ).reasons,
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
