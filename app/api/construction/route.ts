import { constructForSession } from "@/world/server/construction-store";
import type { PlacementRequest } from "@/world/domain/construction";

export async function POST(request: Request) {
  let body: {
    sessionId?: unknown;
    expectedRevision?: unknown;
    placement?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }
  if (
    typeof body.sessionId !== "string" ||
    body.sessionId.length < 8 ||
    body.sessionId.length > 100 ||
    !Number.isInteger(body.expectedRevision) ||
    typeof body.placement !== "object" ||
    body.placement === null
  ) {
    return Response.json(
      { error: "Invalid construction command." },
      { status: 400 },
    );
  }
  const placement = body.placement as PlacementRequest;
  if (
    typeof placement.type !== "string" ||
    typeof placement.rotation !== "string" ||
    !Number.isInteger(placement.x) ||
    !Number.isInteger(placement.y)
  ) {
    return Response.json({ error: "Invalid placement data." }, { status: 400 });
  }
  const result = constructForSession(
    body.sessionId,
    body.expectedRevision as number,
    placement,
  );
  return Response.json(
    result.ok
      ? { building: result.building, revision: result.revision }
      : {
          error: result.error,
          revision: result.revision,
          buildings: result.buildings,
        },
    { status: result.status },
  );
}
