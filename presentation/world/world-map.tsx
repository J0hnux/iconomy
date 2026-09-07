"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  constructionCosts,
  constructibleBuildingTypes,
  roadConstructionCost,
  validateConstructionResources,
  validatePlacement,
  validateRoadConstructionResources,
  validateRoadPlacement,
  type ConstructibleBuildingType,
  type PlacementRequest,
  type RoadPlacementRequest,
} from "@/world/domain/construction";
import {
  buildingAt,
  buildingDefinitions,
  footprintOf,
  type BuildingRotation,
} from "@/world/domain/settlement";
import type {
  Commodity,
  DispatchPolicy,
  ProductionSnapshot,
  ProductionSite,
} from "@/world/domain/production";
import {
  availableRecipes,
  defaultRecipeByProducer,
  dispatchPolicies,
  isProducerType,
  productionPriorities,
  productionRecipes,
} from "@/world/domain/production";
import { commodityDefinitions } from "@/world/domain/commodities";
import {
  marketChartTimeframes,
  type MarketChartTimeframeId,
} from "@/world/domain/market";
import {
  marketIntelligencePolicy,
  type MarketCondition,
} from "@/world/domain/market-intelligence";
import {
  competitionPolicy,
  type IndustryPosition,
  type IndustryResponseKind,
} from "@/world/domain/competition";
import {
  LocalGameSimulation,
  type CommandResult,
  type GameCommand,
  type GameReadModel,
  type MarketSaleReceipt,
} from "@/world/simulation/game-simulation";
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
import {
  buildingVisualProfiles,
  defaultBuildingVisualProfile,
  type BuildingVisualProfileId,
} from "./buildings";
import {
  MarketChartControls,
  MarketPriceChart,
  type MarketChartType,
} from "./price-chart";
import { FloatingMarket } from "./floating-market";
import { RegionalTrader } from "./regional-trader";
import {
  clearLocalSave,
  loadLocalSave,
  storeLocalSave,
} from "./save-repository";

/** Periodic autosave cadence; player commands bypass it. */
const autosaveIntervalMs = 10_000;

/**
 * Largest wall-clock step a single simulation advance may consume. Longer
 * real-world gaps (a sleeping machine, a throttled tab) are absorbed rather
 * than replayed, so the clock cannot leap out of the retention window.
 */
const maximumClockStepMs = 5 * 60_000;

const button =
  "rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-slate-200 transition hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-amber-200 disabled:opacity-30";

const rotations: readonly BuildingRotation[] = [
  "north",
  "east",
  "south",
  "west",
];
const simulationSpeeds = [0, 1, 2, 5] as const;
type SimulationSpeed = (typeof simulationSpeeds)[number];
const terrainNames: Record<TerrainType, string> = {
  grassland: "Grassland",
  water: "Water",
  mountain: "Mountain",
  forest_ground: "Forest",
  farmland: "Farmland",
};

const money = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const dispatchPolicyLabels: Record<DispatchPolicy, string> = {
  manual: "Manual",
  when_full: "When full",
  continuous: "Continuous",
};

const dispatchPolicyHints: Record<DispatchPolicy, string> = {
  manual:
    "Output waits at the site until you dispatch it. Holding stock back keeps it off the market and protects the price.",
  when_full:
    "Ships a full load whenever storage fills. Batched arrivals move the price in steps.",
  continuous:
    "Ships as soon as anything is stored. Steady supply pushes the price down.",
};

const marketConditionTone: Record<MarketCondition, string> = {
  severe_shortage: "text-red-300",
  shortage: "text-amber-200",
  balanced: "text-slate-400",
  oversupplied: "text-sky-200",
  severe_oversupply: "text-emerald-300",
};

const materialSummary = (
  materials: Readonly<Partial<Record<Commodity, number>>>,
) =>
  Object.entries(materials)
    .map(
      ([commodity, quantity]) =>
        `${quantity} ${commodityDefinitions[commodity as Commodity].name}`,
    )
    .join(" · ");

