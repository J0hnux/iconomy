# OpenWorld Economy

A desktop-first browser economy game built with Next.js 16, React 19, TypeScript, and Tailwind CSS 4.

## Milestone 0: spatial foundation

- Deterministic 128 × 128 map with grassland, a river, and a coast (`prototype-001` seed).
- Logical x/y/z coordinates; all terrain is at z = 0 for this milestone.
- Native Canvas 2:1 isometric rendering with high-DPI support and offscreen tile draw rejection.
- Drag, WASD, or arrow-key camera panning; pointer-anchored wheel zoom and zoom buttons (25–300%).
- Click a tile for selection outline, terrain, x/y/z, and its logical 32 × 32-cell chunk address.
- Reset camera, focus selected tile, and toggle the grid.
- Keyboard map controls: Enter inspects the center, Escape clears selection, +/- zooms. Focus the map first.
- Responsive HTML/Tailwind inspector and controls. No rendering dependencies or additional global style rules; system font stacks allow offline builds.

## Run and verify

```bash
npm install
npm run dev
npm run lint
npm test
npm run build
```

Open http://localhost:3000. Drag the map, zoom at a river tile, select it, and verify selection remains attached when panning, zooming, or resizing. Dragging must not select a new tile. Click outside the world to clear selection. Check keyboard controls and focus-selected behavior.

## Architecture and scope

`world/domain/world.ts` generates a serializable, read-only semantic snapshot on the server page. Logical cells never contain screen positions or renderer objects. Chunks are currently derived addresses, not streamed storage.

`presentation/world/projection.ts` owns coordinate transforms, bounded camera operations, and flat tile picking. `render.ts` maps semantic terrain to primitive Canvas diamonds. `world-map.tsx` owns presentation-only camera, selection, and UI state. Rendering runs when those inputs change rather than in a perpetual simulation loop.

The world can later feed another renderer without changing its coordinates. Elevated terrain and elevated polygon picking belong to Milestone 1. This milestone does not implement economic mutations, persistence, multiplayer, or authentication; future authentication must use NextAuth and future economic commands must be validated by the server. No browser state here represents authoritative money, production, or ownership.

The blueprint and reference image describe the long-term destination, not the current art target.
