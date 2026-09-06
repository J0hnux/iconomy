---
name: scalable-solo-browser-economy-game
description: Architecture and game-design skill for a single-player browser-based TypeScript economic city-builder with an isometric/voxel-ready world, deterministic local simulation, dependency-driven production chains, population needs, labor, NPC cities and companies, regional markets, logistics, dynamic shortages, industrialization, and long-term economic simulation.
---

# OpenWorld Economy — Solo Browser Economy Game Skill

## Purpose

Use this skill when designing, implementing, reviewing, balancing, testing, or refactoring **OpenWorld Economy**.

The game is now a **single-player browser economy simulator**.

The player builds and grows a settlement inside a larger simulated world containing:

- population,
- households,
- workers,
- cities,
- NPC companies,
- natural resources,
- farms,
- mines,
- processing industries,
- manufacturing,
- housing,
- infrastructure,
- logistics,
- regional markets,
- dynamic prices,
- shortages,
- oversupply,
- migration,
- contracts,
- economic shocks,
- industrialization,
- business failure,
- recovery.

The player should feel like one powerful participant inside a living economy rather than the only entity that matters.

The codebase should remain:

- easy for humans and Codex to understand,
- safe to extend,
- easy to test,
- deterministic where economic correctness matters,
- explicit about ownership of mutable state,
- resistant to tightly coupled "spaghetti" architecture,
- renderer-independent,
- save-compatible,
- friendly to accelerated simulation,
- capable of supporting a future voxel renderer without rewriting the economy,
- capable of adding new industries mainly through configuration and policies rather than giant switch statements.

---

# 1. Current Product Direction

The current game is:

```text
Single Player
+
Browser Based
+
TypeScript
+
Isometric World
+
Future Voxel Presentation
+
Local Deterministic Economy Simulation
```

The current game is **not**:

```text
Multiplayer
Crypto
Real-Money Trading
Server-Authoritative MMO
Blockchain Game
Player-vs-Player Economy
```

Do not preserve old multiplayer or cryptocurrency architecture merely because it existed in an earlier design.

If old code contains multiplayer-specific boundaries that still provide useful separation, keep the separation.

Remove or simplify architecture whose only purpose was:

- client/server trust,
- network retries,
- player anti-cheat,
- real-money settlement,
- KYC,
- blockchain adapters,
- external token accounting,
- multiplayer synchronization,
- whale prevention.

Do not perform large unrelated rewrites simply to remove terminology.

---

# 2. Assumptions — Verify Before Coding

Codex must inspect the repository before implementation.

Current assumptions:

- TypeScript is the primary language.
- The game runs in a desktop browser first.
- The simulation runs locally.
- The game has one authoritative local simulation state.
- React/UI state is presentation state, not authoritative economic state.
- The existing isometric world uses logical `x/y/z` coordinates.
- Rendering is separate from simulation.
- Primitive visuals will eventually be replaced by voxel visuals.
- The economy should not depend on Canvas, DOM, sprite, mesh, or voxel objects.
- Saves should persist economic/world state independently from rendering state.
- The game may use accelerated time for simulation and balance testing.
- NPC economic actors are deterministic or heuristic systems, not machine-learning agents.
- A full server is not required for core gameplay.
- Real-money or cryptocurrency systems are out of scope.

If the repository contradicts an assumption, Codex must report the conflict before changing architecture.

---

# 3. Fundamental Architectural Boundary

Use:

```text
PLAYER INPUT / NPC DECISION
            ↓
          COMMAND
            ↓
LOCAL SIMULATION AUTHORITY
            ↓
      DOMAIN VALIDATION
            ↓
    AUTHORITATIVE STATE CHANGE
            ↓
 DOMAIN EVENT / LEDGER RECORD
            ↓
      READ MODEL / SNAPSHOT
            ↓
     PRESENTATION MAPPER
            ↓
 PRIMITIVE OR VOXEL RENDERER
```

The simulation owns gameplay truth.

The renderer displays gameplay truth.

The UI requests changes.

The UI does not directly mutate gameplay truth.

---

# 4. Local Simulation Authority Is Non-Negotiable

Single-player does **not** mean every React component may own part of the economy.

Avoid:

```text
React component
→ setCash(...)
→ setFood(...)
→ setPopulation(...)
→ setMarketPrice(...)
```

as authoritative gameplay logic.

Prefer:

```text
UI
→ BuildFarmCommand
→ GameSimulation.execute(command)
→ validation
→ state mutation
→ snapshot
→ UI rerender
```

This retains the clean ownership benefits of server-authoritative architecture without requiring a server.

## Rule

There should be one obvious path through which authoritative economic state changes.

---

# 5. Separate Decision-Making From Execution

Game systems should know **how an action works**, not **who decided to perform it**.

Examples:

- A farm knows how its production recipe resolves, not why the player chose farming.
- A market knows how prices and trades resolve, not whether the trade came from the player or an NPC trader.
- A shipment knows its cargo, route, cost, departure, and arrival, not why that route was chosen.
- A construction system knows how a building is constructed, not whether a player, city policy, or NPC company requested it.
- An NPC company decides what business action it wants, then uses the same economic command boundary where practical.

Prefer:

```text
Player Decision ─┐
                 ├──> Economic Command ──> Domain System
NPC Decision ────┘
```

Avoid separate physical/economic rules for human and NPC actors.

---

# 6. Prefer Composition Over Large Inheritance Trees

Prefer:

```text
Company
├── Wallet
├── Inventory
├── ProductionPortfolio
├── EmploymentState
├── LogisticsState
└── Strategy / Decision Policy
```

over:

```text
EconomicEntity
↓
BusinessEntity
↓
IndustrialBusiness
↓
ManufacturingBusiness
↓
SteelManufacturingBusiness
↓
RegionalSteelManufacturingBusiness
```

Prefer configurable building definitions:

```text
ProductionBuilding
├── Footprint
├── Recipe
├── WorkerRequirement
├── Storage
├── Maintenance
└── VisualTypeId
```

Do not subclass every industry.

---

# 7. Apply SOLID Pragmatically

## Single Responsibility

Good responsibilities:

```text
ProductionResolver
PopulationNeedCalculator
LaborAllocator
MarketPriceCalculator
ShipmentResolver
MigrationPolicy
NPCBusinessPlanner
SaveGameRepository
OpportunityDetector
EconomicTelemetry
```

Risky:

```text
EconomyManager
```

