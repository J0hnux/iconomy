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
- Logical footprints, building types, quarter-turn orientation, settlement identity, and total population live in the domain snapshot. Milestone 12 derives the initial population-needs read model from this authoritative state.
- Connected road cells form a junction with building access. Road strips derive connections from adjacent road cells.
- Primitive shaded buildings use separate presentation definitions. Building roof and wall picking share geometry and draw order with rendering.
- A world-anchored Novagrad label selects the camp. The settlement overview shows population and building counts, with a Go to settlement control; the initial camera and reset view focus the settlement.
- The inspector identifies buildings and shows their purpose, footprint, settlement, and origin coordinates.
- Construction, inventory, production, and population growth are not implemented in this settlement milestone.

`world/domain/settlement.ts` owns starting settlement generation and building definitions. `presentation/world/buildings.ts` owns primitive building appearance. The page composes terrain and settlement into one serializable initial snapshot.

The automated tests include footprint validity, unchanged terrain, road connectivity, deterministic settlement placement, safe handling of unavailable sites, and roof/wall picking across zoom levels. Browser checks cover warehouse inspection, panning, and zooming with a selected building.

## Milestone 4: build interaction

- The explicit world tool switches between Inspect and Build. Escape cancels Build mode.
- House (1×1), Warehouse (2×2), and Workshop (2×1) are constructible. Workshop rotation demonstrates footprint changes; use the Rotate button or `R` for north/east/south/west quarter turns.
- Moving over the map shows a transparent green or red footprint. The panel explains invalid placement before submission.
- Placement requires in-bounds, level grassland beside an existing road. Buildings cannot overlap structures or roads.
- Clicking a valid preview sends a construction command to the local simulation. The authority repeats all validation, checks the expected revision, assigns the building ID, and returns the accepted world read model.
- The client renders a building only after the local simulation accepts the command. A revision conflict restores the simulation's current world read model.
- Construction state lives in the current browser simulation and resets when the page reloads. Costs, inventory requirements, and persistent storage remain future work.

`world/domain/construction.ts` owns footprint validation and placement. `world/simulation/game-simulation.ts` owns revisions and the command boundary. The same pure validator powers the responsive client preview, but the simulation result remains authoritative.

## Milestone 5: production loop

- Three starting producers connect buildings to the economic terrain: a Farm on farmland, a Lumber Camp in Northwood Forest, and a Quarry on Stone Ridge. Each occupies a level 2×2 footprint without altering the generated surface.
- Every recipe declares its commodity, batch size, cycle duration, worker requirement, and local storage capacity. The Farm produces 4 food every 8 seconds, the Lumber Camp produces 3 wood every 10 seconds, and the Quarry produces 2 stone every 12 seconds.
- Production advances from explicit simulation time on a one-second local authority tick; Canvas rendering only displays returned snapshots. Rendering frame rate does not determine economic progress.
- The production overview shows assigned and available citizens, stored output, and a clear Running, Missing workers, or Storage full state. Map badges use the same status and show simulation progress for active sites.
- Selecting a producer opens worker controls, output and cycle details, a progress bar, storage usage, and the exact reason an idle site cannot run. Dispatching output clears local storage and lets a staffed site resume.
- The initial scenario demonstrates all three states: the Farm is running, the Lumber Camp needs two workers, and the Quarry is full. Worker changes and dispatch use locally validated simulation commands.
- Prototype production state lives in the browser simulation and resets when the page reloads. Input recipes, costs, and persistence remain future work. Milestone 6 carries dispatched output into warehouse inventory.

`world/domain/production.ts` owns recipes, site placement, status explanations, and elapsed-time advancement. `world/simulation/game-simulation.ts` composes production with population checks, logistics, markets, events, commands, and read models.

## Milestone 6: logistics

