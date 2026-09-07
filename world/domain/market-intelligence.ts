import {
  commodityDefinitions,
  commodityIds,
  commodityRecord,
  type Commodity,
  type CommodityInventory,
} from "./commodities";
import { marketDefinitions, type MarketListing, type PricePoint } from "./market";
import { npcCityTargetStock, type NpcCityState } from "./npc-cities";
import { productionRecipes } from "./production";

/**
 * Market intelligence observes the authoritative economy and explains it.
 * It never owns, mutates, or replaces market, city, company, or logistics state.
 */
export const marketIntelligencePolicy = {
  /** One consumption/production period; matches the household and NPC city cadence. */
  coveragePeriodMs: 60_000,
  coveragePeriodLabel: "day",
  severeCoveragePeriods: 1,
  lowCoveragePeriods: 3,
  comfortableCoveragePeriods: 10,
  severeShortageStockBasisPoints: 2_500,
  shortageStockBasisPoints: 7_500,
  oversupplyStockBasisPoints: 15_000,
  severeOversupplyStockBasisPoints: 25_000,
  notablePriceDeviationBasisPoints: 2_000,
  severePriceDeviationBasisPoints: 4_000,
  importDependenceBasisPoints: 5_000,
  shortageScore: 2,
  severeShortageScore: 4,
  oversupplyScore: 2,
  severeOversupplyScore: 4,
  reportLimit: 12,
} as const;

export type MarketCondition =
  | "severe_shortage"
  | "shortage"
  | "balanced"
  | "oversupplied"
  | "severe_oversupply";

export const marketConditionLabels: Record<MarketCondition, string> = {
  severe_shortage: "Severe Shortage",
  shortage: "Shortage",
  balanced: "Balanced",
  oversupplied: "Oversupplied",
  severe_oversupply: "Severe Oversupply",
};

export type MarketIntelligenceLocationKind = "novagrad" | "npc_city";

/** One (location, commodity) fact sheet derived from authoritative state. */
export type RegionalMarketObservation = Readonly<{
  locationId: string;
  locationName: string;
  kind: MarketIntelligenceLocationKind;
  commodity: Commodity;
  inventory: number;
  targetStock: number;
  priceCents: number;
  recentProduction: number;
  recentSupply: number;
  recentConsumption: number;
  recentDemand: number;
  imports: number;
  exports: number;
}>;

export type OpportunityResponseKind =
  | "produce"
  | "import"
  | "reduce_production"
  | "export";

/** Informational only. MS25 owns acting on these. */
export type OpportunityResponse = Readonly<{
  kind: OpportunityResponseKind;
  label: string;
  detail: string;
}>;

export type MarketIntelligenceReport = Readonly<{
  id: string;
  locationId: string;
  locationName: string;
  kind: MarketIntelligenceLocationKind;
  commodity: Commodity;
  commodityName: string;
  condition: MarketCondition;
  conditionLabel: string;
  priceCents: number;
  regionalMedianPriceCents: number;
  priceDeviationBasisPoints: number;
  inventory: number;
  targetStock: number;
  stockBasisPoints: number;
  /** Periods of local consumption the inventory covers; null when nothing was consumed. */
  inventoryCoveragePeriods: number | null;
  recentProduction: number;
  recentConsumption: number;
  productionShortfall: number;
  unfilledDemand: number;
  imports: number;
  exports: number;
  importDependenceBasisPoints: number;
  shortageScore: number;
  oversupplyScore: number;
  severity: number;
  reasons: readonly string[];
  responses: readonly OpportunityResponse[];
}>;

export type MarketIntelligenceSnapshot = Readonly<{
  updatedAt: number;
  coveragePeriodMs: number;
  regionalMedianPricesCents: Readonly<Record<Commodity, number>>;
  reports: readonly MarketIntelligenceReport[];
}>;

const commodityOrder = new Map(
  commodityIds.map((commodity, index) => [commodity, index] as const),
);

const producibleCommodities = new Set(
  Object.values(productionRecipes).flatMap(
    (recipe) => Object.keys(recipe.outputs) as Commodity[],
  ),
);

const basisPoints = (value: number, reference: number) =>
  reference <= 0 ? 0 : Math.round((value / reference) * 10_000);