when it controls production, markets, population, logistics, NPCs, saves, rendering, and UI.

If a class description repeatedly requires the word **"and"**, inspect whether it owns too much.

## Open/Closed

Prefer adding commodities and recipes through configuration.

Do not require editing a giant switch every time a new product is introduced.

## Liskov

Implementations of a capability must honor the same contract.

Do not force objects to implement capabilities they cannot meaningfully support.

## Interface Segregation

Prefer small capabilities:

```text
InventoryHolder
WalletHolder
Producer
Consumer
Employer
TransportProvider
MarketParticipant
```

Do not create one huge `IGameEntity`.

## Dependency Inversion

High-level economy policy should not depend directly on UI, Canvas, or persistence details.

---

# 8. Universal Production Law

The core rule of the game is:

> Nothing important appears simply because a timer finished.

Every economic transformation should be traceable to:

```text
PRODUCER
+
CONSUMABLE INPUTS
+
CAPACITY REQUIREMENTS
+
EQUIPMENT / INFRASTRUCTURE
+
TIME
=
OUTPUT
```

Conceptually:

```text
ProductionRecipe
├── producerType
├── consumableInputs
├── capacityRequirements
├── equipmentRequirements
├── duration
├── outputs
└── optionalByproducts
```

This law should govern:

- farming,
- logging,
- mining,
- food processing,
- manufacturing,
- construction,
- infrastructure,
- transportation capacity where appropriate.

---

# 9. Consumable Inputs vs Capacity Requirements

Do not treat every requirement as an item that disappears.

## Consumable inputs

Examples:

```text
Crops
Logs
Iron Ore
Fuel
Animal Feed
Raw Meat
Construction Materials
```

These are consumed, transformed, or transferred.

## Capacity requirements

Examples:

```text
Workers
Land
Housing Capacity
Storage
Transport Capacity
Building Capacity
Construction Capacity
Time
```

These are occupied, allocated, or constrained.

Workers do not turn into bread.

A farm requiring four workers means four units of labor capacity are committed.

---

# 10. Equipment Requirements

Equipment may provide:

- eligibility,
- productivity,
- durability,
- quality,
- reduced labor requirement.

Examples:

```text
Primitive Tools
Stone Tools
Iron Tools
Machinery
```

Do not require the first implementation to model complex durability unless gameplay benefits.

Keep equipment rules explicit and configurable.

---

# 11. Avoid Impossible Bootstrap Loops

Never create a chain such as:

```text
Sawmill requires Lumber
but
Lumber requires Sawmill
```

unless a primitive alternative exists.

Use civilization bootstrap tiers.

Example:

```text
Raw Logs
→ Primitive Shelter

Raw Stone + Wood
→ Primitive Tools

Primitive Tools
→ Better Logging

Logs
→ Sawmill
→ Lumber
```

Primitive systems should be inefficient but capable of creating the first advanced systems.

---

# 12. First Production Economy

The initial economy should remain understandable.

Recommended foundation:

```text
NATURAL WORLD
    │
    ├── Forest
    │    ↓
    │   Logs
    │    ↓
    │   Lumber
    │
    ├── Farmland
    │    ↓
    │   Crops
    │    ├── Basic Food
    │    └── Animal Feed
    │          ↓
    │       Livestock
    │          ↓
    │       Raw Meat
    │          ↓
    │      Cooked Meat
    │
    ├── Stone Deposit
    │    ↓
    │ Rough Stone
    │    ↓
    │ Cut Stone
    │
    └── Iron Deposit
         ↓
       Iron Ore
         ↓
        Iron
         ↓
      Iron Tools
```

Then:

```text
Crops
+
Cooked Meat
+
Cooking Capacity
=
Prepared Meal
```

And:

```text
Lumber
+
Stone
+
Workers
+
Tools
+
Construction Time
=
House
```

---

# 13. Recommended Early Commodity Set

Keep the first meaningful economy around approximately this scope.

## Raw

```text
Logs
Crops
Rough Stone
Iron Ore
```

## Processed

```text
Lumber
Cut Stone
Animal Feed
Raw Meat
Iron
```

## Consumer

```text
Basic Food
Cooked Meat
Prepared Meal
```

## Manufactured

```text
Basic Tools
Iron Tools
```

Do not add dozens of commodities until the existing chains create interesting decisions.

---

# 14. Production Chains Should Interlock

Every major chain should depend on another chain eventually.

Example:

```text
Agriculture
→ feeds Population

Population
→ provides Workers

Workers
→ operate Logging and Mining

Logging + Mining
→ provide Construction Materials

Construction
→ creates Housing and Factories

Housing
→ permits Population growth

Factories
→ create better Tools

Better Tools
→ improve Agriculture / Mining / Construction
```

This creates circular economic dependency.

Avoid isolated minigame industries.

---

# 15. Population Is an Economic System

Population is not decorative.

Population:

```text
Consumes
├── Food
├── Housing
└── later consumer goods

Produces
└── Labor Capacity
```

Track at minimum:

```text
Population
WorkingAgePopulation
AvailableWorkers
EmployedWorkers
UnemployedWorkers
HousingCapacity
FoodSupply
```

Do not simulate every citizen as a full authoritative entity unless future gameplay genuinely requires it.

Aggregate population groups are preferred.

---

# 16. Population Needs — Start Small

Initial needs:

```text
Food
Housing
Employment
```

Do not immediately add:

- medicine,
- crime,
- education,
- entertainment,
- religion,
- politics,
- dozens of happiness modifiers.

Add needs when they introduce meaningful production, trade, or strategic decisions.

---

# 17. Food Quantity and Food Quality

Food should eventually have two concepts:

```text
Supply
Quality
```

Raw crops may prevent starvation but support population inefficiently.

Processed meals may provide:

- more food value per transported unit,
- better health,
- better productivity,
- better migration attractiveness,
- faster growth.

Do not add nutrition micromanagement unless it creates gameplay.

A simple tiered food-quality system is preferred first.

---

# 18. Labor Is a Scarce Capacity

Buildings should not operate at full output simply because they exist.

Example:

```text
Farm

Required Workers: 4
Assigned Workers: 2
```

Possible starting rule:

```text
LaborEfficiency
=
min(1, AssignedWorkers / RequiredWorkers)
```

Then:

```text
ActualOutput
=
BaseOutput × LaborEfficiency × EquipmentModifier × OtherModifiers
```

Do not hard-code the exact formula across every building.

Use a production policy or recipe system.

---

# 19. Construction Competes for Labor

