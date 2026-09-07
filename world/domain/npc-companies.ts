import {
  commodityDefinitions,
  commodityIds,
  commodityRecord,
  normalizeCommodityInventory,
  type Commodity,
  type CommodityInventory,
} from "./commodities";
import { advanceLaborWork } from "./labor";
import {
  cloneNpcCity,
  npcCityTargetStock,
  type NpcCityState,
} from "./npc-cities";
import {
  executeRecipeCycles,
  isRecipeId,
  productionRecipes,
  type RecipeId,
} from "./production";
import {
  createRegionalShipment,
  npcRegionalTradeLocation,
  quoteRegionalTransport,
  regionalLogisticsPolicy,
  type RegionalShipment,
} from "./regional-logistics";

export const npcCompanySimulationPeriodMs = 60_000;
export const npcCompanyDecisionHistoryLimit = 16;
export const npcCompanyEconomicPolicy = {
  baseExpansionCostCents: 25_000,
  minimumCashReserveCents: 30_000,
} as const;

export type NpcCompanyRole = "producer" | "trader" | "expander";
export type NpcCompanyDecisionAction =
  | "produce"
  | "trade"
  | "expand"
  | "hold";

export type NpcCompanyPolicy = Readonly<{
  riskToleranceBasisPoints: number;
  desiredMarginBasisPoints: number;
  planningHorizonPeriods: number;
  reservePreferenceBasisPoints: number;
  expansionAggressivenessBasisPoints: number;
}>;

export type NpcCompanyFacility = Readonly<{
  id: string;
  recipeId: RecipeId;
  capacity: number;
  assignedWorkers: number;
  progressMs: number;
  laborRemainder: number;
}>;

export type NpcCompanyDecision = Readonly<{
  time: number;
  action: NpcCompanyDecisionAction;
  summary: string;
  reasons: readonly string[];
}>;

export type NpcCompanyState = Readonly<{
  id: string;
  name: string;
  role: NpcCompanyRole;
  homeCityId: string;
  cashCents: number;
  workforce: number;
  inventory: CommodityInventory;
  facilities: readonly NpcCompanyFacility[];
  policy: NpcCompanyPolicy;
  periodsObserved: number;
  cumulativeRevenueCents: number;
  cumulativeCostsCents: number;
  realizedTradeProfitCents: number;
  decisions: readonly NpcCompanyDecision[];
}>;

type CompanyDefinition = Readonly<{
  id: string;
  name: string;
  role: NpcCompanyRole;
  homeCityId: string;
  cashCents: number;
  workforce: number;
  recipeId?: RecipeId;
  policy: NpcCompanyPolicy;
}>;

const definitions: readonly CompanyDefinition[] = [
  {
    id: "greenvale-pantry",
    name: "Greenvale Pantry Co.",
    role: "producer",
    homeCityId: "greenvale",
    cashCents: 65_000,
    workforce: 4,
    recipeId: "make_basic_food",
    policy: {
      riskToleranceBasisPoints: 400,
      desiredMarginBasisPoints: 900,
      planningHorizonPeriods: 1,
      reservePreferenceBasisPoints: 2_500,
      expansionAggressivenessBasisPoints: 1_000,
    },
  },
  {
    id: "azure-mercantile",
    name: "Azure Mercantile",
    role: "trader",
    homeCityId: "port-azure",
    cashCents: 90_000,
    workforce: 2,
    policy: {
      riskToleranceBasisPoints: 700,
      desiredMarginBasisPoints: 1_000,
      planningHorizonPeriods: 2,
      reservePreferenceBasisPoints: 3_000,
      expansionAggressivenessBasisPoints: 500,
    },
  },
  {
    id: "ironhold-works",
    name: "Ironhold Works",
    role: "expander",
    homeCityId: "ironhold",
    cashCents: 120_000,
    workforce: 9,
    recipeId: "mine_iron_ore",
    policy: {
      riskToleranceBasisPoints: 300,
      desiredMarginBasisPoints: 1_200,
      planningHorizonPeriods: 1,
      reservePreferenceBasisPoints: 2_000,
      expansionAggressivenessBasisPoints: 1_800,
    },
  },
];

