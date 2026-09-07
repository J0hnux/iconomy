import { commodityIds, type Commodity } from "./commodities";
import {
  cloneNpcCity,
  npcCityTargetStock,
  type NpcCityState,
} from "./npc-cities";
import type { WorldPosition } from "./world";

export const regionalLogisticsPolicy = {
  maximumShipmentCapacity: 12,
  handlingCostCents: 25,
  costCentsPerTilePerUnit: 2,
  minimumTravelTimeMs: 15_000,
  travelTimeMsPerTile: 1_500,
  completedShipmentHistoryLimit: 200,
} as const;

export type RegionalShipmentStatus = "in_transit" | "arrived";
export type RegionalShipmentOwner = "npc" | "player" | "npc_company";
export type RegionalDestinationAction = "sell" | "store";

export type RegionalTradeLocation = Readonly<{
  id: string;
  name: string;
  kind: "novagrad" | "npc_city";
  position: WorldPosition;
  tradeCapacity: number;
  inventory: Readonly<Record<Commodity, number>>;
  localPrices: Readonly<Record<Commodity, number>>;
}>;

export type RegionalEndpoint = Readonly<{
  cityId: string;
  cityName: string;
  position: WorldPosition;
}>;

export type RegionalShipment = Readonly<{
  id: string;
  origin: RegionalEndpoint;
  destination: RegionalEndpoint;
  commodity: Commodity;
  quantity: number;
  transportCapacity: number;
  distanceTiles: number;
  transportCostCents: number;
  departureTime: number;
  arrivalTime: number;
  status: RegionalShipmentStatus;
  owner?: RegionalShipmentOwner;
  ownerId?: string;
  destinationAction?: RegionalDestinationAction;
  originUnitPriceCents: number;
  estimatedDestinationUnitPriceCents: number;
  purchaseCostCents: number;
  estimatedRevenueCents: number;
  estimatedProfitCents: number;
  upfrontCostCents?: number;
  arrivedAt?: number;
  actualDestinationUnitPriceCents?: number;
  actualRevenueCents?: number;
  actualProfitCents?: number;
  actualCashChangeCents?: number;
}>;

export type RegionalLogisticsSnapshot = Readonly<{
  shipments: readonly RegionalShipment[];
  locations: readonly RegionalTradeLocation[];
}>;

export type RegionalTransportQuote = Readonly<{
  distanceTiles: number;
  transportCapacity: number;
  transportCostCents: number;
  travelTimeMs: number;
}>;

export function quoteRegionalTransport(
  origin: Pick<RegionalTradeLocation, "position" | "tradeCapacity">,
  destination: Pick<RegionalTradeLocation, "position" | "tradeCapacity">,
  quantity: number,
): RegionalTransportQuote {
  if (!Number.isSafeInteger(quantity) || quantity <= 0)
    throw new RangeError("Regional shipment quantity must be a positive integer.");
  const distanceTiles = Math.max(
    1,
    Math.ceil(
      Math.hypot(
        destination.position.x - origin.position.x,
        destination.position.y - origin.position.y,
      ),
    ),
  );
  const transportCapacity = Math.max(
    1,
    Math.min(
      regionalLogisticsPolicy.maximumShipmentCapacity,
      origin.tradeCapacity,
      destination.tradeCapacity,
    ),
  );
  if (quantity > transportCapacity)
    throw new RangeError(
      `Regional shipment exceeds transport capacity of ${transportCapacity}.`,
    );
  return {
    distanceTiles,
    transportCapacity,
    transportCostCents:
      regionalLogisticsPolicy.handlingCostCents +
      distanceTiles *
        quantity *
        regionalLogisticsPolicy.costCentsPerTilePerUnit,
    travelTimeMs:
      regionalLogisticsPolicy.minimumTravelTimeMs +
      distanceTiles * regionalLogisticsPolicy.travelTimeMsPerTile,
  };
}

