import { withStartingProduction, advanceProduction, describeProduction, isProducerType, productionRecipes, type ProductionSnapshot, type ProductionState } from "../domain/production";
import { withStartingLogistics, type Shipment, type WarehouseInventory } from "../domain/logistics";
import { buildEconomicOpportunities, buildMarketListings, marketDefinitions, marketPriceCents, shortageLevel, type EconomyEvent, type PricePoint } from "../domain/market";
import { withStartingSettlement, type Building } from "../domain/settlement";
import { generateWorld } from "../domain/world";

type ProductionSession = {
  states: Map<string, ProductionState>;
  shipments: Shipment[];
  inventory: Record<keyof WarehouseInventory, number>;
  nextShipment: number;
  cashCents: number;
  marketTick: number;
  marketUpdatedAt: number;
  priceHistory: Record<keyof WarehouseInventory, PricePoint[]>;
  shortages: Record<keyof WarehouseInventory, ReturnType<typeof shortageLevel>>;
  events: EconomyEvent[];
  nextEvent: number;
};
const sessions = new Map<string, ProductionSession>();
const scenario = withStartingLogistics(withStartingProduction(withStartingSettlement(generateWorld())));
const producers = (scenario.buildings ?? []).filter((building): building is Building & { type: "farm" | "lumber_camp" | "quarry" } => isProducerType(building.type));
const warehouse = scenario.buildings?.find(building => building.type === "warehouse");

function createSession(now: number): ProductionSession {
  const farm = producers.find(building => building.type === "farm");
  const demonstrationRoute = scenario.logisticsRoutes?.find(route => route.originBuildingId === farm?.id);
  const shipments: Shipment[] = farm && warehouse && demonstrationRoute ? [{
    id: "shipment-1",
    routeId: demonstrationRoute.id,
    originBuildingId: farm.id,
    destinationBuildingId: warehouse.id,
    cargo: { commodity: "food", quantity: productionRecipes.farm.outputAmount },
    departureTime: now,
    arrivalTime: now + demonstrationRoute.durationMs,
    status: "in_transit",
  }] : [];
  const inventory = { food: 8, wood: 3, stone: 0 };
  const priceHistory = Object.fromEntries((Object.keys(marketDefinitions) as (keyof WarehouseInventory)[]).map(commodity => [commodity,
    Array.from({ length: 5 }, (_, index) => ({ time: now - (4 - index) * 5_000, priceCents: marketPriceCents(commodity, inventory[commodity], index) })),
  ])) as Record<keyof WarehouseInventory, PricePoint[]>;
  return { states: new Map(producers.map(building => {
    const recipe = productionRecipes[building.type];
    const assignedWorkers = building.type === "lumber_camp" ? 0 : recipe.requiredWorkers;
    const stored = building.type === "quarry" ? recipe.storageCapacity : 0;
    return [building.id, { buildingId: building.id, assignedWorkers, stored, progressMs: 0, updatedAt: now }];
  })), shipments, inventory, nextShipment: shipments.length + 1, cashCents: 12_450_00, marketTick: 4, marketUpdatedAt: now, priceHistory,
    shortages: { food: shortageLevel("food", inventory.food), wood: shortageLevel("wood", inventory.wood), stone: shortageLevel("stone", inventory.stone) },
    events: [
      { id: "event-1", time: now - 2_000, category: "market", message: "Stone shortage appeared in Novagrad." },
      { id: "event-2", time: now - 1_000, category: "production", message: "Lumber Camp stopped: two workers are needed." },
      ...(shipments.length ? [{ id: "event-3", time: now, category: "logistics" as const, message: "4 food departed on Harvest Road." }] : []),
    ], nextEvent: shipments.length ? 4 : 3 };
}

function getSession(sessionId: string, now: number) {
  const session = sessions.get(sessionId) ?? createSession(now);
  sessions.set(sessionId, session);
  return session;
}

function addEvent(session: ProductionSession, time: number, category: EconomyEvent["category"], message: string) {
  session.events.push({ id: `event-${session.nextEvent++}`, time, category, message });
  if (session.events.length > 30) session.events.splice(0, session.events.length - 30);
}

