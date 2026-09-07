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
- Partial staffing now advances production proportionally. A Farm with one of two required workers operates at 50% labor efficiency and completes its four-unit batch in 16 seconds; full staffing retains the existing eight-second cycle.
- Exact integer remainder carry makes partial work deterministic across timer frequency, Pause, 1×, 2×, 5×, and direct simulation-time jumps. Commodity output remains in complete recipe batches.
- The existing `set_workers` command uses the shared labor validator. It prevents assignments above a building requirement or above the settlement workforce and continues to replace one building's allocation without double-counting it.
- The player and economy HUDs show Workforce, Assigned, Available, and Labor shortages. Producer inspection and the company list show assigned/required workers and labor efficiency, with clear Unassigned, Worker shortage, Full staffing, or Storage full consequences.
- Version 1 saves preserve worker allocation and an optional fractional-work remainder. Milestone 13 saves load with a zero remainder, so the save version remains compatible.
- Existing per-building worker controls remain available from earlier milestones. This milestone adds no settlement-wide labor-management interface, assignment priorities, wages, professions, skills, education, migration, citizen entities, automation, or NPC labor market.

`world/domain/labor.ts` owns labor capacity validation, status, efficiency, deterministic work conversion, and aggregate labor snapshots. Production consumes that policy, while `LocalGameSimulation` remains the sole owner of assignment state.

For labor verification, inspect the starting workforce of 6 with 5 assigned and 1 available. Remove one worker from the Farm and confirm it reports 1/2 workers, 50% efficiency, and a worker shortage while continuing to produce at half speed. Release all workers and confirm progress stops. Attempt to assign more than six workers across producers and confirm the command is rejected, then reload and verify the accepted allocation is restored.

## Milestone 15: core dependency-driven production

- A single commodity catalog now defines the first connected economy. Existing save IDs remain stable: `wood` is displayed as Logs, `stone` as Rough Stone, and `food` as Basic Food. Crops, Lumber, Cut Stone, Animal Feed, Livestock, Raw Meat, Cooked Meat, Prepared Meal, Iron Ore, Iron, and Iron Tools extend that catalog without duplicate legacy goods.
- Production is recipe-driven. Every recipe declares its producer building, consumable warehouse inputs, worker requirement, equipment requirements, duration, output, local storage capacity, and site-storage destination.
- Primitive Farm, Lumber Camp, Quarry, and Iron Mine recipes can start without consumable or manufactured inputs. A configurable Workshop supplies processing capacity, avoiding a separate subclass for every industry and avoiding bootstrap loops.
- The supported chains are Forest → Logs → Lumber; Farmland → Crops → Basic Food; Crops → Animal Feed → Livestock → Raw Meat → Cooked Meat; Crops + Cooked Meat → Prepared Meal; Stone Deposit → Rough Stone → Cut Stone; and Iron Deposit → Iron Ore → Iron → Iron Tools.
- The shared resolver consumes inputs only when a complete batch is accepted into local output storage. Missing labor, missing inputs, unmet equipment requirements, or insufficient output room stop production without creating or consuming goods. Partial labor continues to use the Milestone 14 labor policy.
- Producer resolution uses stable building-ID order. Shipment arrival times divide long simulation advances into deterministic segments, so a newly arrived input becomes usable at the same authoritative time regardless of browser refresh frequency.
- The initial world adds an unstaffed Iron Mine and a Basic Food Workshop. The existing demonstration shipment now carries Crops from the Farm, allowing the player to release labor from another site, staff the Workshop, and observe Crops become Basic Food.
- Producer inspection exposes the active recipe, required inputs, output rate, labor, blocker, progress, and destination storage. The company overview distinguishes missing inputs from labor and storage shortages. Full recipe selection remains reserved for Milestone 16.
- Version 1 saves remain readable. Missing commodity maps are normalized to zero, missing recipe IDs receive building defaults, and stored output from a pre-Milestone 15 Farm is safely migrated into warehouse Basic Food before that Farm begins its new Crops recipe.

`world/domain/commodities.ts` owns commodity identity and normalization. `world/domain/production.ts` owns recipe configuration and deterministic transformations. `LocalGameSimulation` supplies authoritative warehouse inventory, orders producer resolution, handles arrivals, and persists recipe state. Presentation only reads these results.

For dependency verification, wait for the opening Crop shipment to reach the Warehouse, release the Quarry workers, and assign two workers to the Workshop. After six simulated seconds, confirm the Workshop holds three Basic Food and Warehouse Crops fell from four to two. Leave the Workshop staffed after its Crops run out and confirm it reports Missing inputs without gaining progress or output.

## Milestone 16: labor and production player control

