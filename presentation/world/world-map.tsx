"use client";

import { useEffect, useRef, useState } from "react";
import { buildingAt, buildingDefinitions } from "@/world/domain/settlement";
import { chunkOf, type SurfaceCell, type WorldSnapshot } from "@/world/domain/world";
import { toScreen, focusCell, panCamera, pickCell, zoomCamera, type Camera, type Viewport } from "./projection";
import { drawWorld } from "./render";

const button = "rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-slate-200 transition hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-amber-200 disabled:opacity-30";

export default function WorldMap({ world }: { world: WorldSnapshot }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [camera, setCamera] = useState<Camera>({ focus: world.settlement ? focusCell(world.settlement.anchor) : { x: world.size / 2, y: world.size / 2 }, zoom: world.settlement ? 2 : 1 });
  const [viewport, setViewport] = useState<Viewport>({ width: 1, height: 1 });
  const [selected, setSelected] = useState<SurfaceCell | null>(null);
  const [grid, setGrid] = useState(true);
  const drag = useRef<{ id: number; startX: number; startY: number; x: number; y: number; moved: boolean } | null>(null);

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
    return () => { observer.disconnect(); window.removeEventListener("resize", resize); };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(viewport.width * ratio);
    canvas.height = Math.round(viewport.height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    drawWorld(ctx, world, camera, viewport, selected, grid);
  }, [world, camera, viewport, selected, grid]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const bounds = canvas.getBoundingClientRect();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? bounds.height : 1);
      setCamera(current => zoomCamera(current, Math.exp(-Math.max(-200, Math.min(200, delta)) * 0.002), { x: event.clientX - bounds.left, y: event.clientY - bounds.top }, { width: bounds.width, height: bounds.height }, world.size));
    };
    canvas.addEventListener("wheel", wheel, { passive: false });
    return () => canvas.removeEventListener("wheel", wheel);
  }, [world.size]);

  const zoom = (factor: number) => setCamera(current => zoomCamera(current, factor, { x: viewport.width / 2, y: viewport.height / 2 }, viewport, world.size));
  const selectedBuilding = selected ? buildingAt(world, selected.x, selected.y) : undefined;
  const cityLabel = world.settlement ? toScreen({ ...world.settlement.anchor, z: world.settlement.anchor.z + 4 }, camera, viewport) : null;
  const chunk = selected ? chunkOf(selected, world.chunkSize) : null;

  return (
    <main className="flex h-dvh min-h-[520px] flex-col overflow-hidden bg-[#101f25] font-sans text-slate-100">
      <header className="z-10 flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-[#101d23] px-5 py-4 sm:px-7">
        <div className="flex items-center gap-3"><span className="flex size-9 items-center justify-center rounded-lg border border-amber-200/30 text-xl text-amber-200" aria-hidden="true">◇</span><div><h1 className="text-lg font-semibold tracking-tight">OpenWorld Economy</h1><p className="text-[10px] uppercase tracking-[0.22em] text-slate-400">Spatial prototype / Milestone 3</p></div></div>
        <span className="rounded-full border border-emerald-300/20 bg-emerald-300/5 px-3 py-1.5 text-xs text-emerald-200">World explorer</span>
      </header>
      <div className="relative flex min-h-0 flex-1 flex-col md:flex-row">
        <section className="relative min-h-[260px] flex-1 overflow-hidden" aria-label="Isometric world">
          <canvas ref={canvasRef} tabIndex={0} aria-label="Interactive isometric map. Drag or use WASD and arrow keys to pan. Scroll or use plus and minus to zoom. Enter selects the center tile. Escape clears selection."
            className="absolute inset-0 h-full w-full touch-none cursor-grab outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-200 active:cursor-grabbing"
            onPointerDown={event => {
              if (!event.isPrimary || event.button !== 0) return;
              event.currentTarget.focus();
              event.currentTarget.setPointerCapture(event.pointerId);
              drag.current = { id: event.pointerId, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, moved: false };
            }}
            onPointerMove={event => {
              const state = drag.current;
              if (!state || state.id !== event.pointerId) return;
              if (!state.moved && Math.hypot(event.clientX - state.startX, event.clientY - state.startY) < 5) return;
              state.moved = true;
              const delta = { x: event.clientX - state.x, y: event.clientY - state.y };
              state.x = event.clientX; state.y = event.clientY;
              setCamera(current => panCamera(current, delta, world.size));
            }}
            onPointerUp={event => {
              const state = drag.current;
              if (!state || state.id !== event.pointerId) return;
              if (!state.moved) {
                const bounds = event.currentTarget.getBoundingClientRect();
                setSelected(pickCell({ x: event.clientX - bounds.left, y: event.clientY - bounds.top }, camera, viewport, world));
              }
              drag.current = null;
              event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            onPointerCancel={() => { drag.current = null; }}
            onLostPointerCapture={() => { drag.current = null; }}
            onKeyDown={event => {
              const key = event.key.toLowerCase();
              if (event.ctrlKey || event.metaKey || event.altKey) return;
              const movement: Record<string, { x: number; y: number }> = { arrowup: { x: 0, y: 40 }, w: { x: 0, y: 40 }, arrowdown: { x: 0, y: -40 }, s: { x: 0, y: -40 }, arrowleft: { x: 40, y: 0 }, a: { x: 40, y: 0 }, arrowright: { x: -40, y: 0 }, d: { x: -40, y: 0 } };
              if (movement[key]) { event.preventDefault(); setCamera(current => panCamera(current, movement[key], world.size)); }
              if (["+", "=", "-", "enter", "escape"].includes(key)) {
                event.preventDefault();
                if (key === "enter") setSelected(pickCell({ x: viewport.width / 2, y: viewport.height / 2 }, camera, viewport, world));
                else if (key === "escape") setSelected(null);
                else zoom(key === "-" ? 1 / 1.2 : 1.2);
              }
            }}
          >Your browser needs Canvas support to display this map.</canvas>
          <div className="pointer-events-none absolute left-5 top-5 rounded-lg border border-white/10 bg-[#102128]/90 px-4 py-3 shadow-lg"><p className="text-[10px] uppercase tracking-[0.2em] text-amber-200">The first frontier</p><p className="mt-1 text-xs text-slate-300">{world.size} × {world.size} cells · Stepped terrain</p></div>
          {world.settlement && cityLabel && <button
            className="absolute -translate-x-1/2 -translate-y-full rounded-lg border border-amber-200/30 bg-[#102128]/95 px-4 py-2 text-left shadow-lg"
            style={{ left: cityLabel.x, top: cityLabel.y }}
            onClick={() => { const anchor = world.settlement!.anchor; setSelected(world.cells[anchor.y * world.size + anchor.x]); }}>
            <span className="block text-sm font-semibold text-amber-100">{world.settlement.name}</span>
            <span className="text-xs text-slate-300">{world.settlement.population} citizens · Founding camp</span>
          </button>}
          <span aria-hidden="true" className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-white/50">+</span>
          <div className="absolute bottom-5 left-5 flex items-center gap-2 rounded-xl border border-white/10 bg-[#102128]/95 p-2 shadow-xl">
            <button className={button} aria-label="Zoom out" disabled={camera.zoom <= 0.25} onClick={() => zoom(1 / 1.2)}>−</button>
            <span className="w-12 text-center font-mono text-xs">{Math.round(camera.zoom * 100)}%</span>
            <button className={button} aria-label="Zoom in" disabled={camera.zoom >= 3} onClick={() => zoom(1.2)}>+</button>
            <button className={button} onClick={() => setCamera({ focus: world.settlement ? focusCell(world.settlement.anchor) : { x: world.size / 2, y: world.size / 2 }, zoom: world.settlement ? 2 : 1 })}>Reset view</button>
          </div>
        </section>
        <aside className="z-10 w-full shrink-0 overflow-y-auto border-t border-white/10 bg-[#13242b] p-5 md:w-72 md:border-l md:border-t-0 lg:w-80">
          {world.settlement && <section className="mb-6 border-b border-white/10 pb-5" aria-label="Settlement overview">
            <p className="text-[10px] uppercase tracking-[0.2em] text-amber-200">Starting settlement</p>
            <h2 className="mt-2 text-xl font-semibold">{world.settlement.name}</h2>
            <p className="mt-2 text-sm text-slate-300">Population: {world.settlement.population} citizens</p>
            <p className="mt-1 text-xs text-slate-400">{world.buildings?.filter(building => building.type === "camp").length} camp · {world.buildings?.filter(building => building.type === "house").length} houses · {world.buildings?.filter(building => building.type === "warehouse").length} warehouse</p>
            <button className={`${button} mt-3 w-full`} onClick={() => setCamera(current => ({ ...current, focus: focusCell(world.settlement!.anchor), zoom: 2 }))}>Go to settlement</button>
          </section>}
          <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400">Selected location</p>
          <h2 className="mt-2 text-xl font-medium">{selectedBuilding ? buildingDefinitions[selectedBuilding.type].name : selected ? (selected.terrain === "water" ? "Water" : selected.terrain === "mountain" ? "Mountain" : selected.z > 1 ? "Hillside" : "Grassland") : "Explore the world"}</h2>
          {selectedBuilding && <p className="mt-2 text-xs leading-5 text-slate-400">{buildingDefinitions[selectedBuilding.type].purpose} Footprint: {buildingDefinitions[selectedBuilding.type].width} × {buildingDefinitions[selectedBuilding.type].depth}. Settlement: {world.settlement?.name}.</p>}
          <div className="mt-5" aria-live="polite" aria-atomic="true">
            {selected ? <><div className="grid grid-cols-3 gap-2">{(["x", "y", "z"] as const).map(axis => <div key={axis} className="rounded-lg border border-white/10 bg-black/10 p-3"><p className="text-xs uppercase text-slate-400">{axis}</p><p className="mt-1 font-mono text-xl text-amber-100">{selected[axis]}</p></div>)}</div><p className="mt-4 text-xs text-slate-400">Chunk {chunk?.x}, {chunk?.y} · Surface elevation {selected.z}</p></> : <p className="text-sm leading-6 text-slate-400">Select a diamond to inspect its world coordinates. Follow the river, find the coastline, or explore the stepped hills and mountains.</p>}
          </div>
          <button className={`${button} mt-5 w-full`} disabled={!selected} onClick={() => { if (selected) setCamera(current => ({ ...current, focus: focusCell(selected) })); }}>Focus selected tile</button>
          <div className="mt-7 border-t border-white/10 pt-5"><h3 className="text-xs font-medium text-slate-300">Map layers</h3><label className="mt-4 flex cursor-pointer items-center justify-between text-sm text-slate-400">Tile grid<input type="checkbox" checked={grid} onChange={event => setGrid(event.target.checked)} className="size-4 accent-amber-200" /></label><div className="mt-4 flex flex-wrap gap-4 text-xs text-slate-400"><span><span className="mr-2 inline-block size-2.5 rounded-sm bg-[#718e6c]" />Grassland</span><span><span className="mr-2 inline-block size-2.5 rounded-sm bg-[#2c7187]" />Water</span><span><span className="mr-2 inline-block size-2.5 rounded-sm bg-[#92988f]" />Mountain</span></div></div>
          <div className="mt-7 border-t border-white/10 pt-5 text-xs leading-6 text-slate-400"><h3 className="mb-2 font-medium text-slate-300">Navigation</h3><p>Drag to pan · Scroll to zoom</p><p>WASD / arrows to pan when map is focused</p><p>Enter to inspect the center · Esc to clear</p></div>
          <p className="mt-7 text-[11px] leading-5 text-slate-500">The founding settlement is read-only. Construction, inventory, and population simulation arrive in later milestones.</p>
        </aside>
      </div>
      <footer className="flex flex-wrap justify-between gap-2 border-t border-white/10 bg-[#101d23] px-5 py-2.5 font-mono text-[10px] text-slate-400"><span>SEED / {world.seed}</span><span>{world.cells.length.toLocaleString("en-US")} CELLS · {world.chunkSize} × {world.chunkSize}-CELL CHUNKS</span><span>2:1 ISOMETRIC / CANVAS</span></footer>
    </main>
  );
}
