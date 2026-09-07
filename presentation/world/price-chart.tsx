"use client";

import { useMemo, useState } from "react";
import {
  buildPriceChartReadModel,
  marketChartTimeframes,
  type MarketChartTimeframeId,
  type PriceCandle,
  type PriceChartPoint,
  type PricePoint,
} from "@/world/domain/market";

export type MarketChartType = "line" | "candlestick";

type ChartDimensions = Readonly<{
  width: number;
  height: number;
  top: number;
  bottom: number;
  left: number;
  right: number;
}>;

const compactDimensions: ChartDimensions = {
  width: 280,
  height: 148,
  top: 10,
  bottom: 24,
  left: 10,
  right: 10,
};
const expandedDimensions: ChartDimensions = {
  width: 900,
  height: 400,
  top: 20,
  bottom: 38,
  left: 24,
  right: 24,
};

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const timeLabel = (time: number) =>
  new Date(time).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
const intervalLabel = (startTime: number, endTime: number) =>
  `${timeLabel(startTime)}–${timeLabel(endTime)}`;

function priceScale(prices: readonly number[], dimensions: ChartDimensions) {
  const minimum = Math.min(...prices);
  const maximum = Math.max(...prices);
  const range = Math.max(1, maximum - minimum);
  const plotHeight = dimensions.height - dimensions.top - dimensions.bottom;
  return {
    minimum,
    maximum,
    y: (price: number) =>
      dimensions.top + ((maximum - price) / range) * plotHeight,
  };
}

function chartX(index: number, count: number, dimensions: ChartDimensions) {
  const plotWidth = dimensions.width - dimensions.left - dimensions.right;
  return count === 1
    ? dimensions.left + plotWidth / 2
    : dimensions.left + (index / (count - 1)) * plotWidth;
}

function ChartAxes({
  dimensions,
  minimum,
  maximum,
  firstTime,
  lastTime,
}: {
  dimensions: ChartDimensions;
  minimum: number;
  maximum: number;
  firstTime: number;
  lastTime: number;
}) {
  const baseline = dimensions.height - dimensions.bottom;
  return (
    <>
      <line
        x1={dimensions.left}
        y1={dimensions.top}
        x2={dimensions.left}
        y2={baseline}
        stroke="currentColor"
        opacity="0.2"
      />
      <line
        x1={dimensions.left}
        y1={baseline}
        x2={dimensions.width - dimensions.right}
        y2={baseline}
        stroke="currentColor"
        opacity="0.2"
      />
      <text
        x={dimensions.left}
        y={dimensions.height - 6}
        fill="currentColor"
        opacity="0.55"
        fontSize="10"
      >
        {timeLabel(firstTime)}
      </text>
      <text
        x={dimensions.width - dimensions.right}
        y={dimensions.height - 6}
        fill="currentColor"
        opacity="0.55"
        fontSize="10"
        textAnchor="end"
      >
        {timeLabel(lastTime)}
      </text>
      <text
        x={dimensions.left + 3}
        y={dimensions.top + 11}
        fill="currentColor"
        opacity="0.55"
        fontSize="10"
      >
        {money(maximum)}
      </text>
      <text
        x={dimensions.left + 3}
        y={baseline - 5}
        fill="currentColor"
        opacity="0.55"
        fontSize="10"
      >
        {money(minimum)}
      </text>
    </>
  );
}

function linePointLabel(point: PriceChartPoint) {
  return `${intervalLabel(point.startTime, point.endTime)} · Price ${money(point.priceCents)} · ${point.status}`;
}

function LinePriceChart({
  points,
  dimensions,
  activeStart,
  onHover,
  onSelect,
}: {
  points: readonly PriceChartPoint[];
  dimensions: ChartDimensions;
  activeStart: number;
  onHover: (startTime: number | null) => void;
  onSelect: (startTime: number) => void;
}) {
  const scale = priceScale(
    points.map((point) => point.priceCents),
    dimensions,
  );
  const coordinates = points.map((point, index) => ({
    point,
    x: chartX(index, points.length, dimensions),
    y: scale.y(point.priceCents),
  }));
  return (
    <svg
      viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}
      role="img"
      aria-label="Closing market price history"
      className="h-full min-h-40 w-full overflow-visible"
      onPointerLeave={() => onHover(null)}
    >
      <ChartAxes
        dimensions={dimensions}
        minimum={scale.minimum}
        maximum={scale.maximum}
        firstTime={points[0].startTime}
        lastTime={points.at(-1)!.endTime}
      />
      <polyline
        points={coordinates.map(({ x, y }) => `${x},${y}`).join(" ")}
        fill="none"
        stroke="#38bdf8"
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
      />
      {coordinates.map(({ point, x, y }) => (
        <g
          key={point.startTime}
          role="button"
          tabIndex={0}
          aria-label={linePointLabel(point)}
          className="cursor-pointer outline-none"
          onPointerEnter={() => onHover(point.startTime)}
          onFocus={() => onHover(point.startTime)}
          onBlur={() => onHover(null)}
          onClick={() => onSelect(point.startTime)}
        >
          <title>{linePointLabel(point)}</title>
          <circle cx={x} cy={y} r="8" fill="transparent" />
          <circle
            cx={x}
            cy={y}
            r={activeStart === point.startTime ? 4 : 2.5}
            fill={point.status === "active" ? "#fbbf24" : "#7dd3fc"}
            stroke={activeStart === point.startTime ? "#f8fafc" : "none"}
          />
        </g>
      ))}
    </svg>
  );
}