- Production inspection now sends authoritative commands to assign and remove workers, pause and resume a producer, choose an available recipe, and set its production priority. React keeps only the returned read model and never edits labor or production state directly.
- Pausing a producer releases all of its workers immediately while preserving completed cycle progress. Resuming leaves it unstaffed so the player decides where finite labor goes next.
- Recipe controls appear only for producers with real alternatives. Farms can switch between Crops and Livestock, and Workshops expose their supported processing recipes. A switch is rejected when the current local output has not been dispatched, when the selected recipe belongs to another producer, or when the current assignment exceeds the new recipe's worker requirement.
- Low, Normal, and High priority determine which producer resolves first when multiple sites compete for scarce shared warehouse inputs at the same simulation time. Building ID remains the deterministic tie-breaker. Priority never assigns labor or changes recipes automatically.
- Production inspection reports assigned and required workers, labor efficiency, expected output for the current staffing and status, warehouse input stock, local output storage, progress, and the exact blocking reason. Storage at 80% or more receives a visible warning.
- Version 1 saves preserve the active recipe, explicit pause state, production priority, worker allocation, cycle progress, and deterministic labor remainder. Older saves default to active production and Normal priority.
- Players can now overbuild, understaff a site, concentrate labor in one industry, starve another producer, exhaust an intermediate input, fill local storage, pause a critical link, and recover by changing those choices. No automatic optimizer corrects these outcomes.

For the playable gate, build two Farms and distribute the finite workforce unevenly. Accelerate time and compare their expected output and inventories, move labor between them, then pause one Farm and assign its released workers to another producer. Change a Farm or Workshop recipe when its local output is empty, use production priority to choose which Workshop receives scarce shared inputs first, and deliberately create then resolve a labor or input bottleneck. Reload the page and confirm all accepted controls survive.

## Milestone 16.6: advanced market chart timeframes

- The Novagrad Exchange has a focused commodity chart with shared 1s, 1m, 5m, 15m, 1H, 4H, and 1D timeframe controls plus the session-only Line/Candlestick toggle. Switching either setting keeps the commodity, Novagrad region, selected period, simulation state, and underlying history.
- One pure read-model transformation sorts genuine price observations into deterministic timeframe boundaries. Candles use the first, maximum, minimum, and final observed prices as Open, High, Low, and Close. Line mode uses the Close from those same buckets rather than running a separate aggregation.
- The rightmost bucket is displayed before it closes when it contains a genuine observation. Its Open remains fixed while later observations update High, Low, and Close. Completed buckets remain unchanged, single-observation candles remain flat, and empty periods do not receive fabricated prices.
- Scheduled market prices still update every five simulation seconds; accepted sales may add observations between ticks. The 1s view is therefore intentionally sparse unless genuine events occur, and both compact and expanded views explain that cadence.
- Expand Chart opens an accessible in-game analysis dialog with substantially more chart space. The compact preview and dialog share commodity, timeframe, chart type, and selected-period state. Escape, the close button, and backdrop click close it and restore focus. The simulation continues running while it is open.
- Both modes provide keyboard-focusable and selectable periods with interval details. Candlestick mode shows Open, High, Low, and Close; Line mode shows the bucket interval and closing price.
- Version 1 saves retain the same `PricePoint[]` format. The rolling history window grows from 12 observations to at most four simulation hours or 4,096 observations per commodity. Rendering remains bounded to 48 compact or 180 expanded periods.
- No chart dependency was added. Market price formation, shortage rules, economic commands, and tick frequency remain unchanged; SVG rendering and chart controls remain presentation concerns.

For chart verification, open Market, select Crops, choose Candlestick and 1s, then watch scheduled ticks or a sale create genuine buckets. Try every timeframe and compare Line closes with candle closes. Expand the chart, change to 1H, close it with Escape, and confirm the compact chart still shows Crops, Candlestick, and 1H while the simulation continues advancing.

## Milestone 16.7: floating commodity market terminal

- A global Market action opens a non-blocking terminal over the world. It does not require a building selection, pause simulation time, dim the map, or replace the existing right-panel Exchange.
- The terminal can be dragged by its title bar and is clamped to the visible viewport. Its commodity list and chart area scroll internally, so browsing markets does not move the right gameplay panel.
- All current market listings come from the existing commodity catalog and market snapshot. Search filters display names immediately and case-insensitively; compact rows show the current quote and trend without mounting a chart for every commodity.
- All mode provides a flat list. Production Chains groups the same commodities by connected components and order derived from the authoritative recipe inputs and outputs. The selected commodity also exposes direct Made from and Used to make links from those recipes.
- The floating chart reuses the existing price history, OHLC read model, SVG renderer, active-candle behavior, Line/Candlestick mode, and 1s through 1D controls. Only the selected commodity renders a full live chart.
- Commodity, timeframe, chart type, and selected period are shared with the existing expanded chart flow. Expand opens the same detailed modal with the terminal's current view; closing it returns focus to the terminal while the terminal remains open.
- Market-terminal state is presentation-only and session-only. It sends no economic commands, changes no pricing or OHLC rules, adds no commodities, and creates no parallel simulation or history subscription.