- Harvest Road, Northwood Road, and Ridge Road connect the three producers to Novagrad's existing street network. Routes use contiguous logical world cells, merge into the visible road layer, avoid building footprints, and preserve the underlying terrain and elevation.
- Dispatching stored output creates an authoritative shipment with an origin, warehouse destination, cargo, departure time, arrival time, route, and status. Goods remain in transit until simulation time reaches the scheduled arrival.
- A dedicated presentation canvas draws dashed route overlays and moving cargo markers from shipment timestamps. Marker movement never controls delivery; a late or hidden browser receives the same authoritative result on its next simulation tick.
- A simulation-confirmed arrival adds cargo to the Novagrad warehouse inventory and produces a short arrival ring at the destination. The logistics panel lists recent shipments, their routes, cargo, and In transit or Arrived state.
- The warehouse inspector exposes spatial inventory for food, wood, and stone. Collecting at a producer now means dispatching goods rather than moving them into a global inventory immediately.
- A demonstration food shipment starts in transit so the logistics layer is visible immediately. Further Farm, Lumber Camp, and Quarry shipments use their route's distance-based travel duration.
- Logistics state remains in browser memory for this prototype. Vehicle capacity, congestion, transport costs, persistent inventory, and route construction tools remain future work.

`world/domain/logistics.ts` owns road connections, deterministic route generation, shipment types, and route interpolation. The production session store owns shipment departures, authoritative arrivals, and warehouse inventory transitions. Canvas animation consumes those snapshots without changing them.

## Milestone 7: market and opportunities

- The Market view keeps the isometric world visible while showing Novagrad's food, wood, and stone exchange. Each listing includes the current warehouse supply, desired stock, price, recent sparkline, percentage trend, and Stable, Low shortage, or Critical shortage indicator.
- Prices update on authoritative five-second market ticks. Each commodity starts from a base price and responds to actual warehouse scarcity plus a small deterministic demand pulse; Canvas frames never update prices.
- Sell 1 and Sell all issue local simulation commands. A completed sale removes goods from Novagrad Warehouse at the quoted price and credits company cash, so market actions preserve the spatial inventory model.
- Economic opportunities combine market shortages with real producer state. Examples direct the player to staff the idle Lumber Camp, dispatch full Quarry storage, or inspect a running producer whose commodity remains scarce.
- Opportunity actions return to the map and focus the relevant physical producer, where the existing worker and dispatch controls complete the production decision.
- The event log explains market, production, and logistics changes, including shortages, price moves, staffing changes, shipment departures and arrivals, and completed sales.
- Market cash, price history, and events remain in browser simulation memory. Consumer orders, competing companies, order books, operating costs, and persistence remain future work.

`world/domain/market.ts` owns price formation, shortage classification, listing read models, and opportunity derivation. The production session store advances market ticks and validates warehouse sales alongside production and logistics state.

## Milestone 8: reference HUD skeleton

- The desktop layout follows the reference hierarchy: top Map/Market/Company navigation, left player and warehouse resources, a central world view, right minimap and selection controls, and bottom economy, event log, and actions. Small screens stack the panels and allow page scrolling.
- Player summary shows session cash, population, free workers, and an estimated net worth consisting of cash plus warehouse, producer, and in-transit goods valued at current quotes. It excludes land and building values. Player and enterprise labels identify the local prototype rather than an authenticated account.
- The independent minimap draws semantic terrain, the player's settlement, selection, and a ground-plane camera outline. Click a location to pan there, or focus the minimap and press Enter to return to the settlement.
- Company opens the existing settlement, producer, resource, and shipment management controls. Market retains price trends, sales, and opportunities. Selecting an empty cell shows terrain, road access, and building-specific placement validity with a Build here action.
- The persistent bottom log filters All events, Market News, and Deliveries. Economy metrics use live local population, workers, producing sites, shortages, and in-transit goods; global CPI, wages, and money supply are not simulated.
- Bottom actions open Build, Trade, Company, the actual warehouse inspector, or the home camera. Unimplemented actions are omitted. The HUD uses Tailwind and simulation read models, with no economy changes or new dependencies.

`presentation/world/hud.tsx` contains the player/resources, minimap, and bottom HUD components. The world controller retains camera, selection, and command ownership.

For HUD verification, navigate using the minimap, compare its view outline before and after zooming, switch Map/Market/Company, filter the bottom log, and use Warehouse and Build actions. Confirm production controls and market commands remain accessible while the world stays visible.

## Milestone 9: chunk awareness