const endpoint = (location: RegionalTradeLocation): RegionalEndpoint => ({
  cityId: location.id,
  cityName: location.name,
  position: { ...location.position },
});

export function npcRegionalTradeLocation(
  city: NpcCityState,
): RegionalTradeLocation {
  return {
    id: city.id,
    name: city.name,
    kind: "npc_city",
    position: { ...city.position },
    tradeCapacity: city.tradeCapacity,
    inventory: { ...city.inventory },
    localPrices: { ...city.localPrices },
  };
}

export function createRegionalShipment(input: Readonly<{
  id: string;
  origin: RegionalTradeLocation;
  destination: RegionalTradeLocation;
  commodity: Commodity;
  quantity: number;
  departureTime: number;
  owner: RegionalShipmentOwner;
  ownerId?: string;
  destinationAction: RegionalDestinationAction;
  upfrontCostCents?: number;
}>): RegionalShipment {
  if (input.origin.id === input.destination.id)
    throw new RangeError("Regional shipment origin and destination must differ.");
  if (input.origin.inventory[input.commodity] < input.quantity)
    throw new RangeError(`${input.origin.name} does not have enough cargo.`);
  const transport = quoteRegionalTransport(
    input.origin,
    input.destination,
    input.quantity,
  );
  const purchaseCostCents =
    input.origin.localPrices[input.commodity] * input.quantity;
  const estimatedRevenueCents =
    input.destination.localPrices[input.commodity] * input.quantity;
  return {
    id: input.id,
    origin: endpoint(input.origin),
    destination: endpoint(input.destination),
    commodity: input.commodity,
    quantity: input.quantity,
    transportCapacity: transport.transportCapacity,
    distanceTiles: transport.distanceTiles,
    transportCostCents: transport.transportCostCents,
    departureTime: input.departureTime,
    arrivalTime: input.departureTime + transport.travelTimeMs,
    status: "in_transit",
    owner: input.owner,
    ...(input.ownerId === undefined ? {} : { ownerId: input.ownerId }),
    destinationAction: input.destinationAction,
    originUnitPriceCents: input.origin.localPrices[input.commodity],
    estimatedDestinationUnitPriceCents:
      input.destination.localPrices[input.commodity],
    purchaseCostCents,
    estimatedRevenueCents,
    estimatedProfitCents:
      estimatedRevenueCents -
      purchaseCostCents -
      transport.transportCostCents,
    upfrontCostCents: input.upfrontCostCents ?? 0,
  };
}

function replaceCity(
  cities: NpcCityState[],
  cityId: string,
  update: (city: NpcCityState) => NpcCityState,
) {
  const index = cities.findIndex((city) => city.id === cityId);
  if (index < 0) throw new RangeError(`NPC city ${cityId} does not exist.`);
  cities[index] = update(cities[index]);
}

function departCargo(
  city: NpcCityState,
  commodity: Commodity,
  quantity: number,
) {
  if (city.inventory[commodity] < quantity)
    throw new RangeError(`${city.name} does not own enough cargo to depart.`);
  return {
    ...city,
    inventory: {
      ...city.inventory,
      [commodity]: city.inventory[commodity] - quantity,
    },
    exports: {
      ...city.exports,
      [commodity]: city.exports[commodity] + quantity,
    },
  };
}

function receiveCargo(
  city: NpcCityState,
  commodity: Commodity,
  quantity: number,
) {
  return {
    ...city,
    inventory: {
      ...city.inventory,
      [commodity]: city.inventory[commodity] + quantity,
    },
    imports: {
      ...city.imports,
      [commodity]: city.imports[commodity] + quantity,
    },
  };
}

function inboundQuantity(
  shipments: readonly RegionalShipment[],
  cityId: string,
  commodity: Commodity,
) {
  return shipments.reduce(
    (total, shipment) =>
      shipment.status === "in_transit" &&
      shipment.destination.cityId === cityId &&
      shipment.commodity === commodity
        ? total + shipment.quantity
        : total,
    0,
  );
}