const keepDecisions = (
  decisions: readonly NpcCompanyDecision[],
  decision: NpcCompanyDecision,
) => [...decisions, decision].slice(-npcCompanyDecisionHistoryLimit);

export function createNpcCompanies(
  cities: readonly NpcCityState[],
): NpcCompanyState[] {
  const cityIds = new Set(cities.map((city) => city.id));
  return definitions.flatMap((definition) => {
    if (!cityIds.has(definition.homeCityId)) return [];
    const recipe = definition.recipeId
      ? productionRecipes[definition.recipeId]
      : null;
    const capacity = recipe ? 1 : 0;
    return [{
      id: definition.id,
      name: definition.name,
      role: definition.role,
      homeCityId: definition.homeCityId,
      cashCents: definition.cashCents,
      workforce: definition.workforce,
      inventory: commodityRecord(0),
      facilities: recipe
        ? [{
            id: `${definition.id}-facility-1`,
            recipeId: recipe.id,
            capacity,
            assignedWorkers: Math.min(
              definition.workforce,
              recipe.requiredWorkers * capacity,
            ),
            progressMs: 0,
            laborRemainder: 0,
          }]
        : [],
      policy: { ...definition.policy },
      periodsObserved: 0,
      cumulativeRevenueCents: 0,
      cumulativeCostsCents: 0,
      realizedTradeProfitCents: 0,
      decisions: [],
    }];
  });
}

function replaceCity(
  cities: NpcCityState[],
  cityId: string,
  update: (city: NpcCityState) => NpcCityState,
) {
  const index = cities.findIndex((city) => city.id === cityId);
  if (index < 0) throw new RangeError(`NPC city ${cityId} does not exist.`);
  cities[index] = update(cities[index]);
}

function availableCityInventory(
  city: NpcCityState,
  commodity: Commodity,
  reservePreferenceBasisPoints: number,
) {
  const protectedStock = Math.floor(
    (npcCityTargetStock(city, commodity) * reservePreferenceBasisPoints) /
      10_000,
  );
  return Math.max(0, city.inventory[commodity] - protectedStock);
}