- World generation now publishes deterministic 32×32 chunk regions with stable IDs and clipped bounds at uneven world edges. Cells remain in the existing flat semantic snapshot, so chunk awareness does not couple the domain to Canvas or duplicate world data.
- The presentation layer converts the camera viewport into a conservative set of visible chunks, including elevation and a one-chunk safety margin. Terrain drawing, building drawing, logistics overlays, and pointer picking work from this scene window instead of scanning every world cell.
- Per-world chunk cell indexes and maximum elevation are cached from immutable snapshots. The active scene is recalculated only when the world, camera, or viewport changes.
- The Map layers panel can show cyan chunk boundaries and stable chunk IDs. Both the sidebar and economy HUD report visible chunks, tiles, and buildings so culling can be checked while panning and zooming.
- This milestone adds local render culling only. Chunks do not load over the network, unload authoritative state, or change simulation ownership.

For chunk verification, enable Chunk boundaries, pan across a boundary, and compare the cyan IDs with the visible-scene counters. Zoom in to confirm the active tile count falls below the 16,384-cell world total, then zoom and pan along cliffs and confirm terrain, buildings, selection, routes, and shipment markers remain intact at scene edges.

## Milestone 10: voxel renderer readiness test

- The Lumber Camp now has two interchangeable primitive visual profiles. Primitive A preserves the original timber shed, while Primitive B renders a taller, narrower forest depot with a different palette and roof mark.
- Building height, inset, colors, and labels live in typed presentation-only visual sets. The generic Canvas building geometry consumes the selected set instead of reading economic or settlement definitions.
- The Map layers panel swaps the Lumber Camp profile at runtime. Drawing and hit testing receive the same visual set, so both primitives remain selectable across their full rendered geometry.
- Every non-Lumber Camp visual is identical between the two profiles. Switching profiles leaves footprints, roads, workers, recipes, storage, shipments, inventory, and prices untouched.
- This readiness test keeps the renderer replaceable without introducing voxel assets or choosing a future WebGL stack.

For renderer-readiness verification, locate the Lumber Camp and switch between Primitive A and Primitive B under Map layers. Confirm its proportions, colors, and label change immediately, click the taller Primitive B roof to select the same Lumber Camp, and verify its workers and production status remain unchanged after repeated swaps.

## Milestone 11: local deterministic simulation authority

- One `LocalGameSimulation` instance now owns the current single-player world revision, buildings, production states, shipments, warehouse inventory, cash, price history, shortages, events, counters, and simulation time.
- Player actions cross one discriminated command boundary: construct, set workers, dispatch production, or sell goods. Every command advances scheduled work to an explicit timestamp, validates through existing domain rules, applies the state change, records any event, and returns a world and economy read model.
- The React controller retains only presentation state, a stable simulation reference, and returned read models. It no longer sends gameplay commands through HTTP or treats API responses as authority.
- Production and markets advance on the existing one-second local timer. Shipment animation remains frame-based presentation, while shipment arrivals, inventory changes, production cycles, and prices use monotonic simulation time.
- The previous construction and production API routes and independent server session stores were removed. This also eliminates the split world copies that could allow UI construction and economic state to diverge.
- `exportSave()` produces a renderer-free, JSON-serializable `saveVersion: 1` authority snapshot. Browser persistence and save loading remain future work; no storage API or dependency was introduced.
- Existing coordinates, chunks, building visuals, production recipes, worker limits, route timing, inventory rules, prices, and starting balance are unchanged.

For local-authority verification, reload the page, assign workers, dispatch output, wait for its physical arrival, sell warehouse goods, and construct a building. Confirm each action updates immediately without requests to `/api/*`, rejected commands leave state unchanged, and a page reload starts a fresh local run.

## Milestone 12: population needs

- The local simulation now publishes one aggregate population snapshot with total population, working-age population, employed workers, unemployed workers, available workers, housing capacity, and warehouse food supply.
- Working-age population is the deterministic whole-number floor of 60% of total population. Available workers and unemployed workers both represent working-age citizens without a production assignment.
- The starting Settler Camp provides housing for 4 citizens and each House provides housing for 2, for a starting capacity of 12. Constructing a House immediately raises the authoritative capacity by 2 through the existing command and read-model flow.
- Food supply is the food physically present in Novagrad Warehouse. In-transit or producer-stored food is excluded until it arrives, and a market sale reduces the displayed supply through the existing inventory transition.
- Worker assignment validation now uses working-age population instead of total population. With 10 citizens, 6 are working age; the starting Farm and Quarry employ 5, leaving 1 worker available.
- Total population remains fixed in this milestone. Food consumption, population growth, migration, happiness, education, health, crime, social classes, and housing penalties remain future systems.