export function planRegionalShipments(
  sourceCities: readonly NpcCityState[],
  existingShipments: readonly RegionalShipment[],
  departureTime: number,
  nextShipmentSequence: number,
) {
  if (!Number.isSafeInteger(departureTime))
    throw new RangeError("Regional departure time must be a safe integer.");
  if (!Number.isSafeInteger(nextShipmentSequence) || nextShipmentSequence < 1)
    throw new RangeError("Regional shipment sequence must be positive.");
  const cities = sourceCities.map(cloneNpcCity);
  const shipments: RegionalShipment[] = [];
  const importBudget = new Map(
    cities.map((city) => [city.id, city.tradeCapacity]),
  );
  const exportBudget = new Map(
    cities.map((city) => [city.id, city.tradeCapacity]),
  );
  let sequence = nextShipmentSequence;
  for (const commodity of commodityIds) {
    const recipients = [...cities].sort((first, second) =>
      first.id.localeCompare(second.id),
    );
    for (const recipient of recipients) {
      const target = npcCityTargetStock(recipient, commodity);
      let needed = Math.max(
        0,
        target -
          recipient.inventory[commodity] -
          inboundQuantity(
            [...existingShipments, ...shipments],
            recipient.id,
            commodity,
          ),
      );
      needed = Math.min(needed, importBudget.get(recipient.id) ?? 0);
      while (needed > 0) {
        const donor = [...cities]
          .filter(
            (candidate) =>
              candidate.id !== recipient.id &&
              (exportBudget.get(candidate.id) ?? 0) > 0 &&
              candidate.inventory[commodity] >
                npcCityTargetStock(candidate, commodity),
          )
          .sort(
            (first, second) =>
              first.localPrices[commodity] -
                second.localPrices[commodity] ||
              first.id.localeCompare(second.id),
          )[0];
        if (!donor) break;
        const capacity = Math.min(
          regionalLogisticsPolicy.maximumShipmentCapacity,
          donor.tradeCapacity,
          recipient.tradeCapacity,
          exportBudget.get(donor.id) ?? 0,
          importBudget.get(recipient.id) ?? 0,
        );
        const quantity = Math.min(
          needed,
          capacity,
          donor.inventory[commodity] - npcCityTargetStock(donor, commodity),
        );
        if (quantity <= 0) break;
        const shipment = createRegionalShipment({
          id: `regional-shipment-${sequence++}`,
          origin: npcRegionalTradeLocation(donor),
          destination: npcRegionalTradeLocation(recipient),
          commodity,
          quantity,
          departureTime,
          owner: "npc",
          destinationAction: "sell",
        });
        shipments.push(shipment);
        replaceCity(cities, donor.id, (city) =>
          departCargo(city, commodity, quantity),
        );
        exportBudget.set(
          donor.id,
          (exportBudget.get(donor.id) ?? 0) - quantity,
        );
        importBudget.set(
          recipient.id,
          (importBudget.get(recipient.id) ?? 0) - quantity,
        );
        needed -= quantity;
      }
    }
  }
  return {
    cities,
    shipments,
    nextShipmentSequence: sequence,
  } as const;
}

export function settleRegionalShipment(
  sourceCities: readonly NpcCityState[],
  shipment: RegionalShipment,
  simulationTime: number,
) {
  if (shipment.status !== "in_transit")
    throw new RangeError("Only an in-transit regional shipment can arrive.");
  if (simulationTime < shipment.arrivalTime)
    throw new RangeError("Regional shipment cannot arrive before its arrival time.");
  const cities = sourceCities.map(cloneNpcCity);
  const destination = cities.find(
    (city) => city.id === shipment.destination.cityId,
  );
  if (!destination)
    throw new RangeError("Regional shipment destination does not exist.");
  const settledShipment = settleRegionalShipmentValue(
    shipment,
    simulationTime,
    destination.localPrices[shipment.commodity],
  );
  replaceCity(cities, destination.id, (city) =>
    receiveCargo(city, shipment.commodity, shipment.quantity),
  );
  return {
    cities,
    shipment: settledShipment,
  } as const;
}

