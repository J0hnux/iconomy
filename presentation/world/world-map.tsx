"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  constructibleBuildingTypes,
  validatePlacement,
  type PlacementRequest,
} from "@/world/domain/construction";
import {
  buildingAt,
  buildingDefinitions,
  footprintOf,
  type BuildingRotation,
  type BuildingType,
} from "@/world/domain/settlement";
import type {
  Commodity,
  ProductionSnapshot,
  ProductionSite,
} from "@/world/domain/production";
import type { PricePoint } from "@/world/domain/market";
import {
  chunkOf,
  resourceAt,
  type SurfaceCell,
  type TerrainType,
  type WorldSnapshot,
} from "@/world/domain/world";
import {
  toScreen,
  focusCell,
  panCamera,
  pickCell,
  visibleScene,
  zoomCamera,
  type Camera,
  type Viewport,
} from "./projection";
import { drawLogistics, drawWorld, type PlacementPreview } from "./render";
import { PlayerHud, WorldMinimap, BottomHud } from "./hud";

const button =
  "rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-slate-200 transition hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-amber-200 disabled:opacity-30";

const rotations: readonly BuildingRotation[] = [
  "north",
  "east",
  "south",
  "west",
];
const terrainNames: Record<TerrainType, string> = {
  grassland: "Grassland",
  water: "Water",
  mountain: "Mountain",
  forest_ground: "Forest",
  farmland: "Farmland",
};