`world/domain/population.ts` owns the pure aggregate policy and derived snapshot. `world/simulation/game-simulation.ts` composes it from authoritative world, production, and warehouse state. React and Canvas only consume the resulting read model.

For population verification, open the player or economy HUD and confirm 10 total citizens, 6 working-age citizens, 5 employed, 1 unemployed/available, 12 housing capacity, and the current warehouse food count. Build a House and confirm capacity becomes 14. Try to assign more than 6 workers across all producers and confirm the command is rejected. Wait for food to arrive or sell food and confirm food supply follows warehouse inventory.

## Milestone 13: player agency and first playable economy loop

- The Build panel now offers Farm, Lumber Camp, Quarry, House, Warehouse, and Workshop cards with their authoritative credit/material costs, footprint, purpose, worker requirement where applicable, and current affordability. A Find site action focuses a physically valid location for the selected structure.
- Placement applies each existing economic geography rule: Farms use farmland, Lumber Camps use forest resources, Quarries use stone resources, and civic structures use grassland. Every structure still requires level ground and an adjacent road connected to Novagrad Warehouse.
- Construction costs are centralized in `world/domain/construction.ts`. An accepted command atomically deducts credits and warehouse wood/stone, places the building, initializes producer state and logistics when needed, records an event, and returns the updated read model. Rejected or repeated commands deduct nothing.
- Players may build repeated producers while land and resources allow. Newly built producers start with zero workers and immediately appear in the existing production controls; assigning workers runs the existing recipe, storage, dispatch, shipment, and market-supply loop.
- Building inspection retains production status, output per cycle, workers, progress, local storage, and dispatch controls. A dedicated pause action releases all assigned workers. Demolition removes occupancy, production state, routes, housing capacity, and worker assignments through the local command boundary. The founding Camp and primary Warehouse are protected, and producers with cargo in transit must wait for arrival.
- Pause, 1×, 2×, and 5× controls advance the same explicit deterministic simulation clock independently of Canvas frame rate. Commands continue to work at the current simulation time while paused.
- Version 1 saves can now be validated and restored. The browser automatically stores the authoritative save in localStorage after simulation updates and resumes from saved simulation time without offline progression.
- Player feedback reports construction costs, affordability gaps, physical placement failures, production state, demolition, inventory, credits, and economy events without requiring developer tools.
- Player-built Warehouses provide another map location from which to inspect the settlement's existing shared inventory. Aggregate warehouse capacity and player-built roads remain future work because neither system had an authoritative Milestone 12 model.

Milestone 13 does not add commodities, recipes, NPC actors, migration, consumption, wages, banking, contracts, technology, or regional markets.

For the playable-loop check, open Build, choose Farm, and use Find site or inspect farmland beside Harvest Road. Build two Farms, release workers from another producer, staff a new Farm, and use 5× to observe its local food storage. Dispatch output, inspect a Warehouse after arrival, build with the delivered materials, pause a producer, and demolish a nonessential structure. Reload the page and confirm the constructed world, inventory, assignments, and simulation time resume from the local save.

## Milestone 14: labor and worker allocation

- Working-age population now supplies one finite workforce read model with total, assigned, and unassigned workers plus the number of production buildings experiencing a labor shortage.
- A shared labor policy calculates `min(1, assigned workers / required workers)` once for every producer type. Farm, Lumber Camp, and Quarry expose the same labor status and efficiency fields instead of implementing separate formulas.
- Partial staffing now advances production proportionally. A Farm with one of two required workers operates at 50% labor efficiency and completes its four-food batch in 16 seconds; full staffing retains the existing eight-second cycle.
- Exact integer remainder carry makes partial work deterministic across timer frequency, Pause, 1×, 2×, 5×, and direct simulation-time jumps. Commodity output remains in complete recipe batches.
- The existing `set_workers` command uses the shared labor validator. It prevents assignments above a building requirement or above the settlement workforce and continues to replace one building's allocation without double-counting it.
- The player and economy HUDs show Workforce, Assigned, Available, and Labor shortages. Producer inspection and the company list show assigned/required workers and labor efficiency, with clear Unassigned, Worker shortage, Full staffing, or Storage full consequences.
- Version 1 saves preserve worker allocation and an optional fractional-work remainder. Milestone 13 saves load with a zero remainder, so the save version remains compatible.
- Existing per-building worker controls remain available from earlier milestones. This milestone adds no settlement-wide labor-management interface, assignment priorities, wages, professions, skills, education, migration, citizen entities, automation, or NPC labor market.

