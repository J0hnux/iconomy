import {
  commodityDefinitions,
  commodityIds,
  commodityRecord,
  normalizeCommodityInventory,
  type Commodity,
  type CommodityInventory,
} from "./commodities";
import { constructionCosts, isConstructibleBuildingType } from "./construction";
import type { MarketCondition, MarketIntelligenceSnapshot } from "./market-intelligence";
import {
  productionRecipes,
  recipeOutput,
  type ProducerType,
  type ProductionSite,
} from "./production";

/**
 * Competition turns the observed economy into the player's competitive position.
 * Like market intelligence it derives; the simulation still owns every fact it reads.
 */
export const competitionPolicy = {
  /** Retained industry periods; one period matches the NPC city cadence. */
  periodHistoryLimit: 24,
  /** Lookback used for "recent entrants". */
  entrantWindowPeriods: 5,
  /** Lookback used for NPC supply growth. */
  growthWindowPeriods: 3,
} as const;

/** One period of authoritative production facts, recorded by the simulation. */
export type IndustryPeriodRecord = Readonly<{
  time: number;
  playerProduction: CommodityInventory;
  npcCityProduction: CommodityInventory;
  npcCompanyProduction: CommodityInventory;
  demand: CommodityInventory;
  playerSites: CommodityInventory;
  npcCapacity: CommodityInventory;
}>;

export type IndustryResponseKind =
  | "expand"
  | "reduce"
  | "exit"
  | "reenter"
  | "export";

export type IndustryResponseOption = Readonly<{
  kind: IndustryResponseKind;
  label: string;
  detail: string;
}>;

export type IndustryPosition = Readonly<{
  commodity: Commodity;
  commodityName: string;
  producerType: ProducerType | null;
  producerName: string | null;
  condition: MarketCondition | null;
  marketSizeUnits: number;
  currentSupply: number;
  currentDemand: number;
  priceCents: number;
  regionalMedianPriceCents: number;
  playerSupply: number;
  playerSupplyShareBasisPoints: number;
  npcSupply: number;
  npcSupplyGrowthUnits: number;
  npcSupplyGrowthBasisPoints: number;
  recentEntrants: number;
  playerSiteCount: number;
  playerActiveSiteCount: number;
  playerPausedSiteCount: number;
  unitRevenueCents: number;
  unitInputCostCents: number;
  unitMarginCents: number;
  entryCostCents: number;
  periodsObserved: number;
  responses: readonly IndustryResponseOption[];
}>;

export type CompetitionSnapshot = Readonly<{
  updatedAt: number;
  periodsRecorded: number;
  positions: readonly IndustryPosition[];
}>;

export const emptyIndustryPeriodRecord = (time: number): IndustryPeriodRecord => ({
  time,
  playerProduction: commodityRecord(0),
  npcCityProduction: commodityRecord(0),
  npcCompanyProduction: commodityRecord(0),
  demand: commodityRecord(0),
  playerSites: commodityRecord(0),
  npcCapacity: commodityRecord(0),
});

export function retainIndustryPeriods(
  history: readonly IndustryPeriodRecord[],
  record: IndustryPeriodRecord,
) {
  return [...history, record].slice(-competitionPolicy.periodHistoryLimit);
}

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

const producerOf = (commodity: Commodity) => {
  const recipe = Object.values(productionRecipes).find(
    (candidate) => (candidate.outputs[commodity] ?? 0) > 0,
  );
  return recipe ? recipe.producer : null;
};

/** Per-unit input cost of the cheapest recipe producing this commodity. */
export function unitInputCostCents(
  commodity: Commodity,
  priceOf: (input: Commodity) => number,
) {
  const costs = Object.values(productionRecipes)
    .filter((recipe) => (recipe.outputs[commodity] ?? 0) > 0)
    .map((recipe) => {
      const output = recipeOutput(recipe);
      const cycleCost = (
        Object.entries(recipe.consumableInputs) as [Commodity, number][]
      ).reduce(
        (total, [input, quantity]) => total + priceOf(input) * quantity,
        0,
      );
      return Math.round(cycleCost / Math.max(1, output.amount));
    })
    .sort((first, second) => first - second);
  return costs[0] ?? 0;
}