export default function WorldMap({
  world: initialWorld,
}: {
  world: WorldSnapshot;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const logisticsCanvasRef = useRef<HTMLCanvasElement>(null);
  const simulationRef = useRef<LocalGameSimulation | null>(null);
  const simulationTimeRef = useRef(0);
  const lastWallTimeRef = useRef(0);
  const snapshotWallTimeRef = useRef(0);
  const speedRef = useRef<SimulationSpeed>(1);
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
  const [buildingVisualProfile, setBuildingVisualProfile] =
    useState<BuildingVisualProfileId>(defaultBuildingVisualProfile);
  const buildingVisualSet = buildingVisualProfiles[buildingVisualProfile];
  const [tool, setTool] = useState<"inspect" | "build" | "road">("inspect");
  const [buildingType, setBuildingType] =
    useState<ConstructibleBuildingType>("farm");
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
  const [regionalTradeOpen, setRegionalTradeOpen] = useState(false);
  const [marketChartType, setMarketChartType] =
    useState<MarketChartType>("line");
  const [marketChartTimeframe, setMarketChartTimeframe] =
    useState<MarketChartTimeframeId>("1m");
  const [selectedMarketCommodity, setSelectedMarketCommodity] =
    useState<Commodity>("crops");
  const [selectedMarketPeriodStart, setSelectedMarketPeriodStart] = useState<
    number | null
  >(null);
  const [marketChartExpanded, setMarketChartExpanded] = useState(false);
  const [marketTerminalOpen, setMarketTerminalOpen] = useState(false);
  const marketChartCloseRef = useRef<HTMLButtonElement>(null);
  const marketChartReturnFocusRef = useRef<HTMLElement | null>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const [marketMessage, setMarketMessage] = useState<string | null>(null);
  const [saleQuantities, setSaleQuantities] = useState<
    Partial<Record<Commodity, string>>
  >({});
  const [lastMarketSale, setLastMarketSale] =
    useState<MarketSaleReceipt | null>(null);
  const [regionalTradeMessage, setRegionalTradeMessage] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const saveFailedRef = useRef(false);
  const lastSaveWallTimeRef = useRef(0);
  const [simulationSpeed, setSimulationSpeed] = useState<SimulationSpeed>(1);
  const drag = useRef<{
    id: number;
    startX: number;
    startY: number;
    x: number;
    y: number;
    moved: boolean;
  } | null>(null);

  const placement = useMemo<PlacementPreview | null>(() => {
    if (tool === "inspect" || !hovered) return null;
    if (tool === "road") {
      const request: RoadPlacementRequest = { x: hovered.x, y: hovered.y };
      const physical = validateRoadPlacement(world, request);
      const economic = production
        ? validateRoadConstructionResources(
            production.market.cashCents,
            production.logistics.warehouseInventory,
          )
        : { affordable: false, reasons: ["Simulation is starting"] };
      return {
        request,
        validation: {
          ...physical,
          valid: physical.valid && economic.affordable,
          reasons: [...physical.reasons, ...economic.reasons],
        },
      };
    }
    const request: PlacementRequest = {
      type: buildingType,
      x: hovered.x,
      y: hovered.y,
      rotation,
    };
    const physical = validatePlacement(world, request);
    const economic = production
      ? validateConstructionResources(
          buildingType,
          production.market.cashCents,
          production.logistics.warehouseInventory,
        )
      : { affordable: false, reasons: ["Simulation is starting"] };
    return {
      request,
      validation: {
        ...physical,
        valid: physical.valid && economic.affordable,
        reasons: [...physical.reasons, ...economic.reasons],
      },
    };
  }, [tool, hovered, buildingType, rotation, world, production]);
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
  const applyReadModel = useCallback((readModel: GameReadModel) => {
    snapshotWallTimeRef.current = Date.now();
    setWorld(readModel.world);
    setRevision(readModel.revision);
    setProduction(readModel.economy);
  }, []);

  /**
   * Autosave is throttled: the periodic tick only writes every
   * autosaveIntervalMs, while a player command forces an immediate write so a
   * deliberate action is never the thing that gets lost.
   */
  const persistSimulation = useCallback((
    simulation: LocalGameSimulation,
    options?: { force?: boolean },
  ) => {
    const now = Date.now();
    if (
      !options?.force &&
      now - lastSaveWallTimeRef.current < autosaveIntervalMs
    )
      return;
    lastSaveWallTimeRef.current = now;
    void storeLocalSave(simulation.exportSave())
      .then(() => {
        if (saveFailedRef.current) {
          saveFailedRef.current = false;
          setSaveMessage(null);
        }
      })
      .catch((error: unknown) => {
        if (saveFailedRef.current) return;
        saveFailedRef.current = true;
        setSaveMessage(
          error instanceof DOMException && error.name === "QuotaExceededError"
            ? "Autosave storage is full. The game is still running, but newer progress is not saved."
            : "Autosave is unavailable. The game is still running in this tab.",
        );
      });
  }, []);
  /**
   * Advances simulation time by the wall clock elapsed since the last read.
   *
   * The step is clamped: an unset or stale wall-clock reference yields an
   * elapsed of a whole Unix epoch, which previously advanced the simulation by
   * tens of thousands of years and wrote unreachable timestamps into price
   * history that no later retention pass could remove.
   */
  const currentSimulationTime = useCallback(() => {
    const now = Date.now();
    const since = lastWallTimeRef.current;
    const elapsed =
      since <= 0 ? 0 : Math.min(maximumClockStepMs, Math.max(0, now - since));
    lastWallTimeRef.current = now;
    simulationTimeRef.current += Math.round(elapsed * speedRef.current);
    return simulationTimeRef.current;
  }, []);

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
      buildingVisualSet,
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
    buildingVisualSet,
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
    let frame = 0;
    const draw = () => {
      const now =
        production.simulationTime +
        (Date.now() - snapshotWallTimeRef.current) * speedRef.current;
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
  }, [world, camera, viewport, production, scene, simulationSpeed]);

  useEffect(() => {
    speedRef.current = simulationSpeed;
    lastWallTimeRef.current = Date.now();
    snapshotWallTimeRef.current = Date.now();
  }, [simulationSpeed]);

  useEffect(() => {
    if (!marketChartExpanded) return;
    marketChartCloseRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setMarketChartExpanded(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      marketChartReturnFocusRef.current?.focus();
    };
  }, [marketChartExpanded]);

  useEffect(() => {
    // Loading is asynchronous because IndexedDB is; the simulation only exists
    // once the stored save has been read, so guard every teardown path.
    let cancelled = false;
    let simulation: LocalGameSimulation | null = null;
    let timer = 0;
    let notificationTimer = 0;
    void (async () => {
      let recoveryMessage: string | null = null;
      const stored = await loadLocalSave();
      let loaded: LocalGameSimulation;
      try {
        loaded = stored.save
          ? LocalGameSimulation.fromSave(stored.save)
          : new LocalGameSimulation(initialWorld, Date.now());
      } catch {
        await clearLocalSave();
        loaded = new LocalGameSimulation(initialWorld, Date.now());
        recoveryMessage =
          "The previous local save was invalid, so a new settlement was started.";
      }
      if (cancelled) return;
      simulation = loaded;
      simulationRef.current = loaded;
      simulationTimeRef.current = loaded.exportSave().simulationTime;
      lastWallTimeRef.current = Date.now();
      const refresh = () => {
        applyReadModel(loaded.read(currentSimulationTime()));
        persistSimulation(loaded);
      };
      refresh();
      if (recoveryMessage)
        notificationTimer = window.setTimeout(
          () => setBuildMessage(recoveryMessage),
          0,
        );
      timer = window.setInterval(refresh, 1_000);
    })();
    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
      if (notificationTimer) window.clearTimeout(notificationTimer);
      if (simulation && simulationRef.current === simulation)
        simulationRef.current = null;
    };
  }, [initialWorld, applyReadModel, currentSimulationTime, persistSimulation]);

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
  const focusBuildSite = () => {
    const candidate = world.cells.find((cell) =>
      validatePlacement(world, {
        type: buildingType,
        x: cell.x,
        y: cell.y,
        rotation,
      }).valid,
    );
    if (!candidate) {
      setBuildMessage(
        `No valid ${buildingDefinitions[buildingType].name} site is currently connected to a road.`,
      );
      return;
    }
    setSelected(candidate);
    setHovered(candidate);
    setCamera((current) => ({
      ...current,
      focus: focusCell(candidate),
      zoom: Math.max(current.zoom, 1.6),
    }));
    setBuildMessage("A valid physical site is selected. Review affordability, then click the footprint to build.");
  };
  const focusRoadSite = () => {
    const candidate = world.cells.find(
      (cell) => validateRoadPlacement(world, cell).valid,
    );
    if (!candidate) {
      setBuildMessage("No dry, empty cell currently extends the road network.");
      return;
    }
    setSelected(candidate);
    setHovered(candidate);
    setCamera((current) => ({
      ...current,
      focus: focusCell(candidate),
      zoom: Math.max(current.zoom, 1.6),
    }));
    setBuildMessage("A valid road extension is selected. Click the cell to build.");
  };
  const issueProductionCommand = (
    command: GameCommand,
    pendingMessage: string,
    successMessage: (
      result: Extract<CommandResult, { ok: true }>,
    ) => string,
  ) => {
    if (productionBusy) return;
    setProductionBusy(true);
    setProductionMessage(pendingMessage);
    try {
      const simulation = simulationRef.current;
      if (!simulation) throw new Error("Local simulation is starting.");
      const result = simulation.execute(command, currentSimulationTime());
      applyReadModel(result.readModel);
      persistSimulation(simulation, { force: true });
      if (!result.ok) throw new Error(result.error);
      setProductionMessage(successMessage(result));
    } catch (error) {
      setProductionMessage(
        error instanceof Error ? error.message : "Production command failed.",
      );
    } finally {
      setProductionBusy(false);
    }
  };
  const updateWorkers = (site: ProductionSite, workers: number) =>
    issueProductionCommand(
      { type: "set_workers", buildingId: site.buildingId, workers },
      "Assigning workers…",
      () => "Worker assignment updated.",
    );
  const setProductionPaused = (site: ProductionSite, paused: boolean) =>
    issueProductionCommand(
      {
        type: "set_production_paused",
        buildingId: site.buildingId,
        paused,
      },
      paused ? "Pausing production…" : "Resuming production…",
      () => (paused ? "Production paused and workers released." : "Production resumed. Assign workers when ready."),
    );
  const setProductionRecipe = (
    site: ProductionSite,
    recipeId: ProductionSite["recipeId"],
  ) =>
    issueProductionCommand(
      { type: "set_recipe", buildingId: site.buildingId, recipeId },
      "Changing recipe…",
      () => "Production recipe updated.",
    );
  const setProductionPriority = (
    site: ProductionSite,
    priority: ProductionSite["priority"],
  ) =>
    issueProductionCommand(
      {
        type: "set_production_priority",
        buildingId: site.buildingId,
        priority,
      },
      "Changing production priority…",
      () => `Production priority set to ${priority}.`,
    );
  const setDispatchPolicy = (site: ProductionSite, policy: DispatchPolicy) =>
    issueProductionCommand(
      { type: "set_dispatch_policy", buildingId: site.buildingId, policy },
      "Changing delivery…",
      () => `${site.name} delivery set to ${dispatchPolicyLabels[policy]}.`,
    );
  const upgradeProduction = (site: ProductionSite) =>
    issueProductionCommand(
      { type: "upgrade_production", buildingId: site.buildingId },
      "Upgrading production…",
      () =>
        `${site.name} industrialised. Reassign the freed workers where they are needed.`,
    );
  const setIndustryPaused = (commodity: Commodity, paused: boolean) =>
    issueProductionCommand(
      { type: "set_industry_paused", commodity, paused },
      paused ? "Exiting industry…" : "Re-entering industry…",
      () =>
        paused
          ? `Exited ${commodityDefinitions[commodity].name}. Workers are free for other industries.`
          : `Re-entered ${commodityDefinitions[commodity].name}. Assign workers to restart output.`,
    );
  const dispatchProduction = (site: ProductionSite) =>
    issueProductionCommand(
      { type: "dispatch_production", buildingId: site.buildingId },
      "Dispatching output…",
      (result) =>
        `${result.collected ?? 0} ${commodityDefinitions[site.output].name} dispatched to the warehouse.`,
    );
  const sellGoods = (
    commodity: Commodity,
    quantity: number,
    expectedPriceCents: number,
  ) => {
    if (productionBusy || quantity <= 0) return;
    setProductionBusy(true);
    setMarketMessage(`Selling ${quantity} ${commodity}…`);
    try {
      const simulation = simulationRef.current;
      if (!simulation) throw new Error("Local simulation is starting.");
      const result = simulation.execute(
        {
          type: "sell_goods",
          commodity,
          quantity,
          expectedPriceCents,
        },
        currentSimulationTime(),
      );
      applyReadModel(result.readModel);
      persistSimulation(simulation, { force: true });
      if (!result.ok) throw new Error(result.error);
      if (!result.sale) throw new Error("The market did not return a sale receipt.");
      setLastMarketSale(result.sale);
      setSaleQuantities((current) => ({ ...current, [commodity]: "" }));
      setMarketMessage(
        `${quantity} ${commodityDefinitions[commodity].name} sold for ${money(result.sale.revenueCents)}.`,
      );
    } catch (error) {
      setMarketMessage(
        error instanceof Error ? error.message : "Market sale failed.",
      );
    } finally {
      setProductionBusy(false);
    }
  };
  const createRegionalShipment = (
    command: Extract<GameCommand, { type: "create_regional_shipment" }>,
  ) => {
    if (productionBusy) return;
    setProductionBusy(true);
    setRegionalTradeMessage("Booking cargo and transport…");
    try {
      const simulation = simulationRef.current;
      if (!simulation) throw new Error("Local simulation is starting.");
      const result = simulation.execute(command, currentSimulationTime());
      applyReadModel(result.readModel);
      persistSimulation(simulation, { force: true });
      if (!result.ok) throw new Error(result.error);
      if (!result.regionalShipment)
        throw new Error("The regional exchange did not return a shipment.");
      const shipment = result.regionalShipment;
      setRegionalTradeMessage(
        `${shipment.quantity} ${commodityDefinitions[shipment.commodity].name} is traveling to ${shipment.destination.cityName}. Estimated ${shipment.estimatedProfitCents < 0 ? "loss" : "profit"}: ${money(Math.abs(shipment.estimatedProfitCents))}.`,
      );
    } catch (error) {
      setRegionalTradeMessage(
        error instanceof Error ? error.message : "Regional shipment failed.",
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
  const shiftProduction = (commodity: Commodity) => {
    if (!production) return;
    const compatibleRecipes = Object.values(productionRecipes).filter(
      (recipe) => (recipe.outputs[commodity] ?? 0) > 0,
    );
    const existingSite = production.sites.find((site) =>
      compatibleRecipes.some((recipe) => recipe.producer === site.type),
    );
    setMarketOpen(false);
    setRegionalTradeOpen(false);
    setMarketMessage(null);
    if (existingSite) {
      focusBuilding(existingSite.buildingId);
      setProductionMessage(
        `Adjust workers, priority, pause state, or recipe to change ${commodityDefinitions[commodity].name} production.`,
      );
      return;
    }
    const producerType = compatibleRecipes[0]?.producer;
    if (!producerType) return;
    setTool("build");
    setBuildingType(producerType);
    setHovered(null);
    setBuildMessage(
      `Choose a valid site for a ${buildingDefinitions[producerType].name} that can produce ${commodityDefinitions[commodity].name}.`,
    );
  };
  const processStock = (commodity: Commodity) => {
    if (!production) return;
    const processingRecipes = Object.values(productionRecipes).filter(
      (recipe) => (recipe.consumableInputs[commodity] ?? 0) > 0,
    );
    const processor = production.sites.find((site) =>
      processingRecipes.some((recipe) => recipe.producer === site.type),
    );
    setMarketOpen(false);
    setMarketMessage(null);
    if (processor) {
      focusBuilding(processor.buildingId);
      setProductionMessage(
        `${commodityDefinitions[commodity].name} can feed ${processingRecipes.map((recipe) => recipe.name).join(" or ")}. Choose the recipe and allocate labor here.`,
      );
      return;
    }
    const producerType = processingRecipes[0]?.producer;
    if (!producerType) return;
    setTool("build");
    setBuildingType(producerType);
    setHovered(null);
    setBuildMessage(
      `Choose a valid site for a ${buildingDefinitions[producerType].name} that can process ${commodityDefinitions[commodity].name}.`,
    );
  };
  const buildMoreProduction = (commodity: Commodity) => {
    const producerType = Object.values(productionRecipes).find(
      (recipe) => (recipe.outputs[commodity] ?? 0) > 0,
    )?.producer;
    if (!producerType) return;
    setMarketOpen(false);
    setTool("build");
    setBuildingType(producerType);
    setHovered(null);
    setBuildMessage(
      `Choose a valid site for another ${buildingDefinitions[producerType].name} that can produce ${commodityDefinitions[commodity].name}.`,
    );
  };
  /**
   * Routes an industry response to the verb that already owns it. Every branch
   * ends in an existing authoritative command or an existing build/inspect flow.
   */
  const respondToIndustry = (
    position: IndustryPosition,
    kind: IndustryResponseKind,
  ) => {
    if (kind === "exit") {
      setIndustryPaused(position.commodity, true);
      return;
    }
    if (kind === "reenter") {
      setIndustryPaused(position.commodity, false);
      return;
    }
    if (kind === "expand") {
      buildMoreProduction(position.commodity);
      return;
    }
    if (kind === "reduce") {
      const site = production?.sites.find(
        (candidate) =>
          candidate.output === position.commodity && !candidate.paused,
      );
      if (!site) return;
      setMarketOpen(false);
      focusBuilding(site.buildingId);
      setProductionMessage(
        `Lower the worker count on ${site.name} to reduce ${position.commodityName} output without losing the building.`,
      );
      return;
    }
    setMarketOpen(false);
    setRegionalTradeOpen(true);
    setRegionalTradeMessage(
      `Choose a destination that pays more for ${position.commodityName} than Novagrad's ${money(position.priceCents)}.`,
    );
  };
  const confirmPlacement = (candidate: SurfaceCell | null) => {
    if (tool === "inspect" || !candidate || submitting) return;
    if (tool === "road") {
      const request: RoadPlacementRequest = { x: candidate.x, y: candidate.y };
      const validation = validateRoadPlacement(world, request);
      if (!validation.valid) {
        setBuildMessage(validation.reasons.join(". "));
        return;
      }
      setSubmitting(true);
      setBuildMessage("Validating road construction command…");
      try {
        const simulation = simulationRef.current;
        if (!simulation) throw new Error("Local simulation is starting.");
        const result = simulation.execute(
          {
            type: "construct_road",
            expectedRevision: revision,
            placement: request,
          },
          currentSimulationTime(),
        );
        applyReadModel(result.readModel);
        persistSimulation(simulation, { force: true });
        if (!result.ok || !result.road) {
          setBuildMessage(
            result.ok ? "Road construction could not be completed." : result.error,
          );
          return;
        }
        setSelected(
          result.readModel.world.cells[
            result.road.y * result.readModel.world.size + result.road.x
          ],
        );
        setHovered(null);
        setBuildMessage(
          `Road constructed. −${money(result.constructionCost?.cashCents ?? 0)}`,
        );
      } catch (error) {
        setBuildMessage(
          error instanceof Error ? error.message : "Road construction command failed.",
        );
      } finally {
        setSubmitting(false);
      }
      return;
    }
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
    setBuildMessage("Validating construction command…");
    try {
      const simulation = simulationRef.current;
      if (!simulation) throw new Error("Local simulation is starting.");
      const result = simulation.execute(
        {
          type: "construct",
          expectedRevision: revision,
          placement: request,
        },
        currentSimulationTime(),
      );
      applyReadModel(result.readModel);
      persistSimulation(simulation, { force: true });
      if (!result.ok || !result.building) {
        setBuildMessage(
          result.ok ? "Construction could not be completed." : result.error,
        );
        return;
      }
      setSelected(
        result.readModel.world.cells[
          result.building.y * result.readModel.world.size + result.building.x
        ],
      );
      setHovered(null);
      setBuildMessage(
        `${buildingDefinitions[result.building.type].name} constructed. −${money(result.constructionCost?.cashCents ?? 0)}${result.constructionCost && materialSummary(result.constructionCost.materials) ? ` · −${materialSummary(result.constructionCost.materials)}` : ""}`,
      );
    } catch (error) {
      setBuildMessage(
        error instanceof Error ? error.message : "Construction command failed.",
      );
    } finally {
      setSubmitting(false);
    }
  };
  const demolishBuilding = (buildingId: string) => {
    if (submitting) return;
    setSubmitting(true);
    setBuildMessage("Validating demolition command…");
    try {
      const simulation = simulationRef.current;
      if (!simulation) throw new Error("Local simulation is starting.");
      const result = simulation.execute(
        { type: "demolish", buildingId },
        currentSimulationTime(),
      );
      applyReadModel(result.readModel);
      persistSimulation(simulation, { force: true });
      if (!result.ok) throw new Error(result.error);
      setSelected(null);
      setProductionMessage(null);
      setBuildMessage("Building demolished. Its workers and capacity were released.");
    } catch (error) {
      setBuildMessage(
        error instanceof Error ? error.message : "Demolition command failed.",
      );
    } finally {
      setSubmitting(false);
    }
  };
  const selectedBuilding = selected
    ? buildingAt(world, selected.x, selected.y)
    : undefined;
  const selectedRoad = selected
    ? (world.roads ?? []).some(
        (road) => road.x === selected.x && road.y === selected.y,
      )
    : false;
  const selectedProduction = selectedBuilding
    ? production?.sites.find((site) => site.buildingId === selectedBuilding.id)
    : undefined;
  const selectedMarketListing = production?.market.listings.find(
    (listing) => listing.commodity === selectedMarketCommodity,
  );
  const selectedWarehouseInventory =
    production && selectedBuilding?.type === "warehouse"
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
  const selectedPlacement = (() => {
    if (!selected) return null;
    if (tool === "road") {
      const physical = validateRoadPlacement(world, selected);
      const economic = production
        ? validateRoadConstructionResources(
            production.market.cashCents,
            production.logistics.warehouseInventory,
          )
        : { affordable: false, reasons: ["Simulation is starting"] };
      return {
        ...physical,
        valid: physical.valid && economic.affordable,
        reasons: [...physical.reasons, ...economic.reasons],
      };
    }
    const physical = validatePlacement(world, {
      type: buildingType,
      x: selected.x,
      y: selected.y,
      rotation,
    });
    const economic = production
      ? validateConstructionResources(
          buildingType,
          production.market.cashCents,
          production.logistics.warehouseInventory,
        )
      : { affordable: false, reasons: ["Simulation is starting"] };
    return {
      ...physical,
      valid: physical.valid && economic.affordable,
      reasons: [...physical.reasons, ...economic.reasons],
    };
  })();

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
              Prototype / Milestone 28.6
            </p>
          </div>
        </div>
        <nav
          className="flex items-center gap-1 rounded-xl border border-white/10 bg-black/10 p-1"
          aria-label="Primary views"
        >
          <button
            className={`rounded-lg px-4 py-2 text-sm transition ${!marketOpen && !companyOpen && !regionalTradeOpen ? "bg-sky-600 text-white" : "text-slate-300 hover:bg-white/10"}`}
            onClick={() => {
              setMarketOpen(false);
              setCompanyOpen(false);
              setRegionalTradeOpen(false);
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
              setRegionalTradeOpen(false);
              sidebarRef.current?.scrollTo({ top: 0 });
            }}
          >
            Market
          </button>
          <button
            className={`rounded-lg px-4 py-2 text-sm transition ${regionalTradeOpen ? "bg-sky-600 text-white" : "text-slate-300 hover:bg-white/10"}`}
            onClick={() => {
              setRegionalTradeOpen(true);
              setMarketOpen(false);
              setCompanyOpen(false);
              sidebarRef.current?.scrollTo({ top: 0 });
            }}
          >
            Regions
          </button>
          <button
            className={`rounded-lg px-4 py-2 text-sm ${companyOpen ? "bg-sky-600" : "text-slate-300 hover:bg-white/10"}`}
            onClick={() => {
              setCompanyOpen(true);
              setMarketOpen(false);
              setRegionalTradeOpen(false);
              sidebarRef.current?.scrollTo({ top: 0 });
            }}
          >
            Company
          </button>
        </nav>
        <div
          className="flex items-center gap-1 rounded-xl border border-white/10 bg-black/10 p-1"
          aria-label="Simulation speed"
        >
          {simulationSpeeds.map((speed) => (
            <button
              key={speed}
              aria-pressed={simulationSpeed === speed}
              className={`rounded-md px-2 py-1 text-xs ${simulationSpeed === speed ? "bg-amber-300 text-slate-950" : "text-slate-300 hover:bg-white/10"}`}
              onClick={() => setSimulationSpeed(speed)}
            >
              {speed === 0 ? "Pause" : `${speed}×`}
            </button>
          ))}
        </div>
        <span className="rounded-full border border-emerald-300/20 bg-emerald-300/5 px-3 py-1.5 text-xs text-emerald-200">
          {production
            ? new Date(production.simulationTime).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              }) + " · "
            : ""}
          {tool === "build"
            ? "Build tool active"
            : tool === "road"
              ? "Road tool active"
              : "Local session"}
        </span>
        {saveMessage && (
          <span className="rounded-lg border border-amber-300/30 bg-amber-300/10 px-3 py-1.5 text-xs text-amber-100" role="status">
            {saveMessage}
          </span>
        )}
      </header>
      <div className="relative flex min-h-0 flex-1 flex-col md:flex-row">
        <PlayerHud
          world={world}
          snapshot={production}
          onCompany={() => {
            setCompanyOpen(true);
            setMarketOpen(false);
            setRegionalTradeOpen(false);
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
              if (tool !== "inspect") {
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
                    buildingVisualSet,
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
                  buildingVisualSet,
                );
                if (tool !== "inspect") void confirmPlacement(candidate);
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
                    buildingVisualSet,
                  );
                  if (tool !== "inspect") void confirmPlacement(candidate);
                  else setSelected(candidate);
                } else if (key === "escape") {
                  setTool("inspect");
                  setHovered(null);
                  setBuildMessage(null);
                } else if (key === "r" && tool === "build") rotatePreview();
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
          {regionalTradeOpen && production && (
            <RegionalTrader
              snapshot={production}
              revision={revision}
              busy={productionBusy}
              message={regionalTradeMessage}
              onCreate={createRegionalShipment}
              onShiftProduction={shiftProduction}
            />
          )}
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
              {selectedMarketListing && (
                <section
                  className="mt-4 rounded-xl border border-sky-300/20 bg-slate-950/35 p-3"
                  aria-label={`${selectedMarketListing.name} price chart`}
                >
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <label className="min-w-0 flex-1 text-[10px] uppercase tracking-[0.16em] text-slate-400">
                      Commodity
                      <select
                        className="mt-1 block w-full rounded-md border border-white/15 bg-slate-900 px-2 py-2 text-xs normal-case tracking-normal text-slate-100"
                        value={selectedMarketCommodity}
                        onChange={(event) =>
                          setSelectedMarketCommodity(
                            event.target.value as Commodity,
                          )
                        }
                      >
                        {production.market.listings.map((listing) => (
                          <option
                            key={listing.commodity}
                            value={listing.commodity}
                          >
                            {listing.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      className={`${button} px-2 py-2 text-[11px]`}
                      onClick={(event) => {
                        marketChartReturnFocusRef.current = event.currentTarget;
                        setMarketChartExpanded(true);
                      }}
                    >
                      Expand Chart
                    </button>
                  </div>
                  <div className="mt-3">
                    <MarketChartControls
                      chartType={marketChartType}
                      timeframeId={marketChartTimeframe}
                      onChartTypeChange={setMarketChartType}
                      onTimeframeChange={setMarketChartTimeframe}
                    />
                  </div>
                  <div className="mt-3 flex items-center justify-between text-[10px] text-slate-500">
                    <span>Novagrad · simulation history</span>
                    <span>
                      {selectedMarketListing.history.length} observations ·{" "}
                      {
                        marketChartTimeframes.find(
                          (timeframe) =>
                            timeframe.id === marketChartTimeframe,
                        )!.label
                      }
                    </span>
                  </div>
                  <MarketPriceChart
                    history={selectedMarketListing.history}
                    chartType={marketChartType}
                    timeframeId={marketChartTimeframe}
                    currentTime={production.simulationTime}
                    selectedPeriodStart={selectedMarketPeriodStart}
                    onSelectedPeriodStartChange={
                      setSelectedMarketPeriodStart
                    }
                  />
                  {marketChartType === "candlestick" && (
                    <div className="mt-1 flex justify-center gap-4 text-[10px]">
                      <span className="text-emerald-300">■ Rising</span>
                      <span className="text-rose-300">■ Falling</span>
                      <span className="text-slate-400">■ Unchanged</span>
                    </div>
                  )}
                  {marketChartTimeframe === "1s" && (
                    <p className="mt-2 text-[10px] leading-4 text-slate-500">
                      The market publishes scheduled prices every 5 simulation
                      seconds. Empty 1s intervals remain empty; sales can add
                      genuine observations between ticks.
                    </p>
                  )}
                </section>
              )}
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
                          className={`text-[10px] ${listing.trendPercent > 0 ? "text-emerald-300" : listing.trendPercent < 0 ? "text-red-300" : "text-slate-400"}`}
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
                    <div className="mt-3 flex items-center justify-between gap-2">
                      <span
                        className={`rounded-full px-2 py-1 text-[10px] uppercase ${listing.supplyStatus === "critical_shortage" ? "bg-red-400/10 text-red-300" : listing.supplyStatus === "shortage" ? "bg-amber-300/10 text-amber-200" : listing.supplyStatus === "oversupplied" ? "bg-sky-300/10 text-sky-200" : "bg-emerald-300/10 text-emerald-200"}`}
                      >
                        {listing.supplyStatus.replaceAll("_", " ")}
                      </span>
                      <button
                        className={`${button} px-2 py-1 text-[11px]`}
                        onClick={() => shiftProduction(listing.commodity)}
                      >
                        Shift production
                      </button>
                    </div>
                    {(() => {
                      const draft = saleQuantities[listing.commodity] ?? "";
                      const canProcess = Object.values(productionRecipes).some(
                        (recipe) =>
                          (recipe.consumableInputs[listing.commodity] ?? 0) > 0,
                      );
                      const requested = /^\d+$/.test(draft)
                        ? Number.parseInt(draft, 10)
                        : 0;
                      const validQuantity =
                        requested > 0 && requested <= listing.available;
                      const retained = validQuantity
                        ? listing.available - requested
                        : listing.available;
                      return (
                        <form
                          className="mt-3 rounded-lg border border-white/10 bg-slate-950/30 p-2"
                          onSubmit={(event) => {
                            event.preventDefault();
                            if (validQuantity)
                              void sellGoods(
                                listing.commodity,
                                requested,
                                listing.priceCents,
                              );
                          }}
                        >
                          <div className="grid grid-cols-2 gap-2 text-[10px] sm:grid-cols-4">
                            <div>
                              <span className="block text-slate-500">Owned</span>
                              <span className="mt-0.5 block font-mono text-slate-100">
                                {listing.available}
                              </span>
                            </div>
                            <div>
                              <span className="block text-slate-500">Current price</span>
                              <span className="mt-0.5 block font-mono text-slate-100">
                                {money(listing.priceCents)}
                              </span>
                            </div>
                            <div>
                              <span className="block text-slate-500">Estimated revenue</span>
                              <span className="mt-0.5 block font-mono text-emerald-200">
                                {money(validQuantity ? requested * listing.priceCents : 0)}
                              </span>
                            </div>
                            <div>
                              <span className="block text-slate-500">Retained after sale</span>
                              <span className="mt-0.5 block font-mono text-sky-200">
                                {retained}
                              </span>
                            </div>
                          </div>
                          <div className="mt-2 flex items-end gap-2">
                            <label className="min-w-0 flex-1 text-[10px] uppercase tracking-wide text-slate-400">
                              Sell quantity
                              <input
                                type="number"
                                min={1}
                                max={listing.available}
                                step={1}
                                inputMode="numeric"
                                value={draft}
                                placeholder="0"
                                className="mt-1 block w-full rounded-md border border-white/15 bg-slate-900 px-2 py-1.5 font-mono text-xs normal-case tracking-normal text-white"
                                onChange={(event) =>
                                  setSaleQuantities((current) => ({
                                    ...current,
                                    [listing.commodity]: event.target.value,
                                  }))
                                }
                              />
                            </label>
                            <button
                              type="button"
                              className={`${button} px-2 py-1.5 text-[11px]`}
                              disabled={listing.available < 1}
                              onClick={() => {
                                setSaleQuantities((current) => ({
                                  ...current,
                                  [listing.commodity]: "",
                                }));
                                setMarketMessage(
                                  `${listing.available} ${listing.name} retained in owned storage.`,
                                );
                              }}
                            >
                              Retain all
                            </button>
                            <button
                              type="submit"
                              className={`${button} border-emerald-300/30 bg-emerald-400/10 px-3 py-1.5 text-[11px] text-emerald-100`}
                              disabled={productionBusy || !validQuantity}
                            >
                              Sell
                            </button>
                          </div>
                          {requested > listing.available && (
                            <p className="mt-2 text-[10px] text-red-300">
                              Only {listing.available} units are available in owned storage.
                            </p>
                          )}
                          <div className="mt-2 flex flex-wrap gap-1 border-t border-white/10 pt-2">
                            {canProcess && (
                              <button
                                type="button"
                                className={`${button} px-2 py-1 text-[10px]`}
                                onClick={() => processStock(listing.commodity)}
                              >
                                Process stock
                              </button>
                            )}
                            <button
                              type="button"
                              className={`${button} px-2 py-1 text-[10px]`}
                              onClick={() => buildMoreProduction(listing.commodity)}
                            >
                              Build more
                            </button>
                          </div>
                        </form>
                      );
                    })()}
                    <dl className="mt-3 grid grid-cols-3 gap-1 border-t border-white/10 pt-2 text-center text-[10px]">
                      {[
                        ["Recent supply", listing.recentSupply],
                        ["Recent demand", listing.recentDemand],
                        ["Consumed", listing.recentConsumption],
                      ].map(([label, value]) => (
                        <div key={label}>
                          <dt className="text-slate-500">{label}</dt>
                          <dd className="mt-0.5 font-mono text-slate-200">
                            {value}
                          </dd>
                        </div>
                      ))}
                    </dl>
                    <div className="mt-2 rounded-lg bg-slate-950/40 px-2 py-1.5">
                      <p className="text-[9px] uppercase tracking-wide text-slate-500">
                        Price reasons
                      </p>
                      <ul className="mt-1 space-y-1 text-[10px] leading-4 text-slate-300">
                        {listing.priceReasons.map((reason) => (
                          <li key={reason}>• {reason}</li>
                        ))}
                      </ul>
                    </div>
                  </article>
                ))}
              </div>
              {marketMessage && (
                <p className="mt-3 text-xs text-amber-100" aria-live="polite">
                  {marketMessage}
                </p>
              )}
              {lastMarketSale && (
                <dl className="mt-3 grid grid-cols-2 gap-2 rounded-lg border border-emerald-300/20 bg-emerald-400/5 p-3 text-[10px]">
                  <div>
                    <dt className="text-slate-500">Last actual revenue</dt>
                    <dd className="mt-0.5 font-mono text-emerald-200">
                      {money(lastMarketSale.revenueCents)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Accepted sale</dt>
                    <dd className="mt-0.5 text-slate-200">
                      {lastMarketSale.quantity} {commodityDefinitions[lastMarketSale.commodity].name} at {money(lastMarketSale.unitPriceCents)}
                    </dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-slate-500">Stockpile remaining</dt>
                    <dd className="mt-0.5 text-sky-200">
                      {lastMarketSale.remainingInventory} {commodityDefinitions[lastMarketSale.commodity].name} retained in the Warehouse
                    </dd>
                  </div>
                </dl>
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
              <div className="mt-5">
                <p className="text-[10px] uppercase tracking-[0.18em] text-sky-200">
                  Market intelligence
                </p>
                <p className="mt-1 text-[10px] leading-4 text-slate-400">
                  Read-only regional analysis of the same economy NPC cities and
                  companies trade in. Possible responses are informational.
                </p>
                <div className="mt-2 space-y-2">
                  {production.marketIntelligence.reports
                    .slice(0, marketIntelligencePolicy.reportLimit)
                    .map((report) => (
                      <article
                        key={report.id}
                        className="rounded-xl border border-white/10 bg-black/15 p-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <h3 className="text-xs font-semibold text-slate-100">
                              {report.locationName} — {report.commodityName}
                            </h3>
                            <p
                              className={`mt-1 text-[9px] uppercase tracking-wide ${marketConditionTone[report.condition]}`}
                            >
                              {report.conditionLabel}
                            </p>
                          </div>
                          <p className="font-mono text-[11px] text-slate-200">
                            {money(report.priceCents)}
                          </p>
                        </div>
                        <dl className="mt-2 grid grid-cols-3 gap-1 text-center text-[10px]">
                          <div>
                            <dt className="text-slate-500">Regional median</dt>
                            <dd className="mt-0.5 font-mono text-slate-200">
                              {money(report.regionalMedianPriceCents)}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-slate-500">Inventory</dt>
                            <dd className="mt-0.5 font-mono text-slate-200">
                              {report.inventory}/{report.targetStock}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-slate-500">Coverage</dt>
                            <dd className="mt-0.5 font-mono text-slate-200">
                              {report.inventoryCoveragePeriods === null
                                ? "—"
                                : `${report.inventoryCoveragePeriods.toFixed(1)} ${marketIntelligencePolicy.coveragePeriodLabel}s`}
                            </dd>
                          </div>
                        </dl>
                        <ul className="mt-2 space-y-1 text-[10px] leading-4 text-slate-300">
                          {report.reasons.map((reason) => (
                            <li key={reason}>• {reason}</li>
                          ))}
                        </ul>
                        {report.responses.length > 0 && (
                          <div className="mt-2 border-t border-white/10 pt-2">
                            <p className="text-[9px] uppercase tracking-wide text-slate-500">
                              Possible responses
                            </p>
                            <ul className="mt-1 space-y-1 text-[10px] leading-4 text-sky-200">
                              {report.responses.map((response) => (
                                <li key={response.kind}>
                                  {response.label}
                                  <span className="text-slate-400">
                                    {" "}
                                    — {response.detail}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </article>
                    ))}
                </div>
              </div>
              <div className="mt-5">
                <p className="text-[10px] uppercase tracking-[0.18em] text-violet-200">
                  Competitive response
                </p>
                <p className="mt-1 text-[10px] leading-4 text-slate-400">
                  Your position in each industry, and what you can do about it.
                  Margin is price minus input cost, not profit.
                </p>
                <div className="mt-2 space-y-2">
                  {production.competition.positions
                    .filter(
                      (position) =>
                        position.playerSiteCount > 0 ||
                        (position.condition !== null &&
                          position.condition !== "balanced"),
                    )
                    .slice(0, competitionPolicy.periodHistoryLimit)
                    .map((position) => (
                      <article
                        key={position.commodity}
                        className="rounded-xl border border-white/10 bg-black/15 p-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <h3 className="text-xs font-semibold text-slate-100">
                              {position.commodityName}
                            </h3>
                            <p className="mt-1 text-[9px] uppercase tracking-wide text-slate-400">
                              {position.playerSiteCount === 0
                                ? "Not in this industry"
                                : `${position.playerActiveSiteCount}/${position.playerSiteCount} site${position.playerSiteCount === 1 ? "" : "s"} active`}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="font-mono text-[11px] text-slate-200">
                              {money(position.priceCents)}
                            </p>
                            <p
                              className={`text-[9px] ${position.unitMarginCents >= 0 ? "text-emerald-300" : "text-red-300"}`}
                            >
                              {money(position.unitMarginCents)} / unit margin
                            </p>
                          </div>
                        </div>
                        <dl className="mt-2 grid grid-cols-3 gap-1 text-center text-[10px]">
                          {[
                            ["Market size", `${position.marketSizeUnits}`],
                            ["Supply", `${position.currentSupply}`],
                            ["Demand", `${position.currentDemand}`],
                            [
                              "Your share",
                              `${(position.playerSupplyShareBasisPoints / 100).toFixed(1)}%`,
                            ],
                            [
                              "NPC growth",
                              `${position.npcSupplyGrowthUnits >= 0 ? "+" : ""}${position.npcSupplyGrowthUnits}`,
                            ],
                            ["Entrants", `${position.recentEntrants}`],
                          ].map(([label, value]) => (
                            <div key={label}>
                              <dt className="text-slate-500">{label}</dt>
                              <dd className="mt-0.5 font-mono text-slate-200">
                                {value}
                              </dd>
                            </div>
                          ))}
                        </dl>
                        <p className="mt-2 text-[10px] leading-4 text-slate-400">
                          Input cost {money(position.unitInputCostCents)} per
                          unit · entry {money(position.entryCostCents)} ·
                          regional median{" "}
                          {money(position.regionalMedianPriceCents)}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-1 border-t border-white/10 pt-2">
                          {position.responses.map((response) => (
                            <button
                              key={response.kind}
                              type="button"
                              title={response.detail}
                              disabled={productionBusy}
                              className={`${button} px-2 py-1 text-[10px] disabled:opacity-50`}
                              onClick={() =>
                                respondToIndustry(position, response.kind)
                              }
                            >
                              {response.label}
                            </button>
                          ))}
                        </div>
                      </article>
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
              {production && (
                <section
                  className="mb-6 border-b border-white/10 pb-5"
                  aria-label="NPC company competition"
                >
                  <p className="text-[10px] uppercase tracking-[0.2em] text-violet-200">
                    Competitors
                  </p>
                  <h2 className="mt-1 text-lg font-semibold">NPC companies</h2>
                  <p className="mt-1 text-[10px] leading-4 text-slate-400">
                    Deterministic firms use real city inventory, labor, recipes,
                    cash, prices, and shipments.
                  </p>
                  <div className="mt-3 space-y-2">
                    {production.npcCompanies.map((company) => {
                      const latest = company.decisions.at(-1);
                      const assigned = company.facilities.reduce(
                        (total, facility) =>
                          total + facility.assignedWorkers,
                        0,
                      );
                      return (
                        <article
                          key={company.id}
                          className="rounded-xl border border-white/10 bg-black/15 p-3"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <h3 className="text-xs font-semibold text-slate-100">
                                {company.name}
                              </h3>
                              <p className="mt-1 text-[9px] uppercase tracking-wide text-violet-200">
                                {company.role} · {company.homeCityId.replaceAll("-", " ")}
                              </p>
                            </div>
                            <span className="font-mono text-xs text-emerald-200">
                              {money(company.cashCents)}
                            </span>
                          </div>
                          <dl className="mt-2 grid grid-cols-3 gap-1 text-[10px]">
                            <div>
                              <dt className="text-slate-500">Labor</dt>
                              <dd>{assigned}/{company.workforce}</dd>
                            </div>
                            <div>
                              <dt className="text-slate-500">Capacity</dt>
                              <dd>{company.facilities.reduce((sum, facility) => sum + facility.capacity, 0)}</dd>
                            </div>
                            <div>
                              <dt className="text-slate-500">Trade P/L</dt>
                              <dd className={company.realizedTradeProfitCents < 0 ? "text-rose-300" : "text-emerald-200"}>
                                {money(company.realizedTradeProfitCents)}
                              </dd>
                            </div>
                          </dl>
                          {latest && (
                            <div className="mt-2 border-t border-white/10 pt-2">
                              <p className="text-[10px] font-medium text-slate-200">
                                {latest.summary}
                              </p>
                              <ul className="mt-1 space-y-1 text-[10px] leading-4 text-slate-400">
                                {latest.reasons.map((reason) => (
                                  <li key={reason}>• {reason}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </article>
                      );
                    })}
                  </div>
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
                      {production.labor.unassignedWorkers} /{" "}
                      {production.labor.totalWorkforce} available
                    </span>
                  )}
                </div>
                <div className="mt-3 space-y-2">
                  {production?.sites.map((site) => {
                    const building = world.buildings?.find(
                      (candidate) => candidate.id === site.buildingId,
                    );
                    const statusLabel =
                      site.status === "paused"
                        ? "Paused"
                        : site.status === "storage_full"
                        ? "Storage full"
                        : site.status === "missing_inputs"
                          ? "Missing inputs"
                          : site.status === "missing_equipment"
                            ? "Missing equipment"
                        : site.laborStatus === "unassigned"
                          ? "Unassigned"
                          : site.laborStatus === "shortage"
                            ? "Worker shortage"
                            : "Running";
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
                            {site.name} · {site.recipeName}
                          </span>
                          <span className="mt-1 block text-[10px] text-slate-400">
                            {site.assignedWorkers}/{site.requiredWorkers}{" "}
                            workers · {Math.round(site.laborEfficiency * 100)}%
                            {" labor · "}{site.stored}/{site.storageCapacity}{" "}
                            {commodityDefinitions[site.output].name}
                          </span>
                          <span className="mt-1 block text-[10px] capitalize text-slate-500">
                            {site.priority} priority · expected {site.expectedOutputPerCycle.toFixed(1)} per cycle
                          </span>
                        </span>
                        <span
                          className={`shrink-0 text-[10px] ${site.status === "running" || site.status === "worker_shortage" ? "text-emerald-300" : site.status === "missing_workers" || site.status === "paused" ? "text-amber-300" : "text-red-300"}`}
                        >
                          ● {statusLabel}
                        </span>
                      </button>
                    );
                  }) ?? (
                    <p className="text-xs text-slate-400">
                      Starting the local simulation…
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
                    warehouse inventory only when the simulation marks its
                    shipment arrived.
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
                  {tool === "build"
                    ? "Place building"
                    : tool === "road"
                      ? "Place road"
                      : "Inspect"}
                </h2>
              </div>
              <div className="flex gap-2">
                {tool === "inspect" ? (
                  <>
                    <button
                      className={button}
                      onClick={() => {
                        setTool("build");
                        setHovered(null);
                        setBuildMessage(null);
                      }}
                    >
                      Buildings
                    </button>
                    <button
                      className={button}
                      onClick={() => {
                        setTool("road");
                        setHovered(null);
                        setBuildMessage(null);
                      }}
                    >
                      Roads
                    </button>
                  </>
                ) : (
                  <button
                    className={button}
                    onClick={() => {
                      setTool("inspect");
                      setHovered(null);
                      setBuildMessage(null);
                    }}
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
            {tool === "build" && (
              <div className="mt-4 space-y-3">
                <div className="grid gap-2">
                  {constructibleBuildingTypes.map((type) => {
                    const cost = constructionCosts[type];
                    const affordability = production
                      ? validateConstructionResources(
                          type,
                          production.market.cashCents,
                          production.logistics.warehouseInventory,
                        )
                      : null;
                    const footprint = footprintOf(type, rotation);
                    return (
                      <button
                        key={type}
                        className={`${button} px-3 text-left ${buildingType === type ? "border-amber-200/60 bg-amber-200/10 text-amber-100" : ""}`}
                        onClick={() => {
                          setBuildingType(type);
                          setBuildMessage(null);
                        }}
                      >
                        <span className="flex items-center justify-between gap-3">
                          <span className="font-semibold">
                            {buildingDefinitions[type].name}
                          </span>
                          <span
                            className={`text-[10px] ${affordability?.affordable ? "text-emerald-300" : "text-red-300"}`}
                          >
                            {affordability?.affordable
                              ? "Affordable"
                              : "Unavailable"}
                          </span>
                        </span>
                        <span className="mt-1 block text-[10px] leading-4 text-slate-400">
                          {money(cost.cashCents)}
                          {materialSummary(cost.materials)
                            ? ` · ${materialSummary(cost.materials)}`
                            : ""}
                          {` · ${footprint.width}×${footprint.depth}`}
                        </span>
                        <span className="mt-1 block text-[10px] leading-4 text-slate-300">
                          {buildingDefinitions[type].purpose}
                          {isProducerType(type)
                            ? (() => {
                                const selected =
                                  productionRecipes[
                                    defaultRecipeByProducer[type]
                                  ];
                                const [commodity] = Object.keys(
                                  selected.outputs,
                                ) as Commodity[];
                                return ` Default: ${selected.name} → ${commodityDefinitions[commodity].name}; ${selected.requiredWorkers} workers required.`;
                              })()
                            : ""}
                        </span>
                        {affordability && !affordability.affordable && (
                          <span className="mt-1 block text-[10px] text-red-200">
                            {affordability.reasons.join(" · ")}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-slate-400">
                    Rotation:{" "}
                    <span className="capitalize text-slate-200">
                      {rotation}
                    </span>
                  </span>
                  <div className="flex gap-2">
                    <button className={button} onClick={focusBuildSite}>
                      Find site
                    </button>
                    <button className={button} onClick={rotatePreview}>
                      Rotate (R)
                    </button>
                  </div>
                </div>
                <p className="text-xs leading-5 text-slate-400">
                  Move over the map for a footprint preview, then click to
                  construct. Farms require farmland, Lumber Camps require
                  forest, Quarries require stone, and every building requires
                  level ground beside a connected road.
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
              </div>
            )}
            {tool === "road" && (
              <div className="mt-4 space-y-3">
                <div className="rounded-lg border border-amber-200/30 bg-amber-200/5 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold text-amber-100">
                      Road
                    </span>
                    <span className="text-xs font-mono text-slate-200">
                      {money(roadConstructionCost.cashCents)} / cell
                    </span>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-slate-400">
                    Extend the connected network across one dry, empty cell at
                    a time. New segments provide road access for buildings.
                  </p>
                </div>
                <button className={button} onClick={focusRoadSite}>
                  Find extension
                </button>
                {placement && (
                  <div
                    className={`rounded-lg border p-3 text-xs ${placement.validation.valid ? "border-emerald-300/30 bg-emerald-300/5 text-emerald-200" : "border-red-300/30 bg-red-300/5 text-red-200"}`}
                    aria-live="polite"
                  >
                    {placement.validation.valid
                      ? "Valid road extension — click to build"
                      : placement.validation.reasons.join(" · ")}
                  </div>
                )}
              </div>
            )}
            {buildMessage && (
              <p className="mt-3 text-xs text-amber-100" aria-live="polite">
                {buildMessage}
              </p>
            )}
          </section>
          <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400">
            Selected location
          </p>
          <h2 className="mt-2 text-xl font-medium">
            {selectedBuilding
              ? buildingDefinitions[selectedBuilding.type].name
              : selectedRoad
                ? "Road"
              : selectedResource
                ? selectedResource.name
                : selected
                  ? terrainNames[selected.terrain]
                  : "Explore the world"}
          </h2>
          {selectedBuilding && (
            <>
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
              <button
                className={`${button} mt-3 w-full border-red-300/30 text-red-100`}
                disabled={submitting || selectedBuilding.type === "camp"}
                onClick={() => demolishBuilding(selectedBuilding.id)}
              >
                Demolish building
              </button>
            </>
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
                    {tool === "road"
                      ? "Buildable (Road)"
                      : `Buildable (${buildingDefinitions[buildingType].name})`}
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
                onClick={() => confirmPlacement(selected)}
              >
                {tool === "road" ? "Build road here" : "Build here"}
              </button>
            </div>
          )}
          {selectedProduction && (
            <div className="mt-4 rounded-xl border border-white/10 bg-black/10 p-4">
              <div className="flex items-center justify-between gap-3">
                <span
                  className={`text-xs font-semibold ${selectedProduction.status === "running" || selectedProduction.status === "worker_shortage" ? "text-emerald-300" : selectedProduction.status === "missing_workers" || selectedProduction.status === "paused" ? "text-amber-300" : "text-red-300"}`}
                >
                  {selectedProduction.status === "paused"
                    ? "● Paused"
                    : selectedProduction.status === "storage_full"
                    ? "● Storage full"
                    : selectedProduction.status === "missing_inputs"
                      ? "● Missing inputs"
                      : selectedProduction.status === "missing_equipment"
                        ? "● Missing equipment"
                    : selectedProduction.laborStatus === "unassigned"
                      ? "● Unassigned"
                      : selectedProduction.laborStatus === "shortage"
                        ? "● Worker shortage"
                        : "● Running"}
                </span>
                <span className="text-xs text-slate-400">
                  {selectedProduction.recipeName}
                </span>
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-300">
                {selectedProduction.statusReason}
              </p>
              <dl className="mt-2 grid grid-cols-3 gap-1 rounded-lg bg-black/20 px-2 py-1.5 text-center text-[10px]">
                <div>
                  <dt className="text-slate-500">Technology</dt>
                  <dd
                    className={`mt-0.5 capitalize ${selectedProduction.tier === "improved" ? "text-emerald-300" : "text-slate-200"}`}
                  >
                    {selectedProduction.tier}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Workers needed</dt>
                  <dd className="mt-0.5 font-mono text-slate-200">
                    {selectedProduction.requiredWorkers}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Per worker</dt>
                  <dd className="mt-0.5 font-mono text-slate-200">
                    {selectedProduction.outputPerWorkerPerCycle}
                  </dd>
                </div>
              </dl>
              {selectedProduction.upgradeOption &&
                selectedProduction.expansionOption && (
                  <section
                    className="mt-3 border-t border-white/10 pt-3"
                    aria-label="Grow this industry"
                  >
                    <p className="text-[10px] uppercase tracking-[0.16em] text-slate-400">
                      Grow this industry
                    </p>
                    <p className="mt-1 text-[10px] leading-4 text-slate-500">
                      More output from the same site, or more sites. Which wins
                      depends on whether labor or capital is scarce.
                    </p>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      {[
                        {
                          key: "upgrade",
                          title: `Upgrade · ${selectedProduction.upgradeOption.name}`,
                          cost: `${money(selectedProduction.upgradeOption.costCents)} + holds ${materialSummary(selectedProduction.upgradeOption.equipmentRequirements)}`,
                          workers: `${selectedProduction.upgradeOption.currentWorkers} → ${selectedProduction.upgradeOption.upgradedWorkers}`,
                          output: `${selectedProduction.upgradeOption.currentOutputPerCycle} → ${selectedProduction.upgradeOption.upgradedOutputPerCycle}`,
                          perWorker: `${selectedProduction.upgradeOption.currentOutputPerWorker} → ${selectedProduction.upgradeOption.upgradedOutputPerWorker}`,
                          blocked:
                            selectedProduction.upgradeOption.blockedReasons,
                        },
                        {
                          key: "expand",
                          title: `Build another ${selectedProduction.expansionOption.buildingName}`,
                          cost: `${money(selectedProduction.expansionOption.costCents)} + ${materialSummary(selectedProduction.expansionOption.materials)}`,
                          workers: `+${selectedProduction.expansionOption.requiredWorkers}`,
                          output: `+${selectedProduction.expansionOption.outputPerCycle}`,
                          perWorker: `${selectedProduction.expansionOption.outputPerWorker}`,
                          blocked:
                            selectedProduction.expansionOption.blockedReasons,
                        },
                      ].map((option) => (
                        <article
                          key={option.key}
                          className="rounded-lg border border-white/10 bg-black/20 p-2"
                        >
                          <h4 className="text-[11px] font-semibold text-slate-100">
                            {option.title}
                          </h4>
                          <dl className="mt-1 space-y-0.5 text-[10px]">
                            {[
                              ["Cost", option.cost],
                              ["Workers", option.workers],
                              ["Output / cycle", option.output],
                              ["Per worker", option.perWorker],
                            ].map(([label, value]) => (
                              <div key={label} className="flex justify-between gap-2">
                                <dt className="text-slate-500">{label}</dt>
                                <dd className="text-right text-slate-200">
                                  {value}
                                </dd>
                              </div>
                            ))}
                          </dl>
                          {option.blocked.length > 0 && (
                            <ul className="mt-1 space-y-0.5 text-[10px] text-amber-200">
                              {option.blocked.map((reason) => (
                                <li key={reason}>{reason}</li>
                              ))}
                            </ul>
                          )}
                          <button
                            type="button"
                            disabled={
                              productionBusy || option.blocked.length > 0
                            }
                            className={`${button} mt-2 w-full px-2 py-1 text-[10px] disabled:opacity-40`}
                            onClick={() =>
                              option.key === "upgrade"
                                ? upgradeProduction(selectedProduction)
                                : buildMoreProduction(selectedProduction.output)
                            }
                          >
                            {option.key === "upgrade"
                              ? "Upgrade this site"
                              : "Choose a site to build"}
                          </button>
                        </article>
                      ))}
                    </div>
                    <p className="mt-2 text-[10px] leading-4 text-slate-500">
                      Tools are held, not consumed. Upgrading releases the
                      workers it no longer needs.
                    </p>
                  </section>
                )}
              {availableRecipes(selectedProduction.type).length > 1 && (
                <fieldset className="mt-3 border-t border-white/10 pt-3">
                  <legend className="text-[10px] uppercase tracking-[0.16em] text-slate-400">
                    Recipe
                  </legend>
                  <div className="mt-2 space-y-2">
                    {availableRecipes(selectedProduction.type).map((recipe) => {
                      const [output, outputAmount] = Object.entries(
                        recipe.outputs,
                      )[0] as [Commodity, number];
                      return (
                        <label
                          key={recipe.id}
                          className="flex cursor-pointer items-start gap-2 rounded-md border border-white/10 bg-white/5 p-2 text-xs hover:bg-white/10"
                        >
                          <input
                            type="radio"
                            name={`recipe-${selectedProduction.buildingId}`}
                            checked={selectedProduction.recipeId === recipe.id}
                            disabled={productionBusy}
                            onChange={() =>
                              void setProductionRecipe(
                                selectedProduction,
                                recipe.id,
                              )
                            }
                          />
                          <span>
                            <span className="block font-medium">
                              {recipe.name}
                            </span>
                            <span className="mt-1 block text-[10px] text-slate-400">
                              {Object.entries(recipe.consumableInputs).length
                                ? `${materialSummary(recipe.consumableInputs)} → `
                                : "Primitive → "}
                              {outputAmount} {commodityDefinitions[output].name}
                              {` · ${recipe.requiredWorkers} workers · ${recipe.durationMs / 1000}s`}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
              )}
              <div className="mt-3 border-t border-white/10 pt-3">
                <span className="text-[10px] uppercase tracking-[0.16em] text-slate-400">
                  Input priority
                </span>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {productionPriorities.map((priority) => (
                    <button
                      key={priority}
                      aria-pressed={selectedProduction.priority === priority}
                      className={`${button} capitalize ${selectedProduction.priority === priority ? "border-sky-300/60 bg-sky-400/10 text-sky-100" : ""}`}
                      disabled={productionBusy}
                      onClick={() =>
                        void setProductionPriority(
                          selectedProduction,
                          priority,
                        )
                      }
                    >
                      {priority}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-[10px] leading-4 text-slate-500">
                  Higher priority receives scarce warehouse inputs first. Labor remains manually assigned.
                </p>
              </div>
              <div className="mt-3 border-t border-white/10 pt-3">
                <span className="text-[10px] uppercase tracking-[0.16em] text-slate-400">
                  Delivery
                </span>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {dispatchPolicies.map((policy) => (
                    <button
                      key={policy}
                      aria-pressed={selectedProduction.dispatchPolicy === policy}
                      className={`${button} px-2 py-1 text-[11px] ${selectedProduction.dispatchPolicy === policy ? "border-sky-300/60 bg-sky-400/10 text-sky-100" : ""}`}
                      disabled={productionBusy}
                      onClick={() =>
                        void setDispatchPolicy(selectedProduction, policy)
                      }
                    >
                      {dispatchPolicyLabels[policy]}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-[10px] leading-4 text-slate-500">
                  {dispatchPolicyHints[selectedProduction.dispatchPolicy]}
                </p>
              </div>
              <div className="mt-3 flex items-center justify-between text-xs">
                <span className="text-slate-400">Workers</span>
                <span>
                  {selectedProduction.assignedWorkers} /{" "}
                  {selectedProduction.requiredWorkers}
                </span>
              </div>
              <div className="mt-2 flex items-start justify-between gap-3 text-xs">
                <span className="text-slate-400">Inputs</span>
                <span className="text-right">
                  {Object.entries(selectedProduction.consumableInputs).length
                    ? Object.entries(selectedProduction.consumableInputs)
                        .map(
                          ([commodity, quantity]) =>
                            `${quantity} ${commodityDefinitions[commodity as Commodity].name} (${production?.logistics.warehouseInventory[commodity as Commodity] ?? 0} stored)`,
                        )
                        .join(" + ")
                    : "None · primitive production"}
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between text-xs">
                <span className="text-slate-400">Labor efficiency</span>
                <span>{Math.round(selectedProduction.laborEfficiency * 100)}%</span>
              </div>
              <div className="mt-2 flex gap-2">
                <button
                  className={`${button} flex-1`}
                  disabled={
                    productionBusy ||
                    selectedProduction.paused ||
                    selectedProduction.assignedWorkers === 0
                  }
                  onClick={() =>
                    void updateWorkers(
                      selectedProduction,
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
                    selectedProduction.paused ||
                    selectedProduction.assignedWorkers >=
                      selectedProduction.requiredWorkers ||
                    (production?.labor.unassignedWorkers ?? 0) === 0
                  }
                  onClick={() =>
                    void updateWorkers(
                      selectedProduction,
                      selectedProduction.assignedWorkers + 1,
                    )
                  }
                >
                  + Worker
                </button>
              </div>
              <button
                className={`${button} mt-2 w-full`}
                disabled={productionBusy}
                onClick={() =>
                  void setProductionPaused(
                    selectedProduction,
                    !selectedProduction.paused,
                  )
                }
              >
                {selectedProduction.paused
                  ? "Resume production"
                  : "Pause production · release workers"}
              </button>
              <div className="mt-4 flex items-center justify-between text-xs">
                <span className="text-slate-400">Expected output</span>
                <span>
                  +{selectedProduction.expectedOutputPerCycle.toFixed(1)} /{" "}
                  {selectedProduction.cycleMs / 1000}s
                </span>
              </div>
              {selectedProduction.stored >=
                selectedProduction.storageCapacity * 0.8 && (
                <p className="mt-2 text-xs text-amber-200">
                  Production warning: local storage is nearly full.
                </p>
              )}
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
                <div
                  className={`h-full transition-[width] ${selectedProduction.status === "running" || selectedProduction.status === "worker_shortage" ? "bg-emerald-400" : "bg-slate-600"}`}
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
                  {commodityDefinitions[selectedProduction.output].name}
                </span>
              </div>
              <button
                className={`${button} mt-3 w-full`}
                disabled={productionBusy || selectedProduction.stored === 0}
                onClick={() =>
                  void dispatchProduction(selectedProduction)
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
                      <span className="text-[10px] text-slate-400">
                        {commodityDefinitions[commodity as Commodity].name}
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
            <label className="mt-4 block text-sm text-slate-400">
              <span className="mb-2 block">Lumber Camp primitive</span>
              <select
                value={buildingVisualProfile}
                onChange={(event) =>
                  setBuildingVisualProfile(
                    event.target.value as BuildingVisualProfileId,
                  )
                }
                className="w-full rounded-lg border border-white/15 bg-[#142630] px-3 py-2 text-sm text-slate-100 outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
              >
                <option value="primitiveA">Primitive A · timber shed</option>
                <option value="primitiveB">Primitive B · forest depot</option>
              </select>
            </label>
            <p className="mt-2 text-[10px] leading-4 text-slate-500">
              Presentation test: geometry and palette swap without changing production.
            </p>
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
            Construction costs, production, demolition, shipment timing,
            warehouse arrivals, and saved progress are authoritative for this
            local simulation. Population growth arrives later.
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
          setRegionalTradeOpen(false);
          setHovered(null);
          sidebarRef.current?.scrollTo({ top: 0 });
        }}
        onRoad={() => {
          setTool("road");
          setMarketOpen(false);
          setCompanyOpen(false);
          setRegionalTradeOpen(false);
          setHovered(null);
          sidebarRef.current?.scrollTo({ top: 0 });
        }}
        onMarket={() => {
          setMarketOpen(true);
          setCompanyOpen(false);
          setRegionalTradeOpen(false);
          sidebarRef.current?.scrollTo({ top: 0 });
        }}
        onMarketTerminal={() => setMarketTerminalOpen(true)}
        onCompany={() => {
          setCompanyOpen(true);
          setMarketOpen(false);
          setRegionalTradeOpen(false);
          sidebarRef.current?.scrollTo({ top: 0 });
        }}
        onWarehouse={() => {
          if (production)
            focusBuilding(production.logistics.warehouseBuildingId);
          setMarketOpen(false);
          setCompanyOpen(false);
          setRegionalTradeOpen(false);
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
      {marketTerminalOpen && production && (
        <FloatingMarket
          market={production.market}
          simulationTime={production.simulationTime}
          selectedCommodity={selectedMarketCommodity}
          onSelectedCommodityChange={setSelectedMarketCommodity}
          chartType={marketChartType}
          onChartTypeChange={setMarketChartType}
          timeframeId={marketChartTimeframe}
          onTimeframeChange={setMarketChartTimeframe}
          selectedPeriodStart={selectedMarketPeriodStart}
          onSelectedPeriodStartChange={setSelectedMarketPeriodStart}
          onExpand={(trigger) => {
            marketChartReturnFocusRef.current = trigger;
            setMarketChartExpanded(true);
          }}
          onClose={() => setMarketTerminalOpen(false)}
        />
      )}
      {marketChartExpanded && selectedMarketListing && production && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget)
              setMarketChartExpanded(false);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="expanded-market-chart-title"
            className="max-h-[92vh] w-full max-w-6xl overflow-y-auto rounded-2xl border border-sky-300/25 bg-[#101e28] p-4 shadow-2xl md:p-6"
          >
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 pb-4">
              <div>
                <p className="text-[10px] uppercase tracking-[0.2em] text-sky-200">
                  Novagrad local market
                </p>
                <h2
                  id="expanded-market-chart-title"
                  className="mt-1 text-2xl font-semibold"
                >
                  {selectedMarketListing.name} — Market Analysis
                </h2>
                <div className="mt-2 flex items-baseline gap-3">
                  <span className="font-mono text-xl text-white">
                    {money(selectedMarketListing.priceCents)}
                  </span>
                  <span
                    className={`text-sm ${selectedMarketListing.trendPercent > 0 ? "text-emerald-300" : selectedMarketListing.trendPercent < 0 ? "text-red-300" : "text-slate-400"}`}
                  >
                    {selectedMarketListing.trendPercent > 0
                      ? "▲"
                      : selectedMarketListing.trendPercent < 0
                        ? "▼"
                        : "—"}{" "}
                    {Math.abs(selectedMarketListing.trendPercent).toFixed(1)}%
                  </span>
                </div>
              </div>
              <button
                ref={marketChartCloseRef}
                className={`${button} px-3 py-2`}
                aria-label="Close expanded market chart"
                onClick={() => setMarketChartExpanded(false)}
              >
                ✕
              </button>
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-[minmax(12rem,16rem)_1fr] md:items-end">
              <label className="text-[10px] uppercase tracking-[0.16em] text-slate-400">
                Commodity
                <select
                  className="mt-1 block w-full rounded-md border border-white/15 bg-slate-900 px-3 py-2 text-sm normal-case tracking-normal text-slate-100"
                  value={selectedMarketCommodity}
                  onChange={(event) =>
                    setSelectedMarketCommodity(event.target.value as Commodity)
                  }
                >
                  {production.market.listings.map((listing) => (
                    <option key={listing.commodity} value={listing.commodity}>
                      {listing.name}
                    </option>
                  ))}
                </select>
              </label>
              <MarketChartControls
                chartType={marketChartType}
                timeframeId={marketChartTimeframe}
                onChartTypeChange={setMarketChartType}
                onTimeframeChange={setMarketChartTimeframe}
              />
            </div>
            <div className="mt-4 rounded-xl border border-white/10 bg-slate-950/35 p-3 md:p-5">
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
                <span>
                  {marketChartType === "line"
                    ? "Bucket close price"
                    : "Open · High · Low · Close"}
                </span>
                <span>
                  {
                    marketChartTimeframes.find(
                      (timeframe) => timeframe.id === marketChartTimeframe,
                    )!.label
                  }{" "}
                  timeframe · {selectedMarketListing.history.length} genuine
                  observations
                </span>
              </div>
              <MarketPriceChart
                history={selectedMarketListing.history}
                chartType={marketChartType}
                timeframeId={marketChartTimeframe}
                currentTime={production.simulationTime}
                expanded
                selectedPeriodStart={selectedMarketPeriodStart}
                onSelectedPeriodStartChange={setSelectedMarketPeriodStart}
              />
              {marketChartType === "candlestick" && (
                <div className="mt-3 flex justify-center gap-5 text-[11px]">
                  <span className="text-emerald-300">■ Rising</span>
                  <span className="text-rose-300">■ Falling</span>
                  <span className="text-slate-400">■ Unchanged</span>
                  <span className="text-amber-300">□ Active</span>
                </div>
              )}
            </div>
            <p className="mt-3 text-xs leading-5 text-slate-400">
              The simulation continues while this chart is open. Every point
              comes from the saved market observation stream; chart refreshes
              never create prices.
            </p>
            {marketChartTimeframe === "1s" && (
              <p className="mt-2 text-xs leading-5 text-amber-100/80">
                Scheduled market prices arrive every 5 simulation seconds, so
                the 1s view is intentionally sparse. A sale may add another
                genuine observation between scheduled ticks.
              </p>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