function operateCompany(
  sourceCities: readonly NpcCityState[],
  sourceCompany: NpcCompanyState,
  time: number,
) {
  const cities = sourceCities.map(cloneNpcCity);
  let company = cloneNpcCompany(sourceCompany);
  const home = cities.find((city) => city.id === company.homeCityId);
  if (!home || company.facilities.length === 0)
    return {
      cities,
      production: commodityRecord(0),
      company: {
        ...company,
        periodsObserved: company.periodsObserved + 1,
        decisions: keepDecisions(company.decisions, {
          time,
          action: "hold" as const,
          summary: "No viable production facility.",
          reasons: ["The company has no active recipe capacity in its home city."],
        }),
      },
    };
  let totalProduced = 0;
  let totalInputCost = 0;
  const production = commodityRecord(0);
  let latestRecipeId = company.facilities[0].recipeId;
  const facilities = company.facilities.map((facility) => {
    const recipe = productionRecipes[facility.recipeId];
    latestRecipeId = recipe.id;
    const requiredWorkers = recipe.requiredWorkers * facility.capacity;
    const work = advanceLaborWork(
      npcCompanySimulationPeriodMs,
      facility.assignedWorkers,
      requiredWorkers,
      facility.laborRemainder,
    );
    const productiveMs = facility.progressMs + work.effectiveMs * facility.capacity;
    const requestedCycles = Math.floor(productiveMs / recipe.durationMs);
    const requiredPurchases: Partial<Record<Commodity, number>> = {};
    for (const [commodity, quantity] of Object.entries(
      recipe.consumableInputs,
    ) as [Commodity, number][]) {
      requiredPurchases[commodity] = Math.max(
        0,
        quantity * requestedCycles - company.inventory[commodity],
      );
    }
    for (const [commodity, quantity] of Object.entries(
      recipe.equipmentRequirements,
    ) as [Commodity, number][]) {
      requiredPurchases[commodity] = Math.max(
        requiredPurchases[commodity] ?? 0,
        quantity - company.inventory[commodity],
      );
    }
    for (const commodity of commodityIds) {
      const requested = requiredPurchases[commodity] ?? 0;
      if (requested <= 0) continue;
      const currentHome = cities.find((city) => city.id === home.id)!;
      const affordable = Math.floor(
        company.cashCents / currentHome.localPrices[commodity],
      );
      const purchased = Math.min(
        requested,
        affordable,
        availableCityInventory(
          currentHome,
          commodity,
          company.policy.reservePreferenceBasisPoints,
        ),
      );
      if (purchased <= 0) continue;
      const cost = purchased * currentHome.localPrices[commodity];
      totalInputCost += cost;
      company = {
        ...company,
        cashCents: company.cashCents - cost,
        cumulativeCostsCents: company.cumulativeCostsCents + cost,
        inventory: {
          ...company.inventory,
          [commodity]: company.inventory[commodity] + purchased,
        },
      };
      replaceCity(cities, currentHome.id, (city) => ({
        ...city,
        inventory: {
          ...city.inventory,
          [commodity]: city.inventory[commodity] - purchased,
        },
      }));
    }
    const resolution = executeRecipeCycles(
      recipe.id,
      requestedCycles,
      company.inventory,
    );
    company = { ...company, inventory: resolution.inventory };
    for (const [commodity, quantity] of Object.entries(
      resolution.producedOutputs,
    ) as [Commodity, number][])
      production[commodity] += quantity;
    totalProduced += Object.values(resolution.producedOutputs).reduce(
      (total, quantity) => total + (quantity ?? 0),
      0,
    );
    return {
      ...facility,
      progressMs: productiveMs % recipe.durationMs,
      laborRemainder: work.remainder,
    };
  });
  company = { ...company, facilities };
  let revenue = 0;
  const recipe = productionRecipes[latestRecipeId];
  for (const [commodity] of Object.entries(recipe.outputs) as [Commodity, number][]) {
    const reserve = company.policy.planningHorizonPeriods;
    const quantity = Math.max(0, company.inventory[commodity] - reserve);
    if (quantity <= 0) continue;
    const currentHome = cities.find((city) => city.id === home.id)!;
    const saleRevenue = currentHome.localPrices[commodity] * quantity;
    revenue += saleRevenue;
    company = {
      ...company,
      cashCents: company.cashCents + saleRevenue,
      cumulativeRevenueCents:
        company.cumulativeRevenueCents + saleRevenue,
      inventory: { ...company.inventory, [commodity]: reserve },
    };
    replaceCity(cities, currentHome.id, (city) => ({
      ...city,
      inventory: {
        ...city.inventory,
        [commodity]: city.inventory[commodity] + quantity,
      },
    }));
  }
  const decision: NpcCompanyDecision = {
    time,
    action: "produce",
    summary: `${company.name} operated ${productionRecipes[latestRecipeId].name}.`,
    reasons: [
      `Labor: ${facilities.reduce((sum, facility) => sum + facility.assignedWorkers, 0)} / ${company.workforce} workers assigned.`,
      `Output: ${totalProduced} units; input purchases: $${(totalInputCost / 100).toFixed(2)}.`,
      `Local sales revenue: $${(revenue / 100).toFixed(2)}.`,
    ],
  };
  company = {
    ...company,
    periodsObserved: company.periodsObserved + 1,
    decisions: keepDecisions(company.decisions, decision),
  };
  if (company.role === "expander")
    company = considerExpansion(company, cities, time);
  return { cities, company, production };
}