Construction workers are not free.

If a city has:

```text
12 available workers
```

and they are all producing food, lumber, and stone, constructing another building should require reallocating labor.

Expansion should temporarily cost productive capacity.

That produces meaningful tradeoffs.

---

# 20. Population Growth Must Have Requirements

Do not use:

```text
every N seconds
→ +1 population
```

without economic cause.

Population growth or migration should consider:

```text
Food Supply
Housing
Jobs
Wages
Living Conditions
```

A simple early model is acceptable.

The critical principle is:

> A functioning economy produces population growth.

---

# 21. Prefer Migration Before Detailed Birth Simulation

For the early game, migration is easier to understand and more responsive.

Example loop:

```text
Factory Expansion
↓
Labor Shortage
↓
Wages Rise
↓
City Attractiveness Rises
↓
Migration
↓
Population Grows
↓
Housing Demand Rises
↓
Construction Boom
```

The reverse should also be possible:

```text
Unemployment
↓
Low Wages
↓
Out-Migration
↓
Consumer Demand Falls
```

---

# 22. Household Consumption Creates Demand

Population should create market demand.

Households receive income through wages and then consume.

Conceptually:

```text
Companies
↓ wages
Households
↓ purchases
Markets
↓ revenue
Companies
```

This creates a circular economy.

Do not make all consumer goods vanish through an arbitrary global drain if household demand can provide the reason.

---

# 23. Aggregate Households First

Do not simulate:

```text
Citizen #348 walks to Bakery #19
```

as authoritative economy behavior.

Prefer cohorts such as:

```text
Labor Households
Craft Households
Professional Households
```

or simply aggregate households initially.

Visual citizens may later walk around without being the authoritative consumer simulation.

---

# 24. Consumer Demand Can Evolve With Prosperity

Later economic classes may demand different products.

Example:

```text
Basic households
→ basic food
→ simple housing
→ fuel

Prosperous households
→ prepared meals
→ furniture
→ better housing
→ services

Wealthy households
→ luxury goods
→ imported goods
→ entertainment
```

Do not add economic classes until basic household demand works.

---

# 25. Goods Must Exist Somewhere

Every physical good should have a location.

Examples:

```text
100 Lumber at Warehouse A
40 Meat at Market B
500 Iron in Shipment C
```

Avoid magical global inventories.

Spatial location is necessary for:

- logistics,
- storage,
- trade,
- production bottlenecks,
- regional pricing.

---

# 26. Storage Is Productive Capacity

Warehouses produce:

```text
Storage Capacity
```

If storage is full:

```text
Production
→ slows or stops
```

Do not allow unlimited accumulation without consequence.

---

# 27. Logistics Is an Economic System

Goods should not teleport between regions.

A shipment should conceptually contain:

```text
Origin
Destination
Commodity
Quantity
TransportCapacity
Cost
DepartureTime
ArrivalTime
Status
```

The renderer may animate a cart or dot.

Animation never determines authoritative arrival.

---

# 28. Geography Must Affect Economics

Examples:

```text
Forest
→ wood opportunity

Mountain
→ minerals

Farmland
→ agriculture

Coast
→ port opportunity

Distance
→ transport cost

Road
→ transport efficiency

Elevation
→ construction / route cost
```

The isometric map should be strategically meaningful, not merely decorative.

---

# 29. Regional Markets Are Core Gameplay

Do not make every good share one universal price.

Each region or settlement may have:

```text
Inventory
Demand
Supply
Recent Production
Recent Consumption
Imports
Exports
Price
Price Trend
```

Regional differences create:

- specialization,
- arbitrage,
- logistics,
- shortages,
- trade routes,
- investment opportunities.

---

# 30. Price Discovery Should Be Understandable

Early market pricing may use a simplified scarcity model.

Required behavior:

```text
Supply rises faster than demand
→ price tends downward

Demand rises faster than supply
→ price tends upward
```

Do not let prices become arbitrary random numbers.

The player should be able to inspect why a price moved.

Example:

```text
Food +18%

Reasons:
Local inventory low
Population increased
Imports declined
```

---

# 31. Shortage Detection Is a Signature System

A region should classify market conditions using signals such as:

```text
Current Demand
Available Supply
Inventory Coverage
Unfilled Demand
Price Deviation
Import Dependence
Recent Production
```

Possible statuses:

```text
Severe Shortage
Shortage
Balanced
Oversupplied
Severe Oversupply
```

The exact thresholds belong in configuration.

---

# 32. Opportunity Engine

The game should help the player discover economic opportunities without solving the game for them.

Example:

```text
IRONHOLD

Food
Severe Shortage

Current Price       22
Regional Median     13
Inventory Coverage  2.1 days

Possible Responses
• Produce Food
• Import Food
```

The game exposes information.

The player decides what to do.

Avoid:

```text
BUY FOOD NOW
GUARANTEED PROFIT
```

---

# 33. NPC Cities Replace Multiplayer Demand

NPC cities create the larger economy.

An NPC city can be simulated economically without rendering every building at full player-city detail.

Conceptually:

```text
CityEconomy
├── population
├── local resources
├── production capacities
├── inventories
├── household demand
├── imports
├── exports
├── wages
└── local prices
```

Example specialization:

```text
Greenvale
→ agriculture

Ironhold
→ iron + coal + steel

Port Azure
→ trade + imports
```

NPC cities should create believable comparative advantages.

---

# 34. NPC Companies Replace Human Competitors

NPC companies create:

- supply,
- competition,
- expansion,
- bankruptcies,
- changing market share,
- investment.

They do not need complex AI.

Prefer heuristic strategies.

Examples:

## Producer

```text
estimate profitable goods
→ choose viable industry
→ acquire inputs
→ produce
→ sell
```

## Trader

```text
compare regional prices
→ subtract transport cost
→ choose positive-margin route
→ buy
→ ship
→ sell
```

## Builder

```text
observe housing / infrastructure demand
→ buy construction goods
→ construct
```

## Expander

```text
retain profit
→ add capacity when expected return is acceptable
```

---

# 35. NPCs Must Follow the Economy

NPC companies should not receive magical advantages unless explicitly part of difficulty design.

Prefer the same rules for:

- production inputs,
- labor,
- transport,
- market prices,
- construction costs.

NPC decision-making may be simpler than the player's.

Execution rules should remain shared.

---

# 36. NPCs Need Imperfection

Perfect economic agents create sterile markets.

NPCs may differ in:

