# OpenWorld Economy

A desktop-first browser economy game built with Next.js 16, React 19, TypeScript, and Tailwind CSS 4.

## Milestone 0: spatial foundation

- Deterministic 128 × 128 map with grassland, a river, and a coast (`prototype-001` seed).
- Logical x/y/z coordinates, initially introduced with flat terrain in Milestone 0.
- Native Canvas 2:1 isometric rendering with high-DPI support and offscreen tile draw rejection.
- Drag, WASD, or arrow-key camera panning; pointer-anchored wheel zoom and zoom buttons (25–300%).
- Click a tile for selection outline, terrain, x/y/z, and its logical 32 × 32-cell chunk address.
- Reset camera, focus selected tile, and toggle the grid.
- Keyboard map controls: Enter inspects the center, Escape clears selection, +/- zooms. Focus the map first.
- Responsive HTML/Tailwind inspector and controls. No rendering dependencies or additional global style rules; system font stacks allow offline builds.

## Milestone 1: voxel-like surface elevation

- Seeded integer-height hills and two mountain regions; water remains at sea level (z = 0).
- Stepped river banks and coastlines with exposed left/right cliff faces and simple face shading.
- Mountain terrain has a distinct stone-colored surface; no resource deposits are implemented yet.
- Shared face geometry and painter order for rendering and picking. Clicking a cliff selects its owning surface tile, and nearer terrain hides selection outlines behind it.
- Focus selected tile centers its elevated surface. Pan, pointer-anchored zoom, keyboard controls, and the grid toggle remain available.
- Seven automated tests cover deterministic generation, projection, flat-map compatibility, elevated top/side picking, occlusion, hidden internal faces, zoom, panning, and elevated camera focus.

The world remains a surface height field, not a collection of individual voxels. No economy, construction, resources, or 3D dependencies were added.

## Milestone 3: starting settlement

- Novagrad starts with 10 citizens, one 2×2 Settler Camp, four 1×1 houses, and a 2×2 warehouse.
- Deterministic placement finds a naturally flat, dry 9×9 site near the world center, without changing terrain. Worlds without a suitable site omit the settlement.
- Logical footprints, building types, quarter-turn orientation, settlement identity, and population live in the domain snapshot. Population is initial scenario data, not a running simulation.
- Connected road cells form a junction with building access. Road strips derive connections from adjacent road cells.
- Primitive shaded buildings use separate presentation definitions. Building roof and wall picking share geometry and draw order with rendering.
- A world-anchored Novagrad label selects the camp. The settlement overview shows population and building counts, with a Go to settlement control; the initial camera and reset view focus the settlement.
- The inspector identifies buildings and shows their purpose, footprint, settlement, and origin coordinates.
- Milestone 2 resources and farmland remain deferred. Construction, inventory, production, and population growth are not implemented.

`world/domain/settlement.ts` owns starting settlement generation and building definitions. `presentation/world/buildings.ts` owns primitive building appearance. The server page composes terrain and settlement into one serializable snapshot.

Ten automated tests include footprint validity, unchanged terrain, road connectivity, deterministic settlement placement, safe handling of unavailable sites, and roof/wall picking across zoom levels. Browser checks cover warehouse inspection, panning, and zooming with a selected building.

## Run and verify

```bash
npm install
npm run dev
npm run lint
npm test
npm run build
```

Open http://localhost:3000. Drag the map, zoom at a river tile, select it, and verify selection remains attached when panning, zooming, or resizing. Dragging must not select a new tile. Click outside the world to clear selection. Check keyboard controls and focus-selected behavior. Select a mountain tile and confirm z is greater than zero; click an exposed cliff and verify its owning tile is selected. Focus the tile and confirm its elevated surface is centered, then pan/zoom and verify the selection stays attached.

## Architecture and scope

`world/domain/world.ts` generates a serializable, read-only semantic snapshot on the server page. Logical cells never contain screen positions or renderer objects. Chunks are currently derived addresses, not streamed storage.

`presentation/world/projection.ts` owns coordinate transforms, bounded camera operations, and elevated terrain face picking. `render.ts` maps semantic terrain to shaded Canvas top and cliff polygons. `world-map.tsx` owns presentation-only camera, selection, and UI state. Rendering runs when those inputs change rather than in a perpetual simulation loop.

The world can later feed another renderer without changing its coordinates. Elevation is stored in domain coordinates; face geometry and depth ordering remain presentation responsibilities. Picking scans cells in reverse painter order with a bounds check; chunk-level acceleration is deferred until profiling justifies it. This milestone does not implement economic mutations, persistence, multiplayer, or authentication; future authentication must use NextAuth and future economic commands must be validated by the server. No browser state here represents authoritative money, production, or ownership.

The blueprint and reference image describe the long-term destination, not the current art target.