function recordMarket(session: ProductionSession, time: number) {
  for (const commodity of Object.keys(marketDefinitions) as (keyof WarehouseInventory)[]) {
    const history = session.priceHistory[commodity];
    const previous = history.at(-1)?.priceCents ?? marketDefinitions[commodity].basePriceCents;
    const priceCents = marketPriceCents(commodity, session.inventory[commodity], session.marketTick);
    history.push({ time, priceCents });
    if (history.length > 12) history.splice(0, history.length - 12);
    const shortage = shortageLevel(commodity, session.inventory[commodity]);
    if (shortage !== session.shortages[commodity]) {
      addEvent(session, time, "market", shortage === "none" ? `${marketDefinitions[commodity].name} shortage cleared.` : `${marketDefinitions[commodity].name} shortage is now ${shortage}.`);
      session.shortages[commodity] = shortage;
    } else if (previous > 0 && Math.abs(priceCents - previous) / previous >= 0.05) {
      const direction = priceCents > previous ? "increased" : "decreased";
      addEvent(session, time, "market", `${marketDefinitions[commodity].name} price ${direction} by ${Math.round(Math.abs(priceCents - previous) / previous * 100)}%.`);
    }
  }
}

function advanceMarket(session: ProductionSession, now: number) {
  const elapsedTicks = Math.min(24, Math.floor((now - session.marketUpdatedAt) / 5_000));
  for (let index = 0; index < elapsedTicks; index++) {
    session.marketTick++;
    session.marketUpdatedAt += 5_000;
    recordMarket(session, session.marketUpdatedAt);
  }
  if (elapsedTicks === 24) session.marketUpdatedAt = now;
}

function advanceSession(session: ProductionSession, now: number) {
  for (const building of producers) {
    const state = session.states.get(building.id);
    if (state) session.states.set(building.id, advanceProduction(state, building.type, now));
  }
  const arrivals = session.shipments.filter(shipment => shipment.status === "in_transit" && shipment.arrivalTime <= now).sort((a, b) => a.arrivalTime - b.arrivalTime);
  for (const shipment of arrivals) {
    advanceMarket(session, shipment.arrivalTime);
    session.inventory[shipment.cargo.commodity] += shipment.cargo.quantity;
    addEvent(session, shipment.arrivalTime, "logistics", `${shipment.cargo.quantity} ${shipment.cargo.commodity} arrived at Novagrad Warehouse.`);
    session.shipments = session.shipments.map(candidate => candidate.id === shipment.id ? { ...candidate, status: "arrived", arrivedAt: shipment.arrivalTime } : candidate);
  }
  advanceMarket(session, now);
}

function toSnapshot(session: ProductionSession, now: number): ProductionSnapshot {
  const sites = producers.flatMap(building => {
    const state = session.states.get(building.id);
    const site = state ? describeProduction(state, building) : null;
    return site ? [site] : [];
  });
  const population = scenario.settlement?.population ?? 0;
  const assignedWorkers = sites.reduce((total, site) => total + site.assignedWorkers, 0);
  const listings = buildMarketListings(session.inventory, session.priceHistory, session.marketTick);
  return {
    serverTime: now,
    population,
    assignedWorkers,
    availableWorkers: population - assignedWorkers,
    sites,
    logistics: {
      routes: scenario.logisticsRoutes ?? [],
      shipments: session.shipments,
      warehouseBuildingId: warehouse?.id ?? "",
      warehouseInventory: { ...session.inventory },
    },
    market: {
      updatedAt: session.marketUpdatedAt,
      cashCents: session.cashCents,
      listings,
      opportunities: buildEconomicOpportunities(listings, sites),
      events: session.events.slice(-12).reverse(),
    },
  };
}

export function productionForSession(sessionId: string, now = Date.now()) {
  const session = getSession(sessionId, now);
  advanceSession(session, now);
  return toSnapshot(session, now);
}

