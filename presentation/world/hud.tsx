"use client";

import { useEffect, useRef, useState } from "react";
import type { ProductionSnapshot } from "@/world/domain/production";
import type { WorldSnapshot, SurfaceCell } from "@/world/domain/world";
import { screenToWorld, type Camera, type Viewport } from "./projection";

const panel =
  "rounded-lg border border-slate-600/60 bg-[#101e28]/95 p-3 shadow-lg";
const action =
  "rounded-md border border-white/10 bg-slate-700/40 px-3 py-2 text-xs text-slate-200 hover:bg-sky-800/50 focus-visible:outline-2 focus-visible:outline-sky-300 disabled:opacity-40";
const currency = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

export function PlayerHud({
  world,
  snapshot,
  onCompany,
}: {
  world: WorldSnapshot;
  snapshot: ProductionSnapshot | null;
  onCompany: () => void;
}) {
  const goodsValue =
    snapshot?.market.listings.reduce((total, listing) => {
      const local = snapshot.sites
        .filter((site) => site.output === listing.commodity)
        .reduce((sum, site) => sum + site.stored, 0);
      const moving = snapshot.logistics.shipments
        .filter(
          (shipment) =>
            shipment.status === "in_transit" &&
            shipment.cargo.commodity === listing.commodity,
        )
        .reduce((sum, shipment) => sum + shipment.cargo.quantity, 0);
      return total + (listing.available + local + moving) * listing.priceCents;
    }, 0) ?? 0;
  return (
    <aside
      aria-label="Player and resources"
      className="z-10 grid shrink-0 gap-3 overflow-y-auto p-2 md:block md:w-52 md:space-y-3 lg:w-56"
    >
      <section className={panel} aria-label="Player summary">
        <div className="mb-3 flex items-center gap-3 border-b border-white/10 pb-3">
          <span
            className="flex size-10 items-center justify-center rounded bg-sky-800 text-xl"
            aria-hidden="true"
          >
            ◇
          </span>
          <div>
            <h2 className="text-sm font-semibold">Founding player</h2>
            <p className="text-[10px] text-slate-400">Local prototype</p>
          </div>
        </div>
        <dl className="space-y-2 text-xs">
          {[
            [
              "Cash",
              snapshot ? currency(snapshot.market.cashCents) : "Connecting…",
            ],
            [
              "Net worth*",
              snapshot ? currency(snapshot.market.cashCents + goodsValue) : "—",
            ],
            ["Company", "Novagrad enterprise"],
            ["City", world.settlement?.name ?? "Unsettled"],
            [
              "Population",
              snapshot?.population.totalPopulation ??
                world.settlement?.population ??
                0,
            ],
            ["Workforce", snapshot?.labor.totalWorkforce ?? "—"],
            ["Assigned", snapshot?.labor.assignedWorkers ?? "—"],
            ["Available", snapshot?.labor.unassignedWorkers ?? "—"],
            ["Labor shortages", snapshot?.labor.shortageBuildings ?? "—"],
            ["Housing capacity", snapshot?.population.housingCapacity ?? "—"],
            ["Food supply", snapshot?.population.foodSupply ?? "—"],
          ].map(([label, value]) => (
            <div key={label} className="flex justify-between gap-2">
              <dt className="text-slate-400">{label}</dt>
              <dd className="text-right">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-[10px] leading-4 text-slate-500">
          *Cash + goods at current quotes. Buildings and land excluded.
        </p>
        <button className={`${action} mt-3 w-full`} onClick={onCompany}>
          Manage company
        </button>
      </section>
      <section className={panel} aria-label="Owned local resources">
        <h2 className="text-sm font-semibold">Resources · Warehouse</h2>
        <p className="mt-1 text-[10px] text-slate-400">
          Owned goods, ready to sell
        </p>
        <dl className="mt-3 space-y-3 text-xs">
          {snapshot ? (
            snapshot.market.listings.map((listing) => (
              <div key={listing.commodity} className="flex justify-between">
                <dt>{listing.name}</dt>
                <dd className="font-mono">{listing.available}</dd>
              </div>
            ))
          ) : (
            <p className="text-slate-400">Loading inventory…</p>
          )}
        </dl>
        <p className="mt-3 border-t border-white/10 pt-2 text-[10px] text-slate-500">
          Deposits on the map are natural reserves.
        </p>
      </section>
    </aside>
  );
}

export function WorldMinimap({
  world,
  camera,
  viewport,
  selected,
  onNavigate,
}: {
  world: WorldSnapshot;
  camera: Camera;
  viewport: Viewport;
  selected: SurfaceCell | null;
  onNavigate: (cell: SurfaceCell) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    const colors = {
      grassland: "#668568",
      water: "#286b88",
      mountain: "#949b90",
      forest_ground: "#285536",
      farmland: "#b3a352",
    };
    for (const cell of world.cells) {
      ctx.fillStyle = colors[cell.terrain];
      ctx.fillRect(cell.x, cell.y, 1, 1);
    }
  }, [world]);
  const corners = [
    { x: 0, y: 0 },
    { x: viewport.width, y: 0 },
    { x: viewport.width, y: viewport.height },
    { x: 0, y: viewport.height },
  ].map((point) => screenToWorld(point, camera, viewport));
  return (
    <section
      className="mb-3 border-b border-white/10 pb-3"
      aria-label="World minimap"
    >
      <div className="mb-2 flex justify-between">
        <h2 className="text-sm font-semibold">World Map</h2>
        <span className="text-[10px] text-slate-400">Click to travel</span>
      </div>
      <div className="relative mx-auto aspect-square w-full max-w-44 overflow-hidden rounded border border-white/10 bg-sky-950">
        <canvas
          ref={canvas}
          width={world.size}
          height={world.size}
          className="absolute inset-0 h-full w-full [image-rendering:pixelated]"
          aria-hidden="true"
        />
        <svg
          viewBox={`0 0 ${world.size} ${world.size}`}
          className="relative h-full w-full cursor-crosshair"
          role="button"
          tabIndex={0}
          aria-label="Navigate world minimap. Click to focus a location; Enter returns to settlement."
          onClick={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            const x = Math.max(
              0,
              Math.min(
                world.size - 1,
                Math.floor(
                  ((event.clientX - bounds.left) / bounds.width) * world.size,
                ),
              ),
            );
            const y = Math.max(
              0,
              Math.min(
                world.size - 1,
                Math.floor(
                  ((event.clientY - bounds.top) / bounds.height) * world.size,
                ),
              ),
            );
            onNavigate(world.cells[y * world.size + x]);
          }}
          onKeyDown={(event) => {
            if (
              (event.key === "Enter" || event.key === " ") &&
              world.settlement
            ) {
              event.preventDefault();
              const anchor = world.settlement.anchor;
              onNavigate(world.cells[anchor.y * world.size + anchor.x]);
            }
          }}
        >
          <polygon
            points={corners.map((point) => `${point.x},${point.y}`).join(" ")}
            fill="#ffffff15"
            stroke="#e0f2fe"
            strokeWidth="1"
          />
          {world.settlement && (
            <circle
              cx={world.settlement.anchor.x + 0.5}
              cy={world.settlement.anchor.y + 0.5}
              r="2.5"
              fill="#fbbf24"
            >
              <title>Your settlement</title>
            </circle>
          )}
          {selected && (
            <circle
              cx={selected.x + 0.5}
              cy={selected.y + 0.5}
              r="2"
              fill="#38bdf8"
            >
              <title>Selected location</title>
            </circle>
          )}
        </svg>
      </div>
      <p className="mt-2 text-[10px] text-slate-400">
        Gold: your settlement · Blue: selection · Outline: view at ground level
      </p>
    </section>
  );
}

export function BottomHud({
  snapshot,
  scene,
  onBuild,
  onMarket,
  onMarketTerminal,
  onCompany,
  onWarehouse,
  onHome,
}: {
  snapshot: ProductionSnapshot | null;
  scene: {
    chunks: number;
    totalChunks: number;
    tiles: number;
    buildings: number;
  };
  onBuild: () => void;
  onMarket: () => void;
  onMarketTerminal: () => void;
  onCompany: () => void;
  onWarehouse: () => void;
  onHome: () => void;
}) {
  const [tab, setTab] = useState<"all" | "market" | "logistics">("all");
  const events =
    snapshot?.market.events.filter(
      (event) => tab === "all" || event.category === tab,
    ) ?? [];
  return (
    <div className="z-20 grid shrink-0 gap-2 bg-[#101f25] p-2 md:h-48 md:grid-cols-[13rem_minmax(0,1fr)_18rem] lg:grid-cols-[14rem_minmax(0,1fr)_20rem]">
      <section
        className={`${panel} overflow-y-auto`}
        aria-label="Local economy"
      >
        <h2 className="mb-3 text-sm font-semibold">Novagrad Economy</h2>
        <dl className="space-y-2 text-xs">
          {[
            ["Population", snapshot?.population.totalPopulation ?? "—"],
            ["Workforce", snapshot?.labor.totalWorkforce ?? "—"],
            ["Assigned", snapshot?.labor.assignedWorkers ?? "—"],
            ["Available", snapshot?.labor.unassignedWorkers ?? "—"],
            ["Labor shortages", snapshot?.labor.shortageBuildings ?? "—"],
            ["Housing capacity", snapshot?.population.housingCapacity ?? "—"],
            ["Food supply", snapshot?.population.foodSupply ?? "—"],
            [
              "Producing sites",
              snapshot
                ? `${snapshot.sites.filter((site) => site.status === "running" || site.status === "worker_shortage").length} / ${snapshot.sites.length}`
                : "—",
            ],
            [
              "Shortages",
              snapshot?.market.listings.filter(
                (listing) => listing.shortage !== "none",
              ).length ?? "—",
            ],
            [
              "Goods in transit",
              snapshot?.logistics.shipments
                .filter((shipment) => shipment.status === "in_transit")
                .reduce((sum, shipment) => sum + shipment.cargo.quantity, 0) ??
                "—",
            ],
            [
              "Visible scene",
              `${scene.chunks}/${scene.totalChunks} chunks · ${scene.tiles.toLocaleString("en-US")} tiles · ${scene.buildings} buildings`,
            ],
          ].map(([label, value]) => (
            <div key={label} className="flex justify-between">
              <dt className="text-slate-400">{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section
        className={`${panel} flex min-h-40 min-w-0 flex-col md:min-h-0`}
        aria-label="Economy event log"
      >
        <div className="mb-2 flex gap-1 border-b border-white/10 pb-2">
          {(
            [
              ["all", "Event Log"],
              ["market", "Market News"],
              ["logistics", "Deliveries"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              aria-pressed={tab === id}
              onClick={() => setTab(id)}
              className={`rounded px-3 py-1 text-xs ${tab === id ? "bg-sky-700 text-white" : "text-slate-400 hover:bg-white/10"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <ol className="min-h-0 space-y-2 overflow-y-auto text-xs">
          {events.map((event) => (
            <li key={event.id} className="flex gap-3">
              <time className="shrink-0 font-mono text-slate-500">
                {new Date(event.time).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </time>
              <span
                className={
                  event.category === "market"
                    ? "text-amber-100"
                    : "text-slate-300"
                }
              >
                {event.message}
              </span>
            </li>
          ))}
        </ol>
        {events.length === 0 && (
          <p className="text-xs text-slate-500">No events yet.</p>
        )}
      </section>
      <section className={panel} aria-label="Quick actions">
        <h2 className="mb-3 text-sm font-semibold">Actions</h2>
        <div className="grid grid-cols-3 gap-2">
          {[
            ["Build", onBuild],
            ["Trade", onMarket],
            ["Market", onMarketTerminal],
            ["Company", onCompany],
            ["Warehouse", onWarehouse],
            ["Home", onHome],
          ].map(([label, handler]) => (
            <button
              key={label as string}
              className={`${action} min-h-10 px-1`}
              onClick={handler as () => void}
            >
              {label as string}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