const money = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function PriceSparkline({ history }: { history: readonly PricePoint[] }) {
  const values = history.map((point) => point.priceCents);
  const minimum = Math.min(...values),
    maximum = Math.max(...values);
  const range = Math.max(1, maximum - minimum);
  const points = values
    .map(
      (value, index) =>
        `${values.length === 1 ? 50 : (index / (values.length - 1)) * 100},${28 - ((value - minimum) / range) * 24}`,
    )
    .join(" ");
  return (
    <svg
      viewBox="0 0 100 32"
      role="img"
      aria-label="Recent price trend"
      className="h-8 w-full overflow-visible"
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export default function WorldMap({
  world: initialWorld,
}: {
  world: WorldSnapshot;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const logisticsCanvasRef = useRef<HTMLCanvasElement>(null);
  const [world, setWorld] = useState(initialWorld);
  const [camera, setCamera] = useState<Camera>({
    focus: world.settlement
      ? focusCell(world.settlement.anchor)
      : { x: world.size / 2, y: world.size / 2 },
    zoom: world.settlement ? 2 : 1,
  });
  const [viewport, setViewport] = useState<Viewport>({ width: 1, height: 1 });
  const [selected, setSelected] = useState<SurfaceCell | null>(() => {
    const anchor = initialWorld.settlement?.anchor;
    return anchor
      ? initialWorld.cells[anchor.y * initialWorld.size + anchor.x]
      : null;
  });
  const [grid, setGrid] = useState(true);
  const [showChunks, setShowChunks] = useState(false);
  const [tool, setTool] = useState<"inspect" | "build">("inspect");
  const [buildingType, setBuildingType] = useState<BuildingType>("house");
  const [rotation, setRotation] = useState<BuildingRotation>("north");
  const [hovered, setHovered] = useState<SurfaceCell | null>(null);
  const [revision, setRevision] = useState(0);
  const [buildMessage, setBuildMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [production, setProduction] = useState<ProductionSnapshot | null>(null);
  const [productionMessage, setProductionMessage] = useState<string | null>(
    null,
  );
  const [productionBusy, setProductionBusy] = useState(false);
  const [marketOpen, setMarketOpen] = useState(false);
  const [companyOpen, setCompanyOpen] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const [marketMessage, setMarketMessage] = useState<string | null>(null);
  const sessionId = useRef<string | null>(null);
  const drag = useRef<{
    id: number;
    startX: number;
    startY: number;
    x: number;
    y: number;
    moved: boolean;
  } | null>(null);

  const placement = useMemo<PlacementPreview | null>(() => {
    if (tool !== "build" || !hovered) return null;
    const request: PlacementRequest = {
      type: buildingType,
      x: hovered.x,
      y: hovered.y,
      rotation,
    };
    return { request, validation: validatePlacement(world, request) };
  }, [tool, hovered, buildingType, rotation, world]);
  const scene = useMemo(
    () => visibleScene(world, camera, viewport),
    [world, camera, viewport],
  );
  const visibleBuildingCount = useMemo(
    () =>
      (world.buildings ?? []).filter((building) => {
        const chunk = chunkOf(building, world.chunkSize);
        return scene.chunkIds.has(`${chunk.x},${chunk.y}`);
      }).length,
    [world, scene],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      setViewport({ width: bounds.width, height: bounds.height });
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    window.addEventListener("resize", resize);
    resize();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(viewport.width * ratio);
    canvas.height = Math.round(viewport.height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    drawWorld(
      ctx,
      world,
      camera,
      viewport,
      selected,
      grid,
      placement,
      production,
      scene,
      showChunks,
    );
  }, [
    world,
    camera,
    viewport,
    selected,
    grid,
    placement,
    production,
    scene,
    showChunks,
  ]);

  useEffect(() => {
    const canvas = logisticsCanvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !production) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(viewport.width * ratio);
    canvas.height = Math.round(viewport.height * ratio);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    const serverOffset = production.serverTime - Date.now();
    let frame = 0;
    const draw = () => {
      const now = Date.now() + serverOffset;
      drawLogistics(ctx, world, camera, viewport, production, now, scene);
      const moving = production.logistics.shipments.some(
        (shipment) =>
          shipment.status === "in_transit" ||
          (shipment.arrivedAt !== undefined &&
            now - shipment.arrivedAt < 5_000),
      );
      if (moving) frame = window.requestAnimationFrame(draw);
    };
    draw();
    return () => window.cancelAnimationFrame(frame);
  }, [world, camera, viewport, production, scene]);

  useEffect(() => {
    sessionId.current ??= crypto.randomUUID();
    let cancelled = false;
    const refresh = async () => {
      try {
        const response = await fetch(
          `/api/production?sessionId=${encodeURIComponent(sessionId.current!)}`,
          { cache: "no-store" },
        );
        const result = (await response.json()) as ProductionSnapshot & {
          error?: string;
        };
        if (!response.ok) throw new Error(result.error);
        if (!cancelled) setProduction(result);
      } catch {
        if (!cancelled)
          setProductionMessage("Production server is unavailable. Retrying…");
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 1_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const bounds = canvas.getBoundingClientRect();
      const delta =
        event.deltaY *
        (event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? bounds.height
            : 1);
      setCamera((current) =>
        zoomCamera(
          current,
          Math.exp(-Math.max(-200, Math.min(200, delta)) * 0.002),
          { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
          { width: bounds.width, height: bounds.height },
          world.size,
        ),
      );
    };
    canvas.addEventListener("wheel", wheel, { passive: false });
    return () => canvas.removeEventListener("wheel", wheel);
  }, [world.size]);

  const zoom = (factor: number) =>
    setCamera((current) =>
      zoomCamera(
        current,
        factor,
        { x: viewport.width / 2, y: viewport.height / 2 },
        viewport,
        world.size,
      ),
    );
  const rotatePreview = () =>
    setRotation(
      (current) =>
        rotations[(rotations.indexOf(current) + 1) % rotations.length],
    );
  const updateProduction = async (
    site: ProductionSite,
    action: "set_workers" | "collect",
    workers?: number,
  ) => {
    if (productionBusy) return;
    setProductionBusy(true);
    setProductionMessage(
      action === "collect" ? "Collecting output…" : "Assigning workers…",
    );
    sessionId.current ??= crypto.randomUUID();
    try {
      const response = await fetch("/api/production", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: sessionId.current,
          buildingId: site.buildingId,
          action,
          ...(workers === undefined ? {} : { workers }),
        }),
      });
      const result = (await response.json()) as {
        snapshot?: ProductionSnapshot;
        collected?: number;
        shipment?: { arrivalTime: number };
        error?: string;
      };
      if (!response.ok || !result.snapshot)
        throw new Error(result.error ?? "Production command was rejected.");
      setProduction(result.snapshot);
      setProductionMessage(
        action === "collect"
          ? `${result.collected ?? 0} ${site.output} dispatched to the warehouse.`
          : "Worker assignment updated.",
      );
    } catch (error) {
      setProductionMessage(
        error instanceof Error ? error.message : "Production command failed.",
      );
    } finally {
      setProductionBusy(false);
    }
  };
  const sellGoods = async (
    commodity: Commodity,
    quantity: number,
    expectedPriceCents: number,
  ) => {
    if (productionBusy || quantity <= 0) return;
    setProductionBusy(true);
    setMarketMessage(`Selling ${quantity} ${commodity}…`);
    sessionId.current ??= crypto.randomUUID();
    try {
      const response = await fetch("/api/production", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: sessionId.current,
          action: "sell",
          commodity,
          quantity,
          expectedPriceCents,
        }),
      });
      const result = (await response.json()) as {
        snapshot?: ProductionSnapshot;
        revenueCents?: number;
        error?: string;
      };
      if (!response.ok || !result.snapshot) {
        if (result.snapshot) setProduction(result.snapshot);
        throw new Error(result.error ?? "Market sale was rejected.");
      }
      setProduction(result.snapshot);
      setMarketMessage(
        `${quantity} ${commodity} sold for ${money(result.revenueCents ?? 0)}.`,
      );
    } catch (error) {
      setMarketMessage(
        error instanceof Error ? error.message : "Market sale failed.",
      );
    } finally {
      setProductionBusy(false);
    }
  };
  const focusBuilding = (buildingId: string) => {
    const building = world.buildings?.find(
      (candidate) => candidate.id === buildingId,
    );
    if (!building) return;
    setTool("inspect");
    setSelected(world.cells[building.y * world.size + building.x]);
    setCamera((current) => ({
      ...current,
      focus: focusCell(building),
      zoom: Math.max(current.zoom, 1.35),
    }));
  };
  const confirmPlacement = async (candidate: SurfaceCell | null) => {
    if (tool !== "build" || !candidate || submitting) return;
    const request: PlacementRequest = {
      type: buildingType,
      x: candidate.x,
      y: candidate.y,
      rotation,
    };
    const validation = validatePlacement(world, request);
    if (!validation.valid) {
      setBuildMessage(validation.reasons.join(". "));
      return;
    }
    setSubmitting(true);
    setBuildMessage("Submitting construction command…");
    sessionId.current ??= crypto.randomUUID();
    try {
      const response = await fetch("/api/construction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: sessionId.current,
          expectedRevision: revision,
          placement: request,
        }),
      });
      const result = (await response.json()) as {
        building?: NonNullable<WorldSnapshot["buildings"]>[number];
        buildings?: WorldSnapshot["buildings"];
        revision?: number;
        error?: string;
      };
      if (
        !response.ok ||
        !result.building ||
        typeof result.revision !== "number"
      ) {
        if (typeof result.revision === "number") setRevision(result.revision);
        if (result.buildings)
          setWorld((current) => ({ ...current, buildings: result.buildings }));
        setBuildMessage(result.error ?? "The server rejected this placement.");
        return;
      }
      setWorld((current) => ({
        ...current,
        buildings: [...(current.buildings ?? []), result.building!],
      }));
      setRevision(result.revision);
      setSelected(
        world.cells[result.building.y * world.size + result.building.x],
      );
      setHovered(null);
      setBuildMessage(
        `${buildingDefinitions[result.building.type].name} constructed.`,
      );
    } catch {
      setBuildMessage("Construction server is unavailable. Try again.");
    } finally {
      setSubmitting(false);
    }
  };
  const selectedBuilding = selected
    ? buildingAt(world, selected.x, selected.y)
    : undefined;
  const selectedProduction = selectedBuilding
    ? production?.sites.find((site) => site.buildingId === selectedBuilding.id)
    : undefined;
  const selectedWarehouseInventory =
    production &&
    selectedBuilding?.id === production.logistics.warehouseBuildingId
      ? production.logistics.warehouseInventory
      : undefined;
  const selectedResource = selected ? resourceAt(world, selected) : undefined;
  const cityLabel = world.settlement
    ? toScreen(
        { ...world.settlement.anchor, z: world.settlement.anchor.z + 4 },
        camera,
        viewport,
      )
    : null;
  const resourceLabels = world.resourceNodes.map((node) => ({
    node,
    point: toScreen({ ...node.anchor, z: node.anchor.z + 2 }, camera, viewport),
  }));
  const chunk = selected ? chunkOf(selected, world.chunkSize) : null;
  const selectedPlacement = selected
    ? validatePlacement(world, {
        type: buildingType,
        x: selected.x,
        y: selected.y,
        rotation,
      })
    : null;

  return (
    <main className="flex min-h-dvh flex-col md:h-dvh md:min-h-[600px] md:overflow-hidden bg-[#101f25] font-sans text-slate-100">
      <header className="z-10 flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-[#101d23] px-4 py-2">
        <div className="flex items-center gap-3">
          <span
            className="flex size-9 items-center justify-center rounded-lg border border-amber-200/30 text-xl text-amber-200"
            aria-hidden="true"
          >
            ◇
          </span>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">
              OpenWorld Economy
            </h1>
            <p className="text-[10px] uppercase tracking-[0.22em] text-slate-400">
              Prototype / Milestones 0–8
            </p>
          </div>
        </div>
        <nav
          className="flex items-center gap-1 rounded-xl border border-white/10 bg-black/10 p-1"
          aria-label="Primary views"
        >
          <button
            className={`rounded-lg px-4 py-2 text-sm transition ${!marketOpen && !companyOpen ? "bg-sky-600 text-white" : "text-slate-300 hover:bg-white/10"}`}
            onClick={() => {
              setMarketOpen(false);
              setCompanyOpen(false);
              sidebarRef.current?.scrollTo({ top: 0 });
            }}
          >
            Map
          </button>
          <button
            className={`rounded-lg px-4 py-2 text-sm transition ${marketOpen ? "bg-sky-600 text-white" : "text-slate-300 hover:bg-white/10"}`}
            onClick={() => {
              setMarketOpen(true);
              setCompanyOpen(false);
              sidebarRef.current?.scrollTo({ top: 0 });
            }}
          >
            Market
          </button>
          <button
            className={`rounded-lg px-4 py-2 text-sm ${companyOpen ? "bg-sky-600" : "text-slate-300 hover:bg-white/10"}`}
            onClick={() => {
              setCompanyOpen(true);
              setMarketOpen(false);
              sidebarRef.current?.scrollTo({ top: 0 });
            }}
          >
            Company
          </button>
        </nav>
        <span className="rounded-full border border-emerald-300/20 bg-emerald-300/5 px-3 py-1.5 text-xs text-emerald-200">
          {production
            ? new Date(production.serverTime).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              }) + " · "
            : ""}
          {tool === "build" ? "Build tool active" : "Local session"}
        </span>
      </header>
      <div className="relative flex min-h-0 flex-1 flex-col md:flex-row">
        <PlayerHud
          world={world}
          snapshot={production}
          onCompany={() => {
            setCompanyOpen(true);
            setMarketOpen(false);
            sidebarRef.current?.scrollTo({ top: 0 });
          }}
        />
        <section
          className="relative min-h-[360px] flex-1 overflow-hidden md:min-h-0"
          aria-label="Isometric world"
        >
          <canvas
            ref={canvasRef}
            tabIndex={0}
            aria-label="Interactive isometric map. Drag or use WASD and arrow keys to pan. Scroll or use plus and minus to zoom. Enter inspects or builds at the center. R rotates a build preview. Escape cancels the build tool."
            className="absolute inset-0 h-full w-full touch-none cursor-grab outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-200 active:cursor-grabbing"
            onPointerDown={(event) => {
              if (!event.isPrimary || event.button !== 0) return;
              event.currentTarget.focus();
              event.currentTarget.setPointerCapture(event.pointerId);
              drag.current = {
                id: event.pointerId,
                startX: event.clientX,
                startY: event.clientY,
                x: event.clientX,
                y: event.clientY,
                moved: false,
              };
            }}
            onPointerMove={(event) => {
              if (tool === "build") {
                const bounds = event.currentTarget.getBoundingClientRect();
                setHovered(
                  pickCell(
                    {
                      x: event.clientX - bounds.left,
                      y: event.clientY - bounds.top,
                    },
                    camera,
                    viewport,
                    world,
                    scene,
                  ),
                );
              }
              const state = drag.current;
              if (!state || state.id !== event.pointerId) return;
              if (
                !state.moved &&
                Math.hypot(
                  event.clientX - state.startX,
                  event.clientY - state.startY,
                ) < 5
              )
                return;
              state.moved = true;
              const delta = {
                x: event.clientX - state.x,
                y: event.clientY - state.y,
              };
              state.x = event.clientX;
              state.y = event.clientY;
              setCamera((current) => panCamera(current, delta, world.size));
            }}
            onPointerUp={(event) => {
              const state = drag.current;
              if (!state || state.id !== event.pointerId) return;
              if (!state.moved) {
                const bounds = event.currentTarget.getBoundingClientRect();
                const candidate = pickCell(
                  {
                    x: event.clientX - bounds.left,
                    y: event.clientY - bounds.top,
                  },
                  camera,
                  viewport,
                  world,
                  scene,
                );
                if (tool === "build") void confirmPlacement(candidate);
                else setSelected(candidate);
              }
              drag.current = null;
              event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            onPointerCancel={() => {
              drag.current = null;
            }}
            onLostPointerCapture={() => {
              drag.current = null;
            }}
            onKeyDown={(event) => {
              const key = event.key.toLowerCase();
              if (event.ctrlKey || event.metaKey || event.altKey) return;
              const movement: Record<string, { x: number; y: number }> = {
                arrowup: { x: 0, y: 40 },
                w: { x: 0, y: 40 },
                arrowdown: { x: 0, y: -40 },
                s: { x: 0, y: -40 },
                arrowleft: { x: 40, y: 0 },
                a: { x: 40, y: 0 },
                arrowright: { x: -40, y: 0 },
                d: { x: -40, y: 0 },
              };
              if (movement[key]) {
                event.preventDefault();
                setCamera((current) =>
                  panCamera(current, movement[key], world.size),
                );
              }
              if (["+", "=", "-", "enter", "escape", "r"].includes(key)) {
                event.preventDefault();
                if (key === "enter") {
                  const candidate = pickCell(
                    { x: viewport.width / 2, y: viewport.height / 2 },
                    camera,
                    viewport,
                    world,
                    scene,
                  );
                  if (tool === "build") void confirmPlacement(candidate);
                  else setSelected(candidate);
                } else if (key === "escape") {
                  setTool("inspect");
                  setHovered(null);
                  setBuildMessage(null);
                } else if (key === "r") rotatePreview();
                else zoom(key === "-" ? 1 / 1.2 : 1.2);
              }
            }}
          >
            Your browser needs Canvas support to display this map.
          </canvas>
          <canvas
            ref={logisticsCanvasRef}
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 h-full w-full"
          />
          <div className="pointer-events-none absolute left-5 top-5 rounded-lg border border-white/10 bg-[#102128]/90 px-4 py-3 shadow-lg">
            <p className="text-[10px] uppercase tracking-[0.2em] text-amber-200">
              The first frontier
            </p>
            <p className="mt-1 text-xs text-slate-300">
              {world.size} × {world.size} cells · Stepped terrain
            </p>
          </div>
          {world.settlement && cityLabel && (
            <button
              className="absolute -translate-x-1/2 -translate-y-full rounded-lg border border-amber-200/30 bg-[#102128]/95 px-4 py-2 text-left shadow-lg"
              style={{ left: cityLabel.x, top: cityLabel.y }}
              onClick={() => {
                const anchor = world.settlement!.anchor;
                setSelected(world.cells[anchor.y * world.size + anchor.x]);
              }}
            >
              <span className="block text-sm font-semibold text-amber-100">
                {world.settlement.name}
              </span>
              <span className="text-xs text-slate-300">
                {world.settlement.population} citizens · Founding camp
              </span>
            </button>
          )}
          {camera.zoom >= 0.45 &&
            resourceLabels.map(({ node, point }) =>
              point.x > -100 &&
              point.x < viewport.width + 100 &&
              point.y > 0 &&
              point.y < viewport.height + 80 ? (
                <button
                  key={node.id}
                  className="absolute -translate-x-1/2 -translate-y-full rounded-md border border-white/15 bg-[#102128]/90 px-3 py-1.5 text-left shadow-md"
                  style={{ left: point.x, top: point.y }}
                  onClick={() =>
                    setSelected(
                      world.cells[node.anchor.y * world.size + node.anchor.x],
                    )
                  }
                >
                  <span className="block text-xs font-semibold text-slate-100">
                    {node.name}
                  </span>
                  <span className="text-[10px] capitalize text-slate-400">
                    {node.type} deposit
                  </span>
                </button>
              ) : null,
            )}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-white/50"
          >
            +
          </span>
          <div className="absolute bottom-5 left-5 flex items-center gap-2 rounded-xl border border-white/10 bg-[#102128]/95 p-2 shadow-xl">
            <button
              className={button}
              aria-label="Zoom out"
              disabled={camera.zoom <= 0.25}
              onClick={() => zoom(1 / 1.2)}
            >
              −
            </button>
            <span className="w-12 text-center font-mono text-xs">
              {Math.round(camera.zoom * 100)}%
            </span>
            <button
              className={button}
              aria-label="Zoom in"
              disabled={camera.zoom >= 3}
              onClick={() => zoom(1.2)}
            >
              +
            </button>
            <button
              className={button}
              onClick={() =>
                setCamera({
                  focus: world.settlement
                    ? focusCell(world.settlement.anchor)
                    : { x: world.size / 2, y: world.size / 2 },
                  zoom: world.settlement ? 2 : 1,
                })
              }
            >
              Reset view
            </button>
          </div>
        </section>
        <aside
          ref={sidebarRef}
          aria-label="World controls and selection"
          className="z-10 w-full shrink-0 overflow-y-auto border-t border-white/10 bg-[#101e28] p-3 md:w-72 md:border-l md:border-t-0 lg:w-80"
        >
          <WorldMinimap
            world={world}
            camera={camera}
            viewport={viewport}
            selected={selected}
            onNavigate={(cell) => {
              setCamera((current) => ({ ...current, focus: focusCell(cell) }));
            }}
          />
          {marketOpen && production && (
            <section
              className="mb-6 border-b border-white/10 pb-5"
              aria-label="Novagrad market"
            >
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.2em] text-sky-200">
                    Local market
                  </p>
                  <h2 className="mt-1 text-xl font-semibold">
                    Novagrad Exchange
                  </h2>
                </div>
                <div className="text-right">
                  <span className="block text-[10px] uppercase text-slate-500">
                    Cash
                  </span>
                  <span className="font-mono text-sm text-emerald-200">
                    {money(production.market.cashCents)}
                  </span>
                </div>
              </div>
              <div className="mt-4 space-y-3">
                {production.market.listings.map((listing) => (
                  <article
                    key={listing.commodity}
                    className="rounded-xl border border-white/10 bg-black/10 p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold">
                          {listing.name}
                        </h3>
                        <p className="mt-1 text-[10px] text-slate-400">
                          Warehouse supply {listing.available} / target{" "}
                          {listing.desiredStock}
                        </p>
                      </div>
                      <div className="text-right">
                        <span className="block font-mono text-base text-white">
                          {money(listing.priceCents)}
                        </span>
                        <span
                          className={`text-[10px] ${listing.trendPercent > 0 ? "text-red-300" : listing.trendPercent < 0 ? "text-emerald-300" : "text-slate-400"}`}
                        >
                          {listing.trendPercent > 0
                            ? "▲"
                            : listing.trendPercent < 0
                              ? "▼"
                              : "—"}{" "}
                          {Math.abs(listing.trendPercent).toFixed(1)}%
                        </span>
                      </div>
                    </div>
                    <div
                      className={
                        listing.trendPercent > 0
                          ? "mt-1 text-red-300"
                          : "mt-1 text-emerald-300"
                      }
                    >
                      <PriceSparkline history={listing.history} />
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`rounded-full px-2 py-1 text-[10px] uppercase ${listing.shortage === "critical" ? "bg-red-400/10 text-red-300" : listing.shortage === "low" ? "bg-amber-300/10 text-amber-200" : "bg-emerald-300/10 text-emerald-200"}`}
                      >
                        {listing.shortage === "none"
                          ? "Supply stable"
                          : `${listing.shortage} shortage`}
                      </span>
                      <div className="flex gap-1">
                        <button
                          className={`${button} px-2 py-1 text-[11px]`}
                          disabled={productionBusy || listing.available < 1}
                          onClick={() =>
                            void sellGoods(
                              listing.commodity,
                              1,
                              listing.priceCents,
                            )
                          }
                        >
                          Sell 1
                        </button>
                        <button
                          className={`${button} px-2 py-1 text-[11px]`}
                          disabled={productionBusy || listing.available < 1}
                          onClick={() =>
                            void sellGoods(
                              listing.commodity,
                              listing.available,
                              listing.priceCents,
                            )
                          }
                        >
                          Sell all
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
              {marketMessage && (
                <p className="mt-3 text-xs text-amber-100" aria-live="polite">
                  {marketMessage}
                </p>
              )}
              <div className="mt-5">
                <p className="text-[10px] uppercase tracking-[0.18em] text-amber-200">
                  Economic opportunities
                </p>
                <div className="mt-2 space-y-2">
                  {production.market.opportunities.map((opportunity) => (
                    <button
                      key={opportunity.id}
                      className={`${button} w-full text-left`}
                      onClick={() => {
                        focusBuilding(opportunity.targetBuildingId);
                        setMarketOpen(false);
                      }}
                    >
                      <span className="block text-xs font-semibold text-white">
                        {opportunity.title}
                      </span>
                      <span className="mt-1 block text-[11px] leading-4 text-slate-400">
                        {opportunity.reason}
                      </span>
                      <span className="mt-2 block text-[10px] uppercase tracking-wide text-amber-200">
                        {opportunity.actionLabel} →
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </section>
          )}
          {companyOpen && (
            <div aria-label="Company management">
              {world.settlement && (
                <section
                  className="mb-6 border-b border-white/10 pb-5"
                  aria-label="Settlement overview"
                >
                  <p className="text-[10px] uppercase tracking-[0.2em] text-amber-200">
                    Starting settlement
                  </p>
                  <h2 className="mt-2 text-xl font-semibold">
                    {world.settlement.name}
                  </h2>
                  <p className="mt-2 text-sm text-slate-300">
                    Population: {world.settlement.population} citizens
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    {
                      world.buildings?.filter(
                        (building) => building.type === "camp",
                      ).length
                    }{" "}
                    camp ·{" "}
                    {
                      world.buildings?.filter(
                        (building) => building.type === "house",
                      ).length
                    }{" "}
                    houses ·{" "}
                    {
                      world.buildings?.filter(
                        (building) => building.type === "warehouse",
                      ).length
                    }{" "}
                    warehouse ·{" "}
                    {
                      world.buildings?.filter(
                        (building) => building.type === "workshop",
                      ).length
                    }{" "}
                    workshops
                  </p>
                  <button
                    className={`${button} mt-3 w-full`}
                    onClick={() =>
                      setCamera((current) => ({
                        ...current,
                        focus: focusCell(world.settlement!.anchor),
                        zoom: 2,
                      }))
                    }
                  >
                    Go to settlement
                  </button>
                </section>
              )}
              <section
                className="mb-6 border-b border-white/10 pb-5"
                aria-label="Economic geography"
              >
                <p className="text-[10px] uppercase tracking-[0.2em] text-emerald-200">
                  Economic geography
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {world.resourceNodes.map((node) => (
                    <button
                      key={node.id}
                      className={`${button} px-2 text-left`}
                      onClick={() => {
                        setTool("inspect");
                        setSelected(
                          world.cells[
                            node.anchor.y * world.size + node.anchor.x
                          ],
                        );
                        setCamera((current) => ({
                          ...current,
                          focus: focusCell(node.anchor),
                          zoom: Math.max(current.zoom, 1.2),
                        }));
                      }}
                    >
                      <span className="block text-xs font-medium">
                        {node.name}
                      </span>
                      <span className="mt-1 block text-[10px] capitalize text-slate-400">
                        {node.type} · {node.cellCount} cells
                      </span>
                    </button>
                  ))}
                </div>
                <button
                  className={`${button} mt-2 w-full text-left`}
                  onClick={() => {
                    const farm = world.cells.find(
                      (cell) => cell.terrain === "farmland",
                    );
                    if (farm) {
                      setTool("inspect");
                      setSelected(farm);
                      setCamera((current) => ({
                        ...current,
                        focus: focusCell(farm),
                        zoom: Math.max(current.zoom, 1.2),
                      }));
                    }
                  }}
                >
                  View farmland
                </button>
              </section>
              <section
                className="mb-6 border-b border-white/10 pb-5"
                aria-label="Production overview"
              >
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.2em] text-sky-200">
                      Production
                    </p>
                    <h2 className="mt-1 text-lg font-semibold">
                      Novagrad industry
                    </h2>
                  </div>
                  {production && (
                    <span className="text-xs text-slate-400">
                      {production.availableWorkers} / {production.population}{" "}
                      free
                    </span>
                  )}
                </div>
                <div className="mt-3 space-y-2">
                  {production?.sites.map((site) => {
                    const building = world.buildings?.find(
                      (candidate) => candidate.id === site.buildingId,
                    );
                    const statusLabel =
                      site.status === "running"
                        ? "Running"
                        : site.status === "missing_workers"
                          ? "Missing workers"
                          : "Storage full";
                    return (
                      <button
                        key={site.buildingId}
                        className={`${button} flex w-full items-center justify-between gap-3 text-left`}
                        onClick={() => {
                          if (!building) return;
                          setTool("inspect");
                          setSelected(
                            world.cells[building.y * world.size + building.x],
                          );
                          setCamera((current) => ({
                            ...current,
                            focus: focusCell(building),
                            zoom: Math.max(current.zoom, 1.35),
                          }));
                        }}
                      >
                        <span>
                          <span className="block text-xs font-medium">
                            {site.name}
                          </span>
                          <span className="mt-1 block text-[10px] text-slate-400">
                            {site.assignedWorkers}/{site.requiredWorkers}{" "}
                            workers · {site.stored}/{site.storageCapacity}{" "}
                            {site.output}
                          </span>
                        </span>
                        <span
                          className={`shrink-0 text-[10px] ${site.status === "running" ? "text-emerald-300" : site.status === "missing_workers" ? "text-amber-300" : "text-red-300"}`}
                        >
                          ● {statusLabel}
                        </span>
                      </button>
                    );
                  }) ?? (
                    <p className="text-xs text-slate-400">
                      Connecting to the production server…
                    </p>
                  )}
                </div>
              </section>
              {production && (
                <section
                  className="mb-6 border-b border-white/10 pb-5"
                  aria-label="Logistics overview"
                >
                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.2em] text-cyan-200">
                        Logistics
                      </p>
                      <h2 className="mt-1 text-lg font-semibold">
                        Warehouse network
                      </h2>
                    </div>
                    <span className="text-xs text-slate-400">
                      {
                        production.logistics.shipments.filter(
                          (shipment) => shipment.status === "in_transit",
                        ).length
                      }{" "}
                      moving
                    </span>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    {Object.entries(
                      production.logistics.warehouseInventory,
                    ).map(([commodity, quantity]) => (
                      <div
                        key={commodity}
                        className="rounded-lg border border-white/10 bg-black/10 p-2 text-center"
                      >
                        <span className="block font-mono text-base text-cyan-100">
                          {quantity}
                        </span>
                        <span className="text-[10px] capitalize text-slate-400">
                          {commodity}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 space-y-2">
                    {production.logistics.shipments
                      .slice(-4)
                      .reverse()
                      .map((shipment) => {
                        const route = production.logistics.routes.find(
                          (candidate) => candidate.id === shipment.routeId,
                        );
                        return (
                          <button
                            key={shipment.id}
                            className={`${button} flex w-full items-center justify-between gap-3 text-left`}
                            onClick={() => {
                              const midpoint =
                                route?.path[Math.floor(route.path.length / 2)];
                              if (midpoint)
                                setCamera((current) => ({
                                  ...current,
                                  focus: focusCell(midpoint),
                                  zoom: Math.max(current.zoom, 1.2),
                                }));
                            }}
                          >
                            <span>
                              <span className="block text-xs font-medium">
                                {shipment.cargo.quantity}{" "}
                                <span className="capitalize">
                                  {shipment.cargo.commodity}
                                </span>
                              </span>
                              <span className="mt-1 block text-[10px] text-slate-400">
                                {route?.name ?? "Warehouse route"}
                              </span>
                            </span>
                            <span
                              className={`text-[10px] ${shipment.status === "in_transit" ? "text-cyan-300" : "text-emerald-300"}`}
                            >
                              {shipment.status === "in_transit"
                                ? "● In transit"
                                : "✓ Arrived"}
                            </span>
                          </button>
                        );
                      })}
                  </div>
                  <p className="mt-3 text-[11px] leading-5 text-slate-400">
                    Dashed route lines follow connected road cells. Cargo enters
                    warehouse inventory only when the server marks its shipment
                    arrived.
                  </p>
                </section>
              )}
            </div>
          )}
          <section
            className="mb-6 border-b border-white/10 pb-5"
            aria-label="Construction tools"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-[0.2em] text-amber-200">
                  World tool
                </p>
                <h2 className="mt-1 text-lg font-semibold">
                  {tool === "build" ? "Place building" : "Inspect"}
                </h2>
              </div>
              <button
                className={button}
                onClick={() => {
                  setTool((current) =>
                    current === "build" ? "inspect" : "build",
                  );
                  setHovered(null);
                  setBuildMessage(null);
                }}
              >
                {tool === "build" ? "Cancel" : "Build"}
              </button>
            </div>
            {tool === "build" && (
              <div className="mt-4 space-y-3">
                <div className="grid grid-cols-3 gap-2">
                  {constructibleBuildingTypes.map((type) => (
                    <button
                      key={type}
                      className={`${button} px-2 ${buildingType === type ? "border-amber-200/60 bg-amber-200/10 text-amber-100" : ""}`}
                      onClick={() => {
                        setBuildingType(type);
                        setBuildMessage(null);
                      }}
                    >
                      {buildingDefinitions[type].name}
                    </button>
                  ))}
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-slate-400">
                    Rotation:{" "}
                    <span className="capitalize text-slate-200">
                      {rotation}
                    </span>
                  </span>
                  <button className={button} onClick={rotatePreview}>
                    Rotate (R)
                  </button>
                </div>
                <p className="text-xs leading-5 text-slate-400">
                  Move over the map for a footprint preview, then click to
                  construct. Buildings require level grassland beside a road.
                </p>
                {placement && (
                  <div
                    className={`rounded-lg border p-3 text-xs ${placement.validation.valid ? "border-emerald-300/30 bg-emerald-300/5 text-emerald-200" : "border-red-300/30 bg-red-300/5 text-red-200"}`}
                    aria-live="polite"
                  >
                    {placement.validation.valid
                      ? "Valid placement — click to build"
                      : placement.validation.reasons.join(" · ")}
                  </div>
                )}
                {buildMessage && (
                  <p className="text-xs text-amber-100" aria-live="polite">
                    {buildMessage}
                  </p>
                )}
              </div>
            )}
          </section>
          <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400">
            Selected location
          </p>
          <h2 className="mt-2 text-xl font-medium">
            {selectedBuilding
              ? buildingDefinitions[selectedBuilding.type].name
              : selectedResource
                ? selectedResource.name
                : selected
                  ? terrainNames[selected.terrain]
                  : "Explore the world"}
          </h2>
          {selectedBuilding && (
            <p className="mt-2 text-xs leading-5 text-slate-400">
              {buildingDefinitions[selectedBuilding.type].purpose} Footprint:{" "}
              {
                footprintOf(selectedBuilding.type, selectedBuilding.rotation)
                  .width
              }{" "}
              ×{" "}
              {
                footprintOf(selectedBuilding.type, selectedBuilding.rotation)
                  .depth
              }
              . Rotation: {selectedBuilding.rotation}. Settlement:{" "}
              {world.settlement?.name}.
            </p>
          )}
          {selected && !selectedBuilding && selectedPlacement && (
            <div className="mt-3 rounded-lg border border-white/10 p-3 text-xs">
              <dl className="space-y-2">
                <div className="flex justify-between">
                  <dt className="text-slate-400">Terrain</dt>
                  <dd>{terrainNames[selected.terrain]}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-400">Road access</dt>
                  <dd>
                    {selectedPlacement.reasons.includes(
                      "Requires adjacent road access",
                    )
                      ? "No adjacent road"
                      : "Connected"}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-400">
                    Buildable ({buildingDefinitions[buildingType].name})
                  </dt>
                  <dd>{selectedPlacement.valid ? "Yes" : "No"}</dd>
                </div>
              </dl>
              <p className="mt-2 text-slate-400">
                {selectedPlacement.reasons.join(" · ")}
              </p>
              <button
                className={`${button} mt-3 w-full`}
                disabled={!selectedPlacement.valid}
                onClick={() => {
                  setTool("build");
                  setHovered(selected);
                  setBuildMessage(
                    "Preview ready. Click the selected footprint to construct.",
                  );
                }}
              >
                Build here
              </button>
            </div>
          )}
          {selectedProduction && (
            <div className="mt-4 rounded-xl border border-white/10 bg-black/10 p-4">
              <div className="flex items-center justify-between gap-3">
                <span
                  className={`text-xs font-semibold ${selectedProduction.status === "running" ? "text-emerald-300" : selectedProduction.status === "missing_workers" ? "text-amber-300" : "text-red-300"}`}
                >
                  {selectedProduction.status === "running"
                    ? "● Running"
                    : selectedProduction.status === "missing_workers"
                      ? "● Missing workers"
                      : "● Storage full"}
                </span>
                <span className="text-xs capitalize text-slate-400">
                  {selectedProduction.output}
                </span>
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-300">
                {selectedProduction.statusReason}
              </p>
              <div className="mt-3 flex items-center justify-between text-xs">
                <span className="text-slate-400">Workers</span>
                <span>
                  {selectedProduction.assignedWorkers} /{" "}
                  {selectedProduction.requiredWorkers}
                </span>
              </div>
              <div className="mt-2 flex gap-2">
                <button
                  className={`${button} flex-1`}
                  disabled={
                    productionBusy || selectedProduction.assignedWorkers === 0
                  }
                  onClick={() =>
                    void updateProduction(
                      selectedProduction,
                      "set_workers",
                      selectedProduction.assignedWorkers - 1,
                    )
                  }
                >
                  − Worker
                </button>
                <button
                  className={`${button} flex-1`}
                  disabled={
                    productionBusy ||
                    selectedProduction.assignedWorkers >=
                      selectedProduction.requiredWorkers ||
                    (production?.availableWorkers ?? 0) === 0
                  }
                  onClick={() =>
                    void updateProduction(
                      selectedProduction,
                      "set_workers",
                      selectedProduction.assignedWorkers + 1,
                    )
                  }
                >
                  + Worker
                </button>
              </div>
              <div className="mt-4 flex items-center justify-between text-xs">
                <span className="text-slate-400">Output</span>
                <span>
                  +{selectedProduction.outputAmount} /{" "}
                  {selectedProduction.cycleMs / 1000}s
                </span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
                <div
                  className={`h-full transition-[width] ${selectedProduction.status === "running" ? "bg-emerald-400" : "bg-slate-600"}`}
                  style={{
                    width: `${Math.min(100, (selectedProduction.progressMs / selectedProduction.cycleMs) * 100)}%`,
                  }}
                />
              </div>
              <div className="mt-4 flex items-center justify-between text-xs">
                <span className="text-slate-400">Local storage</span>
                <span>
                  {selectedProduction.stored} /{" "}
                  {selectedProduction.storageCapacity}{" "}
                  {selectedProduction.output}
                </span>
              </div>
              <button
                className={`${button} mt-3 w-full`}
                disabled={productionBusy || selectedProduction.stored === 0}
                onClick={() =>
                  void updateProduction(selectedProduction, "collect")
                }
              >
                Dispatch to warehouse
              </button>
              {productionMessage && (
                <p className="mt-2 text-xs text-amber-100" aria-live="polite">
                  {productionMessage}
                </p>
              )}
            </div>
          )}
          {selectedWarehouseInventory && (
            <div className="mt-4 rounded-xl border border-cyan-300/20 bg-cyan-300/5 p-4">
              <p className="text-[10px] uppercase tracking-[0.18em] text-cyan-200">
                Warehouse inventory
              </p>
              <div className="mt-3 grid grid-cols-3 gap-2">
                {Object.entries(selectedWarehouseInventory).map(
                  ([commodity, quantity]) => (
                    <div key={commodity} className="text-center">
                      <span className="block font-mono text-lg text-white">
                        {quantity}
                      </span>
                      <span className="text-[10px] capitalize text-slate-400">
                        {commodity}
                      </span>
                    </div>
                  ),
                )}
              </div>
              <p className="mt-3 text-xs leading-5 text-slate-400">
                Only arrived shipments are stored here.
              </p>
            </div>
          )}
          {selectedResource && (
            <div className="mt-3 rounded-lg border border-white/10 bg-black/10 p-3 text-xs text-slate-300">
              <p className="capitalize">Resource: {selectedResource.type}</p>
              <p className="mt-1">
                Estimated reserve:{" "}
                {selectedResource.estimatedReserve.toLocaleString("en-US")}
              </p>
              <p className="mt-1">Region: {selectedResource.cellCount} cells</p>
              <p className="mt-2 text-slate-500">
                Decorative markers show presence; reserve is stored on this
                resource node.
              </p>
            </div>
          )}
          {selected?.terrain === "farmland" && !selectedProduction && (
            <p className="mt-2 text-xs leading-5 text-slate-400">
              Agricultural land suitable for food production at a Farm.
            </p>
          )}
          <div className="mt-5" aria-live="polite" aria-atomic="true">
            {selected ? (
              <>
                <div className="grid grid-cols-3 gap-2">
                  {(["x", "y", "z"] as const).map((axis) => (
                    <div
                      key={axis}
                      className="rounded-lg border border-white/10 bg-black/10 p-3"
                    >
                      <p className="text-xs uppercase text-slate-400">{axis}</p>
                      <p className="mt-1 font-mono text-xl text-amber-100">
                        {selected[axis]}
                      </p>
                    </div>
                  ))}
                </div>
                <p className="mt-4 text-xs text-slate-400">
                  Chunk {chunk?.x}, {chunk?.y} · Surface elevation {selected.z}
                </p>
              </>
            ) : (
              <p className="text-sm leading-6 text-slate-400">
                Select a diamond to inspect its world coordinates. Follow the
                river, find the coastline, or explore the stepped hills and
                mountains.
              </p>
            )}
          </div>
          <button
            className={`${button} mt-5 w-full`}
            disabled={!selected}
            onClick={() => {
              if (selected)
                setCamera((current) => ({
                  ...current,
                  focus: focusCell(selected),
                }));
            }}
          >
            Focus selected tile
          </button>
          <div className="mt-7 border-t border-white/10 pt-5">
            <h3 className="text-xs font-medium text-slate-300">Map layers</h3>
            <label className="mt-4 flex cursor-pointer items-center justify-between text-sm text-slate-400">
              Tile grid
              <input
                type="checkbox"
                checked={grid}
                onChange={(event) => setGrid(event.target.checked)}
                className="size-4 accent-amber-200"
              />
            </label>
            <label className="mt-4 flex cursor-pointer items-center justify-between text-sm text-slate-400">
              Chunk boundaries
              <input
                type="checkbox"
                checked={showChunks}
                onChange={(event) => setShowChunks(event.target.checked)}
                className="size-4 accent-cyan-300"
              />
            </label>
            <p className="mt-3 font-mono text-[10px] text-cyan-200/80">
              Visible: {scene.chunks.length} / {world.chunks.length} chunks ·{" "}
              {scene.cells.length.toLocaleString("en-US")} tiles
            </p>
            <div className="mt-4 flex flex-wrap gap-4 text-xs text-slate-400">
              <span>
                <span className="mr-2 inline-block size-2.5 rounded-sm bg-[#718e6c]" />
                Grassland
              </span>
              <span>
                <span className="mr-2 inline-block size-2.5 rounded-sm bg-[#2c7187]" />
                Water
              </span>
              <span>
                <span className="mr-2 inline-block size-2.5 rounded-sm bg-[#92988f]" />
                Mountain
              </span>
              <span>
                <span className="mr-2 inline-block size-2.5 rounded-sm bg-[#456f4d]" />
                Forest
              </span>
              <span>
                <span className="mr-2 inline-block size-2.5 rounded-sm bg-[#a39351]" />
                Farmland
              </span>
            </div>
          </div>
          <div className="mt-7 border-t border-white/10 pt-5 text-xs leading-6 text-slate-400">
            <h3 className="mb-2 font-medium text-slate-300">Navigation</h3>
            <p>Drag to pan · Scroll to zoom</p>
            <p>WASD / arrows to pan when map is focused</p>
            <p>Enter to inspect the center · Esc to clear</p>
          </div>
          <p className="mt-7 text-[11px] leading-5 text-slate-500">
            Construction, production, shipment timing, and warehouse arrivals
            are authoritative for this running server session. Costs,
            persistence, authentication, and population growth arrive later.
          </p>
        </aside>
      </div>
      <BottomHud
        snapshot={production}
        scene={{
          chunks: scene.chunks.length,
          totalChunks: world.chunks.length,
          tiles: scene.cells.length,
          buildings: visibleBuildingCount,
        }}
        onBuild={() => {
          setTool("build");
          setMarketOpen(false);
          setCompanyOpen(false);
          setHovered(null);
          sidebarRef.current?.scrollTo({ top: 0 });
        }}
        onMarket={() => {
          setMarketOpen(true);
          setCompanyOpen(false);
          sidebarRef.current?.scrollTo({ top: 0 });
        }}
        onCompany={() => {
          setCompanyOpen(true);
          setMarketOpen(false);
          sidebarRef.current?.scrollTo({ top: 0 });
        }}
        onWarehouse={() => {
          if (production)
            focusBuilding(production.logistics.warehouseBuildingId);
          setMarketOpen(false);
          setCompanyOpen(false);
          sidebarRef.current?.scrollTo({ top: 0 });
        }}
        onHome={() => {
          if (world.settlement)
            setCamera((current) => ({
              ...current,
              focus: focusCell(world.settlement!.anchor),
              zoom: 2,
            }));
        }}
      />
    </main>
  );
}