function candleLabel(candle: PriceCandle) {
  return `${intervalLabel(candle.startTime, candle.endTime)} · Open ${money(candle.openCents)} · High ${money(candle.highCents)} · Low ${money(candle.lowCents)} · Close ${money(candle.closeCents)} · ${candle.status}`;
}

function CandlestickPriceChart({
  candles,
  dimensions,
  activeStart,
  onHover,
  onSelect,
}: {
  candles: readonly PriceCandle[];
  dimensions: ChartDimensions;
  activeStart: number;
  onHover: (startTime: number | null) => void;
  onSelect: (startTime: number) => void;
}) {
  const scale = priceScale(
    candles.flatMap((candle) => [candle.lowCents, candle.highCents]),
    dimensions,
  );
  const plotWidth = dimensions.width - dimensions.left - dimensions.right;
  const slotWidth = plotWidth / Math.max(1, candles.length);
  const bodyWidth = Math.max(4, Math.min(20, slotWidth * 0.55));
  return (
    <svg
      viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}
      role="img"
      aria-label="Market price candlestick history"
      className="h-full min-h-40 w-full overflow-visible"
      onPointerLeave={() => onHover(null)}
    >
      <ChartAxes
        dimensions={dimensions}
        minimum={scale.minimum}
        maximum={scale.maximum}
        firstTime={candles[0].startTime}
        lastTime={candles.at(-1)!.endTime}
      />
      {candles.map((candle, index) => {
        const x = dimensions.left + slotWidth * (index + 0.5);
        const openY = scale.y(candle.openCents);
        const closeY = scale.y(candle.closeCents);
        const rising = candle.closeCents > candle.openCents;
        const falling = candle.closeCents < candle.openCents;
        const color = rising ? "#34d399" : falling ? "#fb7185" : "#94a3b8";
        const bodyTop = Math.min(openY, closeY);
        const bodyHeight = Math.max(2, Math.abs(closeY - openY));
        return (
          <g
            key={candle.startTime}
            role="button"
            tabIndex={0}
            aria-label={candleLabel(candle)}
            className="cursor-pointer outline-none"
            onPointerEnter={() => onHover(candle.startTime)}
            onFocus={() => onHover(candle.startTime)}
            onBlur={() => onHover(null)}
            onClick={() => onSelect(candle.startTime)}
          >
            <title>{candleLabel(candle)}</title>
            <line
              x1={x}
              y1={scale.y(candle.highCents)}
              x2={x}
              y2={scale.y(candle.lowCents)}
              stroke={color}
              strokeWidth="1.5"
            />
            <rect
              x={x - bodyWidth / 2}
              y={bodyTop}
              width={bodyWidth}
              height={bodyHeight}
              fill={color}
              stroke={
                activeStart === candle.startTime
                  ? "#f8fafc"
                  : candle.status === "active"
                    ? "#fbbf24"
                    : color
              }
              strokeWidth={activeStart === candle.startTime ? 2 : 1}
            />
          </g>
        );
      })}
    </svg>
  );
}