export function entryCostCents(producerType: ProducerType | null) {
  if (!producerType || !isConstructibleBuildingType(producerType)) return 0;
  return constructionCosts[producerType].cashCents;
}

function industryResponses(input: {
  commodity: Commodity;
  condition: MarketCondition | null;
  playerSiteCount: number;
  playerActiveSiteCount: number;
  producerType: ProducerType | null;
  unitMarginCents: number;
  entryCostCents: number;
  bestExportName: string | null;
  bestExportPriceCents: number;
}): IndustryResponseOption[] {
  const name = commodityDefinitions[input.commodity].name;
  const responses: IndustryResponseOption[] = [];
  if (input.producerType)
    responses.push({
      kind: "expand",
      label: `Expand ${name} production`,
      detail:
        input.playerSiteCount === 0
          ? `Entering costs ${money(input.entryCostCents)} and the current unit margin is ${money(input.unitMarginCents)}.`
          : `A further site costs ${money(input.entryCostCents)}; you already run ${input.playerSiteCount}.`,
    });
  if (input.playerActiveSiteCount > 0) {
    responses.push({
      kind: "reduce",
      label: `Reduce ${name} output`,
      detail: `Move workers off ${input.playerActiveSiteCount} active site${input.playerActiveSiteCount === 1 ? "" : "s"} without giving up the buildings.`,
    });
    responses.push({
      kind: "exit",
      label: `Exit ${name}`,
      detail: `Pause every ${name} site and release its workers. Reversible.`,
    });
  }
  if (input.playerSiteCount > input.playerActiveSiteCount)
    responses.push({
      kind: "reenter",
      label: `Re-enter ${name}`,
      detail: `Resume ${input.playerSiteCount - input.playerActiveSiteCount} paused site${input.playerSiteCount - input.playerActiveSiteCount === 1 ? "" : "s"} and staff them again.`,
    });
  if (input.bestExportName)
    responses.push({
      kind: "export",
      label: `Export ${name}`,
      detail: `${input.bestExportName} prices ${name} at ${money(input.bestExportPriceCents)}.`,
    });
  return responses;
}

/**
 * Derives the player's position in every industry from recorded periods,
 * live prices, and the market intelligence report. Nothing here mutates.
 */
