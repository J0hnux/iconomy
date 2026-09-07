"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  buildCommodityProductionChains,
  commodityRelationships,
  filterCommodityCatalog,
} from "@/world/domain/commodity-navigation";
import {
  commodityDefinitions,
  type Commodity,
} from "@/world/domain/commodities";
import type {
  MarketChartTimeframeId,
  MarketSnapshot,
} from "@/world/domain/market";
import {
  MarketChartControls,
  MarketPriceChart,
  type MarketChartType,
} from "./price-chart";

type BrowserMode = "all" | "chains";
type Position = Readonly<{ x: number; y: number }>;

const edge = 8;
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export function FloatingMarket({
  market,
  simulationTime,
  selectedCommodity,
  onSelectedCommodityChange,
  chartType,
  onChartTypeChange,
  timeframeId,
  onTimeframeChange,
  selectedPeriodStart,
  onSelectedPeriodStartChange,
  onExpand,
  onClose,
}: {
  market: MarketSnapshot;
  simulationTime: number;
  selectedCommodity: Commodity;
  onSelectedCommodityChange: (commodity: Commodity) => void;
  chartType: MarketChartType;
  onChartTypeChange: (chartType: MarketChartType) => void;
  timeframeId: MarketChartTimeframeId;
  onTimeframeChange: (timeframe: MarketChartTimeframeId) => void;
  selectedPeriodStart: number | null;
  onSelectedPeriodStartChange: (startTime: number) => void;
  onExpand: (trigger: HTMLElement) => void;
  onClose: () => void;
}) {
  const windowRef = useRef<HTMLElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<BrowserMode>("all");
  const [position, setPosition] = useState<Position | null>(null);
  const commodities = useMemo(
    () => market.listings.map((listing) => listing.commodity),
    [market.listings],
  );
  const listingByCommodity = useMemo(
    () => new Map(market.listings.map((listing) => [listing.commodity, listing])),
    [market.listings],
  );
  const filteredCommodities = useMemo(
    () => filterCommodityCatalog(commodities, query),
    [commodities, query],
  );
  const chains = useMemo(
    () => buildCommodityProductionChains(commodities),
    [commodities],
  );
  const selectedListing = listingByCommodity.get(selectedCommodity);
  const relationships = useMemo(
    () => commodityRelationships(selectedCommodity),
    [selectedCommodity],
  );

  useEffect(() => {
    const clampToViewport = () => {
      const element = windowRef.current;
      if (!element) return;
      setPosition((current) => {
        if (!current) return current;
        return {
          x: Math.max(
            edge,
            Math.min(current.x, window.innerWidth - element.offsetWidth - edge),
          ),
          y: Math.max(
            edge,
            Math.min(current.y, window.innerHeight - element.offsetHeight - edge),
          ),
        };
      });
    };
    window.addEventListener("resize", clampToViewport);
    return () => window.removeEventListener("resize", clampToViewport);
  }, []);

  const startDragging = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const element = windowRef.current;
    if (!element) return;
    const bounds = element.getBoundingClientRect();
    dragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - bounds.left,
      offsetY: event.clientY - bounds.top,
    };
    setPosition({ x: bounds.left, y: bounds.top });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const dragWindow = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    const element = windowRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !element) return;
    setPosition({
      x: Math.max(
        edge,
        Math.min(
          event.clientX - drag.offsetX,
          window.innerWidth - element.offsetWidth - edge,
        ),
      ),
      y: Math.max(
        edge,
        Math.min(
          event.clientY - drag.offsetY,
          window.innerHeight - element.offsetHeight - edge,
        ),
      ),
    });
  };

  const stopDragging = (event: ReactPointerEvent<HTMLElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const selectCommodity = (commodity: Commodity) => {
    onSelectedCommodityChange(commodity);
  };

  const row = (commodity: Commodity) => {
    const listing = listingByCommodity.get(commodity);
    if (!listing) return null;
    const selected = commodity === selectedCommodity;
    return (
      <button
        key={commodity}
        className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition ${selected ? "bg-sky-600/30 text-sky-100 ring-1 ring-sky-400/50" : "text-slate-300 hover:bg-white/10"}`}
        aria-pressed={selected}
        onClick={() => selectCommodity(commodity)}
      >
        <span className="truncate">{listing.name}</span>
        <span className="text-right font-mono text-[10px]">
          {money(listing.priceCents)}
          <span
            className={`ml-1 ${listing.trendPercent > 0 ? "text-emerald-300" : listing.trendPercent < 0 ? "text-rose-300" : "text-slate-500"}`}
          >
            {listing.trendPercent > 0 ? "+" : ""}
            {listing.trendPercent.toFixed(1)}%
          </span>
        </span>
      </button>
    );
  };

  if (!selectedListing) return null;
  const relatedGroups = [
    ["Made from", relationships.madeFrom],
    ["Used to make", relationships.usedToMake],
  ] as const;

  return (
    <section
      ref={windowRef}
      role="dialog"
      aria-modal="false"
      aria-labelledby="floating-market-title"
      className="fixed z-40 flex h-[min(34rem,calc(100vh-6rem))] w-[min(46rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border border-sky-300/30 bg-[#101e28]/98 text-slate-100 shadow-2xl"
      style={position ? { left: position.x, top: position.y } : { right: 16, top: 64 }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <header
        className="flex cursor-move touch-none items-center justify-between border-b border-white/10 bg-slate-900/80 px-3 py-2"
        onPointerDown={startDragging}
        onPointerMove={dragWindow}
        onPointerUp={stopDragging}
        onPointerCancel={stopDragging}
      >
        <div>
          <h2
            id="floating-market-title"
            className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-200"
          >
            Market Terminal
          </h2>
          <p className="text-[10px] text-slate-500">Drag to move</p>
        </div>
        <button
          className="cursor-pointer rounded-md border border-white/10 px-2 py-1 text-sm text-slate-300 hover:bg-white/10"
          aria-label="Close market terminal"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={onClose}
        >
          ✕
        </button>
      </header>

      <div className="grid min-h-0 flex-1 md:grid-cols-[15rem_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col border-b border-white/10 p-3 md:border-r md:border-b-0">
          <label className="sr-only" htmlFor="commodity-search">
            Search commodities
          </label>
          <input
            id="commodity-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search commodities..."
            className="w-full rounded-md border border-white/15 bg-slate-950/70 px-3 py-2 text-xs text-white placeholder:text-slate-500 focus-visible:outline-2 focus-visible:outline-sky-300"
          />
          <div
            className="mt-2 grid grid-cols-2 gap-1 rounded-md border border-white/10 p-1"
            role="group"
            aria-label="Commodity browser mode"
          >
            {(["all", "chains"] as const).map((option) => (
              <button
                key={option}
                className={`rounded px-2 py-1 text-[10px] ${mode === option ? "bg-sky-600 text-white" : "text-slate-400 hover:bg-white/10"}`}
                aria-pressed={mode === option}
                onClick={() => setMode(option)}
              >
                {option === "all" ? "All" : "Production Chains"}
              </button>
            ))}
          </div>
          <div
            className="mt-2 min-h-20 flex-1 space-y-1 overflow-y-auto overscroll-contain pr-1"
            aria-label="Commodity list"
          >
            {mode === "all"
              ? filteredCommodities.map(row)
              : chains.map((chain) => {
                  const visible = chain.commodities.filter((commodity) =>
                    filteredCommodities.includes(commodity),
                  );
                  if (visible.length === 0) return null;
                  return (
                    <section key={chain.id} className="pb-2">
                      <h3 className="px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-amber-200/80">
                        {chain.label}
                      </h3>
                      <div className="space-y-1">{visible.map(row)}</div>
                    </section>
                  );
                })}
            {filteredCommodities.length === 0 && (
              <p className="px-2 py-4 text-center text-xs text-slate-500">
                No matching commodities.
              </p>
            )}
          </div>
        </aside>

        <div className="min-h-0 overflow-y-auto overscroll-contain p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-[9px] uppercase tracking-[0.18em] text-slate-500">
                Novagrad local market
              </p>
              <h3 className="text-lg font-semibold">{selectedListing.name}</h3>
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-base">
                  {money(selectedListing.priceCents)}
                </span>
                <span
                  className={`text-xs ${selectedListing.trendPercent > 0 ? "text-emerald-300" : selectedListing.trendPercent < 0 ? "text-rose-300" : "text-slate-500"}`}
                >
                  {selectedListing.trendPercent > 0 ? "+" : ""}
                  {selectedListing.trendPercent.toFixed(1)}%
                </span>
              </div>
            </div>
            <button
              className="rounded-md border border-white/15 bg-white/5 px-3 py-1.5 text-xs hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-amber-200"
              onClick={(event) => onExpand(event.currentTarget)}
            >
              Expand
            </button>
          </div>

          <div className="mt-3">
            <MarketChartControls
              chartType={chartType}
              timeframeId={timeframeId}
              onChartTypeChange={onChartTypeChange}
              onTimeframeChange={onTimeframeChange}
            />
          </div>
          <div className="mt-3 rounded-lg border border-white/10 bg-slate-950/30 p-2">
            <MarketPriceChart
              history={selectedListing.history}
              chartType={chartType}
              timeframeId={timeframeId}
              currentTime={simulationTime}
              floating
              selectedPeriodStart={selectedPeriodStart}
              onSelectedPeriodStartChange={onSelectedPeriodStartChange}
            />
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2 rounded-lg border border-white/10 bg-black/10 p-2 text-center text-[10px]">
            {[
              ["Recent supply", selectedListing.recentSupply],
              ["Recent demand", selectedListing.recentDemand],
              ["Consumed", selectedListing.recentConsumption],
            ].map(([label, value]) => (
              <div key={label}>
                <p className="text-slate-500">{label}</p>
                <p className="mt-0.5 font-mono text-slate-200">{value}</p>
              </div>
            ))}
          </div>
          <div className="mt-2 rounded-lg bg-slate-950/40 p-2">
            <p className="text-[9px] uppercase tracking-wide text-slate-500">
              Price reasons
            </p>
            <ul className="mt-1 space-y-1 text-[10px] leading-4 text-slate-300">
              {selectedListing.priceReasons.map((reason) => (
                <li key={reason}>• {reason}</li>
              ))}
            </ul>
          </div>

          <div className="mt-3 space-y-2">
            {relatedGroups.map(([label, related]) =>
              related.length ? (
                <div key={label} className="flex flex-wrap items-center gap-1.5">
                  <span className="mr-1 text-[10px] uppercase tracking-wide text-slate-500">
                    {label}
                  </span>
                  {related
                    .filter((commodity) => listingByCommodity.has(commodity))
                    .map((commodity) => (
                      <button
                        key={commodity}
                        className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[10px] text-sky-200 hover:bg-sky-700/40"
                        onClick={() => selectCommodity(commodity)}
                      >
                        {commodityDefinitions[commodity].name}
                      </button>
                    ))}
                </div>
              ) : null,
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
