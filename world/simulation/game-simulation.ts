import {
  constructionCosts,
  isConstructibleBuildingType,
  placeBuilding,
  validateConstructionResources,
  validatePlacement,
  type ConstructionCost,
  type PlacementRequest,
} from "../domain/construction";
import {
  connectProducerToWarehouse,
  withStartingLogistics,
  type Shipment,
  type WarehouseInventory,
} from "../domain/logistics";
import {
  buildEconomicOpportunities,
  buildMarketListings,
  emptyMarketActivity,
  marketDefinitions,
  marketPriceAnalysis,
  marketPriceCents,
  retainMarketPriceHistory,
  shortageLevel,
  type EconomyEvent,
  type MarketActivity,
  type PricePoint,
  type ShortageLevel,
} from "../domain/market";
import {
  availableRecipes,
  compareProductionPriority,
  defaultRecipeByProducer,
  describeProduction,
  isProducerType,
  isProductionPriority,
  isRecipeId,
  productionRecipes,
  recipeForState,
  recipeOutput,
  resolveProduction,
  withStartingProduction,
  type Commodity,
  type ProductionSnapshot,
  type ProductionState,
  type ProducerType,
  type ProductionPriority,
  type RecipeId,
} from "../domain/production";
import {
  commodityIds,
  commodityRecord,
  normalizeCommodityInventory,
} from "../domain/commodities";
import {
  consumeHouseholdFood,
  describeFoodNeed,
  describePopulation,
  isFoodConsumptionResult,
  populationPolicy,
  workingAgePopulation,
  type FoodConsumptionResult,
} from "../domain/population";
import { describeLabor, validateLaborAssignment } from "../domain/labor";
import {
  buildingDefinitions,
  withStartingSettlement,
  type Building,
} from "../domain/settlement";
import { generateWorld, type WorldSnapshot } from "../domain/world";

export type GameCommand =
  | Readonly<{
      type: "construct";
      expectedRevision: number;
      placement: PlacementRequest;
    }>
  | Readonly<{
      type: "set_workers";
      buildingId: string;
      workers: number;
    }>
  | Readonly<{
      type: "set_production_paused";
      buildingId: string;
      paused: boolean;
    }>
  | Readonly<{
      type: "set_recipe";
      buildingId: string;
      recipeId: RecipeId;
    }>
  | Readonly<{
      type: "set_production_priority";
      buildingId: string;
      priority: ProductionPriority;
    }>
  | Readonly<{ type: "dispatch_production"; buildingId: string }>
  | Readonly<{
      type: "sell_goods";
      commodity: Commodity;
      quantity: number;
      expectedPriceCents: number;
    }>
  | Readonly<{ type: "demolish"; buildingId: string }>;

export type GameReadModel = Readonly<{
  revision: number;
  world: WorldSnapshot;
  economy: ProductionSnapshot;
}>;

export type CommandResult =
  | Readonly<{
      ok: true;
      status: 200 | 201;
      readModel: GameReadModel;
      building?: Building;
      collected?: number;
      shipment?: Shipment;
      revenueCents?: number;
      constructionCost?: ConstructionCost;
      demolishedBuildingId?: string;
    }>
  | Readonly<{
      ok: false;
      status: 400 | 404 | 409 | 422;
      error: string;
      readModel: GameReadModel;
    }>;

export type LocalSimulationSaveV1 = Readonly<{
  saveVersion: 1;
  simulationTime: number;
  revision: number;
  world: WorldSnapshot;
  productionStates: readonly ProductionState[];
  shipments: readonly Shipment[];
  warehouseInventory: WarehouseInventory;
  nextShipment: number;
  cashCents: number;
  marketTick: number;
  marketUpdatedAt: number;
  priceHistory: Readonly<Record<Commodity, readonly PricePoint[]>>;
  shortages: Readonly<Record<Commodity, ShortageLevel>>;
  events: readonly EconomyEvent[];
  nextEvent: number;
  foodConsumptionUpdatedAt?: number;
  lastFoodConsumption?: FoodConsumptionResult | null;
  recentMarketActivity?: Readonly<Record<Commodity, MarketActivity>>;
}>;

type MutableSimulationState = {
  simulationTime: number;
  revision: number;
  world: WorldSnapshot;
  productionStates: Map<string, ProductionState>;
  shipments: Shipment[];
  warehouseInventory: Record<Commodity, number>;
  nextShipment: number;
  cashCents: number;
  marketTick: number;
  marketUpdatedAt: number;
  priceHistory: Record<Commodity, PricePoint[]>;
  shortages: Record<Commodity, ShortageLevel>;
  events: EconomyEvent[];
  nextEvent: number;
  foodConsumptionUpdatedAt: number;
  lastFoodConsumption: FoodConsumptionResult | null;
  recentMarketActivity: Record<Commodity, MarketActivity>;
};