```text
Risk Tolerance
Planning Horizon
Industry Preference
Minimum Profit Threshold
Expansion Aggressiveness
Information Accuracy
Cash Reserve Preference
```

This creates diverse behavior.

Do not add personality systems unrelated to economics.

---

# 37. Economic Competition Should Be Emergent

Do not arbitrarily say:

```text
player may own only 10 farms
```

Prefer real constraints:

- labor,
- inputs,
- land,
- storage,
- maintenance,
- logistics,
- management overhead,
- market demand,
- price collapse from oversupply.

Large businesses should be possible but require competence.

---

# 38. Oversupply Must Hurt

If every farm continues earning the same profit regardless of market saturation, the economy is fake.

Example:

```text
Many Farms
↓
Food Supply Rises
↓
Inventories Rise
↓
Food Price Falls
↓
Margins Fall
↓
Some Producers Stop Expanding / Exit
```

This is a core balancing mechanism.

---

# 39. Shortages Must Create Opportunity

Example:

```text
Mine Closure
↓
Iron Supply Falls
↓
Iron Price Rises
↓
Tool Costs Rise
↓
Construction Costs Rise
↓
New Iron Production Becomes More Profitable
```

Economic problems should often generate new gameplay opportunities.

---

# 40. Money Should Circulate

Single-player does not require unlimited money faucets.

Prefer money movement among:

```text
Player
NPC Companies
Households
Cities
Government / Treasury
```

Track:

```text
Money Supply
Wages
Consumer Spending
Business Revenue
Taxes / Fees if implemented
Government Spending
```

Do not create money casually merely to keep the player profitable.

---

# 41. Money Supply Still Matters

Even in single-player, runaway NPC money creation can destroy price meaning.

If money is created:

```text
record source
record amount
record reason
```

If money is destroyed:

```text
record sink
record amount
record reason
```

Possible limited faucets:

- starting money,
- specific government spending,
- scenario funding.

Possible sinks:

- maintenance,
- construction fees,
- taxes,
- bankruptcy losses,
- resource-right fees.

Do not overcomplicate monetary policy until needed.

---

# 42. The Ledger Is Still Useful

Every important money movement should be explainable.

Conceptually:

```text
LedgerEntry
├── id
├── source
├── destination
├── amount
├── reason
├── reference
└── simulationTime
```

The ledger supports:

- debugging,
- profit analysis,
- save investigation,
- balance testing.

It does not need blockchain properties.

---

# 43. Exact Currency Arithmetic

Do not use arbitrary floating-point arithmetic for authoritative money.

Prefer integer smallest units.

Example:

```text
1 Credit
=
100 subunits
```

Display formatting is separate.

If the existing project already has an exact money representation, reuse it.

Do not invent a library.

---

# 44. Quantities Need Explicit Precision

If fractional goods exist, define:

```text
smallest unit
rounding stage
rounding direction
```

Do not let JavaScript floating-point accidents determine economic outcomes.

Integer resource units are acceptable for the first game version.

---

# 45. Time Is a Simulation Input

Use a simulation clock.

Do not bind authoritative economics directly to wall-clock browser time.

Prefer:

```text
SimulationClock
├── currentGameTime
├── speed
└── paused
```

The player may run:

```text
Paused
1x
2x
5x
10x
```

Developer mode may support higher speeds.

Production, shipments, population, markets, and contracts use simulation time.

---

# 46. Rendering Frames Are Not Simulation Ticks

Critical:

```text
Economy Simulation
≠
requestAnimationFrame
```

Do not run all markets and population logic at 60 FPS.

Use appropriate cycles.

Example:

```text
Movement Presentation
→ render frame

Production
→ command / scheduled completion

Market Update
→ economic interval

Population Consumption
→ daily simulation cycle

Migration
→ weekly/monthly simulation cycle
```

Exact cadence is configurable.

---

# 47. Determinism Matters

Given:

```text
same initial state
same seed
same commands
same policy versions
```

the simulation should produce the same results where practical.

Random events should use:

- deterministic seeded randomness,
- recorded results,
- or both.

This enables reproducible bugs and balance tests.

---

# 48. Save System

Authoritative save data may include:

```text
World State
Simulation Time
Player Economy
Population
Companies
Cities
Inventories
Markets
Production Jobs
Shipments
Contracts
Policies / Version
Random Seed / RNG State if needed
```

Do not persist renderer objects.

Do not persist:

```text
CanvasPath
DOMNode
Mesh
Texture
HoveredTile
OpenPanel
```

unless a presentation preference genuinely needs persistence.

---

# 49. Browser Persistence

Prefer the repository's existing persistence solution.

If none exists, a browser persistence mechanism such as IndexedDB may be appropriate.

Codex must verify actual project dependencies and APIs before implementation.

Do not invent wrapper methods.

Support, when useful:

```text
Autosave
Manual Save
Save Slots
Export Save
Import Save
```

Do not add all of them before basic persistence works.

---

# 50. Save Compatibility

Persistent simulation games evolve.

Save data should have an explicit version.

Conceptually:

```text
saveVersion
```

When schema changes:

- migrate intentionally,
- reject incompatible saves clearly when migration is impossible,
- never silently reinterpret old fields.

Balance configuration versioning may also be useful.

---

# 51. Simulation Rules Must Be Separate From Presentation

The economy must not know:

- isometric projection,
- Canvas coordinates,
- DOM components,
- voxel models,
- textures,
- shaders,
- animation state.

Presentation consumes read models.

Conceptually:

```text
Simulation
↓
WorldSnapshot
↓
PresentationMapper
↓
SceneDescription
↙             ↘
Primitive      Future Voxel
Renderer       Renderer
```

---

# 52. Voxel Readiness Rule

Ask:

> If every primitive shape were replaced by voxel models tomorrow, would production, markets, population, inventory, logistics, construction, and saves remain unchanged?

Expected answer:

```text
Yes.
```

If no, presentation and simulation are too tightly coupled.

---

# 53. Logical Cell vs Visual Voxel

Maintain:

```text
Logical Cell
=
Gameplay Unit

Visual Voxel
=
Rendering Unit
```

A farm might occupy:

```text
2 × 3 logical cells
```

but visually contain hundreds of voxel cubes later.

Production formulas must not depend on visual voxel count.

---

# 54. City Growth Is Economic

Avoid:

```text
cityLevel += 1
```

as the primary cause of progression.

City growth should arise from:

