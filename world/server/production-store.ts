import { withStartingProduction, advanceProduction, describeProduction, isProducerType, productionRecipes, type ProductionSnapshot, type ProductionState } from "../domain/production";
import { withStartingSettlement, type Building } from "../domain/settlement";
import { generateWorld } from "../domain/world";

type ProductionSession = { states: Map<string, ProductionState> };
const sessions = new Map<string, ProductionSession>();
const scenario = withStartingProduction(withStartingSettlement(generateWorld()));
const producers = (scenario.buildings ?? []).filter((building): building is Building & { type: "farm" | "lumber_camp" | "quarry" } => isProducerType(building.type));

function createSession(now: number): ProductionSession {
  return { states: new Map(producers.map(building => {
    const recipe = productionRecipes[building.type];
    const assignedWorkers = building.type === "lumber_camp" ? 0 : recipe.requiredWorkers;
    const stored = building.type === "quarry" ? recipe.storageCapacity : 0;
    return [building.id, { buildingId: building.id, assignedWorkers, stored, progressMs: 0, updatedAt: now }];
  })) };
}

function getSession(sessionId: string, now: number) {
  const session = sessions.get(sessionId) ?? createSession(now);
  sessions.set(sessionId, session);
  return session;
}

function advanceSession(session: ProductionSession, now: number) {
  for (const building of producers) {
    const state = session.states.get(building.id);
    if (state) session.states.set(building.id, advanceProduction(state, building.type, now));
  }
}

function toSnapshot(session: ProductionSession, now: number): ProductionSnapshot {
  const sites = producers.flatMap(building => {
    const state = session.states.get(building.id);
    const site = state ? describeProduction(state, building) : null;
    return site ? [site] : [];
  });
  const population = scenario.settlement?.population ?? 0;
  const assignedWorkers = sites.reduce((total, site) => total + site.assignedWorkers, 0);
  return { serverTime: now, population, assignedWorkers, availableWorkers: population - assignedWorkers, sites };
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
  return { ok: true as const, status: 200, snapshot: toSnapshot(session, now) };
}

export function collectProduction(sessionId: string, buildingId: string, now = Date.now()) {
  const session = getSession(sessionId, now);
  advanceSession(session, now);
  const state = session.states.get(buildingId);
  if (!state) return { ok: false as const, status: 404, error: "Production site was not found." };
  const collected = state.stored;
  session.states.set(buildingId, { ...state, stored: 0, progressMs: 0, updatedAt: now });
  return { ok: true as const, status: 200, collected, snapshot: toSnapshot(session, now) };
}

export function clearProductionSessionsForTests() {
  sessions.clear();
}