function expectedRecipeMarginBasisPoints(
  company: NpcCompanyState,
  city: NpcCityState,
) {
  const facility = company.facilities[0];
  if (!facility) return 0;
  const recipe = productionRecipes[facility.recipeId];
  const revenue = Object.entries(recipe.outputs).reduce(
    (total, [commodity, quantity]) =>
      total + city.localPrices[commodity as Commodity] * (quantity ?? 0),
    0,
  );
  const cost = Object.entries(recipe.consumableInputs).reduce(
    (total, [commodity, quantity]) =>
      total + city.localPrices[commodity as Commodity] * (quantity ?? 0),
    0,
  );
  return revenue <= 0 ? 0 : Math.round(((revenue - cost) / revenue) * 10_000);
}

function considerExpansion(
  company: NpcCompanyState,
  cities: readonly NpcCityState[],
  time: number,
) {
  if (company.periodsObserved % company.policy.planningHorizonPeriods !== 0)
    return company;
  const facility = company.facilities[0];
  const city = cities.find((candidate) => candidate.id === company.homeCityId);
  if (!facility || !city) return company;
  const recipe = productionRecipes[facility.recipeId];
  const margin = expectedRecipeMarginBasisPoints(company, city);
  const threshold = Math.max(
    0,
    company.policy.desiredMarginBasisPoints -
      company.policy.expansionAggressivenessBasisPoints,
  );
  const expansionCost =
    npcCompanyEconomicPolicy.baseExpansionCostCents *
    (facility.capacity + 1);
  const cashReserve = npcCompanyEconomicPolicy.minimumCashReserveCents;
  const output = Object.keys(recipe.outputs)[0] as Commodity;
  const coverage =
    city.inventory[output] /
    Math.max(1, city.recentConsumption[output]);
  const laborCanUseExpansion =
    facility.capacity * recipe.requiredWorkers < company.workforce;
  if (
    margin < threshold ||
    company.cashCents < expansionCost + cashReserve ||
    !laborCanUseExpansion
  ) {
    return {
      ...company,
      decisions: keepDecisions(company.decisions, {
        time,
        action: "hold",
        summary: `${company.name} deferred expansion.`,
        reasons: [
          `Expected margin: ${(margin / 100).toFixed(1)}%; required: ${(threshold / 100).toFixed(1)}%.`,
          `Inventory coverage: ${coverage.toFixed(1)} periods.`,
          `Cash after expansion would be $${((company.cashCents - expansionCost) / 100).toFixed(2)}.`,
          laborCanUseExpansion
            ? "Unassigned labor can staff added capacity."
            : "The current workforce cannot staff more capacity.",
        ],
      }),
    };
  }
  const capacity = facility.capacity + 1;
  const assignedWorkers = Math.min(
    company.workforce,
    recipe.requiredWorkers * capacity,
  );
  return {
    ...company,
    cashCents: company.cashCents - expansionCost,
    cumulativeCostsCents: company.cumulativeCostsCents + expansionCost,
    facilities: company.facilities.map((candidate) =>
      candidate.id === facility.id
        ? { ...candidate, capacity, assignedWorkers }
        : candidate,
    ),
    decisions: keepDecisions(company.decisions, {
      time,
      action: "expand",
      summary: `${company.name} expanded ${recipe.name} capacity to ${capacity}.`,
      reasons: [
        `Expected margin: ${(margin / 100).toFixed(1)}%.`,
        `Inventory coverage: ${coverage.toFixed(1)} periods.`,
        `Cash reserve remained above $${(cashReserve / 100).toFixed(2)}.`,
      ],
    }),
  };
}