```text
Population
Food
Housing
Jobs
Industry
Infrastructure
Trade
```

A label such as:

```text
Hamlet
Village
Town
City
Metropolis
```

may summarize underlying conditions.

The label should not replace them.

---

# 55. Economic Era Progression

Possible progression:

```text
Settlement
↓
Village
↓
Town
↓
Industrial City
↓
Metropolis
```

Example town requirements might include:

```text
Population
Food Security
Housing
Employment
Market Access
Road Connection
```

Industrialization may require:

```text
Processed Materials
Iron
Advanced Tools
Large-Scale Production
Transport Infrastructure
```

The exact thresholds are balance configuration.

---

# 56. Industrialization Should Transform Labor

Technology should not only say:

```text
+20% Production
```

Prefer meaningful structural changes.

Example:

```text
Primitive Farm
10 Workers
100 Crops

Improved Farm
6 Workers
150 Crops

Mechanized Farm
3 Workers
300 Crops
+ Fuel
+ Machinery
```

Industrialization:

```text
increases output
+
frees labor
+
creates demand for manufactured inputs
```

Freed labor then moves into new industries.

---

# 57. Tools Are an Early Industrial Bridge

Suggested progression:

```text
Primitive Tools
↓
Basic Tools
↓
Iron Tools
↓
Machines
```

Better tools may affect:

- labor requirements,
- productivity,
- construction speed,
- extraction efficiency.

Use configuration.

Do not scatter tool bonuses across industry code.

---

# 58. Fuel and Energy Should Be Added When They Create Tradeoffs

Early energy may be:

```text
Firewood
Charcoal
Coal
```

Potential consumers:

```text
Households
Cookhouses
Smelters
Factories
```

Do not implement electricity before existing fuel constraints create meaningful gameplay.

---

# 59. Infrastructure Produces Capacity

Infrastructure outputs can be intangible.

Examples:

```text
Road
→ Transport Efficiency

Warehouse
→ Storage Capacity

Housing
→ Population Capacity

Port
→ Trade Capacity

Rail
→ High-Capacity Transport
```

Treat these as real production outputs even when they are not inventory items.

---

# 60. Contracts Create Direction

Sandbox economies need short-term goals.

Contracts should ideally arise from simulated needs.

Examples:

```text
Food Shortage
→ Emergency Food Contract

Housing Boom
→ Lumber Contract

Rail Project
→ Steel + Stone + Labor Contract
```

Avoid arbitrary quests disconnected from the economy.

---

# 61. Major Projects Create Mid/Late-Game Goals

Examples:

```text
Railway
Port Expansion
Bridge
Industrial District
Power Network
Large Housing Development
```

Projects require large production chains.

Completion should modify underlying economy.

Example:

```text
Railway Completed
→ Transport Cost -35%
→ Capacity +80%
→ New Trade Routes
```

Do not reward only with abstract XP.

---

# 62. Economic Events Should Modify Real Variables

Examples:

```text
Drought
Mine Discovery
Mine Depletion
Population Boom
Construction Boom
Trade Disruption
Crop Disease
```

Bad:

```text
Drought:
Player loses 1000 coins.
```

Better:

```text
Drought:
Crop yield -35%
↓
Food inventories decline
↓
Prices rise
↓
Imports become profitable
```

Events should create consequences through the economy.

---

# 63. Recessions Are Allowed

The economy should not increase forever.

Possible cycle:

```text
Factory Boom
↓
Oversupply
↓
Price Collapse
↓
Business Losses
↓
Layoffs
↓
Household Spending Falls
↓
Recession
↓
Capacity Exits / Demand Recovers
```

Do not force a recession formula before basic markets work.

But avoid design assumptions that guarantee permanent growth.

---

# 64. Bankruptcy Is a Recovery System

Failure should matter without automatically ending the save.

Possible recovery actions:

```text
Sell Assets
Close Facilities
Reduce Workforce
Liquidate Inventory
Take Contracts
Change Industry
Restructure Debt later
```

The game should permit comeback stories.

Avoid making strategic default profitable.

---

# 65. NPC Companies Can Fail

NPC competition becomes believable if companies can:

- lose money,
- shrink,
- close factories,
- change industries,
- fail,
- be replaced by new entrants.

Do not protect NPC businesses from bad economics merely to keep markets populated.

Instead allow new firms or city production to respond to shortages.

---

# 66. New Entrants Preserve Market Dynamism

When a profitable shortage persists:

```text
High Prices
+
Strong Demand
+
Available Inputs
↓
NPC Entry Becomes More Likely
```

This prevents permanent shortages and creates competition.

The response should take time and resources.

Do not instantly spawn perfect supply.

---

# 67. Market Concentration Is a Diagnostic Metric

Track concentration because one NPC or the player may dominate an industry.

Useful metrics:

```text
Largest Supplier Share
Top-N Share
HHI if useful
Entry Rate
Exit Rate
Price Behavior
```

Do not automatically punish dominance.

Use concentration to understand economy health.

---

# 68. Resource Substitution Creates Adaptation

Later, important resources may have alternatives.

Example:

```text
Expensive Firewood
→ Coal becomes attractive

Expensive Steel
→ Alternative construction materials become attractive
```

Substitution should require tradeoffs.

Do not add substitute goods merely to inflate commodity count.

---

# 69. Scarcity Must Remain Local

A large or eventually infinite world can still have economic scarcity through:

```text
Distance
Resource Quality
Terrain
Infrastructure
Labor
Time
Storage
Transport
Capital
```

Do not place every required resource next to the player.

The player should sometimes trade rather than self-produce.

---

# 70. Self-Sufficiency Should Not Always Be Optimal

A common single-player failure mode is:

```text
build one of everything
→ never trade
```

Design comparative advantage.

Examples:

```text
Player Region
Rich Farmland
Poor Iron

Ironhold
Rich Iron
Poor Food
```

The player may specialize.

Vertical integration should have costs.

---

# 71. Profit Must Include Real Costs

When showing profitability, include relevant costs.

Example:

```text
Revenue
- Input Cost
- Wages
- Transport
- Maintenance
- Fees / Taxes if present
=
Operating Profit
```

Do not display gross revenue as profit.

---

# 72. Failure Feedback Should Be Explanatory

Example:

```text
This shipment lost 210 Credits.

Purchase Cost      800
Transport          240
Sale Revenue       830
----------------------
Loss              -210

Reason:
Food prices fell while cargo was in transit.
```

The player should learn from loss.

---

# 73. Economy Telemetry

