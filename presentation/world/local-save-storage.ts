import { commodityIds, type Commodity } from "../../world/domain/commodities";
import type { PricePoint } from "../../world/domain/market";
import type { LocalSimulationSaveV1 } from "../../world/simulation/game-simulation";

const compactSaveFormat = "openworld-economy-compact-v1";

type CompactPricePoint = readonly [
  firstTimeOrDelta: number,
  priceCents: number,
  availableInventory: number | null,
  recentSupply: number | null,
  recentDemand: number | null,
  recentConsumption: number | null,
  reasonIndexes?: readonly number[],
];

type CompactSaveEnvelope = Readonly<{
  storageFormat: typeof compactSaveFormat;
  save: Omit<LocalSimulationSaveV1, "priceHistory">;
  priceHistory: Readonly<Record<Commodity, readonly CompactPricePoint[]>>;
  priceReasons: readonly string[];
}>;

const optionalNumber = (value: number | undefined) => value ?? null;
const restoredNumber = (value: number | null) => value ?? undefined;

export function serializeLocalSave(save: LocalSimulationSaveV1): string {
  const reasonIndexes = new Map<string, number>();
  const priceReasons: string[] = [];
  const indexReason = (reason: string) => {
    const existing = reasonIndexes.get(reason);
    if (existing !== undefined) return existing;
    const index = priceReasons.length;
    priceReasons.push(reason);
    reasonIndexes.set(reason, index);
    return index;
  };
  const priceHistory = Object.fromEntries(
    commodityIds.map((commodity) => [
      commodity,
      save.priceHistory[commodity].map((point, index, points): CompactPricePoint => {
        const numericValues = [
          index === 0 ? point.time : point.time - points[index - 1].time,
          point.priceCents,
          optionalNumber(point.availableInventory),
          optionalNumber(point.recentSupply),
          optionalNumber(point.recentDemand),
          optionalNumber(point.recentConsumption),
        ] as const;
        return point.priceReasons === undefined
          ? numericValues
          : [...numericValues, point.priceReasons.map(indexReason)];
      }),
    ]),
  ) as Record<Commodity, CompactPricePoint[]>;
  const saveWithoutPriceHistory = Object.fromEntries(
    Object.entries(save).filter(([key]) => key !== "priceHistory"),
  ) as Omit<LocalSimulationSaveV1, "priceHistory">;
  const envelope: CompactSaveEnvelope = {
    storageFormat: compactSaveFormat,
    save: saveWithoutPriceHistory,
    priceHistory,
    priceReasons,
  };
  return JSON.stringify(envelope);
}

export function deserializeLocalSave(serialized: string): unknown {
  const parsed = JSON.parse(serialized) as unknown;
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("storageFormat" in parsed) ||
    parsed.storageFormat !== compactSaveFormat ||
    !("save" in parsed) ||
    typeof parsed.save !== "object" ||
    parsed.save === null ||
    !("priceHistory" in parsed) ||
    typeof parsed.priceHistory !== "object" ||
    parsed.priceHistory === null ||
    !("priceReasons" in parsed) ||
    !Array.isArray(parsed.priceReasons)
  )
    return parsed;
  const envelope = parsed as CompactSaveEnvelope;
  const priceHistory = Object.fromEntries(
    commodityIds.map((commodity) => {
      const points = envelope.priceHistory[commodity];
      if (!Array.isArray(points)) throw new TypeError("Compact price history is invalid.");
      let previousTime = 0;
      return [
        commodity,
        points.map((point, index): PricePoint => {
          if (!Array.isArray(point) || point.length < 6)
            throw new TypeError("Compact price observation is invalid.");
          const indexes = point[6];
          const time = index === 0 ? point[0] : previousTime + point[0];
          previousTime = time;
          return {
            time,
            priceCents: point[1],
            availableInventory: restoredNumber(point[2]),
            recentSupply: restoredNumber(point[3]),
            recentDemand: restoredNumber(point[4]),
            recentConsumption: restoredNumber(point[5]),
            ...(indexes === undefined
              ? {}
              : {
                  priceReasons: indexes.map((index: number) => {
                    const reason = envelope.priceReasons[index];
                    if (typeof reason !== "string")
                      throw new TypeError("Compact price reason is invalid.");
                    return reason;
                  }),
                }),
          };
        }),
      ];
    }),
  ) as Record<Commodity, PricePoint[]>;
  return { ...envelope.save, priceHistory };
}