export function buildIndustryPositions(input: {
  periods: readonly IndustryPeriodRecord[];
  sites: readonly ProductionSite[];
  priceOf: (commodity: Commodity) => number;
  intelligence: MarketIntelligenceSnapshot;
  localLocationId: string;
}): IndustryPosition[] {
  const latest = input.periods.at(-1);
  const growthWindow = input.periods.slice(
    -competitionPolicy.growthWindowPeriods,
  );
  const entrantWindow = input.periods.slice(
    -competitionPolicy.entrantWindowPeriods,
  );
  return commodityIds.map((commodity) => {
    const producerType = producerOf(commodity);
    const playerSites = input.sites.filter(
      (site) => site.output === commodity,
    );
    const activeSites = playerSites.filter((site) => !site.paused);
    const playerSupply = latest?.playerProduction[commodity] ?? 0;
    const npcSupply =
      (latest?.npcCityProduction[commodity] ?? 0) +
      (latest?.npcCompanyProduction[commodity] ?? 0);
    const currentSupply = playerSupply + npcSupply;
    const currentDemand = latest?.demand[commodity] ?? 0;

    const earliestGrowth = growthWindow[0];
    const previousNpcSupply = earliestGrowth
      ? earliestGrowth.npcCityProduction[commodity] +
        earliestGrowth.npcCompanyProduction[commodity]
      : npcSupply;
    const npcSupplyGrowthUnits = npcSupply - previousNpcSupply;

    const earliestEntrant = entrantWindow[0];
    const recentEntrants = earliestEntrant
      ? Math.max(
          0,
          (latest?.playerSites[commodity] ?? 0) +
            (latest?.npcCapacity[commodity] ?? 0) -
            earliestEntrant.playerSites[commodity] -
            earliestEntrant.npcCapacity[commodity],
        )
      : 0;

    const report = input.intelligence.reports.find(
      (candidate) =>
        candidate.commodity === commodity &&
        candidate.locationId === input.localLocationId,
    );
    const bestExport = input.intelligence.reports
      .filter(
        (candidate) =>
          candidate.commodity === commodity &&
          candidate.locationId !== input.localLocationId &&
          candidate.inventory < candidate.targetStock,
      )
      .sort(
        (first, second) =>
          second.priceCents - first.priceCents ||
          first.locationId.localeCompare(second.locationId),
      )[0];

    const unitRevenue = input.priceOf(commodity);
    const unitInputCost = unitInputCostCents(commodity, input.priceOf);
    const entryCost = entryCostCents(producerType);
    return {
      commodity,
      commodityName: commodityDefinitions[commodity].name,
      producerType,
      producerName: producerType
        ? (Object.values(productionRecipes).find(
            (recipe) => (recipe.outputs[commodity] ?? 0) > 0,
          )?.name ?? null)
        : null,
      condition: report?.condition ?? null,
      marketSizeUnits: currentSupply,
      currentSupply,
      currentDemand,
      priceCents: unitRevenue,
      regionalMedianPriceCents:
        input.intelligence.regionalMedianPricesCents[commodity],
      playerSupply,
      playerSupplyShareBasisPoints:
        currentSupply <= 0
          ? 0
          : Math.round((playerSupply / currentSupply) * 10_000),
      npcSupply,
      npcSupplyGrowthUnits,
      npcSupplyGrowthBasisPoints:
        previousNpcSupply <= 0
          ? 0
          : Math.round((npcSupplyGrowthUnits / previousNpcSupply) * 10_000),
      recentEntrants,
      playerSiteCount: playerSites.length,
      playerActiveSiteCount: activeSites.length,
      playerPausedSiteCount: playerSites.length - activeSites.length,
      unitRevenueCents: unitRevenue,
      unitInputCostCents: unitInputCost,
      unitMarginCents: unitRevenue - unitInputCost,
      entryCostCents: entryCost,
      periodsObserved: input.periods.length,
      responses: industryResponses({
        commodity,
        condition: report?.condition ?? null,
        playerSiteCount: playerSites.length,
        playerActiveSiteCount: activeSites.length,
        producerType,
        unitMarginCents: unitRevenue - unitInputCost,
        entryCostCents: entryCost,
        bestExportName: bestExport?.locationName ?? null,
        bestExportPriceCents: bestExport?.priceCents ?? 0,
      }),
    } satisfies IndustryPosition;
  });
}

export function buildCompetitionSnapshot(
  input: Parameters<typeof buildIndustryPositions>[0] & { updatedAt: number },
): CompetitionSnapshot {
  return {
    updatedAt: input.updatedAt,
    periodsRecorded: input.periods.length,
    positions: buildIndustryPositions(input),
  };
}

const isCommodityRecord = (value: unknown) => {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return commodityIds.every(
    (commodity) =>
      Number.isSafeInteger(record[commodity]) &&
      (record[commodity] as number) >= 0,
  );
};

export function isIndustryPeriodRecord(
  value: unknown,
): value is IndustryPeriodRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    Number.isSafeInteger(record.time) &&
    isCommodityRecord(record.playerProduction) &&
    isCommodityRecord(record.npcCityProduction) &&
    isCommodityRecord(record.npcCompanyProduction) &&
    isCommodityRecord(record.demand) &&
    isCommodityRecord(record.playerSites) &&
    isCommodityRecord(record.npcCapacity)
  );
}

export function cloneIndustryPeriodRecord(
  record: IndustryPeriodRecord,
): IndustryPeriodRecord {
  return {
    time: record.time,
    playerProduction: normalizeCommodityInventory(record.playerProduction),
    npcCityProduction: normalizeCommodityInventory(record.npcCityProduction),
    npcCompanyProduction: normalizeCommodityInventory(
      record.npcCompanyProduction,
    ),
    demand: normalizeCommodityInventory(record.demand),
    playerSites: normalizeCommodityInventory(record.playerSites),
    npcCapacity: normalizeCommodityInventory(record.npcCapacity),
  };
}