const roundToTenth = (value: number) => Math.round(value * 10) / 10;

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

const periods = (value: number) =>
  `${value.toFixed(1)} ${marketIntelligencePolicy.coveragePeriodLabel}${value === 1 ? "" : "s"}`;

export type RecentMarketFlow = Readonly<{
  supply: number;
  demand: number;
  consumption: number;
}>;

/**
 * Sums the flow already recorded in local price history over one coverage period.
 * Local observations are recorded far more often than the consumption period, so
 * summing keeps Novagrad comparable with NPC cities without changing either cadence.
 */
export function summarizeRecentFlow(
  history: readonly PricePoint[],
  latestTime: number,
  windowMs: number = marketIntelligencePolicy.coveragePeriodMs,
): RecentMarketFlow {
  if (!Number.isSafeInteger(windowMs) || windowMs <= 0)
    throw new RangeError("Recent flow window must be a positive safe integer.");
  const cutoff = latestTime - windowMs;
  return history.reduce<RecentMarketFlow>(
    (total, point) =>
      point.time <= cutoff || point.time > latestTime
        ? total
        : {
            supply: total.supply + (point.recentSupply ?? 0),
            demand: total.demand + (point.recentDemand ?? 0),
            consumption: total.consumption + (point.recentConsumption ?? 0),
          },
    { supply: 0, demand: 0, consumption: 0 },
  );
}

/** Novagrad observations built from the existing local market read model. */
export function novagradMarketObservations(input: {
  locationId: string;
  locationName: string;
  listings: readonly MarketListing[];
  histories: Readonly<Record<Commodity, readonly PricePoint[]>>;
  latestTime: number;
  imports: CommodityInventory;
  exports: CommodityInventory;
}): RegionalMarketObservation[] {
  return input.listings.map((listing) => {
    const flow = summarizeRecentFlow(
      input.histories[listing.commodity] ?? [],
      input.latestTime,
    );
    return {
      locationId: input.locationId,
      locationName: input.locationName,
      kind: "novagrad",
      commodity: listing.commodity,
      inventory: listing.available,
      targetStock: marketDefinitions[listing.commodity].desiredStock,
      priceCents: listing.priceCents,
      recentProduction: flow.supply,
      recentSupply: flow.supply,
      recentConsumption: flow.consumption,
      recentDemand: flow.demand,
      imports: input.imports[listing.commodity] ?? 0,
      exports: input.exports[listing.commodity] ?? 0,
    } satisfies RegionalMarketObservation;
  });
}

/** NPC city observations built from the authoritative city state. */
export function npcCityMarketObservations(
  city: NpcCityState,
): RegionalMarketObservation[] {
  return commodityIds.map((commodity) => ({
    locationId: city.id,
    locationName: city.name,
    kind: "npc_city",
    commodity,
    inventory: city.inventory[commodity],
    targetStock: npcCityTargetStock(city, commodity),
    priceCents: city.localPrices[commodity],
    recentProduction: city.recentProduction[commodity],
    recentSupply: city.recentProduction[commodity],
    recentConsumption: city.recentConsumption[commodity],
    recentDemand: city.recentConsumption[commodity],
    imports: city.imports[commodity],
    exports: city.exports[commodity],
  }));
}

export function regionalMedianPriceCents(
  observations: readonly RegionalMarketObservation[],
  commodity: Commodity,
) {
  const prices = observations
    .filter((observation) => observation.commodity === commodity)
    .map((observation) => observation.priceCents)
    .sort((first, second) => first - second);
  if (prices.length === 0) return 0;
  const middle = Math.floor(prices.length / 2);
  return prices.length % 2 === 1
    ? prices[middle]
    : Math.round((prices[middle - 1] + prices[middle]) / 2);
}

/**
 * The regional price level, weighted by where the goods actually are.
 *
 * A plain median answers "what do most places charge", which is the wrong
 * question for a trader: a region holding a glut in one city and nothing
 * anywhere else is a cheap region, not an expensive one, because the glut is
 * the only place anyone could actually buy. Weighting by inventory makes the
 * reference follow available supply. With no inventory anywhere there is
 * nothing to buy, so the median stands in.
 */