export function settleRegionalShipmentValue(
  shipment: RegionalShipment,
  simulationTime: number,
  actualDestinationUnitPriceCents: number,
): RegionalShipment {
  if (shipment.status !== "in_transit")
    throw new RangeError("Only an in-transit regional shipment can arrive.");
  if (simulationTime < shipment.arrivalTime)
    throw new RangeError("Regional shipment cannot arrive before its arrival time.");
  if (
    !Number.isSafeInteger(actualDestinationUnitPriceCents) ||
    actualDestinationUnitPriceCents <= 0
  )
    throw new RangeError("Regional destination price must be positive.");
  const actualRevenueCents =
    actualDestinationUnitPriceCents * shipment.quantity;
  return {
    ...shipment,
    status: "arrived",
    arrivedAt: simulationTime,
    actualDestinationUnitPriceCents,
    actualRevenueCents,
    actualProfitCents:
      actualRevenueCents -
      shipment.purchaseCostCents -
      shipment.transportCostCents,
    actualCashChangeCents:
      (shipment.owner === "player" || shipment.owner === "npc_company") &&
      shipment.destinationAction === "sell"
        ? actualRevenueCents
        : 0,
  };
}

export function retainRegionalShipmentHistory(
  shipments: readonly RegionalShipment[],
) {
  const inTransit = shipments.filter(
    (shipment) => shipment.status === "in_transit",
  );
  const completed = shipments
    .filter((shipment) => shipment.status === "arrived")
    .slice(-regionalLogisticsPolicy.completedShipmentHistoryLimit);
  return [...completed, ...inTransit].sort(
    (first, second) =>
      first.departureTime - second.departureTime ||
      first.id.localeCompare(second.id),
  );
}

function isEndpoint(value: unknown): value is RegionalEndpoint {
  if (typeof value !== "object" || value === null) return false;
  const endpointValue = value as Record<string, unknown>;
  const position = endpointValue.position as Record<string, unknown> | undefined;
  return (
    typeof endpointValue.cityId === "string" &&
    endpointValue.cityId.length > 0 &&
    typeof endpointValue.cityName === "string" &&
    typeof position === "object" &&
    position !== null &&
    Number.isSafeInteger(position.x) &&
    (position.x as number) >= 0 &&
    Number.isSafeInteger(position.y) &&
    (position.y as number) >= 0 &&
    Number.isSafeInteger(position.z) &&
    (position.z as number) >= 0
  );
}

const isNonnegativeInteger = (value: unknown) =>
  Number.isSafeInteger(value) && (value as number) >= 0;
const isPositiveInteger = (value: unknown) =>
  Number.isSafeInteger(value) && (value as number) > 0;