`world/domain/labor.ts` owns labor capacity validation, status, efficiency, deterministic work conversion, and aggregate labor snapshots. Production consumes that policy, while `LocalGameSimulation` remains the sole owner of assignment state.

For labor verification, inspect the starting workforce of 6 with 5 assigned and 1 available. Remove one worker from the Farm and confirm it reports 1/2 workers, 50% efficiency, and a worker shortage while continuing to produce at half speed. Release all workers and confirm progress stops. Attempt to assign more than six workers across producers and confirm the command is rejected, then reload and verify the accepted allocation is restored.

## Run and verify

```bash
npm install
npm run dev
npm run lint
npm test
npm run build
```

Open http://localhost:3000. Drag the map, zoom at a river tile, select it, and verify selection remains attached when panning, zooming, or resizing. Dragging must not select a new tile. Check keyboard controls and focus-selected behavior. Select a mountain tile and confirm z is greater than zero; click an exposed cliff and verify its owning tile is selected.

For construction, choose Build, select a building, and move beside a road. Confirm valid cells turn green and invalid cells turn red with a reason. Rotate the Workshop and verify its footprint changes between 2×1 and 1×2. Click a valid preview and verify the building count increases only after the local simulation accepts it. Try the same footprint again and verify it is rejected as occupied.

For production, open each site from the Production panel. Confirm the Farm advances, the Lumber Camp explains that it needs two workers, and the Quarry explains that its storage is full. Add two Lumber Camp workers and watch its simulation progress increase. Dispatch the Quarry output and confirm it changes to Running.

For logistics, watch the initial food marker travel along Harvest Road and confirm the logistics panel changes it from In transit to Arrived. Dispatch the Quarry's stone, verify its local storage clears while warehouse stone remains unchanged, then confirm the warehouse gains 12 stone only after the Ridge Road arrival. Select the Warehouse to inspect its spatial inventory.

For the market, choose Market in the top navigation. Compare each price trend and shortage indicator with warehouse stock. Follow the Staff Lumber Camp opportunity and assign two workers, then dispatch its first wood batch. After it arrives, return to Market and verify wood supply and pricing respond. Sell one delivered good and confirm both warehouse stock and cash change while the sale appears in the event log.

## Architecture and scope

`world/domain/world.ts` generates a serializable, read-only semantic snapshot for the initial page. Logical cells never contain screen positions or renderer objects. The snapshot includes compact chunk region metadata; cells remain flat authoritative data rather than streamed storage.

`presentation/world/projection.ts` owns coordinate transforms, bounded camera operations, visible chunk selection, and elevated terrain face picking. `buildings.ts` owns swappable primitive visual sets and derives geometry from semantic building positions. `render.ts` maps the visible semantic scene and selected visual set to shaded Canvas polygons. `world-map.tsx` owns presentation-only camera, selection, visual-profile, and UI state. Rendering runs when those inputs change rather than in a perpetual simulation loop.

The world can later feed another renderer without changing its coordinates. Elevation is stored in domain coordinates; face geometry, visible scene selection, and depth ordering remain presentation responsibilities. Picking scans only visible chunk cells in reverse painter order with a bounds check. Construction, demolition, production, shipments, warehouse arrivals, market ticks, sales, and worker assignments cross the local simulation command and validation boundary. Population supplies finite workforce; labor efficiency converts explicit elapsed time into deterministic productive work before existing recipes create output. These read models contain no renderer state. Version 1 local saves contain domain state only and are restored inside the client-owned simulation boundary. Competing companies and ownership remain unimplemented.

The blueprint and reference image describe the long-term destination, not the current art target.