export function setProductionWorkers(sessionId: string, buildingId: string, workers: number, now = Date.now()) {
  const session = getSession(sessionId, now);
  advanceSession(session, now);
  const building = producers.find(candidate => candidate.id === buildingId);
  const state = session.states.get(buildingId);
  if (!building || !state) return { ok: false as const, status: 404, error: "Production site was not found." };
  const recipe = productionRecipes[building.type];
  if (!Number.isInteger(workers) || workers < 0 || workers > recipe.requiredWorkers) {
    return { ok: false as const, status: 422, error: `Workers must be between 0 and ${recipe.requiredWorkers}.` };
  }
  const assignedElsewhere = [...session.states.values()].reduce((total, candidate) => total + (candidate.buildingId === buildingId ? 0 : candidate.assignedWorkers), 0);
  if (assignedElsewhere + workers > (scenario.settlement?.population ?? 0)) {
    return { ok: false as const, status: 422, error: "Novagrad does not have enough available workers." };
  }
  session.states.set(buildingId, { ...state, assignedWorkers: workers, updatedAt: now });
  addEvent(session, now, "production", workers >= recipe.requiredWorkers ? `${building.type === "lumber_camp" ? "Lumber Camp" : building.type === "farm" ? "Farm" : "Quarry"} started production.` : `${building.type === "lumber_camp" ? "Lumber Camp" : building.type === "farm" ? "Farm" : "Quarry"} worker assignment changed to ${workers}/${recipe.requiredWorkers}.`);
  return { ok: true as const, status: 200, snapshot: toSnapshot(session, now) };
}

export function collectProduction(sessionId: string, buildingId: string, now = Date.now()) {
  const session = getSession(sessionId, now);
  advanceSession(session, now);
  const state = session.states.get(buildingId);
  if (!state) return { ok: false as const, status: 404, error: "Production site was not found." };
  if (state.stored === 0) return { ok: false as const, status: 422, error: "This production site has no output to ship." };
  const building = producers.find(candidate => candidate.id === buildingId);
  const route = scenario.logisticsRoutes?.find(candidate => candidate.originBuildingId === buildingId);
  if (!building || !route || !warehouse) return { ok: false as const, status: 422, error: "This production site has no road connection to the warehouse." };
  const collected = state.stored;
  session.states.set(buildingId, { ...state, stored: 0, progressMs: 0, updatedAt: now });
  const shipment: Shipment = {
    id: `shipment-${session.nextShipment++}`,
    routeId: route.id,
    originBuildingId: buildingId,
    destinationBuildingId: warehouse.id,
    cargo: { commodity: productionRecipes[building.type].output, quantity: collected },
    departureTime: now,
    arrivalTime: now + route.durationMs,
    status: "in_transit",
  };
  session.shipments.push(shipment);
  addEvent(session, now, "logistics", `${collected} ${shipment.cargo.commodity} departed on ${route.name}.`);
  return { ok: true as const, status: 200, collected, shipment, snapshot: toSnapshot(session, now) };
}

export function sellWarehouseGoods(sessionId: string, commodity: keyof WarehouseInventory, quantity: number, expectedPriceCents: number, now = Date.now()) {
  const session = getSession(sessionId, now);
  advanceSession(session, now);
  if (!(commodity in marketDefinitions) || !Number.isInteger(quantity) || quantity <= 0 || !Number.isInteger(expectedPriceCents) || expectedPriceCents <= 0) {
    return { ok: false as const, status: 400, error: "Invalid market sale." };
  }
  if (quantity > session.inventory[commodity]) {
    return { ok: false as const, status: 422, error: `Only ${session.inventory[commodity]} ${commodity} are available at the warehouse.` };
  }
  const listing = buildMarketListings(session.inventory, session.priceHistory, session.marketTick).find(candidate => candidate.commodity === commodity)!;
  if (listing.priceCents !== expectedPriceCents) {
    return { ok: false as const, status: 409, error: `${listing.name} is now quoted at $${(listing.priceCents / 100).toFixed(2)}. Review the refreshed market before selling.`, snapshot: toSnapshot(session, now) };
  }
  const revenueCents = listing.priceCents * quantity;
  session.inventory[commodity] -= quantity;
  session.cashCents += revenueCents;
  session.marketTick++;
  session.marketUpdatedAt = now;
  recordMarket(session, now);
  addEvent(session, now, "market", `Sold ${quantity} ${commodity} for $${(revenueCents / 100).toFixed(2)}.`);
  return { ok: true as const, status: 200, revenueCents, snapshot: toSnapshot(session, now) };
}

export function clearProductionSessionsForTests() {
  sessions.clear();
}