export function MarketChartControls({
  chartType,
  timeframeId,
  onChartTypeChange,
  onTimeframeChange,
}: {
  chartType: MarketChartType;
  timeframeId: MarketChartTimeframeId;
  onChartTypeChange: (chartType: MarketChartType) => void;
  onTimeframeChange: (timeframe: MarketChartTimeframeId) => void;
}) {
  return (
    <div className="space-y-2">
      <div
        className="grid grid-cols-7 gap-1 rounded-lg border border-white/10 p-1"
        role="group"
        aria-label="Chart timeframe"
      >
        {marketChartTimeframes.map((timeframe) => (
          <button
            key={timeframe.id}
            className={`rounded px-1 py-1.5 text-[10px] transition ${timeframeId === timeframe.id ? "bg-amber-300 text-slate-950" : "text-slate-400 hover:bg-white/10"}`}
            aria-pressed={timeframeId === timeframe.id}
            onClick={() => onTimeframeChange(timeframe.id)}
          >
            {timeframe.label}
          </button>
        ))}
      </div>
      <div
        className="grid grid-cols-2 gap-1 rounded-lg border border-white/10 p-1"
        role="group"
        aria-label="Chart type"
      >
        {(["line", "candlestick"] as const).map((chartTypeOption) => (
          <button
            key={chartTypeOption}
            className={`rounded-md px-3 py-1.5 text-[11px] capitalize transition ${chartType === chartTypeOption ? "bg-sky-500 text-white" : "text-slate-400 hover:bg-white/10"}`}
            aria-pressed={chartType === chartTypeOption}
            onClick={() => onChartTypeChange(chartTypeOption)}
          >
            {chartTypeOption}
          </button>
        ))}
      </div>
    </div>
  );
}

export function MarketPriceChart({
  history,
  chartType,
  timeframeId,
  currentTime,
  expanded = false,
  selectedPeriodStart,
  onSelectedPeriodStartChange,
}: {
  history: readonly PricePoint[];
  chartType: MarketChartType;
  timeframeId: MarketChartTimeframeId;
  currentTime: number;
  expanded?: boolean;
  selectedPeriodStart: number | null;
  onSelectedPeriodStartChange: (startTime: number) => void;
}) {
  const [hoveredStart, setHoveredStart] = useState<number | null>(null);
  const timeframe = marketChartTimeframes.find(
    (candidate) => candidate.id === timeframeId,
  )!;
  const chart = useMemo(
    () =>
      buildPriceChartReadModel(history, timeframe.durationMs, currentTime),
    [history, timeframe.durationMs, currentTime],
  );
  if (chart.candles.length === 0)
    return (
      <p className="py-8 text-center text-xs text-slate-500">
        No price observations yet.
      </p>
    );
  const visibleLimit = expanded ? 180 : 48;
  const candles = chart.candles.slice(-visibleLimit);
  const linePoints = chart.linePoints.slice(-visibleLimit);
  const periods = chartType === "line" ? linePoints : candles;
  const activePeriod =
    periods.find((period) => period.startTime === hoveredStart) ??
    periods.find((period) => period.startTime === selectedPeriodStart) ??
    periods.at(-1)!;
  const dimensions = expanded ? expandedDimensions : compactDimensions;
  const latestPeriod = periods.at(-1)!;
  return (
    <div>
      <div className={expanded ? "h-[min(52vh,30rem)]" : "h-40"}>
        {chartType === "line" ? (
          <LinePriceChart
            points={linePoints}
            dimensions={dimensions}
            activeStart={activePeriod.startTime}
            onHover={setHoveredStart}
            onSelect={onSelectedPeriodStartChange}
          />
        ) : (
          <CandlestickPriceChart
            candles={candles}
            dimensions={dimensions}
            activeStart={activePeriod.startTime}
            onHover={setHoveredStart}
            onSelect={onSelectedPeriodStartChange}
          />
        )}
      </div>
      {chartType === "candlestick" ? (
        <dl className="grid grid-cols-5 gap-2 border-t border-white/10 pt-2 text-center text-[10px]">
          {[
            ["Interval", intervalLabel(activePeriod.startTime, activePeriod.endTime)],
            ["Open", money((activePeriod as PriceCandle).openCents)],
            ["High", money((activePeriod as PriceCandle).highCents)],
            ["Low", money((activePeriod as PriceCandle).lowCents)],
            ["Close", money((activePeriod as PriceCandle).closeCents)],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-slate-500">{label}</dt>
              <dd className="mt-1 font-mono text-slate-100">{value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <dl className="grid grid-cols-2 gap-2 border-t border-white/10 pt-2 text-center text-[10px]">
          <div>
            <dt className="text-slate-500">Interval</dt>
            <dd className="mt-1 font-mono text-slate-100">
              {intervalLabel(activePeriod.startTime, activePeriod.endTime)}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Price</dt>
            <dd className="mt-1 font-mono text-slate-100">
              {money((activePeriod as PriceChartPoint).priceCents)}
            </dd>
          </div>
        </dl>
      )}
      <p className="mt-2 text-center text-[10px] text-slate-500">
        {activePeriod.status === "active"
          ? "Active interval"
          : "Completed interval"}
        {` · ${activePeriod.observationCount} observation${activePeriod.observationCount === 1 ? "" : "s"}`}
        {latestPeriod.status === "complete"
          ? " · Awaiting the next genuine market observation"
          : ""}
      </p>
    </div>
  );
}