export function regionalSupplyWeightedPriceCents(
  observations: readonly RegionalMarketObservation[],
  commodity: Commodity,
) {
  const relevant = observations.filter(
    (observation) => observation.commodity === commodity,
  );
  const stocked = relevant.filter((observation) => observation.inventory > 0);
  if (stocked.length === 0) return regionalMedianPriceCents(observations, commodity);
  const totalUnits = stocked.reduce(
    (total, observation) => total + observation.inventory,
    0,
  );
  const totalValue = stocked.reduce(
    (total, observation) =>
      total + observation.priceCents * observation.inventory,
    0,
  );
  return Math.round(totalValue / totalUnits);
}

export function inventoryCoveragePeriods(
  observation: Pick<RegionalMarketObservation, "inventory" | "recentConsumption">,
) {
  if (observation.recentConsumption <= 0) return null;
  return roundToTenth(observation.inventory / observation.recentConsumption);
}

type ConditionSignal = Readonly<{ points: number; reason: string }>;

type ConditionAnalysis = Readonly<{
  condition: MarketCondition;
  shortageScore: number;
  oversupplyScore: number;
  reasons: readonly string[];
  stockBasisPoints: number;
  priceDeviationBasisPoints: number;
  coveragePeriods: number | null;
  importDependenceBasisPoints: number;
  productionShortfall: number;
  unfilledDemand: number;
}>;

/**
 * Classifies one observation from additive signals. Every reason returned
 * corresponds to a signal that actually fired, so explanations cannot drift
 * away from the conditions that produced the classification.
 */