function planTrader(
  sourceCities: readonly NpcCityState[],
  sourceCompany: NpcCompanyState,
  existingShipments: readonly RegionalShipment[],
  time: number,
  nextShipmentSequence: number,
) {
  const cities = sourceCities.map(cloneNpcCity);
  let company = cloneNpcCompany(sourceCompany);
  const activeShipment = existingShipments.some(
    (shipment) =>
      shipment.status === "in_transit" &&
      shipment.owner === "npc_company" &&
      shipment.ownerId === company.id,
  );
  const planningTurn =
    company.periodsObserved % company.policy.planningHorizonPeriods === 0;
  company = { ...company, periodsObserved: company.periodsObserved + 1 };
  if (activeShipment || !planningTurn)
    return {
      cities,
      company: {
        ...company,
        decisions: keepDecisions(company.decisions, {
          time,
          action: "hold",
          summary: `${company.name} waited for its planning horizon.`,
          reasons: [activeShipment ? "Existing cargo is still in transit." : `Planning occurs every ${company.policy.planningHorizonPeriods} periods.`],
        }),
      },
      shipments: [] as RegionalShipment[],
      nextShipmentSequence,
    };
  const candidates: Array<{
    origin: NpcCityState;
    destination: NpcCityState;
    commodity: Commodity;
    quantity: number;
    profitCents: number;
    marginBasisPoints: number;
  }> = [];
  for (const origin of cities) {
    for (const destination of cities) {
      if (origin.id === destination.id) continue;
      for (const commodity of commodityIds) {
        const available = availableCityInventory(
          origin,
          commodity,
          company.policy.reservePreferenceBasisPoints,
        );
        const capacity = Math.min(
          origin.tradeCapacity,
          destination.tradeCapacity,
          regionalLogisticsPolicy.maximumShipmentCapacity,
        );
        let quantity = Math.min(available, capacity);
        while (quantity > 0) {
          const quote = quoteRegionalTransport(
            npcRegionalTradeLocation(origin),
            npcRegionalTradeLocation(destination),
            quantity,
          );
          const upfront =
            origin.localPrices[commodity] * quantity +
            quote.transportCostCents;
          if (upfront <= company.cashCents) break;
          quantity--;
        }
        if (quantity <= 0) continue;
        const transport = quoteRegionalTransport(
          npcRegionalTradeLocation(origin),
          npcRegionalTradeLocation(destination),
          quantity,
        );
        const purchase = origin.localPrices[commodity] * quantity;
        const revenue = destination.localPrices[commodity] * quantity;
        const profitCents = revenue - purchase - transport.transportCostCents;
        const marginBasisPoints = Math.round((profitCents / Math.max(1, revenue)) * 10_000);
        candidates.push({ origin, destination, commodity, quantity, profitCents, marginBasisPoints });
      }
    }
  }
  const minimumMargin = Math.max(
    0,
    company.policy.desiredMarginBasisPoints - company.policy.riskToleranceBasisPoints,
  );
  const selected = candidates
    .filter((candidate) => candidate.marginBasisPoints >= minimumMargin)
    .sort(
      (first, second) =>
        second.profitCents - first.profitCents ||
        first.origin.id.localeCompare(second.origin.id) ||
        first.destination.id.localeCompare(second.destination.id) ||
        first.commodity.localeCompare(second.commodity),
    )[0];
  if (!selected)
    return {
      cities,
      company: {
        ...company,
        decisions: keepDecisions(company.decisions, {
          time,
          action: "hold",
          summary: `${company.name} found no acceptable trade.`,
          reasons: [`No route met the ${(minimumMargin / 100).toFixed(1)}% risk-adjusted margin threshold.`],
        }),
      },
      shipments: [] as RegionalShipment[],
      nextShipmentSequence,
    };
  const shipment = createRegionalShipment({
    id: `regional-shipment-${nextShipmentSequence}`,
    origin: npcRegionalTradeLocation(selected.origin),
    destination: npcRegionalTradeLocation(selected.destination),
    commodity: selected.commodity,
    quantity: selected.quantity,
    departureTime: time,
    owner: "npc_company",
    ownerId: company.id,
    destinationAction: "sell",
  });
  const upfrontCostCents = shipment.purchaseCostCents + shipment.transportCostCents;
  const ownedShipment = { ...shipment, upfrontCostCents };
  company = {
    ...company,
    cashCents: company.cashCents - upfrontCostCents,
    cumulativeCostsCents: company.cumulativeCostsCents + upfrontCostCents,
    decisions: keepDecisions(company.decisions, {
      time,
      action: "trade",
      summary: `${company.name} shipped ${selected.quantity} ${commodityDefinitions[selected.commodity].name}.`,
      reasons: [
        `${selected.origin.name} → ${selected.destination.name}.`,
        `Expected margin: ${(selected.marginBasisPoints / 100).toFixed(1)}%; required: ${(minimumMargin / 100).toFixed(1)}%.`,
        `Expected profit after transport: $${(selected.profitCents / 100).toFixed(2)}.`,
      ],
    }),
  };
  replaceCity(cities, selected.origin.id, (city) => ({
    ...city,
    inventory: {
      ...city.inventory,
      [selected.commodity]: city.inventory[selected.commodity] - selected.quantity,
    },
    exports: {
      ...city.exports,
      [selected.commodity]: city.exports[selected.commodity] + selected.quantity,
    },
  }));
  return {
    cities,
    company,
    shipments: [ownedShipment],
    nextShipmentSequence: nextShipmentSequence + 1,
  };
}