export function isRegionalShipment(value: unknown): value is RegionalShipment {
  if (typeof value !== "object" || value === null) return false;
  const shipment = value as Record<string, unknown>;
  const arrived = shipment.status === "arrived";
  return (
    typeof shipment.id === "string" &&
    shipment.id.length > 0 &&
    isEndpoint(shipment.origin) &&
    isEndpoint(shipment.destination) &&
    shipment.origin.cityId !== shipment.destination.cityId &&
    commodityIds.includes(shipment.commodity as Commodity) &&
    isPositiveInteger(shipment.quantity) &&
    isPositiveInteger(shipment.transportCapacity) &&
    (shipment.transportCapacity as number) <=
      regionalLogisticsPolicy.maximumShipmentCapacity &&
    (shipment.quantity as number) <= (shipment.transportCapacity as number) &&
    isPositiveInteger(shipment.distanceTiles) &&
    isNonnegativeInteger(shipment.transportCostCents) &&
    shipment.transportCostCents ===
      regionalLogisticsPolicy.handlingCostCents +
        (shipment.distanceTiles as number) *
          (shipment.quantity as number) *
          regionalLogisticsPolicy.costCentsPerTilePerUnit &&
    Number.isSafeInteger(shipment.departureTime) &&
    Number.isSafeInteger(shipment.arrivalTime) &&
    (shipment.arrivalTime as number) > (shipment.departureTime as number) &&
    shipment.arrivalTime ===
      (shipment.departureTime as number) +
        regionalLogisticsPolicy.minimumTravelTimeMs +
        (shipment.distanceTiles as number) *
          regionalLogisticsPolicy.travelTimeMsPerTile &&
    ["in_transit", "arrived"].includes(shipment.status as string) &&
    ((shipment.owner === undefined &&
      shipment.ownerId === undefined &&
      shipment.destinationAction === undefined &&
      shipment.upfrontCostCents === undefined) ||
      (["npc", "player", "npc_company"].includes(shipment.owner as string) &&
        ["sell", "store"].includes(shipment.destinationAction as string) &&
        isNonnegativeInteger(shipment.upfrontCostCents) &&
        (shipment.owner === "npc_company"
          ? typeof shipment.ownerId === "string" && shipment.ownerId.length > 0
          : shipment.ownerId === undefined))) &&
    isPositiveInteger(shipment.originUnitPriceCents) &&
    isPositiveInteger(shipment.estimatedDestinationUnitPriceCents) &&
    isNonnegativeInteger(shipment.purchaseCostCents) &&
    shipment.purchaseCostCents ===
      (shipment.originUnitPriceCents as number) *
        (shipment.quantity as number) &&
    isNonnegativeInteger(shipment.estimatedRevenueCents) &&
    shipment.estimatedRevenueCents ===
      (shipment.estimatedDestinationUnitPriceCents as number) *
        (shipment.quantity as number) &&
    Number.isSafeInteger(shipment.estimatedProfitCents) &&
    shipment.estimatedProfitCents ===
      (shipment.estimatedRevenueCents as number) -
        (shipment.purchaseCostCents as number) -
        (shipment.transportCostCents as number) &&
    (arrived
      ? Number.isSafeInteger(shipment.arrivedAt) &&
        (shipment.arrivedAt as number) >= (shipment.arrivalTime as number) &&
        isPositiveInteger(shipment.actualDestinationUnitPriceCents) &&
        isNonnegativeInteger(shipment.actualRevenueCents) &&
        shipment.actualRevenueCents ===
          (shipment.actualDestinationUnitPriceCents as number) *
            (shipment.quantity as number) &&
        Number.isSafeInteger(shipment.actualProfitCents) &&
        shipment.actualProfitCents ===
          (shipment.actualRevenueCents as number) -
            (shipment.purchaseCostCents as number) -
            (shipment.transportCostCents as number) &&
        (shipment.actualCashChangeCents === undefined ||
          (isNonnegativeInteger(shipment.actualCashChangeCents) &&
            shipment.actualCashChangeCents ===
              ((shipment.owner === "player" ||
                shipment.owner === "npc_company") &&
              shipment.destinationAction === "sell"
                ? shipment.actualRevenueCents
                : 0)))
      : shipment.arrivedAt === undefined &&
        shipment.actualDestinationUnitPriceCents === undefined &&
        shipment.actualRevenueCents === undefined &&
        shipment.actualProfitCents === undefined &&
        shipment.actualCashChangeCents === undefined)
  );
}

export function cloneRegionalShipment(
  shipment: RegionalShipment,
): RegionalShipment {
  return {
    ...shipment,
    origin: {
      ...shipment.origin,
      position: { ...shipment.origin.position },
    },
    destination: {
      ...shipment.destination,
      position: { ...shipment.destination.position },
    },
  };
}