export function classifyMarketCondition(
  observation: RegionalMarketObservation,
  regionalMedianPrice: number,
): ConditionAnalysis {
  const policy = marketIntelligencePolicy;
  const name = commodityDefinitions[observation.commodity].name;
  const stockBasisPoints = basisPoints(
    observation.inventory,
    observation.targetStock,
  );
  const priceDeviationBasisPoints =
    regionalMedianPrice <= 0
      ? 0
      : Math.round(
          ((observation.priceCents - regionalMedianPrice) /
            regionalMedianPrice) *
            10_000,
        );
  const coveragePeriods = inventoryCoveragePeriods(observation);
  const productionShortfall = Math.max(
    0,
    observation.recentConsumption - observation.recentProduction,
  );
  const productionSurplus = Math.max(
    0,
    observation.recentProduction - observation.recentConsumption,
  );
  const unfilledDemand = Math.max(
    0,
    observation.recentDemand - observation.recentSupply,
  );
  const supplied = observation.recentProduction + observation.imports;
  const importDependenceBasisPoints =
    supplied <= 0 ? 0 : basisPoints(observation.imports, supplied);

  const shortageSignals: ConditionSignal[] = [];
  const oversupplySignals: ConditionSignal[] = [];

  if (stockBasisPoints <= policy.severeShortageStockBasisPoints)
    shortageSignals.push({
      points: 2,
      reason: `Inventory ${observation.inventory} is critically below the ${observation.targetStock} unit target.`,
    });
  else if (stockBasisPoints < policy.shortageStockBasisPoints)
    shortageSignals.push({
      points: 1,
      reason: `Inventory ${observation.inventory} is below the ${observation.targetStock} unit target.`,
    });
  else if (stockBasisPoints >= policy.severeOversupplyStockBasisPoints)
    oversupplySignals.push({
      points: 2,
      reason: `Inventory ${observation.inventory} is far above the ${observation.targetStock} unit target.`,
    });
  else if (stockBasisPoints >= policy.oversupplyStockBasisPoints)
    oversupplySignals.push({
      points: 1,
      reason: `Inventory ${observation.inventory} is above the ${observation.targetStock} unit target.`,
    });

  if (coveragePeriods !== null) {
    if (coveragePeriods <= policy.severeCoveragePeriods)
      shortageSignals.push({
        points: 2,
        reason: `Inventory coverage is critically low at ${periods(coveragePeriods)}.`,
      });
    else if (coveragePeriods <= policy.lowCoveragePeriods)
      shortageSignals.push({
        points: 1,
        reason: `Inventory coverage is short at ${periods(coveragePeriods)}.`,
      });
    else if (coveragePeriods >= policy.comfortableCoveragePeriods)
      oversupplySignals.push({
        points: 1,
        reason: `Inventory covers ${periods(coveragePeriods)} of local consumption.`,
      });
  }

  if (priceDeviationBasisPoints >= policy.severePriceDeviationBasisPoints)
    shortageSignals.push({
      points: 2,
      reason: `Price ${money(observation.priceCents)} is far above the regional median ${money(regionalMedianPrice)}.`,
    });
  else if (priceDeviationBasisPoints >= policy.notablePriceDeviationBasisPoints)
    shortageSignals.push({
      points: 1,
      reason: `Price ${money(observation.priceCents)} is above the regional median ${money(regionalMedianPrice)}.`,
    });
  else if (priceDeviationBasisPoints <= -policy.severePriceDeviationBasisPoints)
    oversupplySignals.push({
      points: 2,
      reason: `Price ${money(observation.priceCents)} is far below the regional median ${money(regionalMedianPrice)}.`,
    });
  else if (priceDeviationBasisPoints <= -policy.notablePriceDeviationBasisPoints)
    oversupplySignals.push({
      points: 1,
      reason: `Price ${money(observation.priceCents)} is below the regional median ${money(regionalMedianPrice)}.`,
    });

  if (productionShortfall > 0)
    shortageSignals.push({
      points: 1,
      reason: `Consumption ${observation.recentConsumption} exceeds local production ${observation.recentProduction}.`,
    });
  else if (productionSurplus > 0)
    oversupplySignals.push({
      points: 1,
      reason: `Local production ${observation.recentProduction} exceeds consumption ${observation.recentConsumption}.`,
    });

  if (unfilledDemand > 0)
    shortageSignals.push({
      points: 1,
      reason: `${unfilledDemand} units of recent ${name} demand went unfilled.`,
    });

  if (importDependenceBasisPoints >= policy.importDependenceBasisPoints)
    shortageSignals.push({
      points: 1,
      reason: `Imports supplied ${Math.round(importDependenceBasisPoints / 100)}% of available ${name}.`,
    });

  const shortageScore = shortageSignals.reduce(
    (total, signal) => total + signal.points,
    0,
  );
  const oversupplyScore = oversupplySignals.reduce(
    (total, signal) => total + signal.points,
    0,
  );
  const condition: MarketCondition =
    shortageScore >= policy.severeShortageScore &&
    shortageScore > oversupplyScore
      ? "severe_shortage"
      : shortageScore >= policy.shortageScore && shortageScore > oversupplyScore
        ? "shortage"
        : oversupplyScore >= policy.severeOversupplyScore &&
            oversupplyScore > shortageScore
          ? "severe_oversupply"
          : oversupplyScore >= policy.oversupplyScore &&
              oversupplyScore > shortageScore
            ? "oversupplied"
            : "balanced";
  const reasons =
    condition === "severe_shortage" || condition === "shortage"
      ? shortageSignals.map((signal) => signal.reason)
      : condition === "severe_oversupply" || condition === "oversupplied"
        ? oversupplySignals.map((signal) => signal.reason)
        : [
            `Inventory ${observation.inventory} is near the ${observation.targetStock} unit target with no dominant supply or demand pressure.`,
          ];
  return {
    condition,
    shortageScore,
    oversupplyScore,
    reasons,
    stockBasisPoints,
    priceDeviationBasisPoints,
    coveragePeriods,
    importDependenceBasisPoints,
    productionShortfall,
    unfilledDemand,
  };
}

/**
 * Informational responses only. The detector never executes anything, and it
 * only offers a response the observed economy can actually support.
 */
