import { collectProduction, productionForSession, setProductionWorkers } from "@/world/server/production-store";

function validSessionId(value: unknown): value is string {
  return typeof value === "string" && value.length >= 8 && value.length <= 100;
}

export async function GET(request: Request) {
  const sessionId = new URL(request.url).searchParams.get("sessionId");
  if (!validSessionId(sessionId)) return Response.json({ error: "Invalid production session." }, { status: 400 });
  return Response.json(productionForSession(sessionId));
}

export async function PATCH(request: Request) {
  let body: { sessionId?: unknown; buildingId?: unknown; action?: unknown; workers?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  if (!validSessionId(body.sessionId) || typeof body.buildingId !== "string") {
    return Response.json({ error: "Invalid production command." }, { status: 400 });
  }
  const result = body.action === "set_workers"
    ? setProductionWorkers(body.sessionId, body.buildingId, body.workers as number)
    : body.action === "collect"
      ? collectProduction(body.sessionId, body.buildingId)
      : { ok: false as const, status: 400, error: "Production action is unavailable." };
  return Response.json(result.ok ? result : { error: result.error }, { status: result.status });
}