For the terminal check, use the bottom Market action, search for Crops, switch to Candlestick and 1s, and leave the window open while simulation time advances. Search for Iron, choose Iron Ore or Iron Tools, browse Production Chains, follow a related-good link, then Expand. Close the analysis modal and confirm the terminal remains on the same commodity, timeframe, and chart type. Drag the terminal toward each edge and confirm it remains reachable.

## Milestone 17: household consumption

- Novagrad's aggregate population now consumes Food Value every 60 simulation seconds from the primary settlement Warehouse. Consumption stops while simulation time is paused and remains deterministic at 1×, 2×, 5×, across incremental reads, and across large time jumps.
- One population policy defines demand and food efficiency: each citizen requires one Food Value per period; Crops provide 1, Basic Food 2, Cooked Meat 3, and Prepared Meal 4. Households consume higher-value foods first, so processed food supports the same demand with fewer physical units.
- The consumption resolver reports Food Required, Food Available, Food Consumed, Food Supply %, and the actual commodities and units used during the latest completed period. A shortage is any period that supplies less than 100% of required Food Value.
- Food is removed only from the existing primary Warehouse inventory. Goods stored at producers or moving in shipments are unavailable until they reach that warehouse. Consumption therefore competes with production inputs, player sales, and local reserves without introducing a second inventory.
- Existing market listings read the reduced Warehouse inventory, so household demand naturally affects existing shortage states, scarcity prices, price observations, and charts on the normal market cadence. Pricing and OHLC rules remain unchanged.
- Version 1 saves now include the last completed household-consumption result and its authoritative update time. Older version 1 saves load without retroactive consumption and begin their first period at the saved simulation time.
- Population totals, workforce, housing, production recipes, individual citizens, money, health, starvation, migration, classes, and luxury needs remain unchanged.

For consumption verification, note the Food Required and Food Available values, accelerate to 5×, and observe a completed period reduce edible Warehouse inventory. Main Food identifies what was eaten. Continue until Food Supply falls below 100%, then restore supply by producing and dispatching Crops, Basic Food, Cooked Meat, or Prepared Meals to the primary Warehouse.

## Milestone 18: local supply, demand, and pricing

- Each Novagrad market listing now reports current Warehouse inventory, recently delivered supply, recent demand, recent physical consumption, current price, trend, supply condition, and the measured reasons behind its latest price observation.
- Market activity comes from authoritative inventory movements. Shipment arrivals count as local supply; household and production inputs count as demand and consumption; construction materials count as demand and consumption; accepted player sales count as demand. Producer-local goods do not enter supply until their shipment reaches the primary Warehouse.
- One pricing policy combines inventory pressure with recent demand-versus-supply pressure, moves the previous quote toward that target, and caps each observation's movement. Low or declining inventory pushes upward; excess inventory and deliveries above demand push downward.
- The previous sine-based demand pulse was removed. With unchanged inventory and balanced flows, prices converge on their explained target and then remain stable instead of oscillating without economic cause.
- Critical shortage, shortage, balanced, and oversupplied conditions come from configured stock targets. Price reasons state whether inventory is above or below target, whether demand exceeded delivered supply, whether supply exceeded demand, and how much was recently consumed.
- Activity is accumulated between the existing five-second market observations and reset only after being recorded. Genuine history points carry the resulting price context while the existing Line, Candlestick, timeframe, and OHLC systems continue reading the same history.
- Pending activity is included in version 1 saves. Older version 1 saves default to zero recent activity and begin using the new causal pricing policy at their next market observation.

For local-market verification, inspect a commodity's Recent supply, Recent demand, Consumed, and Price reasons fields. Deliver a large shipment and observe supply and inventory pressure lower its target price as stock becomes excessive. Sell or consume inventory faster than deliveries replace it and observe shortage pressure raise the price. Identical saved states and simulation-time advances produce identical quotes and explanations.

Milestone 18 is the second simulation milestone after the Milestone 16.7 gameplay integration. Milestone 19 below fulfills the required player-facing market conversion before another simulation-heavy system is added.

## Milestone 19: local market decisions