Track enough data to understand the simulation.

At minimum consider:

```text
Money Supply
Commodity Prices
Price Inflation / CPI
Population
Employment
Wages
Production
Consumption
Regional Inventories
Imports
Exports
Trade Volume
Company Profit
Company Failures
Market Concentration
Resource Extraction
Housing Supply
Migration
```

Telemetry exists for balancing and UI.

Do not make the simulation depend on telemetry availability.

---

# 74. Player Success Metrics

For playtesting, track:

- time to first profit,
- time to first shortage discovery,
- time to first production chain,
- time to first trade route,
- percentage of player income by sector,
- number of viable strategies,
- recovery after first major loss,
- whether one strategy dominates,
- whether self-sufficiency dominates trade.

The game is succeeding when players feel they discovered opportunities.

---

# 75. Dynamic Opportunity Is More Important Than Equal Prices

Do not try to stabilize every market into perfect equilibrium.

Perfect equilibrium can remove gameplay.

The economy should continually create:

- temporary shortages,
- temporary oversupply,
- regional differences,
- changing margins,
- new technologies,
- new population needs.

The goal is believable motion, not static perfection.

---

# 76. Accelerated Simulation Is a Development Requirement

Developer mode should support rapid economic testing.

Possible speeds:

```text
1x
5x
20x
100x
```

or deterministic batch advancement.

Do not tie accelerated simulation to rendering FPS.

Run long scenarios:

```text
1 year
5 years
10 years
50 years
```

where practical.

---

# 77. Deterministic Test Scenarios

Maintain reproducible scenarios such as:

```text
Balanced Economy
Food Shortage
Food Oversupply
Iron Shortage
Transport Bottleneck
Population Boom
Industrial Boom
Company Bankruptcy
Regional Recession
Resource Depletion
Mature Economy
```

Use deterministic seeds.

A balance bug should be reproducible.

---

# 78. Simulation Stress Questions

Before adding more systems, ask:

```text
Do NPC cities survive?
Do markets remain active?
Do prices become permanently flat?
Do shortages still emerge?
Does one strategy dominate?
Does self-sufficiency beat specialization every time?
Can NPC companies adapt?
Can companies fail and be replaced?
Can recessions recover?
Does population explode without limit?
Does money supply explode?
Does one commodity become irrelevant?
```

Fix core feedback loops before adding more content.

---

# 79. Balance Changes Require Simulation

For major changes:

1. define the hypothesis,
2. identify affected loops,
3. identify metrics,
4. run repeatable scenarios,
5. compare before/after,
6. inspect unintended consequences,
7. test early, mid, and late game.

Examples:

```text
increase farm output
raise wages
change transport cost
reduce housing capacity
increase tool efficiency
change migration sensitivity
```

Never balance only from intuition when the simulator can test the change.

---

# 80. TypeScript Domain Design

Prefer domain-oriented modules.

Conceptual organization:

```text
simulation/
  clock/
  commands/
  events/

world/
  terrain/
  land/
  resources/
  cities/

economy/
  money/
  inventory/
  production/
  population/
  labor/
  households/
  markets/
  logistics/
  companies/
  contracts/
  migration/
  telemetry/

ai/
  companies/
  cities/

persistence/
  saves/

presentation/
  world/
  hud/
```

Do not create folders simply because they appear here.

Adapt to the repository.

---

# 81. Strong Domain Types

Consider explicit domain types where primitive confusion is dangerous.

Examples:

```text
CityId
CompanyId
BuildingId
InventoryId
CommodityId
RegionId
Money
Quantity
GameTime
WorldPosition
```

Avoid unreadable APIs such as:

```text
transfer(12, 90, 500)
```

Prefer self-describing objects or typed parameters.

Do not wrap every primitive without benefit.

---

# 82. Commands Request; Events Report

Commands:

```text
BuildStructure
AssignWorkers
StartProduction
CreateShipment
BuyCommodity
SellCommodity
AcceptContract
```

Events:

```text
StructureBuilt
WorkersAssigned
ProductionCompleted
ShipmentArrived
CommodityPurchased
CommoditySold
ContractCompleted
```

Do not use an event bus as a hidden command system.

---

# 83. Explicit State Ownership

Every mutable state has one obvious owner.

Examples:

```text
Wallet
→ owns cash

Inventory
→ owns commodity quantities

PopulationState
→ owns population counts

LaborState
→ owns worker allocation

ProductionJob
→ owns production lifecycle

Shipment
→ owns shipment lifecycle

Market
→ owns local market state
```

Prefer:

```text
request
→ owner validates
→ owner mutates
→ owner emits result
```

Avoid multiple unrelated systems directly editing the same fields.

---

# 84. Economic Invariants

Before implementing a sensitive feature, define what must remain true.

## Money

```text
No unexplained money creation
No unexplained money destruction
Exact arithmetic
```

## Inventory

```text
No negative stock unless explicitly supported
No duplicated goods
Reserved goods cannot be spent twice
```

## Production

```text
Output requires completed valid production
Required consumables are accounted for
Required capacity is available
```

## Labor

```text
Assigned workers cannot exceed available labor
One worker unit cannot be allocated to two full-time jobs simultaneously
```

## Logistics

```text
Cargo exists in one authoritative location/state
Arrival does not duplicate cargo
```

## Population

```text
Population changes through defined migration/growth/death rules
Housing and labor derived values remain internally consistent
```

---

# 85. Atomic Local Transactions

Even without network concurrency, complex actions should resolve as one logical operation.

Example purchase:

```text
validate money
validate supply
decrease buyer money
increase seller money
decrease seller inventory
increase buyer inventory
record trade
```

Do not leave half-completed economic operations if an exception occurs.

Use repository transaction/state-update patterns.

---

# 86. Idempotency Is Optional, Not Default

Multiplayer/network retry idempotency is no longer a universal requirement.

Use idempotency where the local architecture can replay commands:

- save recovery,
- event replay,
- queued jobs,
- worker message retries.

Do not add idempotency infrastructure to every action without a real retry path.

---

# 87. Concurrency Is Optional, Not Default

A local single-threaded simulation may not need complex database locking.

Do not preserve multiplayer concurrency architecture merely from habit.

If Web Workers or asynchronous persistence are introduced, explicitly define:

- who owns mutable state,
- message boundaries,
- snapshot consistency.

Prefer one simulation owner.

---

# 88. Web Workers — Only When Needed

If simulation becomes expensive, a Web Worker may eventually own the simulation.