export function advanceNpcCompanies(input: Readonly<{
  cities: readonly NpcCityState[];
  companies: readonly NpcCompanyState[];
  existingShipments: readonly RegionalShipment[];
  time: number;
  nextShipmentSequence: number;
}>) {
  let cities = input.cities.map(cloneNpcCity);
  let nextShipmentSequence = input.nextShipmentSequence;
  const shipments: RegionalShipment[] = [];
  const production = commodityRecord(0);
  const companies = [...input.companies]
    .sort((first, second) => first.id.localeCompare(second.id))
    .map((company) => {
      if (company.role === "trader") {
        const result = planTrader(
          cities,
          company,
          [...input.existingShipments, ...shipments],
          input.time,
          nextShipmentSequence,
        );
        cities = result.cities;
        shipments.push(...result.shipments);
        nextShipmentSequence = result.nextShipmentSequence;
        return result.company;
      }
      const result = operateCompany(cities, company, input.time);
      cities = result.cities;
      for (const commodity of commodityIds)
        production[commodity] += result.production[commodity];
      return result.company;
    });
  return {
    cities,
    companies,
    shipments,
    nextShipmentSequence,
    production,
  } as const;
}

export function settleNpcCompanyShipment(
  sourceCompanies: readonly NpcCompanyState[],
  shipment: RegionalShipment,
) {
  if (
    shipment.status !== "arrived" ||
    shipment.owner !== "npc_company" ||
    !shipment.ownerId
  )
    throw new RangeError("An arrived NPC company shipment is required.");
  const company = sourceCompanies.find(
    (candidate) => candidate.id === shipment.ownerId,
  );
  if (!company) throw new RangeError("NPC shipment owner does not exist.");
  return sourceCompanies.map((candidate) =>
    candidate.id === company.id
      ? {
          ...cloneNpcCompany(candidate),
          cashCents:
            candidate.cashCents + (shipment.actualCashChangeCents ?? 0),
          cumulativeRevenueCents:
            candidate.cumulativeRevenueCents +
            (shipment.actualCashChangeCents ?? 0),
          realizedTradeProfitCents:
            candidate.realizedTradeProfitCents +
            (shipment.actualProfitCents ?? 0),
          decisions: keepDecisions(candidate.decisions, {
            time: shipment.arrivedAt ?? shipment.arrivalTime,
            action: "trade",
            summary: `${candidate.name} settled a ${commodityDefinitions[shipment.commodity].name} shipment.`,
            reasons: [
              `Estimated profit: $${(shipment.estimatedProfitCents / 100).toFixed(2)}.`,
              `Realized profit: $${((shipment.actualProfitCents ?? 0) / 100).toFixed(2)} at the arrival price.`,
            ],
          }),
        }
      : cloneNpcCompany(candidate),
  );
}

