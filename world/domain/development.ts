import type { ProductionSite } from "./production";

/**
 * Settlement development is a summary of the economy, never a substitute for
 * it. Per skill section 54 there is no stored level and nothing to increment:
 * the tier is derived from current conditions on every read, so a settlement
 * that loses population or food security falls back to a lower tier.
 */
export const settlementTiers = [
  "hamlet",
  "village",
  "town",
  "industrial_city",
] as const;
export type SettlementTier = (typeof settlementTiers)[number];

export const settlementTierNames: Record<SettlementTier, string> = {
  hamlet: "Hamlet",
  village: "Village",
  town: "Town",
  industrial_city: "Industrial City",
};

export const developmentRequirementIds = [
  "population",
  "housing",
  "foodSecurity",
  "employment",
  "productionBreadth",
  "trade",
  "industrialisation",
] as const;
export type DevelopmentRequirementId =
  (typeof developmentRequirementIds)[number];

export const developmentRequirementLabels: Record<
  DevelopmentRequirementId,
  string
> = {
  population: "Population",
  housing: "Housing capacity",
  foodSecurity: "Food supply",
  employment: "Workers employed",
  productionBreadth: "Industries staffed",
  trade: "Regional deliveries",
  industrialisation: "Industrialised sites",
};

/**
 * Targets per tier. Each requirement is named and independently readable, in
 * the same spirit as the migration signals: there is deliberately no single
 * aggregate score deciding progression. Targets rise monotonically across
 * tiers, which is what lets the tiers be evaluated in order.
 */
export const developmentPolicy: Record<
  SettlementTier,
  Readonly<Partial<Record<DevelopmentRequirementId, number>>>
> = {
  hamlet: {},
  village: {
    population: 12,
    housing: 12,
    foodSecurity: 100,
    employment: 5,
    productionBreadth: 2,
  },
  town: {
    population: 16,
    housing: 18,
    foodSecurity: 100,
    employment: 8,
    productionBreadth: 3,
    trade: 1,
  },
  industrial_city: {
    population: 22,
    housing: 24,
    foodSecurity: 100,
    employment: 12,
    productionBreadth: 4,
    trade: 3,
    industrialisation: 1,
  },
};

export type DevelopmentRequirement = Readonly<{
  id: DevelopmentRequirementId;
  label: string;
  current: number;
  target: number;
  met: boolean;
}>;

export type SettlementTierProgress = Readonly<{
  tier: SettlementTier;
  name: string;
  met: boolean;
  requirements: readonly DevelopmentRequirement[];
}>;

export type SettlementDevelopment = Readonly<{
  tier: SettlementTier;
  tierName: string;
  nextTier: SettlementTier | null;
  nextTierName: string | null;
  unmetRequirements: readonly DevelopmentRequirement[];
  tiers: readonly SettlementTierProgress[];
}>;

export type DevelopmentConditions = Readonly<{
  population: number;
  housingCapacity: number;
  foodSupplyPercent: number;
  employedWorkers: number;
  sites: readonly ProductionSite[];
  arrivedPlayerDeliveries: number;
}>;

/**
 * Distinct commodities produced by sites that actually have workers.
 *
 * Counting built sites instead would report every starting producer and be
 * satisfied for free; counting staffed ones measures a working economy and
 * makes staffing a new industry the way to advance.
 */
export function staffedIndustryBreadth(sites: readonly ProductionSite[]) {
  return new Set(
    sites
      .filter((site) => !site.paused && site.assignedWorkers > 0)
      .map((site) => site.output),
  ).size;
}

/**
 * Industrialised sites that are actually operating.
 *
 * Staffing is required for the same reason it is for breadth: an upgraded site
 * left without workers is capital on a shelf, and counting it would let the
 * requirement be satisfied by building something and never running it.
 */
export function industrialisedSiteCount(sites: readonly ProductionSite[]) {
  return sites.filter(
    (site) => site.tier === "improved" && !site.paused && site.assignedWorkers > 0,
  ).length;
}

function measure(
  conditions: DevelopmentConditions,
): Record<DevelopmentRequirementId, number> {
  return {
    population: conditions.population,
    housing: conditions.housingCapacity,
    foodSecurity: conditions.foodSupplyPercent,
    employment: conditions.employedWorkers,
    productionBreadth: staffedIndustryBreadth(conditions.sites),
    trade: conditions.arrivedPlayerDeliveries,
    industrialisation: industrialisedSiteCount(conditions.sites),
  };
}

function requirementsFor(
  tier: SettlementTier,
  current: Record<DevelopmentRequirementId, number>,
): DevelopmentRequirement[] {
  const targets = developmentPolicy[tier];
  return developmentRequirementIds
    .filter((id) => targets[id] !== undefined)
    .map((id) => ({
      id,
      label: developmentRequirementLabels[id],
      current: current[id],
      target: targets[id]!,
      met: current[id] >= targets[id]!,
    }));
}

/**
 * Derives the settlement's tier from current conditions.
 *
 * Tiers are evaluated in order and the settlement holds the highest one whose
 * requirements are all met. Nothing is remembered between reads, so progress
 * and regression use exactly the same path.
 */
export function describeSettlementDevelopment(
  conditions: DevelopmentConditions,
): SettlementDevelopment {
  const current = measure(conditions);
  const tiers = settlementTiers.map((tier) => {
    const requirements = requirementsFor(tier, current);
    return {
      tier,
      name: settlementTierNames[tier],
      met: requirements.every((requirement) => requirement.met),
      requirements,
    } satisfies SettlementTierProgress;
  });
  let attained: SettlementTier = settlementTiers[0];
  for (const progress of tiers) {
    if (!progress.met) break;
    attained = progress.tier;
  }
  const attainedIndex = settlementTiers.indexOf(attained);
  const nextTier = settlementTiers[attainedIndex + 1] ?? null;
  return {
    tier: attained,
    tierName: settlementTierNames[attained],
    nextTier,
    nextTierName: nextTier ? settlementTierNames[nextTier] : null,
    unmetRequirements: nextTier
      ? tiers[attainedIndex + 1].requirements.filter(
          (requirement) => !requirement.met,
        )
      : [],
    tiers,
  };
}