export function createStartingWorld() {
  return withStartingLogistics(
    withStartingProduction(withStartingSettlement(generateWorld())),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonnegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isMarketActivity(value: unknown): value is MarketActivity {
  if (!isRecord(value)) return false;
  return (
    isNonnegativeInteger(value.supply) &&
    isNonnegativeInteger(value.demand) &&
    isNonnegativeInteger(value.consumption) &&
    value.consumption <= value.demand
  );
}

function isLocalSimulationSaveV1(
  value: unknown,
): value is LocalSimulationSaveV1 {
  if (!isRecord(value) || value.saveVersion !== 1) return false;
  const world = value.world;
  const inventory = value.warehouseInventory;
  const history = value.priceHistory;
  const shortages = value.shortages;
  const activity = value.recentMarketActivity;
  if (
    !isRecord(world) ||
    !Array.isArray(world.cells) ||
    !Array.isArray(world.resourceNodes) ||
    !Array.isArray(world.chunks) ||
    !Array.isArray(value.productionStates) ||
    !Array.isArray(value.shipments) ||
    !Array.isArray(value.events) ||
    !isRecord(inventory) ||
    !isRecord(history) ||
    !isRecord(shortages)
  )
    return false;
  if (
    !Number.isSafeInteger(value.simulationTime) ||
    !isNonnegativeInteger(value.revision) ||
    !isNonnegativeInteger(value.nextShipment) ||
    !isNonnegativeInteger(value.cashCents) ||
    !isNonnegativeInteger(value.marketTick) ||
    !Number.isSafeInteger(value.marketUpdatedAt) ||
    !isNonnegativeInteger(value.nextEvent) ||
    (value.foodConsumptionUpdatedAt !== undefined &&
      (!Number.isSafeInteger(value.foodConsumptionUpdatedAt) ||
        (value.foodConsumptionUpdatedAt as number) >
          (value.simulationTime as number) ||
        (value.simulationTime as number) -
            (value.foodConsumptionUpdatedAt as number) >=
          populationPolicy.foodConsumptionPeriodMs)) ||
    (value.lastFoodConsumption !== undefined &&
      value.lastFoodConsumption !== null &&
      !isFoodConsumptionResult(value.lastFoodConsumption))
  )
    return false;
  for (const commodity of ["food", "wood", "stone"] as Commodity[]) {
    if (
      !isNonnegativeInteger(inventory[commodity]) ||
      !Array.isArray(history[commodity]) ||
      !["none", "low", "critical"].includes(shortages[commodity] as string)
    )
      return false;
  }
  for (const commodity of commodityIds) {
    if (
      (inventory[commodity] !== undefined &&
        !isNonnegativeInteger(inventory[commodity])) ||
      (history[commodity] !== undefined &&
        !Array.isArray(history[commodity])) ||
      (shortages[commodity] !== undefined &&
        !["none", "low", "critical"].includes(shortages[commodity] as string)) ||
      (activity !== undefined &&
        (!isRecord(activity) || !isMarketActivity(activity[commodity])))
    )
      return false;
  }
  return value.productionStates.every(
    (state) =>
      isRecord(state) &&
      typeof state.buildingId === "string" &&
      (state.recipeId === undefined || isRecipeId(state.recipeId)) &&
      (state.paused === undefined || typeof state.paused === "boolean") &&
      (state.priority === undefined ||
        isProductionPriority(state.priority)) &&
      isNonnegativeInteger(state.assignedWorkers) &&
      (!state.paused || state.assignedWorkers === 0) &&
      isNonnegativeInteger(state.stored) &&
      isNonnegativeInteger(state.progressMs) &&
      (state.laborRemainder === undefined ||
        isNonnegativeInteger(state.laborRemainder)) &&
      Number.isSafeInteger(state.updatedAt),
  );
}

export class LocalGameSimulation {
  private readonly state: MutableSimulationState;

  constructor(
    world: WorldSnapshot,
    startTime: number,
    restored?: LocalSimulationSaveV1,
  ) {
    this.assertTime(startTime);
    if (restored) {
      const warehouseInventory = normalizeCommodityInventory(
        restored.warehouseInventory,
      );
      const priceHistory = commodityRecord<PricePoint[]>([]);
      const shortages = commodityRecord<ShortageLevel>("none");
      const recentMarketActivity = commodityRecord<MarketActivity>(
        emptyMarketActivity(),
      );
      for (const commodity of commodityIds) {
        const savedHistory = restored.priceHistory[commodity];
        priceHistory[commodity] = Array.isArray(savedHistory)
          ? savedHistory.map((point) => ({ ...point }))
          : [
              {
                time: restored.simulationTime,
                priceCents: marketPriceCents(
                  commodity,
                  warehouseInventory[commodity],
                ),
              },
            ];
        shortages[commodity] =
          restored.shortages[commodity] ??
          shortageLevel(commodity, warehouseInventory[commodity]);
        recentMarketActivity[commodity] = {
          ...(restored.recentMarketActivity?.[commodity] ??
            emptyMarketActivity()),
        };
      }
      this.state = {
        simulationTime: restored.simulationTime,
        revision: restored.revision,
        world: restored.world,
        productionStates: new Map(
          restored.productionStates.map((state) => [
            state.buildingId,
            { ...state },
          ]),
        ),
        shipments: restored.shipments.map((shipment) => ({
          ...shipment,
          cargo: { ...shipment.cargo },
        })),
        warehouseInventory,
        nextShipment: restored.nextShipment,
        cashCents: restored.cashCents,
        marketTick: restored.marketTick,
        marketUpdatedAt: restored.marketUpdatedAt,
        priceHistory,
        shortages,
        events: restored.events.map((event) => ({ ...event })),
        nextEvent: restored.nextEvent,
        foodConsumptionUpdatedAt:
          restored.foodConsumptionUpdatedAt ?? restored.simulationTime,
        lastFoodConsumption: restored.lastFoodConsumption
          ? {
              ...restored.lastFoodConsumption,
              sources: restored.lastFoodConsumption.sources.map((source) => ({
                ...source,
              })),
            }
          : null,
        recentMarketActivity,
      };
      for (const building of this.producers) {
        const existing = this.state.productionStates.get(building.id);
        const migratesLegacyFarmState =
          building.type === "farm" && existing?.recipeId === undefined;
        if (migratesLegacyFarmState)
          this.state.warehouseInventory.food += existing?.stored ?? 0;
        const selected = existing
          ? recipeForState(existing, building.type)
          : productionRecipes[defaultRecipeByProducer[building.type]];
        this.state.productionStates.set(building.id, {
          buildingId: building.id,
          recipeId: selected.id,
          paused: existing?.paused ?? false,
          priority: existing?.priority ?? "normal",
          assignedWorkers: existing?.assignedWorkers ?? 0,
          stored: migratesLegacyFarmState ? 0 : (existing?.stored ?? 0),
          progressMs: migratesLegacyFarmState ? 0 : (existing?.progressMs ?? 0),
          laborRemainder: migratesLegacyFarmState
            ? 0
            : (existing?.laborRemainder ?? 0),
          updatedAt: existing?.updatedAt ?? restored.simulationTime,
        });
      }
      return;
    }
    const producers = (world.buildings ?? []).filter(
      (building): building is Building & { type: ProducerType } =>
        isProducerType(building.type),
    );
    const warehouse = world.buildings?.find(
      (building) => building.type === "warehouse",
    );
    const farm = producers.find((building) => building.type === "farm");
    const demonstrationRoute = world.logisticsRoutes?.find(
      (route) => route.originBuildingId === farm?.id,
    );
    const shipments: Shipment[] =
      farm && warehouse && demonstrationRoute
        ? [
            {
              id: "shipment-1",
              routeId: demonstrationRoute.id,
              originBuildingId: farm.id,
              destinationBuildingId: warehouse.id,
              cargo: {
                commodity: recipeOutput(
                  productionRecipes[defaultRecipeByProducer.farm],
                ).commodity,
                quantity: recipeOutput(
                  productionRecipes[defaultRecipeByProducer.farm],
                ).amount,
              },
              departureTime: startTime,
              arrivalTime: startTime + demonstrationRoute.durationMs,
              status: "in_transit",
            },
          ]
        : [];
    const warehouseInventory = normalizeCommodityInventory({
      food: 8,
      wood: 3,
      stone: 0,
    });
    const priceHistory = commodityRecord<PricePoint[]>([]);
    for (const commodity of commodityIds) {
      let previousPriceCents = marketDefinitions[commodity].basePriceCents;
      priceHistory[commodity] = Array.from({ length: 5 }, (_, index) => {
        const activity = emptyMarketActivity();
        const analysis = marketPriceAnalysis(
          commodity,
          warehouseInventory[commodity],
          previousPriceCents,
          activity,
        );
        previousPriceCents = analysis.priceCents;
        return {
          time: startTime - (4 - index) * 5_000,
          priceCents: analysis.priceCents,
          availableInventory: warehouseInventory[commodity],
          recentSupply: activity.supply,
          recentDemand: activity.demand,
          recentConsumption: activity.consumption,
          priceReasons: analysis.reasons,
        };
      });
    }
    this.state = {
      simulationTime: startTime,
      revision: 0,
      world,
      productionStates: new Map(
        producers.map((building) => {
          const selected =
            productionRecipes[defaultRecipeByProducer[building.type]];
          return [
            building.id,
            {
              buildingId: building.id,
              recipeId: selected.id,
              paused: false,
              priority: "normal",
              assignedWorkers:
                building.type === "farm" || building.type === "quarry"
                  ? selected.requiredWorkers
                  : 0,
              stored: building.type === "quarry" ? selected.storageCapacity : 0,
              progressMs: 0,
              laborRemainder: 0,
              updatedAt: startTime,
            },
          ];
        }),
      ),
      shipments,
      warehouseInventory,
      nextShipment: shipments.length + 1,
      cashCents: 12_450_00,
      marketTick: 4,
      marketUpdatedAt: startTime,
      priceHistory,
      shortages: Object.fromEntries(
        commodityIds.map((commodity) => [
          commodity,
          shortageLevel(commodity, warehouseInventory[commodity]),
        ]),
      ) as Record<Commodity, ShortageLevel>,
      events: [
        {
          id: "event-1",
          time: startTime - 2_000,
          category: "market",
          message: "Stone shortage appeared in Novagrad.",
        },
        {
          id: "event-2",
          time: startTime - 1_000,
          category: "production",
          message: "Lumber Camp stopped: two workers are needed.",
        },
        ...(shipments.length
          ? [
              {
                id: "event-3",
                time: startTime,
                category: "logistics" as const,
                message: "4 food departed on Harvest Road.",
              },
            ]
          : []),
      ],
      nextEvent: shipments.length ? 4 : 3,
      foodConsumptionUpdatedAt: startTime,
      lastFoodConsumption: null,
      recentMarketActivity: commodityRecord<MarketActivity>(
        emptyMarketActivity(),
      ),
    };
  }

  static fromSave(save: unknown): LocalGameSimulation {
    if (!isLocalSimulationSaveV1(save))
      throw new TypeError("The saved game is invalid or unsupported.");
    return new LocalGameSimulation(save.world, save.simulationTime, save);
  }

  private get producers(): readonly (Building & { type: ProducerType })[] {
    return (this.state.world.buildings ?? []).filter(
      (building): building is Building & { type: ProducerType } =>
        isProducerType(building.type),
    );
  }

  private get warehouse(): Building | undefined {
    return this.state.world.buildings?.find(
      (building) => building.type === "warehouse",
    );
  }

  read(simulationTime: number): GameReadModel {
    this.advanceTo(simulationTime);
    return this.readModel();
  }

  execute(command: GameCommand, simulationTime: number): CommandResult {
    this.advanceTo(simulationTime);
    switch (command.type) {
      case "construct":
        return this.construct(command);
      case "set_workers":
        return this.setWorkers(command.buildingId, command.workers);
      case "set_production_paused":
        return this.setProductionPaused(command.buildingId, command.paused);
      case "set_recipe":
        return this.setRecipe(command.buildingId, command.recipeId);
      case "set_production_priority":
        return this.setProductionPriority(
          command.buildingId,
          command.priority,
        );
      case "dispatch_production":
        return this.dispatchProduction(command.buildingId);
      case "sell_goods":
        return this.sellGoods(
          command.commodity,
          command.quantity,
          command.expectedPriceCents,
        );
      case "demolish":
        return this.demolish(command.buildingId);
    }
  }

  exportSave(): LocalSimulationSaveV1 {
    return {
      saveVersion: 1,
      simulationTime: this.state.simulationTime,
      revision: this.state.revision,
      world: this.state.world,
      productionStates: [...this.state.productionStates.values()],
      shipments: [...this.state.shipments],
      warehouseInventory: { ...this.state.warehouseInventory },
      nextShipment: this.state.nextShipment,
      cashCents: this.state.cashCents,
      marketTick: this.state.marketTick,
      marketUpdatedAt: this.state.marketUpdatedAt,
      priceHistory: Object.fromEntries(
        commodityIds.map((commodity) => [
          commodity,
          [...this.state.priceHistory[commodity]],
        ]),
      ) as Record<Commodity, PricePoint[]>,
      shortages: { ...this.state.shortages },
      events: [...this.state.events],
      nextEvent: this.state.nextEvent,
      foodConsumptionUpdatedAt: this.state.foodConsumptionUpdatedAt,
      lastFoodConsumption: this.state.lastFoodConsumption
        ? {
            ...this.state.lastFoodConsumption,
            sources: this.state.lastFoodConsumption.sources.map((source) => ({
              ...source,
            })),
          }
        : null,
      recentMarketActivity: Object.fromEntries(
        commodityIds.map((commodity) => [
          commodity,
          { ...this.state.recentMarketActivity[commodity] },
        ]),
      ) as Record<Commodity, MarketActivity>,
    };
  }

  private assertTime(simulationTime: number) {
    if (!Number.isSafeInteger(simulationTime))
      throw new RangeError("Simulation time must be a safe integer.");
  }

  private advanceTo(simulationTime: number) {
    this.assertTime(simulationTime);
    if (simulationTime < this.state.simulationTime)
      throw new RangeError("Simulation time cannot move backward.");
    const arrivals = this.state.shipments
      .filter(
        (shipment) =>
          shipment.status === "in_transit" &&
          shipment.arrivalTime <= simulationTime,
      )
      .sort(
        (a, b) => a.arrivalTime - b.arrivalTime || a.id.localeCompare(b.id),
      );
    let arrivalIndex = 0;
    while (true) {
      const arrivalTime =
        arrivalIndex < arrivals.length
          ? Math.max(
              this.state.simulationTime,
              arrivals[arrivalIndex].arrivalTime,
            )
          : Number.POSITIVE_INFINITY;
      const consumptionTime =
        this.state.foodConsumptionUpdatedAt +
        populationPolicy.foodConsumptionPeriodMs;
      const marketTime = Math.max(
        this.state.simulationTime,
        this.state.marketUpdatedAt + 5_000,
      );
      const boundaryTime = Math.min(
        arrivalTime,
        consumptionTime,
        marketTime,
      );
      if (boundaryTime > simulationTime) break;
      this.advanceProducersTo(boundaryTime);
      this.advanceMarket(boundaryTime);
      while (
        arrivalIndex < arrivals.length &&
        Math.max(
          this.state.simulationTime,
          arrivals[arrivalIndex].arrivalTime,
        ) === boundaryTime
      ) {
        const shipment = arrivals[arrivalIndex++];
        this.state.warehouseInventory[shipment.cargo.commodity] +=
          shipment.cargo.quantity;
        this.addMarketActivity(shipment.cargo.commodity, {
          supply: shipment.cargo.quantity,
        });
        this.addEvent(
          shipment.arrivalTime,
          "logistics",
          `${shipment.cargo.quantity} ${shipment.cargo.commodity} arrived at Novagrad Warehouse.`,
        );
        this.state.shipments = this.state.shipments.map((candidate) =>
          candidate.id === shipment.id
            ? {
                ...candidate,
                status: "arrived",
                arrivedAt: shipment.arrivalTime,
              }
            : candidate,
        );
      }
      if (consumptionTime === boundaryTime) {
        const result = consumeHouseholdFood(
          this.state.warehouseInventory,
          this.state.world.settlement?.population ?? 0,
        );
        this.state.warehouseInventory = { ...result.inventory };
        this.state.lastFoodConsumption = result.consumption;
        this.state.foodConsumptionUpdatedAt = boundaryTime;
        for (const source of result.consumption.sources)
          this.addMarketActivity(source.commodity, {
            demand: source.unitsConsumed,
            consumption: source.unitsConsumed,
          });
      }
      this.state.simulationTime = boundaryTime;
    }
    this.advanceProducersTo(simulationTime);
    this.advanceMarket(simulationTime);
    this.state.simulationTime = simulationTime;
  }

  private advanceProducersTo(simulationTime: number) {
    for (const building of [...this.producers].sort((a, b) =>
      compareProductionPriority(
        this.state.productionStates.get(a.id) ?? { buildingId: a.id },
        this.state.productionStates.get(b.id) ?? { buildingId: b.id },
      ),
    )) {
      const state = this.state.productionStates.get(building.id);
      if (!state) continue;
      const resolution = resolveProduction(
        state,
        building.type,
        simulationTime,
        this.state.warehouseInventory,
      );
      this.state.productionStates.set(building.id, resolution.state);
      this.state.warehouseInventory = { ...resolution.inventory };
      for (const [commodity, quantity] of Object.entries(
        resolution.consumedInputs,
      ) as [Commodity, number][]) {
        this.addMarketActivity(commodity, {
          demand: quantity,
          consumption: quantity,
        });
      }
    }
  }

  private construct(
    command: Extract<GameCommand, { type: "construct" }>,
  ): CommandResult {
    if (command.expectedRevision !== this.state.revision)
      return this.failure(
        409,
        "Simulation changed. Review the latest world state.",
      );
    const validation = validatePlacement(this.state.world, command.placement);
    if (!validation.valid)
      return this.failure(422, validation.reasons.join(". "));
    const resourceValidation = validateConstructionResources(
      command.placement.type,
      this.state.cashCents,
      this.state.warehouseInventory,
    );
    if (!resourceValidation.affordable)
      return this.failure(422, resourceValidation.reasons.join(". "));
    if (!isConstructibleBuildingType(command.placement.type))
      return this.failure(422, "Building type is unavailable.");
    const cost = constructionCosts[command.placement.type];
    const id = `player-${this.state.revision + 1}`;
    let world = placeBuilding(this.state.world, command.placement, id);
    const building = world.buildings?.at(-1);
    if (!building)
      return this.failure(422, "Construction could not be completed.");
    if (isProducerType(building.type)) {
      const producer = building as Building & { type: ProducerType };
      const warehouse = this.warehouse;
      if (!warehouse)
        return this.failure(422, "A warehouse is required for production.");
      world = connectProducerToWarehouse(world, producer, warehouse);
      if (
        !world.logisticsRoutes?.some(
          (route) => route.originBuildingId === building.id,
        )
      )
        return this.failure(
          422,
          "The adjacent road is not connected to Novagrad Warehouse.",
        );
    }
    this.state.cashCents -= cost.cashCents;
    for (const [commodity, quantity] of Object.entries(cost.materials) as [
      Commodity,
      number,
    ][]) {
      this.state.warehouseInventory[commodity] -= quantity;
      this.addMarketActivity(commodity, {
        demand: quantity,
        consumption: quantity,
      });
    }
    this.state.world = world;
    if (isProducerType(building.type)) {
      const selected =
        productionRecipes[defaultRecipeByProducer[building.type]];
      this.state.productionStates.set(building.id, {
        buildingId: building.id,
        recipeId: selected.id,
        paused: false,
        priority: "normal",
        assignedWorkers: 0,
        stored: 0,
        progressMs: 0,
        laborRemainder: 0,
        updatedAt: this.state.simulationTime,
      });
    }
    this.state.revision++;
    const materialSummary = Object.entries(cost.materials)
      .map(([commodity, quantity]) => `${quantity} ${commodity}`)
      .join(", ");
    this.addEvent(
      this.state.simulationTime,
      "production",
      `${buildingDefinitions[building.type].name} constructed for $${(cost.cashCents / 100).toFixed(2)}${materialSummary ? ` and ${materialSummary}` : ""}.`,
    );
    return {
      ok: true,
      status: 201,
      building,
      constructionCost: cost,
      readModel: this.readModel(),
    };
  }

  private demolish(buildingId: string): CommandResult {
    const building = this.state.world.buildings?.find(
      (candidate) => candidate.id === buildingId,
    );
    if (!building) return this.failure(404, "Building was not found.");
    if (building.type === "camp")
      return this.failure(
        422,
        "The settlement's founding camp cannot be demolished.",
      );
    if (building.type === "warehouse" && building.id === this.warehouse?.id)
      return this.failure(422, "The primary warehouse cannot be demolished.");
    if (
      this.state.shipments.some(
        (shipment) =>
          shipment.originBuildingId === buildingId &&
          shipment.status === "in_transit",
      )
    )
      return this.failure(
        422,
        "Wait for this building's active shipment to arrive before demolition.",
      );
    this.state.world = {
      ...this.state.world,
      buildings: this.state.world.buildings?.filter(
        (candidate) => candidate.id !== buildingId,
      ),
      logisticsRoutes: this.state.world.logisticsRoutes?.filter(
        (route) =>
          route.originBuildingId !== buildingId &&
          route.destinationBuildingId !== buildingId,
      ),
    };
    this.state.productionStates.delete(buildingId);
    this.state.revision++;
    this.addEvent(
      this.state.simulationTime,
      "production",
      `${buildingDefinitions[building.type].name} demolished.`,
    );
    return {
      ok: true,
      status: 200,
      demolishedBuildingId: buildingId,
      readModel: this.readModel(),
    };
  }

  private setWorkers(buildingId: string, workers: number): CommandResult {
    const building = this.producers.find(
      (candidate) => candidate.id === buildingId,
    );
    const state = this.state.productionStates.get(buildingId);
    if (!building || !state)
      return this.failure(404, "Production site was not found.");
    const selected = recipeForState(state, building.type);
    if (!Number.isInteger(workers) || workers < 0)
      return this.failure(422, "Workers must be a nonnegative integer.");
    if (state.paused && workers > 0)
      return this.failure(
        422,
        "Resume production before assigning workers to this building.",
      );
    const assignedElsewhere = [...this.state.productionStates.values()].reduce(
      (total, candidate) =>
        total +
        (candidate.buildingId === buildingId ? 0 : candidate.assignedWorkers),
      0,
    );
    const workforce = workingAgePopulation(
      this.state.world.settlement?.population ?? 0,
    );
    const validation = validateLaborAssignment(
      workforce,
      assignedElsewhere,
      workers,
      selected.requiredWorkers,
    );
    if (!validation.valid) return this.failure(422, validation.reason);
    this.state.productionStates.set(buildingId, {
      ...state,
      assignedWorkers: workers,
      updatedAt: this.state.simulationTime,
    });
    this.addEvent(
      this.state.simulationTime,
      "production",
      workers === selected.requiredWorkers
        ? `${buildingDefinitions[building.type].name} staffed ${selected.name}.`
        : workers === 0
          ? `${buildingDefinitions[building.type].name} released its workers.`
          : `${buildingDefinitions[building.type].name} has a worker shortage at ${workers}/${selected.requiredWorkers}.`,
    );
    return this.success();
  }

  private setProductionPaused(
    buildingId: string,
    paused: boolean,
  ): CommandResult {
    const building = this.producers.find(
      (candidate) => candidate.id === buildingId,
    );
    const state = this.state.productionStates.get(buildingId);
    if (!building || !state)
      return this.failure(404, "Production site was not found.");
    if (typeof paused !== "boolean")
      return this.failure(400, "Paused state must be a boolean.");
    if ((state.paused ?? false) === paused) return this.success();
    const releasedWorkers = paused ? state.assignedWorkers : 0;
    this.state.productionStates.set(buildingId, {
      ...state,
      paused,
      assignedWorkers: paused ? 0 : state.assignedWorkers,
      updatedAt: this.state.simulationTime,
    });
    this.addEvent(
      this.state.simulationTime,
      "production",
      paused
        ? `${buildingDefinitions[building.type].name} paused${releasedWorkers ? ` and released ${releasedWorkers} worker${releasedWorkers === 1 ? "" : "s"}` : ""}.`
        : `${buildingDefinitions[building.type].name} resumed and is ready for workers.`,
    );
    return this.success();
  }

  private setRecipe(buildingId: string, recipeId: RecipeId): CommandResult {
    const building = this.producers.find(
      (candidate) => candidate.id === buildingId,
    );
    const state = this.state.productionStates.get(buildingId);
    if (!building || !state)
      return this.failure(404, "Production site was not found.");
    if (!isRecipeId(recipeId))
      return this.failure(400, "Production recipe is invalid.");
    const choices = availableRecipes(building.type);
    if (choices.length <= 1)
      return this.failure(422, "This building has no alternate recipes.");
    const selected = choices.find((candidate) => candidate.id === recipeId);
    if (!selected)
      return this.failure(422, "This recipe cannot run in this building.");
    if (recipeForState(state, building.type).id === selected.id)
      return this.success();
    if (state.stored > 0)
      return this.failure(
        422,
        "Dispatch the current output before changing recipes.",
      );
    if (state.assignedWorkers > selected.requiredWorkers)
      return this.failure(
        422,
        `Reduce this building to ${selected.requiredWorkers} workers before selecting ${selected.name}.`,
      );
    this.state.productionStates.set(buildingId, {
      ...state,
      recipeId: selected.id,
      progressMs: 0,
      laborRemainder: 0,
      updatedAt: this.state.simulationTime,
    });
    this.addEvent(
      this.state.simulationTime,
      "production",
      `${buildingDefinitions[building.type].name} selected ${selected.name}.`,
    );
    return this.success();
  }

  private setProductionPriority(
    buildingId: string,
    priority: ProductionPriority,
  ): CommandResult {
    const building = this.producers.find(
      (candidate) => candidate.id === buildingId,
    );
    const state = this.state.productionStates.get(buildingId);
    if (!building || !state)
      return this.failure(404, "Production site was not found.");
    if (!isProductionPriority(priority))
      return this.failure(400, "Production priority is invalid.");
    if ((state.priority ?? "normal") === priority) return this.success();
    this.state.productionStates.set(buildingId, {
      ...state,
      priority,
      updatedAt: this.state.simulationTime,
    });
    this.addEvent(
      this.state.simulationTime,
      "production",
      `${buildingDefinitions[building.type].name} priority set to ${priority}.`,
    );
    return this.success();
  }

  private dispatchProduction(buildingId: string): CommandResult {
    const state = this.state.productionStates.get(buildingId);
    if (!state) return this.failure(404, "Production site was not found.");
    if (state.stored === 0)
      return this.failure(422, "This production site has no output to ship.");
    const building = this.producers.find(
      (candidate) => candidate.id === buildingId,
    );
    const route = this.state.world.logisticsRoutes?.find(
      (candidate) => candidate.originBuildingId === buildingId,
    );
    if (!building || !route || !this.warehouse)
      return this.failure(
        422,
        "This production site has no road connection to the warehouse.",
      );
    const collected = state.stored;
    const selected = recipeForState(state, building.type);
    const output = recipeOutput(selected);
    this.state.productionStates.set(buildingId, {
      ...state,
      stored: 0,
      progressMs: 0,
      laborRemainder: 0,
      updatedAt: this.state.simulationTime,
    });
    const shipment: Shipment = {
      id: `shipment-${this.state.nextShipment++}`,
      routeId: route.id,
      originBuildingId: buildingId,
      destinationBuildingId: this.warehouse.id,
      cargo: {
        commodity: output.commodity,
        quantity: collected,
      },
      departureTime: this.state.simulationTime,
      arrivalTime: this.state.simulationTime + route.durationMs,
      status: "in_transit",
    };
    this.state.shipments.push(shipment);
    this.addEvent(
      this.state.simulationTime,
      "logistics",
      `${collected} ${shipment.cargo.commodity} departed on ${route.name}.`,
    );
    return {
      ok: true,
      status: 200,
      collected,
      shipment,
      readModel: this.readModel(),
    };
  }

  private sellGoods(
    commodity: Commodity,
    quantity: number,
    expectedPriceCents: number,
  ): CommandResult {
    if (
      !(commodity in marketDefinitions) ||
      !Number.isInteger(quantity) ||
      quantity <= 0 ||
      !Number.isInteger(expectedPriceCents) ||
      expectedPriceCents <= 0
    )
      return this.failure(400, "Invalid market sale.");
    if (quantity > this.state.warehouseInventory[commodity])
      return this.failure(
        422,
        `Only ${this.state.warehouseInventory[commodity]} ${commodity} are available at the warehouse.`,
      );
    const listing = this.marketListings().find(
      (candidate) => candidate.commodity === commodity,
    )!;
    if (listing.priceCents !== expectedPriceCents)
      return this.failure(
        409,
        `${listing.name} is now quoted at $${(listing.priceCents / 100).toFixed(2)}. Review the refreshed market before selling.`,
      );
    const revenueCents = listing.priceCents * quantity;
    this.state.warehouseInventory[commodity] -= quantity;
    this.addMarketActivity(commodity, { demand: quantity });
    this.state.cashCents += revenueCents;
    this.state.marketTick++;
    this.state.marketUpdatedAt = this.state.simulationTime;
    this.recordMarket(this.state.simulationTime);
    this.addEvent(
      this.state.simulationTime,
      "market",
      `Sold ${quantity} ${commodity} for $${(revenueCents / 100).toFixed(2)}.`,
    );
    return {
      ok: true,
      status: 200,
      revenueCents,
      readModel: this.readModel(),
    };
  }

  private marketListings() {
    return buildMarketListings(
      this.state.warehouseInventory,
      this.state.priceHistory,
    );
  }

  private addMarketActivity(
    commodity: Commodity,
    activity: Partial<MarketActivity>,
  ) {
    const current = this.state.recentMarketActivity[commodity];
    this.state.recentMarketActivity[commodity] = {
      supply: current.supply + (activity.supply ?? 0),
      demand: current.demand + (activity.demand ?? 0),
      consumption: current.consumption + (activity.consumption ?? 0),
    };
  }

  private addEvent(
    time: number,
    category: EconomyEvent["category"],
    message: string,
  ) {
    this.state.events.push({
      id: `event-${this.state.nextEvent++}`,
      time,
      category,
      message,
    });
    if (this.state.events.length > 30)
      this.state.events.splice(0, this.state.events.length - 30);
  }

  private recordMarket(time: number) {
    for (const commodity of Object.keys(marketDefinitions) as Commodity[]) {
      const history = this.state.priceHistory[commodity];
      const previous =
        history.at(-1)?.priceCents ??
        marketDefinitions[commodity].basePriceCents;
      const activity = this.state.recentMarketActivity[commodity];
      const analysis = marketPriceAnalysis(
        commodity,
        this.state.warehouseInventory[commodity],
        previous,
        activity,
      );
      const priceCents = analysis.priceCents;
      this.state.priceHistory[commodity] = retainMarketPriceHistory(
        [
          ...history,
          {
            time,
            priceCents,
            availableInventory: this.state.warehouseInventory[commodity],
            recentSupply: activity.supply,
            recentDemand: activity.demand,
            recentConsumption: activity.consumption,
            priceReasons: analysis.reasons,
          },
        ],
        time,
      );
      this.state.recentMarketActivity[commodity] = emptyMarketActivity();
      const shortage = shortageLevel(
        commodity,
        this.state.warehouseInventory[commodity],
      );
      if (shortage !== this.state.shortages[commodity]) {
        this.addEvent(
          time,
          "market",
          shortage === "none"
            ? `${marketDefinitions[commodity].name} shortage cleared.`
            : `${marketDefinitions[commodity].name} shortage is now ${shortage}.`,
        );
        this.state.shortages[commodity] = shortage;
      } else if (
        previous > 0 &&
        Math.abs(priceCents - previous) / previous >= 0.05
      ) {
        const direction = priceCents > previous ? "increased" : "decreased";
        this.addEvent(
          time,
          "market",
          `${marketDefinitions[commodity].name} price ${direction} by ${Math.round((Math.abs(priceCents - previous) / previous) * 100)}%.`,
        );
      }
    }
  }

  private advanceMarket(simulationTime: number) {
    const elapsedTicks = Math.floor(
      (simulationTime - this.state.marketUpdatedAt) / 5_000,
    );
    for (let index = 0; index < elapsedTicks; index++) {
      this.state.marketTick++;
      this.state.marketUpdatedAt += 5_000;
      this.recordMarket(this.state.marketUpdatedAt);
    }
  }

  private economySnapshot(): ProductionSnapshot {
    const sites = this.producers.flatMap((building) => {
      const state = this.state.productionStates.get(building.id);
      const site = state
        ? describeProduction(state, building, this.state.warehouseInventory)
        : null;
      return site ? [site] : [];
    });
    const totalPopulation = this.state.world.settlement?.population ?? 0;
    const totalWorkforce = workingAgePopulation(totalPopulation);
    const labor = describeLabor(
      totalWorkforce,
      sites.map((site) => ({
        assignedWorkers: site.assignedWorkers,
        requiredWorkers: site.requiredWorkers,
      })),
    );
    const population = describePopulation(
      this.state.world,
      labor.assignedWorkers,
      describeFoodNeed(
        this.state.warehouseInventory,
        totalPopulation,
        this.state.lastFoodConsumption,
      ),
    );
    const listings = this.marketListings();
    return {
      simulationTime: this.state.simulationTime,
      population,
      labor,
      sites,
      logistics: {
        routes: this.state.world.logisticsRoutes ?? [],
        shipments: this.state.shipments,
        warehouseBuildingId: this.warehouse?.id ?? "",
        warehouseInventory: { ...this.state.warehouseInventory },
      },
      market: {
        updatedAt: this.state.marketUpdatedAt,
        cashCents: this.state.cashCents,
        listings,
        opportunities: buildEconomicOpportunities(listings, sites),
        events: this.state.events.slice(-12).reverse(),
      },
    };
  }

  private readModel(): GameReadModel {
    return {
      revision: this.state.revision,
      world: this.state.world,
      economy: this.economySnapshot(),
    };
  }

  private success(): CommandResult {
    return { ok: true, status: 200, readModel: this.readModel() };
  }

  private failure(status: 400 | 404 | 409 | 422, error: string): CommandResult {
    return { ok: false, status, error, readModel: this.readModel() };
  }
}