Potential boundary:

```text
UI Thread
↓ commands
Simulation Worker
↓ snapshots/events
UI Thread
```

Do not introduce worker complexity before profiling.

If used, the worker should ideally become the single authoritative simulation owner.

---

# 89. Performance Principle

Profile before optimizing.

Likely heavy systems later:

- large NPC economies,
- market updates,
- route calculations,
- population simulation,
- long accelerated runs,
- voxel rendering.

Do not prematurely optimize every loop.

Preserve boundaries that allow optimization later.

---

# 90. Do Not Simulate Decorative Detail Authoritatively

Avoid making:

```text
every tree
every citizen
every cart wheel
every crop stalk
```

a heavy economic entity unless gameplay requires it.

Use aggregate economic entities.

Presentation may create decorative instances.

Example:

```text
ForestResourceNode
```

may visually render many trees.

---

# 91. Policy Configuration

Balance values should live in owned configuration.

Examples:

```text
recipes
worker requirements
base productivity
food values
house capacities
transport cost curves
migration thresholds
NPC profit thresholds
market response factors
event modifiers
```

Do not scatter magic numbers.

Avoid one gigantic global config for everything.

---

# 92. Policy Versions

Major balance policies may need versioning for:

- save compatibility,
- debugging,
- experiment comparison.

Do not add elaborate version infrastructure until needed.

But avoid making historical saves impossible to interpret.

---

# 93. Avoid God Services

Warning signs:

```text
EconomyManager
WorldManager
SimulationManager
GameManager
```

owning everything.

A `GameSimulation` orchestration root may legitimately coordinate systems.

It should not personally implement every rule.

Prefer:

```text
GameSimulation
├── Clock
├── Production
├── Population
├── Markets
├── Logistics
├── NPC Planning
└── Snapshot Builder
```

with focused responsibilities underneath.

---

# 94. Avoid a Global Event Bus as Default

Use direct calls/commands for requests.

Use events to announce completed facts.

Good:

```text
Production completes
→ ProductionCompleted
→ telemetry records it
→ UI log may display it
```

Bad:

```text
random event
→ event bus
→ five hidden systems mutate core state
```

Important mutation paths should be traceable.

---

# 95. React Rules

React is presentation.

Prefer arrow functions for React components and callbacks unless the existing repository uses another established convention.

Example:

```ts
const MarketPanel = () => {
  // presentation only
};
```

React components may:

- display snapshots,
- collect input,
- issue commands,
- hold temporary UI state.

React components should not own:

- authoritative money,
- production completion,
- market prices,
- population progression,
- NPC business logic.

---

# 96. Avoid Unnecessary Files

When implementing a feature:

- change only required files,
- reuse existing architecture,
- do not create package manifests,
- do not add libraries casually,
- do not generate unrelated docs,
- do not create an interface for every class.

Keep patches focused.

---

# 97. Do Not Prematurely Abstract

Good variation points may include:

- production recipe,
- NPC company strategy,
- market pricing policy,
- migration policy,
- transport pricing,
- event effect policy,
- persistence adapter,
- renderer boundary,
- world generation,
- building visual mapping.

Do not abstract simply because something could theoretically vary.

---

# 98. When Not to Abstract

Keep a direct implementation when:

- only one implementation exists,
- the code is local,
- ownership is clear,
- no real variation is planned,
- testing remains straightforward.

Create an abstraction when:

- multiple implementations exist,
- a second implementation is clearly planned,
- the boundary protects important domain rules,
- infrastructure must be replaceable,
- the behavior is a major balance policy,
- the renderer has a known replacement path.

---

# 99. Architecture Smells

Treat these as warnings:

- React state owns the economy.
- Rendering objects own economic data.
- A factory directly edits population.
- A market directly edits UI.
- NPCs bypass production rules.
- Goods teleport between cities.
- Workers are duplicated across jobs.
- Buildings produce without requirements.
- Production output appears without a producer.
- Money appears without an economic reason.
- Every city becomes self-sufficient.
- One strategy is profitable regardless of supply.
- Prices move randomly with no explainable cause.
- One global market eliminates geography.
- Every citizen is simulated individually without gameplay benefit.
- The game runs economic logic every animation frame.
- Save data contains Canvas or voxel objects.
- Adding one commodity requires modifying many unrelated systems.
- A giant switch controls every recipe or building.
- A giant manager knows every system.
- Old multiplayer/crypto code complicates local gameplay.
- Final voxel concerns leak into production code.

---

# 100. Testing Strategy

## Unit Tests

Test:

- production formulas,
- food conversion,
- worker allocation,
- transport cost,
- market pricing,
- migration modifiers,
- household consumption,
- NPC profitability calculations.

## Invariant Tests

Verify:

```text
money conservation where transfers should conserve money
inventory conservation during transfers
no duplicate cargo
no negative stock
labor allocation does not exceed supply
production cannot complete without requirements
```

## Integration Tests

Test complete loops:

```text
Farm
→ Crops
→ Market
→ Household Consumption

Mine
→ Iron Ore
→ Processing
→ Tools
→ Productivity

Buy in City A
→ Shipment
→ Sell in City B
```

## Simulation Tests

Run long worlds and observe:

- prices,
- population,
- wages,
- shortages,
- oversupply,
- company survival,
- trade,
- money supply,
- concentration.

---

# 101. Codex Workflow

Before modifying gameplay code, Codex must:

1. identify the requested feature,
2. inspect the repository,
3. identify the authoritative local state owner,
4. identify whether the change affects decision, command, domain state, policy, persistence, or presentation,
5. identify relevant economic dependencies,
6. identify affected production chains,
7. identify affected economic invariants,
8. identify simulation-time impact,
9. identify save compatibility impact,
10. identify NPC behavior impact,
11. identify player feedback required,
12. identify telemetry needed,
13. reuse existing abstractions where appropriate,
14. avoid duplicate systems,
15. preserve renderer independence,
16. verify external/library APIs before coding.

---

# 102. Required Pre-Code Report

Before writing implementation code, Codex must state:

```text
Assumptions
Repository Findings
Affected Systems
Affected Files
Authoritative State Owner
Decision / Command Boundary
Economic Inputs
Economic Outputs
Economic Invariants
Production-Chain Impact
Population / Labor Impact
Market / Price Impact
NPC Behavior Impact
Simulation-Time Impact
Save Compatibility Impact
Renderer / Voxel Impact
Performance Risk
Architectural Risk
```