const roles: readonly NpcCompanyRole[] = ["producer", "trader", "expander"];
const actions: readonly NpcCompanyDecisionAction[] = ["produce", "trade", "expand", "hold"];
const nonnegativeInteger = (value: unknown) =>
  Number.isSafeInteger(value) && (value as number) >= 0;

export function isNpcCompanyState(value: unknown): value is NpcCompanyState {
  if (typeof value !== "object" || value === null) return false;
  const company = value as Record<string, unknown>;
  const policy = company.policy as Record<string, unknown> | undefined;
  return (
    typeof company.id === "string" && company.id.length > 0 &&
    typeof company.name === "string" && company.name.length > 0 &&
    roles.includes(company.role as NpcCompanyRole) &&
    typeof company.homeCityId === "string" &&
    nonnegativeInteger(company.cashCents) &&
    nonnegativeInteger(company.workforce) &&
    typeof company.inventory === "object" && company.inventory !== null &&
    commodityIds.every((commodity) => nonnegativeInteger((company.inventory as Record<string, unknown>)[commodity])) &&
    Array.isArray(company.facilities) &&
    company.facilities.every((facility) => {
      if (typeof facility !== "object" || facility === null) return false;
      const item = facility as Record<string, unknown>;
      if (!isRecipeId(item.recipeId)) return false;
      const recipe = productionRecipes[item.recipeId];
      return typeof item.id === "string" &&
        Number.isSafeInteger(item.capacity) && (item.capacity as number) > 0 &&
        nonnegativeInteger(item.assignedWorkers) &&
        (item.assignedWorkers as number) <= (company.workforce as number) &&
        (item.assignedWorkers as number) <= recipe.requiredWorkers * (item.capacity as number) &&
        nonnegativeInteger(item.progressMs) &&
        (item.progressMs as number) < recipe.durationMs &&
        nonnegativeInteger(item.laborRemainder) &&
        (item.laborRemainder as number) < recipe.requiredWorkers * (item.capacity as number);
    }) &&
    company.facilities.reduce((sum, facility) => sum + ((facility as NpcCompanyFacility).assignedWorkers ?? 0), 0) <= (company.workforce as number) &&
    typeof policy === "object" && policy !== null &&
    ["riskToleranceBasisPoints", "desiredMarginBasisPoints", "reservePreferenceBasisPoints", "expansionAggressivenessBasisPoints"].every(
      (key) => nonnegativeInteger(policy[key]) && (policy[key] as number) <= 10_000,
    ) &&
    Number.isSafeInteger(policy.planningHorizonPeriods) && (policy.planningHorizonPeriods as number) > 0 &&
    nonnegativeInteger(company.periodsObserved) &&
    nonnegativeInteger(company.cumulativeRevenueCents) &&
    nonnegativeInteger(company.cumulativeCostsCents) &&
    Number.isSafeInteger(company.realizedTradeProfitCents) &&
    Array.isArray(company.decisions) && company.decisions.length <= npcCompanyDecisionHistoryLimit &&
    company.decisions.every((decision) => {
      if (typeof decision !== "object" || decision === null) return false;
      const item = decision as Record<string, unknown>;
      return Number.isSafeInteger(item.time) && actions.includes(item.action as NpcCompanyDecisionAction) &&
        typeof item.summary === "string" && Array.isArray(item.reasons) &&
        item.reasons.every((reason) => typeof reason === "string");
    })
  );
}

export function cloneNpcCompany(company: NpcCompanyState): NpcCompanyState {
  return {
    ...company,
    inventory: normalizeCommodityInventory(company.inventory),
    facilities: company.facilities.map((facility) => ({ ...facility })),
    policy: { ...company.policy },
    decisions: company.decisions.map((decision) => ({
      ...decision,
      reasons: [...decision.reasons],
    })),
  };
}
