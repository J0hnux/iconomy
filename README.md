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

## Milestone 2: terrain and resources

- Two forest regions, Northwood and Eastwood, are semantic forest resource nodes rendered with procedurally scattered tree primitives.
- Stone Ridge and Iron Heights occupy mountain terrain and use distinct light stone and dark iron markers.
- Two farmland belts use dedicated terrain semantics and visible crop rows. Milestone 5 places the first food producer on this land.
- Resource nodes own their type, anchor, region size, and estimated reserve. Decorative marker counts do not determine economic quantities.
- The central settlement reserve remains ordinary grassland, so Novagrad placement is deterministic and existing construction stays valid.
- The Economic Geography panel focuses each deposit or farmland. World labels and the selected-location inspector expose resource type, estimated reserve, cell count, coordinates, and elevation.
- Forest, farmland, and mountain cells are excluded from the current generic construction rules.

The renderer maps semantic terrain and resource IDs to primitives. Trees and ore shapes are presentation details and never become authoritative entities.

## Milestone 3: starting settlement

- Novagrad starts with 10 citizens, one 2×2 Settler Camp, four 1×1 houses, and a 2×2 warehouse.
- Deterministic placement finds a naturally flat, dry 9×9 site near the world center, without changing terrain. Worlds without a suitable site omit the settlement.
- Logical footprints, building types, quarter-turn orientation, settlement identity, and population live in the domain snapshot. Population is initial scenario data, not a running simulation.
- Connected road cells form a junction with building access. Road strips derive connections from adjacent road cells.
- Primitive shaded buildings use separate presentation definitions. Building roof and wall picking share geometry and draw order with rendering.
- A world-anchored Novagrad label selects the camp. The settlement overview shows population and building counts, with a Go to settlement control; the initial camera and reset view focus the settlement.
- The inspector identifies buildings and shows their purpose, footprint, settlement, and origin coordinates.
- Construction, inventory, production, and population growth are not implemented in this settlement milestone.

`world/domain/settlement.ts` owns starting settlement generation and building definitions. `presentation/world/buildings.ts` owns primitive building appearance. The server page composes terrain and settlement into one serializable snapshot.

The automated tests include footprint validity, unchanged terrain, road connectivity, deterministic settlement placement, safe handling of unavailable sites, and roof/wall picking across zoom levels. Browser checks cover warehouse inspection, panning, and zooming with a selected building.

## Milestone 4: build interaction

- The explicit world tool switches between Inspect and Build. Escape cancels Build mode.
- House (1×1), Warehouse (2×2), and Workshop (2×1) are constructible. Workshop rotation demonstrates footprint changes; use the Rotate button or `R` for north/east/south/west quarter turns.
- Moving over the map shows a transparent green or red footprint. The panel explains invalid placement before submission.
- Placement requires in-bounds, level grassland beside an existing road. Buildings cannot overlap structures or roads.
- Clicking a valid preview sends a construction command to `POST /api/construction`. The route regenerates the authoritative starting world, repeats all validation, checks the expected revision, assigns the building ID, and returns the accepted building.
- The client renders a building only after that response. A revision conflict restores the server's current building list.
- Prototype construction sessions live in server-process memory and reset when the server restarts. Costs, inventory, persistent storage, authenticated ownership, and multiplayer synchronization remain future work. When authentication is introduced, it must use NextAuth.

`world/domain/construction.ts` owns footprint validation and placement. `world/server/construction-store.ts` owns prototype session revisions, while `app/api/construction/route.ts` is the command boundary. The same pure validator powers the responsive client preview, but the server result remains authoritative.

## Milestone 5: production loop

- Three starting producers connect buildings to the economic terrain: a Farm on farmland, a Lumber Camp in Northwood Forest, and a Quarry on Stone Ridge. Each occupies a level 2×2 footprint without altering the generated surface.
- Every recipe declares its commodity, batch size, cycle duration, worker requirement, and local storage capacity. The Farm produces 4 food every 8 seconds, the Lumber Camp produces 3 wood every 10 seconds, and the Quarry produces 2 stone every 12 seconds.
- Production advances from elapsed server time through `GET /api/production`; Canvas rendering only displays snapshots returned by the server. Closing or slowing the browser does not turn frame rate into economic progress.
- The production overview shows assigned and available citizens, stored output, and a clear Running, Missing workers, or Storage full state. Map badges use the same status and show server progress for active sites.
- Selecting a producer opens worker controls, output and cycle details, a progress bar, storage usage, and the exact reason an idle site cannot run. Collecting output clears local storage and lets a staffed site resume.
- The initial scenario demonstrates all three states: the Farm is running, the Lumber Camp needs two workers, and the Quarry is full. Worker changes and collection use server-validated `PATCH /api/production` commands.
- Prototype production state lives in server-process memory and resets when the server restarts. Collected goods are reported by the command but a shared inventory, input recipes, costs, persistence, authenticated ownership, and logistics remain future work. Authentication must use NextAuth when introduced.

`world/domain/production.ts` owns recipes, site placement, status explanations, and elapsed-time advancement. `world/server/production-store.ts` owns session state and population checks, while `app/api/production/route.ts` exposes snapshots and commands.

## Run and verify

```bash
npm install
npm run dev
npm run lint
npm test
npm run build
```

Open http://localhost:3000. Drag the map, zoom at a river tile, select it, and verify selection remains attached when panning, zooming, or resizing. Dragging must not select a new tile. Check keyboard controls and focus-selected behavior. Select a mountain tile and confirm z is greater than zero; click an exposed cliff and verify its owning tile is selected.

For construction, choose Build, select a building, and move beside a road. Confirm valid cells turn green and invalid cells turn red with a reason. Rotate the Workshop and verify its footprint changes between 2×1 and 1×2. Click a valid preview and verify the building count increases only after the server accepts it. Try the same footprint again and verify it is rejected as occupied.

For production, open each site from the Production panel. Confirm the Farm advances, the Lumber Camp explains that it needs two workers, and the Quarry explains that its storage is full. Add two Lumber Camp workers and watch its server-reported progress increase. Collect the Quarry output and confirm it changes to Running.

## Architecture and scope

`world/domain/world.ts` generates a serializable, read-only semantic snapshot on the server page. Logical cells never contain screen positions or renderer objects. Chunks are currently derived addresses, not streamed storage.

`presentation/world/projection.ts` owns coordinate transforms, bounded camera operations, and elevated terrain face picking. `render.ts` maps semantic terrain to shaded Canvas top and cliff polygons. `world-map.tsx` owns presentation-only camera, selection, and UI state. Rendering runs when those inputs change rather than in a perpetual simulation loop.

The world can later feed another renderer without changing its coordinates. Elevation is stored in domain coordinates; face geometry and depth ordering remain presentation responsibilities. Picking scans cells in reverse painter order with a bounds check; chunk-level acceleration is deferred until profiling justifies it. Construction and production cross server validation boundaries, while persistence, multiplayer, authentication, money, shared inventory, and ownership remain unimplemented.

The blueprint and reference image describe the long-term destination, not the current art target.
