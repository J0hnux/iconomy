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
  marketDefinitions,
  marketPriceCents,
  shortageLevel,
  type EconomyEvent,
  type PricePoint,
  type ShortageLevel,
} from "../domain/market";
import {
  defaultRecipeByProducer,
  describeProduction,
  isProducerType,
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
} from "../domain/production";
import {
  commodityIds,
  commodityRecord,
  normalizeCommodityInventory,
} from "../domain/commodities";
import { describePopulation } from "../domain/population";
import {
  describeLabor,
  validateLaborAssignment,
} from "../domain/labor";
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

function isLocalSimulationSaveV1(
  value: unknown,
): value is LocalSimulationSaveV1 {
  if (!isRecord(value) || value.saveVersion !== 1) return false;
  const world = value.world;
  const inventory = value.warehouseInventory;
  const history = value.priceHistory;
  const shortages = value.shortages;
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
    !isNonnegativeInteger(value.nextEvent)
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
      (history[commodity] !== undefined && !Array.isArray(history[commodity])) ||
      (shortages[commodity] !== undefined &&
        !["none", "low", "critical"].includes(shortages[commodity] as string))
    )
      return false;
  }
  return value.productionStates.every(
    (state) =>
      isRecord(state) &&
      typeof state.buildingId === "string" &&
      (state.recipeId === undefined || isRecipeId(state.recipeId)) &&
      isNonnegativeInteger(state.assignedWorkers) &&
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
                  restored.marketTick,
                ),
              },
            ];
        shortages[commodity] =
          restored.shortages[commodity] ??
          shortageLevel(commodity, warehouseInventory[commodity]);
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
          assignedWorkers: existing?.assignedWorkers ?? 0,
          stored: migratesLegacyFarmState ? 0 : (existing?.stored ?? 0),
          progressMs: migratesLegacyFarmState
            ? 0
            : (existing?.progressMs ?? 0),
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
    const priceHistory = Object.fromEntries(
      commodityIds.map((commodity) => [
        commodity,
        Array.from({ length: 5 }, (_, index) => ({
          time: startTime - (4 - index) * 5_000,
          priceCents: marketPriceCents(
            commodity,
            warehouseInventory[commodity],
            index,
          ),
        })),
      ]),
    ) as Record<Commodity, PricePoint[]>;
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
              assignedWorkers:
                building.type === "farm" || building.type === "quarry"
                  ? selected.requiredWorkers
                  : 0,
              stored:
                building.type === "quarry" ? selected.storageCapacity : 0,
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
        (a, b) =>
          a.arrivalTime - b.arrivalTime || a.id.localeCompare(b.id),
      );
    let arrivalIndex = 0;
    while (arrivalIndex < arrivals.length) {
      const arrivalTime = Math.max(
        this.state.simulationTime,
        arrivals[arrivalIndex].arrivalTime,
      );
      this.advanceProducersTo(arrivalTime);
      this.advanceMarket(arrivalTime);
      while (
        arrivalIndex < arrivals.length &&
        Math.max(
          this.state.simulationTime,
          arrivals[arrivalIndex].arrivalTime,
        ) === arrivalTime
      ) {
        const shipment = arrivals[arrivalIndex++];
        this.state.warehouseInventory[shipment.cargo.commodity] +=
          shipment.cargo.quantity;
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
    }
    this.advanceProducersTo(simulationTime);
    this.advanceMarket(simulationTime);
    this.state.simulationTime = simulationTime;
  }

  private advanceProducersTo(simulationTime: number) {
    for (const building of [...this.producers].sort((a, b) =>
      a.id.localeCompare(b.id),
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
    }
  }

  private construct(
    command: Extract<GameCommand, { type: "construct" }>,
  ): CommandResult {
    if (command.expectedRevision !== this.state.revision)
      return this.failure(409, "Simulation changed. Review the latest world state.");
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
    }
    this.state.world = world;
    if (isProducerType(building.type)) {
      const selected =
        productionRecipes[defaultRecipeByProducer[building.type]];
      this.state.productionStates.set(building.id, {
        buildingId: building.id,
        recipeId: selected.id,
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
      return this.failure(422, "The settlement's founding camp cannot be demolished.");
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
      return this.failure(
        422,
        "Workers must be a nonnegative integer.",
      );
    const assignedElsewhere = [...this.state.productionStates.values()].reduce(
      (total, candidate) =>
        total +
        (candidate.buildingId === buildingId ? 0 : candidate.assignedWorkers),
      0,
    );
    const workingAgePopulation = describePopulation(
      this.state.world,
      0,
      this.state.warehouseInventory.food,
    ).workingAgePopulation;
    const validation = validateLaborAssignment(
      workingAgePopulation,
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
          ? `${buildingDefinitions[building.type].name} paused and released its workers.`
          : `${buildingDefinitions[building.type].name} has a worker shortage at ${workers}/${selected.requiredWorkers}.`,
    );
    return this.success();
  }

  private dispatchProduction(buildingId: string): CommandResult {
    const state = this.state.productionStates.get(buildingId);
    if (!state)
      return this.failure(404, "Production site was not found.");
    if (state.stored === 0)
      return this.failure(
        422,
        "This production site has no output to ship.",
      );
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
      this.state.marketTick,
    );
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
      const priceCents = marketPriceCents(
        commodity,
        this.state.warehouseInventory[commodity],
        this.state.marketTick,
      );
      history.push({ time, priceCents });
      if (history.length > 12) history.splice(0, history.length - 12);
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
    const elapsedTicks = Math.min(
      24,
      Math.floor((simulationTime - this.state.marketUpdatedAt) / 5_000),
    );
    for (let index = 0; index < elapsedTicks; index++) {
      this.state.marketTick++;
      this.state.marketUpdatedAt += 5_000;
      this.recordMarket(this.state.marketUpdatedAt);
    }
    if (elapsedTicks === 24) this.state.marketUpdatedAt = simulationTime;
  }

  private economySnapshot(): ProductionSnapshot {
    const sites = this.producers.flatMap((building) => {
      const state = this.state.productionStates.get(building.id);
      const site = state
        ? describeProduction(state, building, this.state.warehouseInventory)
        : null;
      return site ? [site] : [];
    });
    const totalWorkforce = describePopulation(
      this.state.world,
      0,
      this.state.warehouseInventory.food,
    ).workingAgePopulation;
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
      this.state.warehouseInventory.food,
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

  private failure(
    status: 400 | 404 | 409 | 422,
    error: string,
  ): CommandResult {
    return { ok: false, status, error, readModel: this.readModel() };
  }
}
