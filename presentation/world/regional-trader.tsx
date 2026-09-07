"use client";

import { useMemo, useState } from "react";
import { commodityDefinitions, commodityIds } from "@/world/domain/commodities";
import { productionRecipes, type Commodity, type ProductionSnapshot } from "@/world/domain/production";
import { quoteRegionalTransport } from "@/world/domain/regional-logistics";
import type { GameCommand } from "@/world/simulation/game-simulation";

const control =
  "w-full rounded-lg border border-white/15 bg-slate-900 px-2 py-2 text-xs text-slate-100 outline-none focus-visible:ring-2 focus-visible:ring-cyan-300";
const money = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const duration = (milliseconds: number) => {
  const seconds = Math.ceil(milliseconds / 1_000);
  return seconds < 60 ? `${seconds}s` : `${Math.ceil(seconds / 60)}m`;
};

export function RegionalTrader({
  snapshot,
  revision,
  busy,
  message,
  onCreate,
  onShiftProduction,
}: {
  snapshot: ProductionSnapshot;
  revision: number;
  busy: boolean;
  message: string | null;
  onCreate: (command: Extract<GameCommand, { type: "create_regional_shipment" }>) => void;
  onShiftProduction: (commodity: Commodity) => void;
}) {
  const locations = snapshot.regionalLogistics.locations;
  const [originId, setOriginId] = useState(
    locations.find((location) => location.kind === "npc_city")?.id ?? "novagrad",
  );
  const [destinationId, setDestinationId] = useState("novagrad");
  const [commodity, setCommodity] = useState<Commodity>("food");
  const [quantityText, setQuantityText] = useState("1");
  const origin = locations.find((location) => location.id === originId) ?? locations[0];
  const destination =
    locations.find((location) => location.id === destinationId) ?? locations[1];
  const quantity = /^\d+$/.test(quantityText) ? Number(quantityText) : 0;
  const quote = useMemo(() => {
    if (!origin || !destination || origin.id === destination.id || quantity <= 0)
      return null;
    try {
      return quoteRegionalTransport(origin, destination, quantity);
    } catch {
      return null;
    }
  }, [origin, destination, quantity]);
  const originPrice = origin?.localPrices[commodity] ?? 0;
  const destinationPrice = destination?.localPrices[commodity] ?? 0;
  const purchaseCost = originPrice * quantity;
  const destinationValue = destinationPrice * quantity;
  const estimatedProfit = quote
    ? destinationValue - purchaseCost - quote.transportCostCents
    : 0;
  const upfrontCost = quote
    ? quote.transportCostCents + (origin?.kind === "npc_city" ? purchaseCost : 0)
    : 0;
  const impossibleReason = !origin || !destination
    ? "Route locations are unavailable."
    : origin.id === destination.id
      ? "Choose different origin and destination regions."
      : quantity <= 0
        ? "Enter a positive whole quantity."
        : quantity > origin.inventory[commodity]
          ? `${origin.name} has only ${origin.inventory[commodity]} units.`
          : !quote
            ? "Quantity exceeds route capacity."
            : upfrontCost > snapshot.market.cashCents
              ? `Needs ${money(upfrontCost)} up front.`
              : null;
  const playerShipments = snapshot.regionalLogistics.shipments
    .filter((shipment) => shipment.owner === "player")
    .slice(-8)
    .reverse();
  const localRecipes = Object.values(productionRecipes).filter(
    (recipe) => (recipe.outputs[commodity] ?? 0) > 0,
  );

  return (
    <section className="mb-6 border-b border-white/10 pb-5" aria-label="Regional trader">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-cyan-200">Regional trade</p>
          <h2 className="mt-1 text-xl font-semibold">Route Exchange</h2>
        </div>
        <div className="text-right text-[10px] text-slate-500">
          Cash
          <strong className="block font-mono text-sm font-normal text-emerald-200">
            {money(snapshot.market.cashCents)}
          </strong>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <label className="text-[10px] uppercase tracking-wide text-slate-400">
          From
          <select className={`${control} mt-1`} value={origin.id} onChange={(event) => setOriginId(event.target.value)}>
            {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
          </select>
        </label>
        <label className="text-[10px] uppercase tracking-wide text-slate-400">
          To
          <select className={`${control} mt-1`} value={destination.id} onChange={(event) => setDestinationId(event.target.value)}>
            {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
          </select>
        </label>
        <label className="text-[10px] uppercase tracking-wide text-slate-400">
          Commodity
          <select className={`${control} mt-1`} value={commodity} onChange={(event) => setCommodity(event.target.value as Commodity)}>
            {commodityIds.map((id) => <option key={id} value={id}>{commodityDefinitions[id].name}</option>)}
          </select>
        </label>
        <label className="text-[10px] uppercase tracking-wide text-slate-400">
          Quantity
          <input className={`${control} mt-1 font-mono`} type="number" min={1} step={1} value={quantityText} onChange={(event) => setQuantityText(event.target.value)} />
        </label>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-2 rounded-xl border border-white/10 bg-black/15 p-3 text-[10px]">
        {[
          [origin.kind === "novagrad" ? "Owned stock" : "Origin inventory", origin.inventory[commodity]],
          ["Origin price", money(originPrice)],
          [origin.kind === "novagrad" ? "Cargo value" : "Purchase cost", money(purchaseCost)],
          ["Transport", quote ? money(quote.transportCostCents) : "—"],
          ["Current destination value", money(destinationValue)],
          ["Travel time", quote ? duration(quote.travelTimeMs) : "—"],
          ["Upfront cash", money(upfrontCost)],
          ["Estimated profit", money(estimatedProfit)],
        ].map(([label, value]) => (
          <div key={label as string}>
            <dt className="text-slate-500">{label}</dt>
            <dd className={`mt-0.5 font-mono ${label === "Estimated profit" ? (estimatedProfit < 0 ? "text-rose-300" : "text-emerald-200") : "text-slate-100"}`}>{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-[10px] leading-4 text-slate-400">
        Destination prices remain live during transit. The realized result can differ from this estimate.
      </p>
      {impossibleReason && <p className="mt-2 text-[10px] text-amber-200">{impossibleReason}</p>}
      <button
        className="mt-3 w-full rounded-lg border border-cyan-300/30 bg-cyan-400/10 px-3 py-2 text-xs font-semibold text-cyan-100 hover:bg-cyan-400/20 disabled:opacity-30"
        disabled={busy || Boolean(impossibleReason)}
        onClick={() => onCreate({
          type: "create_regional_shipment",
          expectedRevision: revision,
          originId: origin.id,
          destinationId: destination.id,
          commodity,
          quantity,
          expectedOriginPriceCents: originPrice,
          expectedDestinationPriceCents: destinationPrice,
        })}
      >
        Create shipment
      </button>
      {message && <p className="mt-2 text-xs text-amber-100" aria-live="polite">{message}</p>}

      <div className="mt-5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold text-slate-200">Regional price comparison</h3>
          <span className="text-[9px] uppercase tracking-wide text-slate-500">current quotes</span>
        </div>
        <div className="mt-2 max-h-44 overflow-y-auto rounded-lg border border-white/10">
          <table className="w-full text-left text-[10px]">
            <thead className="sticky top-0 bg-[#142630] text-slate-400"><tr><th className="px-2 py-1.5">Region</th><th>Price</th><th>Stock</th></tr></thead>
            <tbody>
              {[...locations].sort((a, b) => a.localPrices[commodity] - b.localPrices[commodity]).map((location) => (
                <tr key={location.id} className="border-t border-white/5">
                  <td className="px-2 py-1.5 text-slate-200">{location.name}</td>
                  <td className="font-mono">{money(location.localPrices[commodity])}</td>
                  <td className="font-mono text-slate-400">{location.inventory[commodity]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-amber-200/15 bg-amber-200/5 p-3">
        <p className="text-[10px] uppercase tracking-wide text-amber-200">Import or self-produce</p>
        <p className="mt-1 text-[11px] leading-4 text-slate-300">
          {localRecipes.length ? `Local option: ${localRecipes.map((recipe) => recipe.name).join(" or ")}.` : "No local recipe is currently available."} Compare its labor and inputs with the selected route.
        </p>
        {localRecipes.length > 0 && <button className="mt-2 rounded border border-white/15 px-2 py-1 text-[10px] hover:bg-white/10" onClick={() => onShiftProduction(commodity)}>Inspect local production</button>}
      </div>

      <div className="mt-5">
        <h3 className="text-xs font-semibold text-slate-200">Your shipments</h3>
        <div className="mt-2 space-y-2">
          {playerShipments.map((shipment) => (
            <article key={shipment.id} className="rounded-lg border border-white/10 bg-black/15 p-2 text-[10px]">
              <div className="flex justify-between gap-2"><strong className="text-slate-200">{shipment.quantity} {commodityDefinitions[shipment.commodity].name}</strong><span className={shipment.status === "arrived" ? "text-emerald-200" : "text-cyan-200"}>{shipment.status.replaceAll("_", " ")}</span></div>
              <p className="mt-1 text-slate-400">{shipment.origin.cityName} → {shipment.destination.cityName}</p>
              <p className="mt-1 text-slate-300">Estimated {money(shipment.estimatedProfitCents)}{shipment.status === "arrived" ? ` · Actual ${money(shipment.actualProfitCents ?? 0)}` : ` · arrives in ${duration(Math.max(0, shipment.arrivalTime - snapshot.simulationTime))}`}</p>
              {shipment.status === "arrived" && <p className="mt-1 text-slate-500">Destination quote moved from {money(shipment.estimatedDestinationUnitPriceCents)} to {money(shipment.actualDestinationUnitPriceCents ?? shipment.estimatedDestinationUnitPriceCents)} per unit.</p>}
            </article>
          ))}
          {playerShipments.length === 0 && <p className="text-[10px] text-slate-500">No player shipments yet.</p>}
        </div>
      </div>
    </section>
  );
}