- Every commodity listing now accepts an exact integer sale quantity and shows owned stock, the current authoritative quote, estimated revenue, and the amount that will remain stockpiled before the player submits the command.
- Accepted sales still use the existing local `sell_goods` command. The simulation validates the live quote and Warehouse balance, then atomically removes inventory, credits cash, records market demand, publishes price history, and returns an authoritative receipt with the actual unit price, revenue, and retained balance.
- Retain all clears the sale draft without moving inventory. Partial selling makes stockpiling explicit: unsold goods remain in the primary Warehouse for household consumption, construction, or downstream recipes.
- Shift production opens an existing compatible producer in the established Milestone 16 building inspector. Process stock opens a compatible downstream processor derived from real recipe inputs, and Build more enters the existing construction tool with the recipe-configured building type. Worker allocation, pause/resume, priority, recipe choice, and construction remain owned by their existing commands and controls.
- Buying remains unavailable because the local economy does not yet contain a conserved external seller inventory. Market controls do not fabricate goods or cash, and estimated revenue remains presentation-only.

For gameplay verification, overproduce and dispatch Crops, then sell exact quantities while watching recent supply, demand, inventory, price trend, and price reasons. Compare selling the full stock with retaining Crops for food processing. Use Shift production to pause or restaff a Farm, change a compatible Workshop recipe, or enter Farm construction. Reduce food production and accelerate time to create a shortage, then resume or expand production and watch inventory and price pressure recover.

## Milestone 20: NPC cities

- Five deterministic aggregate cities now surround Novagrad: agricultural Greenvale, forestry-focused Northwood, stoneworking Stonebridge, mining and metals center Ironhold, and coastal processing hub Port Azure. Their logical `x/y/z` positions follow the generated farm belt, Northwood Forest, Stone Ridge, Iron Heights, and coast without adding renderer objects.
- Every city tracks population, resource advantages, recipe capacity, inventories, recent production and consumption, imports, exports, and a complete local price map using the existing commodity catalog. No duplicate regional goods or per-citizen simulation were added.
- NPC production resolves configured capacity through the existing recipes, so processing consumes genuine inputs. Aggregate households consume food with the existing food-value policy. Limited deterministic intercity transfers move only real surplus inventory to deficits, with every imported unit matched by an export.
- Regional prices use existing commodity base prices and the shared scarcity-policy weights, scaled to each city's population, inventory, production, consumption, imports, and exports. Agriculture, timber, stone, metal, and coastal specializations therefore create different inventories and prices over time.
- NPC cities advance every 60 simulation seconds at exact authority-owned boundaries. Version 1 saves preserve their state and timing through optional fields, while legacy saves initialize the same deterministic cities from their saved world.
- This milestone adds simulation state only. Player regional shipping, import/export commands, route controls, detailed NPC companies, and regional trading UI remain outside Milestone 20.

For verification, advance at least one NPC-city period and compare Crops in Greenvale with Ironhold, then compare Iron Ore in Ironhold with Greenvale. Inspect the saved `npcCities` snapshots to confirm production, consumption, inventories, matched imports and exports, and distinct prices. Advancing three periods in one read or three separate reads produces the same save.

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

For logistics, watch the initial Crops marker travel along Harvest Road and confirm the logistics panel changes it from In transit to Arrived. Dispatch the Quarry's Rough Stone, verify its local storage clears while warehouse stock remains unchanged, then confirm the warehouse gains 12 Rough Stone only after the Ridge Road arrival. Select the Warehouse to inspect its spatial inventory.

For the market, choose Market in the top navigation. Compare each price trend and shortage indicator with warehouse stock. Follow the Staff Lumber Camp opportunity and assign two workers, then dispatch its first Logs batch. After it arrives, return to Market and verify Logs supply and pricing respond. Sell one delivered good and confirm both warehouse stock and cash change while the sale appears in the event log.

## Architecture and scope

`world/domain/world.ts` generates a serializable, read-only semantic snapshot for the initial page. Logical cells never contain screen positions or renderer objects. The snapshot includes compact chunk region metadata; cells remain flat authoritative data rather than streamed storage.

`presentation/world/projection.ts` owns coordinate transforms, bounded camera operations, visible chunk selection, and elevated terrain face picking. `buildings.ts` owns swappable primitive visual sets and derives geometry from semantic building positions. `render.ts` maps the visible semantic scene and selected visual set to shaded Canvas polygons. `world-map.tsx` owns presentation-only camera, selection, visual-profile, and UI state. Rendering runs when those inputs change rather than in a perpetual simulation loop.

The world can later feed another renderer without changing its coordinates. Elevation is stored in domain coordinates; face geometry, visible scene selection, and depth ordering remain presentation responsibilities. Picking scans only visible chunk cells in reverse painter order with a bounds check. Construction, demolition, production, shipments, warehouse arrivals, market ticks, sales, and worker assignments cross the local simulation command and validation boundary. Population supplies finite workforce; labor efficiency converts explicit elapsed time into deterministic productive work. Recipe configuration then validates consumable inputs and storage before atomically consuming warehouse goods and creating local output. These read models contain no renderer state. Version 1 local saves contain domain state only and are restored inside the client-owned simulation boundary. Competing companies and ownership remain unimplemented.

The blueprint and reference image describe the long-term destination, not the current art target.