export function possibleResponses(
  observation: RegionalMarketObservation,
  condition: MarketCondition,
  observations: readonly RegionalMarketObservation[],
): OpportunityResponse[] {
  const name = commodityDefinitions[observation.commodity].name;
  const elsewhere = observations.filter(
    (candidate) =>
      candidate.commodity === observation.commodity &&
      candidate.locationId !== observation.locationId,
  );
  if (condition === "severe_shortage" || condition === "shortage") {
    const responses: OpportunityResponse[] = [];
    if (producibleCommodities.has(observation.commodity))
      responses.push({
        kind: "produce",
        label: `Produce ${name}`,
        detail: `${observation.locationName} holds ${observation.inventory} units against a ${observation.targetStock} unit target at ${money(observation.priceCents)}.`,
      });
    const surplus = elsewhere
      .filter((candidate) => candidate.inventory > candidate.targetStock)
      .sort(
        (first, second) =>
          first.priceCents - second.priceCents ||
          first.locationId.localeCompare(second.locationId),
      )[0];
    if (surplus)
      responses.push({
        kind: "import",
        label: `Import ${name}`,
        detail: `${surplus.locationName} holds ${surplus.inventory} units at ${money(surplus.priceCents)}.`,
      });
    return responses;
  }
  if (condition === "severe_oversupply" || condition === "oversupplied") {
    const responses: OpportunityResponse[] = [
      {
        kind: "reduce_production",
        label: `Reduce ${name} production`,
        detail: `${observation.locationName} holds ${observation.inventory} units against a ${observation.targetStock} unit target.`,
      },
    ];
    const shortLocation = elsewhere
      .filter((candidate) => candidate.inventory < candidate.targetStock)
      .sort(
        (first, second) =>
          second.priceCents - first.priceCents ||
          first.locationId.localeCompare(second.locationId),
      )[0];
    if (shortLocation)
      responses.push({
        kind: "export",
        label: `Export ${name}`,
        detail: `${shortLocation.locationName} is below target and prices ${name} at ${money(shortLocation.priceCents)}.`,
      });
    return responses;
  }
  return [];
}

const conditionSeverityRank: Record<MarketCondition, number> = {
  severe_shortage: 4,
  shortage: 3,
  severe_oversupply: 2,
  oversupplied: 1,
  balanced: 0,
};

/**
 * Reads observations and returns the derived report. Inputs are never mutated.
 */
export function detectMarketIntelligence(
  observations: readonly RegionalMarketObservation[],
  updatedAt: number,
): MarketIntelligenceSnapshot {
  if (!Number.isSafeInteger(updatedAt))
    throw new RangeError("Market intelligence time must be a safe integer.");
  const medians = commodityRecord(0);
  for (const commodity of commodityIds)
    medians[commodity] = regionalMedianPriceCents(observations, commodity);
  const reports = observations
    .map((observation) => {
      const median = medians[observation.commodity];
      const analysis = classifyMarketCondition(observation, median);
      const imbalance = Math.max(
        analysis.shortageScore,
        analysis.oversupplyScore,
      );
      return {
        id: `${observation.locationId}-${observation.commodity}`,
        locationId: observation.locationId,
        locationName: observation.locationName,
        kind: observation.kind,
        commodity: observation.commodity,
        commodityName: commodityDefinitions[observation.commodity].name,
        condition: analysis.condition,
        conditionLabel: marketConditionLabels[analysis.condition],
        priceCents: observation.priceCents,
        regionalMedianPriceCents: median,
        priceDeviationBasisPoints: analysis.priceDeviationBasisPoints,
        inventory: observation.inventory,
        targetStock: observation.targetStock,
        stockBasisPoints: analysis.stockBasisPoints,
        inventoryCoveragePeriods: analysis.coveragePeriods,
        recentProduction: observation.recentProduction,
        recentConsumption: observation.recentConsumption,
        productionShortfall: analysis.productionShortfall,
        unfilledDemand: analysis.unfilledDemand,
        imports: observation.imports,
        exports: observation.exports,
        importDependenceBasisPoints: analysis.importDependenceBasisPoints,
        shortageScore: analysis.shortageScore,
        oversupplyScore: analysis.oversupplyScore,
        severity:
          conditionSeverityRank[analysis.condition] * 100 + imbalance,
        reasons: analysis.reasons,
        responses: possibleResponses(
          observation,
          analysis.condition,
          observations,
        ),
      } satisfies MarketIntelligenceReport;
    })
    .sort(
      (first, second) =>
        second.severity - first.severity ||
        first.locationId.localeCompare(second.locationId) ||
        commodityOrder.get(first.commodity)! -
          commodityOrder.get(second.commodity)!,
    );
  return {
    updatedAt,
    coveragePeriodMs: marketIntelligencePolicy.coveragePeriodMs,
    regionalMedianPricesCents: medians,
    reports,
  };
}
