import { placeBuilding, validatePlacement, type PlacementRequest } from "../domain/construction";
import { withStartingSettlement } from "../domain/settlement";
import { generateWorld, type WorldSnapshot } from "../domain/world";

type Session = { revision: number; world: WorldSnapshot };
const sessions = new Map<string, Session>();

export function constructForSession(sessionId: string, expectedRevision: number, placement: PlacementRequest) {
  const session = sessions.get(sessionId) ?? { revision: 0, world: withStartingSettlement(generateWorld()) };
  if (session.revision !== expectedRevision) {
    return { ok: false as const, status: 409, error: "World changed. The latest server state has been restored.", revision: session.revision, buildings: session.world.buildings };
  }
  const validation = validatePlacement(session.world, placement);
  if (!validation.valid) return { ok: false as const, status: 422, error: validation.reasons.join(". "), revision: session.revision, buildings: session.world.buildings };
  const id = `player-${session.revision + 1}`;
  const world = placeBuilding(session.world, placement, id);
  const next = { revision: session.revision + 1, world };
  sessions.set(sessionId, next);
  return { ok: true as const, status: 201, building: world.buildings?.at(-1), revision: next.revision };
}

export function clearConstructionSessionsForTests() {
  sessions.clear();
}