If a category is not relevant:

```text
Not affected
```

is acceptable.

Do not invent an effect merely to fill the report.

---

# 103. Verify Assumptions Before Implementation

Codex must not silently assume:

- framework APIs,
- storage APIs,
- test libraries,
- IndexedDB wrappers,
- renderer APIs,
- state-management APIs,
- existing simulation types,
- current save schema,
- command signatures.

Inspect code first.

Use methods actually available in the repository.

If a method is unknown:

> Do not guess.

State the assumption or request the signature when necessary.

---

# 104. Gameplay Feature Design Checklist

For every new economic feature, ask:

> Who produces it?

> What does the producer require?

> Which inputs are consumed?

> Which capacities are occupied?

> How much time is required?

> Where does the output physically go?

> Who consumes the output?

> What happens when it is scarce?

> What happens when it is oversupplied?

> Does geography matter?

> Does labor matter?

> Can an NPC use the same system?

> How does the player understand success or failure?

If an item has no consumer, question why it exists.

If an output has no producer, question where it comes from.

---

# 105. Content Addition Rule

Do not add a new commodity simply because more commodities seem realistic.

A new commodity should introduce at least one meaningful decision:

- new production dependency,
- new trade route,
- new bottleneck,
- new substitution choice,
- new population need,
- new industrial upgrade,
- new regional specialization.

If it only adds another icon and recipe, postpone it.

---

# 106. Building Addition Rule

A new building should have an economic role.

Ask:

```text
What capacity does it create?
What good does it produce?
What inputs does it require?
What problem does it solve?
What tradeoff does it introduce?
```

Avoid decorative economic buildings with no gameplay effect.

Decorative visuals belong to the renderer/art layer.

---

# 107. NPC Addition Rule

A new NPC strategy should exist because the economy needs a new type of behavior.

Examples:

```text
producer
trader
builder
expander
```

Do not create dozens of AI archetypes before the basic ones generate interesting markets.

---

# 108. Event Addition Rule

A new event should:

1. modify underlying economic variables,
2. create a readable consequence,
3. create a player response opportunity.

Avoid arbitrary random rewards/punishments.

---

# 109. Healthy Solo Economy Definition

The economy is healthy when:

- the player can identify opportunities,
- shortages occur but can be answered,
- oversupply reduces margins,
- geography creates specialization,
- NPC cities generate believable demand,
- NPC companies compete and adapt,
- production chains depend on each other,
- labor constrains expansion,
- population creates demand and labor,
- logistics matters,
- prices are explainable,
- failure is possible,
- recovery is possible,
- multiple strategies remain viable,
- long simulations do not trivially collapse or explode.

---

# 110. Healthy Player Experience Definition

The player should regularly experience:

```text
I need something
→ Why?
→ What produces it?
→ What does that producer require?
→ Should I produce it or trade for it?
```

and:

```text
I noticed a shortage
→ I invested
→ I supplied it
→ I profited
```

and sometimes:

```text
I misread the economy
→ I lost money
→ I understand why
→ I changed strategy
```

The player should feel economically intelligent, not merely patient.

---

# 111. Healthy NPC Economy Definition

NPCs should:

- create demand,
- create supply,
- react imperfectly,
- expand,
- shrink,
- fail,
- enter profitable markets,
- leave persistently unprofitable markets.

NPCs should not:

- know future prices perfectly,
- teleport goods,
- ignore input costs,
- ignore labor,
- receive infinite money,
- always choose optimal actions.

---

# 112. Healthy Production System Definition

A production system is healthy when:

- every output has a producer,
- every producer has explicit requirements,
- inputs and capacities are distinct,
- labor matters,
- storage matters,
- location matters,
- output has a consumer,
- bottlenecks are visible,
- new recipes can be added without rewriting the executor.

---

# 113. Healthy Renderer Boundary Definition

The renderer is healthy when:

- the simulation works with the renderer disabled,
- saves contain no render objects,
- economic logic imports no rendering modules,
- primitive visuals can be replaced by voxel visuals,
- visual animations cannot change economic completion,
- camera and selection are presentation state.

---

# 114. Long-Term Expansion Order

After the core solo economy works, expand according to playtesting.

If players love **trading**, prioritize:

```text
ports
rail
warehouses
shipping
regional specialization
```

If players love **city management**, prioritize:

```text
housing classes
services
education
health
migration
```

If players love **industry**, prioritize:

```text
steel
machinery
energy
chemicals
advanced manufacturing
```

If players love **economic planning**, prioritize:

```text
loans
investment
stockpiles
advanced forecasting
```

Do not build all branches simultaneously.

---

# 115. Do Not Add Multiplayer Back Accidentally

Do not design ordinary systems around hypothetical future multiplayer.

The current game should not pay complexity costs for:

- network authority,
- synchronization,
- cheating clients,
- remote players,
- network latency,
- distributed locks.

If multiplayer ever returns, it requires a separate architectural review.

Do not make today's single-player code unnecessarily difficult for a hypothetical future.

---

# 116. Do Not Add Crypto Back Accidentally

Cryptocurrency, token value, deposits, withdrawals, blockchain settlement, and real-money trading are out of scope.

Do not create:

```text
SettlementProvider
CryptoWallet
TokenBalance
KYCService
BlockchainAdapter
```

unless the product direction explicitly changes.

The economy must be fun with internal game value only.

---

# 117. Final Guiding Principle

The core game law is:

```text
Requirement
+
Producer
+
Inputs
+
Labor / Capacity
+
Time
=
Output
```

The output then becomes:

```text
another producer's input
or
a population need
or
a construction requirement
or
a trade good
```

The world becomes a network of dependencies.

The player's fun comes from understanding that network.

The economy should create questions such as:

```text
Should I produce this myself?
Should I import it?
Should I expand?
Should I specialize?
Should I stockpile?
Should I automate?
Should I hire more workers?
Should I improve tools?
Should I build infrastructure?
```

The desired feeling is not:

> "I waited long enough, so I became rich."

It is:

> "I understood what the economy needed, built the right production chain, and profited from my decision."

Build:

```text
Economic causality
before
economic complexity
```

Build:

```text
Readable production chains
before
hundreds of commodities
```

Build:

```text
Living NPC markets
before
more visual polish
```

Build:

```text
Deterministic local simulation
before
performance optimization
```

Build:

```text
Renderer independence
before
voxel sophistication
```

That is the architecture and game-design standard for OpenWorld Economy.
