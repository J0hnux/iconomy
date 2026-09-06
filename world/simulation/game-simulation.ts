import {
  placeBuilding,
  validatePlacement,
  type PlacementRequest,
} from "../domain/construction";
import {
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
  advanceProduction,
  describeProduction,
  isProducerType,
  productionRecipes,
  withStartingProduction,
  type Commodity,
  type ProductionSnapshot,
  type ProductionState,
  type ProducerType,
} from "../domain/production";
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
    }>;

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

export class LocalGameSimulation {
  private readonly producers: readonly (Building & { type: ProducerType })[];
  private readonly warehouse: Building | undefined;
  private readonly state: MutableSimulationState;

  constructor(world: WorldSnapshot, startTime: number) {
    this.assertTime(startTime);
    this.producers = (world.buildings ?? []).filter(
      (building): building is Building & { type: ProducerType } =>
        isProducerType(building.type),
    );
    this.warehouse = world.buildings?.find(
      (building) => building.type === "warehouse",
    );
    const farm = this.producers.find((building) => building.type === "farm");
    const demonstrationRoute = world.logisticsRoutes?.find(
      (route) => route.originBuildingId === farm?.id,
    );
    const shipments: Shipment[] =
      farm && this.warehouse && demonstrationRoute
        ? [
            {
              id: "shipment-1",
              routeId: demonstrationRoute.id,
              originBuildingId: farm.id,
              destinationBuildingId: this.warehouse.id,
              cargo: {
                commodity: "food",
                quantity: productionRecipes.farm.outputAmount,
              },
              departureTime: startTime,
              arrivalTime: startTime + demonstrationRoute.durationMs,
              status: "in_transit",
            },
          ]
        : [];
    const warehouseInventory = { food: 8, wood: 3, stone: 0 };
    const priceHistory = Object.fromEntries(
      (Object.keys(marketDefinitions) as Commodity[]).map((commodity) => [
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
        this.producers.map((building) => {
          const recipe = productionRecipes[building.type];
          return [
            building.id,
            {
              buildingId: building.id,
              assignedWorkers:
                building.type === "lumber_camp" ? 0 : recipe.requiredWorkers,
              stored:
                building.type === "quarry" ? recipe.storageCapacity : 0,
              progressMs: 0,
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
      shortages: {
        food: shortageLevel("food", warehouseInventory.food),
        wood: shortageLevel("wood", warehouseInventory.wood),
        stone: shortageLevel("stone", warehouseInventory.stone),
      },
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
      priceHistory: {
        food: [...this.state.priceHistory.food],
        wood: [...this.state.priceHistory.wood],
        stone: [...this.state.priceHistory.stone],
      },
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
    for (const building of this.producers) {
      const state = this.state.productionStates.get(building.id);
      if (state)
        this.state.productionStates.set(
          building.id,
          advanceProduction(state, building.type, simulationTime),
        );
    }
    const arrivals = this.state.shipments
      .filter(
        (shipment) =>
          shipment.status === "in_transit" &&
          shipment.arrivalTime <= simulationTime,
      )
      .sort((a, b) => a.arrivalTime - b.arrivalTime);
    for (const shipment of arrivals) {
      this.advanceMarket(shipment.arrivalTime);
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
    this.advanceMarket(simulationTime);
    this.state.simulationTime = simulationTime;
  }

  private construct(
    command: Extract<GameCommand, { type: "construct" }>,
  ): CommandResult {
    if (command.expectedRevision !== this.state.revision)
      return this.failure(409, "Simulation changed. Review the latest world state.");
    const validation = validatePlacement(this.state.world, command.placement);
    if (!validation.valid)
      return this.failure(422, validation.reasons.join(". "));
    const id = `player-${this.state.revision + 1}`;
    const world = placeBuilding(this.state.world, command.placement, id);
    const building = world.buildings?.at(-1);
    if (!building)
      return this.failure(422, "Construction could not be completed.");
    this.state.world = world;
    this.state.revision++;
    return {
      ok: true,
      status: 201,
      building,
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
    const recipe = productionRecipes[building.type];
    if (
      !Number.isInteger(workers) ||
      workers < 0 ||
      workers > recipe.requiredWorkers
    )
      return this.failure(
        422,
        `Workers must be between 0 and ${recipe.requiredWorkers}.`,
      );
    const assignedElsewhere = [...this.state.productionStates.values()].reduce(
      (total, candidate) =>
        total +
        (candidate.buildingId === buildingId ? 0 : candidate.assignedWorkers),
      0,
    );
    if (
      assignedElsewhere + workers >
      (this.state.world.settlement?.population ?? 0)
    )
      return this.failure(
        422,
        "Novagrad does not have enough available workers.",
      );
    this.state.productionStates.set(buildingId, {
      ...state,
      assignedWorkers: workers,
      updatedAt: this.state.simulationTime,
    });
    this.addEvent(
      this.state.simulationTime,
      "production",
      workers >= recipe.requiredWorkers
        ? `${buildingDefinitions[building.type].name} started production.`
        : `${buildingDefinitions[building.type].name} worker assignment changed to ${workers}/${recipe.requiredWorkers}.`,
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
    this.state.productionStates.set(buildingId, {
      ...state,
      stored: 0,
      progressMs: 0,
      updatedAt: this.state.simulationTime,
    });
    const shipment: Shipment = {
      id: `shipment-${this.state.nextShipment++}`,
      routeId: route.id,
      originBuildingId: buildingId,
      destinationBuildingId: this.warehouse.id,
      cargo: {
        commodity: productionRecipes[building.type].output,
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
      const site = state ? describeProduction(state, building) : null;
      return site ? [site] : [];
    });
    const population = this.state.world.settlement?.population ?? 0;
    const assignedWorkers = sites.reduce(
      (total, site) => total + site.assignedWorkers,
      0,
    );
    const listings = this.marketListings();
    return {
      simulationTime: this.state.simulationTime,
      population,
      assignedWorkers,
      availableWorkers: population - assignedWorkers,
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
