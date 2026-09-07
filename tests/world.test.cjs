/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness loads TypeScript in-process. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
// Test-process-only TS loading; type safety is checked separately by tsc/build.
const compileTypeScript = (jsx) => (module, filename) => {
  module._compile(
    ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2017,
        ...(jsx ? { jsx: ts.JsxEmit.ReactJSX } : {}),
      },
    }).outputText,
    filename,
  );
};
require.extensions[".ts"] = compileTypeScript(false);
require.extensions[".tsx"] = compileTypeScript(true);
// Presentation modules use the "@/" path alias that tsconfig maps to the repo root.
const nodePath = require("node:path");
const NodeModule = require("node:module");
const resolveFilename = NodeModule._resolveFilename;
NodeModule._resolveFilename = function (request, ...rest) {
  return resolveFilename.call(
    this,
    request.startsWith("@/")
      ? nodePath.join(__dirname, "..", request.slice(2))
      : request,
    ...rest,
  );
};
const {
  generateWorld,
  chunkOf,
  chunkRegions,
  resourceAt,
} = require("../world/domain/world.ts");
const {
  project,
  unproject,
  toScreen,
  screenToWorld,
  pickCell,
  panCamera,
  zoomCamera,
  focusCell,
  terrainFaces,
  visibleScene,
} = require("../presentation/world/projection.ts");
const world = generateWorld();
const viewport = { width: 1100, height: 700 };
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test("seeded semantic world is repeatable, bounded, elevated, and includes economic terrain", () => {
  assert.deepEqual(generateWorld(), world);
  assert.notDeepEqual(generateWorld("another-seed"), world);
  assert.equal(world.cells.length, 128 * 128);
  assert.deepEqual(
    new Set(world.cells.map((c) => c.terrain)),
    new Set(["grassland", "water", "mountain", "forest_ground", "farmland"]),
  );
  for (const cell of world.cells) {
    assert.ok(Number.isInteger(cell.z) && cell.z >= 0);
    if (cell.terrain === "water") assert.equal(cell.z, 0);
    else assert.ok(cell.z >= 1);
    assert.ok(cell.x >= 0 && cell.x < 128 && cell.y >= 0 && cell.y < 128);
  }
  assert.deepEqual(chunkOf({ x: 32, y: 63, z: 0 }, 32), { x: 1, y: 1 });
  assert.equal(world.chunks.length, 16);
  assert.throws(() => generateWorld("seed", 0), RangeError);
});

test("chunk regions cover uneven world edges exactly once", () => {
  const chunks = chunkRegions(70, 32);
  assert.equal(chunks.length, 9);
  assert.deepEqual(chunks.at(-1), {
    id: "2,2",
    x: 2,
    y: 2,
    minX: 64,
    minY: 64,
    maxX: 70,
    maxY: 70,
  });
  const coverage = new Set();
  for (const chunk of chunks) {
    for (let y = chunk.minY; y < chunk.maxY; y++)
      for (let x = chunk.minX; x < chunk.maxX; x++) coverage.add(`${x},${y}`);
  }
  assert.equal(coverage.size, 70 * 70);
  assert.throws(() => chunkRegions(70, 0), RangeError);
});

test("visible scene selects camera-local chunks with complete cell membership", () => {
  const camera = { focus: { x: 16, y: 16 }, zoom: 3 };
  const compactViewport = { width: 360, height: 240 };
  const scene = visibleScene(world, camera, compactViewport, 0);
  assert.ok(
    scene.chunks.length > 0 && scene.chunks.length < world.chunks.length,
  );
  assert.ok(scene.cells.length > 0 && scene.cells.length < world.cells.length);
  for (const cell of scene.cells) {
    const chunk = chunkOf(cell, world.chunkSize);
    assert.ok(scene.chunkIds.has(`${chunk.x},${chunk.y}`));
  }
  assert.ok(scene.cells.some((cell) => cell.x === 16 && cell.y === 16));
  assert.deepEqual(
    visibleScene(world, camera, compactViewport, 0).chunks,
    scene.chunks,
  );
});

test("resource nodes reference matching cells and preserve semantic reserves", () => {
  assert.deepEqual(world.resourceNodes.map((node) => node.type).sort(), [
    "forest",
    "forest",
    "iron",
    "stone",
  ]);
  for (const node of world.resourceNodes) {
    const cells = world.cells.filter((cell) => cell.resourceNodeId === node.id);
    assert.equal(cells.length, node.cellCount);
    assert.ok(node.estimatedReserve > node.cellCount);
    const anchor = world.cells[node.anchor.y * world.size + node.anchor.x];
    assert.equal(anchor.resourceNodeId, node.id);
    assert.equal(resourceAt(world, anchor), node);
    if (node.type === "forest")
      assert.ok(cells.every((cell) => cell.terrain === "forest_ground"));
    else assert.ok(cells.every((cell) => cell.terrain === "mountain"));
  }
  assert.ok(
    world.cells.some(
      (cell) => cell.terrain === "farmland" && !cell.resourceNodeId,
    ),
  );
  assert.ok(world.cells.some((cell) => cell.terrain === "forest_ground"));
});

test("settlement reserve stays grassland and construction rejects economic terrain", () => {
  const {
    withStartingSettlement,
    buildingDefinitions,
  } = require("../world/domain/settlement.ts");
  const { validatePlacement } = require("../world/domain/construction.ts");
  const settled = withStartingSettlement(world);
  for (const building of settled.buildings) {
    const definition = buildingDefinitions[building.type];
    for (let y = building.y; y < building.y + definition.depth; y++)
      for (let x = building.x; x < building.x + definition.width; x++) {
        assert.equal(settled.cells[y * settled.size + x].terrain, "grassland");
      }
  }
  for (const terrain of ["forest_ground", "farmland", "mountain"]) {
    const cell = settled.cells.find(
      (candidate) => candidate.terrain === terrain,
    );
    const isolatedRoad = {
      ...settled,
      roads: [{ x: cell.x, y: cell.y + 1, z: cell.z }],
    };
    assert.ok(
      validatePlacement(isolatedRoad, {
        type: "house",
        x: cell.x,
        y: cell.y,
        rotation: "north",
      }).reasons.includes("Requires grassland"),
    );
  }
});
test("projection preserves coordinates at different elevations", () => {
  for (const point of [
    { x: 0, y: 0, z: 0 },
    { x: 13.5, y: 90.5, z: 3 },
    { x: -4, y: 10, z: 7 },
  ]) {
    const result = unproject(project(point), point.z);
    close(result.x, point.x);
    close(result.y, point.y);
  }
});
test("flat terrain picking remains compatible at all zoom levels", () => {
  const generated = generateWorld("flat-test", 16);
  const world = {
    ...generated,
    cells: generated.cells.map((cell) => ({ ...cell, z: 0 })),
  };
  for (const zoom of [0.25, 1, 3]) {
    const camera = { focus: { x: 47.25, y: 82.5 }, zoom };
    for (const cell of world.cells) {
      const screen = toScreen(
        { x: cell.x + 0.5, y: cell.y + 0.5, z: 0 },
        camera,
        viewport,
      );
      assert.equal(pickCell(screen, camera, viewport, world), cell);
    }
    for (const x of [-0.1, 16.1])
      assert.equal(
        pickCell(
          toScreen({ x, y: 10, z: 0 }, camera, viewport),
          camera,
          viewport,
          world,
        ),
        null,
      );
  }
});
test("zoom retains world position under pointer and respects limits", () => {
  const camera = { focus: { x: 64, y: 64 }, zoom: 1 };
  const anchor = { x: 210, y: 320 };
  const before = screenToWorld(anchor, camera, viewport);
  const next = zoomCamera(camera, 1.7, anchor, viewport, world.size);
  const after = screenToWorld(anchor, next, viewport);
  close(before.x, after.x);
  close(before.y, after.y);
  assert.equal(zoomCamera(camera, 100, anchor, viewport, 128).zoom, 3);
  assert.equal(zoomCamera(camera, 0.001, anchor, viewport, 128).zoom, 0.25);
});
test("pan moves rendered tiles by pointer delta and clamps world focus", () => {
  const camera = { focus: { x: 64, y: 64 }, zoom: 1.5 };
  const cell = world.cells[100];
  const before = toScreen(cell, camera, viewport);
  const after = toScreen(
    cell,
    panCamera(camera, { x: 75, y: -40 }, 128),
    viewport,
  );
  close(after.x - before.x, 75);
  close(after.y - before.y, -40);
  const far = panCamera(camera, { x: 1e6, y: 1e6 }, 128);
  assert.ok(
    far.focus.x >= 0 &&
      far.focus.x <= 128 &&
      far.focus.y >= 0 &&
      far.focus.y <= 128,
  );
});

test("elevated top and exposed cliff picking work at each zoom", () => {
  const cells = Array.from({ length: 9 }, (_, i) => ({
    x: i % 3,
    y: Math.floor(i / 3),
    z: i === 4 ? 3 : 0,
    terrain: "grassland",
  }));
  const fixture = { seed: "cliff", size: 3, chunkSize: 32, cells };
  for (const zoom of [0.25, 1, 3]) {
    const camera = { focus: { x: 1.5, y: 1.5 }, zoom };
    const top = toScreen({ x: 1.5, y: 1.5, z: 3 }, camera, viewport);
    assert.equal(pickCell(top, camera, viewport, fixture), cells[4]);
    for (const face of terrainFaces(cells[4], fixture, camera, viewport)) {
      const center = face.points.reduce(
        (sum, point) => ({ x: sum.x + point.x / 4, y: sum.y + point.y / 4 }),
        { x: 0, y: 0 },
      );
      assert.equal(pickCell(center, camera, viewport, fixture), cells[4]);
    }
    const focused = toScreen(
      { x: 1.5, y: 1.5, z: 3 },
      { ...camera, focus: focusCell(cells[4]) },
      viewport,
    );
    close(focused.x, viewport.width / 2);
    close(focused.y, viewport.height / 2);
  }
});
test("nearby elevated terrain occludes a lower tile and shared sides are hidden", () => {
  const cells = Array.from({ length: 9 }, (_, i) => ({
    x: i % 3,
    y: Math.floor(i / 3),
    z: i === 4 ? 3 : 0,
    terrain: "grassland",
  }));
  const fixture = { seed: "overlap", size: 3, chunkSize: 32, cells };
  const camera = { focus: { x: 1, y: 1 }, zoom: 1 };
  const hidden = toScreen({ x: 0.5, y: 0.5, z: 0 }, camera, viewport);
  assert.equal(pickCell(hidden, camera, viewport, fixture), cells[4]);
  const plateau = {
    ...fixture,
    cells: cells.map((cell) => ({ ...cell, z: 3 })),
  };
  assert.deepEqual(
    terrainFaces(plateau.cells[4], plateau, camera, viewport).map(
      (face) => face.kind,
    ),
    ["top"],
  );
});

test("starting settlement has valid dry footprints and connected roads", () => {
  const {
    withStartingSettlement,
    buildingDefinitions,
  } = require("../world/domain/settlement.ts");
  const settled = withStartingSettlement(world);
  assert.ok(settled.settlement);
  assert.equal(settled.settlement.population, 10);
  assert.equal(settled.buildings.length, 6);
  assert.deepEqual(withStartingSettlement(world), settled);
  const occupied = new Set();
  for (const building of settled.buildings) {
    const definition = buildingDefinitions[building.type];
    for (let y = building.y; y < building.y + definition.depth; y++)
      for (let x = building.x; x < building.x + definition.width; x++) {
        const key = `${x},${y}`;
        assert.ok(!occupied.has(key));
        occupied.add(key);
        const cell = settled.cells[y * settled.size + x];
        assert.equal(cell.terrain, "grassland");
        assert.equal(cell.z, building.z);
      }
    assert.ok(
      settled.roads.some(
        (road) =>
          road.x >= building.x - 1 &&
          road.x <= building.x + definition.width &&
          road.y >= building.y - 1 &&
          road.y <= building.y + definition.depth,
      ),
    );
  }
  const remaining = new Set(settled.roads.map((road) => `${road.x},${road.y}`));
  for (const key of remaining) assert.ok(!occupied.has(key));
  const queue = [settled.roads[0]];
  remaining.delete(`${queue[0].x},${queue[0].y}`);
  while (queue.length) {
    const cell = queue.pop();
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const key = `${cell.x + dx},${cell.y + dy}`;
      if (remaining.delete(key)) queue.push({ x: cell.x + dx, y: cell.y + dy });
    }
  }
  assert.equal(remaining.size, 0);
  assert.deepEqual(settled.cells, world.cells);
});

test("building roof and wall picking return the building origin after zoom", () => {
  const { withStartingSettlement } = require("../world/domain/settlement.ts");
  const { buildingFaces } = require("../presentation/world/buildings.ts");
  const settled = withStartingSettlement(world);
  for (const zoom of [0.5, 1, 3])
    for (const building of settled.buildings) {
      const camera = { focus: focusCell(building), zoom };
      for (const face of buildingFaces(building, camera, viewport)) {
        const center = face.points.reduce(
          (sum, p) => ({ x: sum.x + p.x / 4, y: sum.y + p.y / 4 }),
          { x: 0, y: 0 },
        );
        assert.equal(
          pickCell(center, camera, viewport, settled),
          settled.cells[building.y * settled.size + building.x],
        );
      }
    }
});

test("lumber camp visual profiles swap presentation without changing domain state", () => {
  const { withStartingSettlement } = require("../world/domain/settlement.ts");
  const { withStartingProduction } = require("../world/domain/production.ts");
  const { buildingFaces, buildingVisualProfiles } = require("../presentation/world/buildings.ts");
  const settled = withStartingProduction(withStartingSettlement(world));
  const lumberCamp = settled.buildings.find((building) => building.type === "lumber_camp");
  assert.ok(lumberCamp);
  assert.deepEqual(buildingVisualProfiles.primitiveA.house, buildingVisualProfiles.primitiveB.house);
  assert.notDeepEqual(buildingVisualProfiles.primitiveA.lumber_camp, buildingVisualProfiles.primitiveB.lumber_camp);
  const semanticBuilding = structuredClone(lumberCamp);
  const camera = { focus: focusCell(lumberCamp), zoom: 2 };
  const facesA = buildingFaces(lumberCamp, camera, viewport, buildingVisualProfiles.primitiveA);
  const facesB = buildingFaces(lumberCamp, camera, viewport, buildingVisualProfiles.primitiveB);
  assert.notDeepEqual(facesA, facesB);
  assert.deepEqual(lumberCamp, semanticBuilding);
  const roofCenter = facesB[2].points.reduce(
    (sum, point) => ({ x: sum.x + point.x / 4, y: sum.y + point.y / 4 }),
    { x: 0, y: 0 },
  );
  assert.equal(
    pickCell(roofCenter, camera, viewport, settled, undefined, buildingVisualProfiles.primitiveB),
    settled.cells[lumberCamp.y * settled.size + lumberCamp.x],
  );
});

test("no suitable site leaves terrain unchanged and omits the settlement", () => {
  const { withStartingSettlement } = require("../world/domain/settlement.ts");
  const tiny = generateWorld("tiny", 8);
  const result = withStartingSettlement(tiny);
  assert.equal(result.settlement, undefined);
  assert.deepEqual(result.buildings, []);
  assert.equal(result.cells, tiny.cells);
});

test("placement validation handles rotation, access, terrain, slopes, and occupancy", () => {
  const {
    withStartingSettlement,
    footprintOf,
  } = require("../world/domain/settlement.ts");
  const {
    validatePlacement,
    placeBuilding,
  } = require("../world/domain/construction.ts");
  const settled = withStartingSettlement(world);
  assert.deepEqual(footprintOf("workshop", "north"), { width: 2, depth: 1 });
  assert.deepEqual(footprintOf("workshop", "east"), { width: 1, depth: 2 });
  const road = settled.roads.find((road) => {
    const request = {
      type: "house",
      x: road.x + 1,
      y: road.y,
      rotation: "north",
    };
    return validatePlacement(settled, request).valid;
  });
  assert.ok(road, "fixture needs a valid road-adjacent site");
  const valid = { type: "house", x: road.x + 1, y: road.y, rotation: "north" };
  assert.equal(validatePlacement(settled, valid).valid, true);
  const placed = placeBuilding(settled, valid, "test-building");
  assert.equal(placed.buildings.at(-1).id, "test-building");
  assert.ok(
    validatePlacement(placed, valid).reasons.includes("Footprint is occupied"),
  );
  const onRoad = { ...valid, x: road.x, y: road.y };
  assert.ok(
    validatePlacement(settled, onRoad).reasons.includes(
      "Cannot build over a road",
    ),
  );
  assert.ok(
    validatePlacement(settled, { ...valid, x: -1 }).reasons.includes(
      "Footprint extends beyond the world",
    ),
  );
  const waterCell = settled.cells.find((cell) => cell.terrain === "water");
  assert.ok(
    validatePlacement(settled, {
      ...valid,
      x: waterCell.x,
      y: waterCell.y,
    }).reasons.includes("Requires grassland"),
  );
  const isolated = settled.cells.find(
    (cell) =>
      cell.terrain === "grassland" &&
      !validatePlacement(settled, {
        ...valid,
        x: cell.x,
        y: cell.y,
      }).reasons.includes("Requires adjacent road access"),
  );
  assert.ok(isolated);
  const noRoadWorld = { ...settled, roads: [] };
  assert.ok(
    validatePlacement(noRoadWorld, valid).reasons.includes(
      "Requires adjacent road access",
    ),
  );
  const slopeOrigin = settled.cells.find(
    (cell) =>
      cell.x + 1 < settled.size &&
      cell.terrain === "grassland" &&
      settled.cells[cell.y * settled.size + cell.x + 1].terrain ===
        "grassland" &&
      settled.cells[cell.y * settled.size + cell.x + 1].z !== cell.z,
  );
  assert.ok(
    slopeOrigin,
    "fixture needs two neighboring grass cells at different heights",
  );
  const slopeWorld = {
    ...settled,
    roads: [{ x: slopeOrigin.x, y: slopeOrigin.y + 1, z: slopeOrigin.z }],
  };
  assert.ok(
    validatePlacement(slopeWorld, {
      type: "workshop",
      x: slopeOrigin.x,
      y: slopeOrigin.y,
      rotation: "north",
    }).reasons.includes("Requires level ground"),
  );
  assert.deepEqual(
    validatePlacement(settled, { ...valid, rotation: "upside-down" }).reasons,
    ["Rotation is unavailable"],
  );
});

test("road placement extends the connected network without occupying invalid cells", () => {
  const {
    placeRoad,
    validateRoadPlacement,
  } = require("../world/domain/construction.ts");
  const {
    createStartingWorld,
  } = require("../world/simulation/game-simulation.ts");
  const starting = createStartingWorld();
  const candidate = starting.cells.find(
    (cell) => validateRoadPlacement(starting, cell).valid,
  );
  assert.ok(candidate, "fixture needs a valid road extension");
  assert.equal(validateRoadPlacement(starting, candidate).valid, true);

  const placed = placeRoad(starting, candidate);
  assert.equal(placed.roads.length, starting.roads.length + 1);
  assert.deepEqual(placed.roads.at(-1), {
    x: candidate.x,
    y: candidate.y,
    z: candidate.z,
  });
  assert.ok(
    validateRoadPlacement(placed, candidate).reasons.includes(
      "A road already occupies this cell",
    ),
  );

  const occupied = starting.buildings[0];
  assert.ok(
    validateRoadPlacement(starting, occupied).reasons.includes(
      "Cell is occupied by a building",
    ),
  );
  const water = starting.cells.find((cell) => cell.terrain === "water");
  assert.ok(
    validateRoadPlacement(starting, water).reasons.includes(
      "Road requires dry ground",
    ),
  );
  assert.deepEqual(validateRoadPlacement(starting, { x: -1, y: 0 }).reasons, [
    "Road must be inside the world",
  ]);
  const disconnected = starting.cells.find((cell) =>
    validateRoadPlacement(starting, cell).reasons.includes(
      "Road must connect to an adjacent road",
    ),
  );
  assert.ok(disconnected);
});

test("authoritative road construction charges once and survives save loading", () => {
  const {
    roadConstructionCost,
    validateRoadPlacement,
  } = require("../world/domain/construction.ts");
  const {
    LocalGameSimulation,
    createStartingWorld,
  } = require("../world/simulation/game-simulation.ts");
  const simulation = new LocalGameSimulation(createStartingWorld(), 1_000);
  const initial = simulation.read(1_000);
  const candidate = initial.world.cells.find(
    (cell) => validateRoadPlacement(initial.world, cell).valid,
  );
  assert.ok(candidate, "fixture needs a valid road extension");

  const accepted = simulation.execute(
    {
      type: "construct_road",
      expectedRevision: initial.revision,
      placement: { x: candidate.x, y: candidate.y },
    },
    1_000,
  );
  assert.equal(accepted.ok, true);
  assert.equal(accepted.readModel.revision, initial.revision + 1);
  assert.equal(
    accepted.readModel.economy.market.cashCents,
    initial.economy.market.cashCents - roadConstructionCost.cashCents,
  );
  assert.deepEqual(accepted.road, {
    x: candidate.x,
    y: candidate.y,
    z: candidate.z,
  });

  const chargedState = simulation.exportSave();
  const stale = simulation.execute(
    {
      type: "construct_road",
      expectedRevision: initial.revision,
      placement: { x: candidate.x, y: candidate.y },
    },
    1_000,
  );
  assert.equal(stale.status, 409);
  assert.deepEqual(simulation.exportSave(), chargedState);
  const duplicate = simulation.execute(
    {
      type: "construct_road",
      expectedRevision: accepted.readModel.revision,
      placement: { x: candidate.x, y: candidate.y },
    },
    1_000,
  );
  assert.equal(duplicate.status, 422);
  assert.match(duplicate.error, /already occupies/);
  assert.deepEqual(simulation.exportSave(), chargedState);

  const restored = LocalGameSimulation.fromSave(
    JSON.parse(JSON.stringify(chargedState)),
  );
  assert.deepEqual(restored.exportSave(), chargedState);
});

test("local simulation enforces construction revision and authoritative validation", () => {
  const { LocalGameSimulation, createStartingWorld } = require("../world/simulation/game-simulation.ts");
  const { validatePlacement } = require("../world/domain/construction.ts");
  const simulation = new LocalGameSimulation(createStartingWorld(), 1_000);
  const initial = simulation.read(1_000);
  const road = initial.world.roads.find(
    (road) =>
      validatePlacement(initial.world, {
        type: "house",
        x: road.x + 1,
        y: road.y,
        rotation: "north",
      }).valid,
  );
  const placement = {
    type: "house",
    x: road.x + 1,
    y: road.y,
    rotation: "north",
  };
  const quarry = initial.economy.sites.find((site) => site.type === "quarry");
  const stoneShipment = simulation.execute(
    { type: "dispatch_production", buildingId: quarry.buildingId },
    1_000,
  );
  assert.equal(stoneShipment.ok, true);
  const buildTime = stoneShipment.shipment.arrivalTime;
  simulation.read(buildTime);
  const accepted = simulation.execute(
    { type: "construct", expectedRevision: 0, placement },
    buildTime,
  );
  assert.equal(accepted.ok, true);
  assert.equal(accepted.readModel.revision, 1);
  assert.equal(accepted.building.id, "player-1");
  assert.equal(accepted.readModel.economy.population.housingCapacity, 14);
  const stale = simulation.execute(
    {
      type: "construct",
      expectedRevision: 0,
      placement: { ...placement, x: placement.x + 1 },
    },
    buildTime,
  );
  assert.equal(stale.status, 409);
  assert.equal(stale.readModel.revision, 1);
  assert.ok(
    stale.readModel.world.buildings.some(
      (building) => building.id === "player-1",
    ),
  );
  const secondSimulation = new LocalGameSimulation(createStartingWorld(), 1_000);
  const invalid = secondSimulation.execute(
    {
      type: "construct",
      expectedRevision: 0,
      placement: { ...placement, x: -5 },
    },
    1_000,
  );
  assert.equal(invalid.status, 422);
});

test("player construction charges once, supports multiple farms, production, save loading, and demolition", () => {
  const { validatePlacement } = require("../world/domain/construction.ts");
  const { LocalGameSimulation, createStartingWorld } = require("../world/simulation/game-simulation.ts");
  const simulation = new LocalGameSimulation(createStartingWorld(), 1_000);
  const findPlacement = (currentWorld, type) => {
    const cell = currentWorld.cells.find((candidate) =>
      validatePlacement(currentWorld, {
        type,
        x: candidate.x,
        y: candidate.y,
        rotation: "north",
      }).valid,
    );
    assert.ok(cell, `Expected a valid ${type} placement`);
    return { type, x: cell.x, y: cell.y, rotation: "north" };
  };

  const initial = simulation.read(1_000);
  const initialCash = initial.economy.market.cashCents;
  const firstPlacement = findPlacement(initial.world, "farm");
  const first = simulation.execute(
    { type: "construct", expectedRevision: 0, placement: firstPlacement },
    1_000,
  );
  assert.equal(first.ok, true);
  assert.equal(first.readModel.economy.market.cashCents, initialCash - 20_000);
  assert.equal(first.readModel.economy.logistics.warehouseInventory.wood, 2);
  assert.equal(
    first.readModel.economy.sites.find(
      (site) => site.buildingId === first.building.id,
    ).status,
    "missing_workers",
  );
  assert.ok(
    first.readModel.economy.logistics.routes.some(
      (route) => route.originBuildingId === first.building.id,
    ),
  );

  const chargedState = simulation.exportSave();
  const staleReplay = simulation.execute(
    { type: "construct", expectedRevision: 0, placement: firstPlacement },
    1_000,
  );
  assert.equal(staleReplay.status, 409);
  assert.deepEqual(simulation.exportSave(), chargedState);
  const occupied = simulation.execute(
    { type: "construct", expectedRevision: 1, placement: firstPlacement },
    1_000,
  );
  assert.equal(occupied.status, 422);
  assert.match(occupied.error, /occupied/);
  assert.deepEqual(simulation.exportSave(), chargedState);

  const secondPlacement = findPlacement(first.readModel.world, "farm");
  const second = simulation.execute(
    { type: "construct", expectedRevision: 1, placement: secondPlacement },
    1_000,
  );
  assert.equal(second.ok, true);
  assert.equal(
    second.readModel.world.buildings.filter((building) => building.type === "farm")
      .length,
    3,
  );
  assert.equal(second.readModel.economy.logistics.warehouseInventory.wood, 1);

  const restored = LocalGameSimulation.fromSave(
    JSON.parse(JSON.stringify(simulation.exportSave())),
  );
  assert.deepEqual(
    restored.read(restored.exportSave().simulationTime),
    simulation.read(simulation.exportSave().simulationTime),
  );
  assert.throws(() => LocalGameSimulation.fromSave({ saveVersion: 2 }), /invalid/);

  const startingFarm = second.readModel.economy.sites.find(
    (site) => site.type === "farm" && !site.buildingId.startsWith("player-"),
  );
  assert.equal(
    simulation.execute(
      { type: "set_workers", buildingId: startingFarm.buildingId, workers: 0 },
      1_000,
    ).ok,
    true,
  );
  assert.equal(
    simulation.execute(
      { type: "set_workers", buildingId: first.building.id, workers: 2 },
      1_000,
    ).ok,
    true,
  );
  const produced = simulation.read(9_000);
  assert.equal(
    produced.economy.sites.find(
      (site) => site.buildingId === first.building.id,
    ).stored,
    4,
  );
  const demolished = simulation.execute(
    { type: "demolish", buildingId: first.building.id },
    9_000,
  );
  assert.equal(demolished.ok, true);
  assert.ok(
    !demolished.readModel.world.buildings.some(
      (building) => building.id === first.building.id,
    ),
  );
  assert.ok(
    !demolished.readModel.economy.sites.some(
      (site) => site.buildingId === first.building.id,
    ),
  );
  assert.equal(demolished.readModel.economy.population.availableWorkers, 3);
});

test("unaffordable construction leaves authoritative resources unchanged", () => {
  const { validatePlacement } = require("../world/domain/construction.ts");
  const { LocalGameSimulation, createStartingWorld } = require("../world/simulation/game-simulation.ts");
  const simulation = new LocalGameSimulation(createStartingWorld(), 1_000);
  const before = simulation.exportSave();
  const cell = before.world.cells.find((candidate) =>
    validatePlacement(before.world, {
      type: "house",
      x: candidate.x,
      y: candidate.y,
      rotation: "north",
    }).valid,
  );
  assert.ok(cell);
  const result = simulation.execute(
    {
      type: "construct",
      expectedRevision: 0,
      placement: { type: "house", x: cell.x, y: cell.y, rotation: "north" },
    },
    1_000,
  );
  assert.equal(result.status, 422);
  assert.match(result.error, /Need 1 more stone/);
  assert.deepEqual(simulation.exportSave(), before);
});

test("population needs derive deterministically from authoritative world and economy state", () => {
  const {
    describeFoodNeed,
    describePopulation,
  } = require("../world/domain/population.ts");
  const {
    normalizeCommodityInventory,
  } = require("../world/domain/commodities.ts");
  const { LocalGameSimulation, createStartingWorld } = require("../world/simulation/game-simulation.ts");
  const startingWorld = createStartingWorld();
  const foodNeed = describeFoodNeed(
    normalizeCommodityInventory({ food: 8 }),
    10,
    null,
  );
  assert.deepEqual(describePopulation(startingWorld, 5, foodNeed), {
    totalPopulation: 10,
    workingAgePopulation: 6,
    availableWorkers: 1,
    employedWorkers: 5,
    unemployedWorkers: 1,
    housingCapacity: 12,
    openPositions: 0,
    lastMigration: null,
    foodRequired: 10,
    foodAvailable: 16,
    foodConsumed: 0,
    foodSupplyPercent: 100,
    mainFoodSources: [],
  });
  assert.throws(
    () => describePopulation(startingWorld, 7, foodNeed),
    RangeError,
  );

  const simulation = new LocalGameSimulation(startingWorld, 1_000);
  const initialEconomy = simulation.read(1_000).economy;
  // Migration has not run yet at the start time, and the simulation reports
  // the open positions its own sites currently advertise.
  assert.equal(initialEconomy.population.lastMigration, null);
  assert.ok(initialEconomy.population.openPositions > 0);
  assert.deepEqual(
    initialEconomy.population,
    describePopulation(
      startingWorld,
      5,
      foodNeed,
      initialEconomy.population.openPositions,
      null,
    ),
  );
  const initialCropShipment = initialEconomy.logistics.shipments.find(
    (shipment) => shipment.cargo.commodity === "crops",
  );
  const arrived = simulation.read(initialCropShipment.arrivalTime).economy;
  assert.equal(arrived.population.foodAvailable, 20);
  assert.equal(arrived.logistics.warehouseInventory.crops, 4);
});

test("starting producers occupy level resource footprints without changing terrain", () => {
  const {
    withStartingSettlement,
    footprintOf,
  } = require("../world/domain/settlement.ts");
  const {
    withStartingProduction,
    producerTypes,
  } = require("../world/domain/production.ts");
  const settled = withStartingSettlement(world);
  const result = withStartingProduction(settled);
  const producers = result.buildings.filter((building) =>
    producerTypes.includes(building.type),
  );
  assert.deepEqual(producers.map((building) => building.type).sort(), [
    "farm",
    "iron_mine",
    "lumber_camp",
    "quarry",
    "workshop",
  ]);
  for (const building of producers) {
    const footprint = footprintOf(building.type, building.rotation);
    const cells = [];
    for (let dy = 0; dy < footprint.depth; dy++)
      for (let dx = 0; dx < footprint.width; dx++)
        cells.push(
          result.cells[(building.y + dy) * result.size + building.x + dx],
        );
    assert.ok(cells.every((cell) => cell.z === building.z));
    if (building.type === "farm")
      assert.ok(cells.every((cell) => cell.terrain === "farmland"));
    if (building.type === "lumber_camp")
      assert.ok(cells.every((cell) => cell.resourceNodeId === "northwood"));
    if (building.type === "quarry")
      assert.ok(cells.every((cell) => cell.resourceNodeId === "stone-ridge"));
    if (building.type === "iron_mine")
      assert.ok(cells.every((cell) => cell.resourceNodeId === "iron-heights"));
    if (building.type === "workshop")
      assert.ok(cells.every((cell) => cell.terrain === "grassland"));
  }
  assert.equal(result.cells, settled.cells);
  assert.deepEqual(withStartingProduction(settled), result);
});

test("production advances from explicit simulation time and explains idle states", () => {
  const { LocalGameSimulation, createStartingWorld } = require("../world/simulation/game-simulation.ts");
  const simulation = new LocalGameSimulation(createStartingWorld(), 1_000);
  const initial = simulation.read(1_000).economy;
  const farm = initial.sites.find((site) => site.type === "farm");
  const lumber = initial.sites.find((site) => site.type === "lumber_camp");
  const quarry = initial.sites.find((site) => site.type === "quarry");
  assert.equal(farm.status, "running");
  assert.equal(lumber.status, "missing_workers");
  assert.match(lumber.statusReason, /Needs 2 workers/);
  assert.equal(quarry.status, "storage_full");
  assert.match(quarry.statusReason, /Dispatch Rough Stone/);
  const advanced = simulation.read(9_000).economy;
  assert.equal(advanced.sites.find((site) => site.type === "farm").stored, 4);
  assert.equal(
    advanced.sites.find((site) => site.type === "lumber_camp").progressMs,
    0,
  );
  const overCapacity = simulation.execute(
    { type: "set_workers", buildingId: lumber.buildingId, workers: 2 },
    9_000,
  );
  assert.equal(overCapacity.status, 422);
  const released = simulation.execute(
    { type: "set_workers", buildingId: farm.buildingId, workers: 1 },
    9_000,
  );
  assert.equal(released.ok, true);
  const staffed = simulation.execute(
    { type: "set_workers", buildingId: lumber.buildingId, workers: 2 },
    9_000,
  );
  assert.equal(staffed.ok, true);
  assert.deepEqual(staffed.readModel.economy.population, {
    totalPopulation: 10,
    workingAgePopulation: 6,
    availableWorkers: 0,
    employedWorkers: 6,
    unemployedWorkers: 0,
    housingCapacity: 12,
    openPositions:
      staffed.readModel.economy.population.openPositions,
    lastMigration: null,
    foodRequired: 10,
    foodAvailable: 16,
    foodConsumed: 0,
    foodSupplyPercent: 100,
    mainFoodSources: [],
  });
  assert.equal(
    staffed.readModel.economy.sites.find((site) => site.type === "lumber_camp").status,
    "running",
  );
  assert.equal(
    simulation.read(19_000).economy.sites.find(
      (site) => site.type === "lumber_camp",
    ).stored,
    3,
  );
  const collected = simulation.execute(
    { type: "dispatch_production", buildingId: quarry.buildingId },
    19_000,
  );
  assert.equal(collected.ok, true);
  assert.equal(collected.collected, 12);
  assert.equal(collected.shipment.status, "in_transit");
  assert.equal(collected.readModel.economy.logistics.warehouseInventory.stone, 0);
  assert.equal(
    collected.readModel.economy.sites.find((site) => site.type === "quarry").status,
    "running",
  );
  const delivered = simulation.read(collected.shipment.arrivalTime).economy;
  assert.equal(delivered.logistics.warehouseInventory.stone, 12);
  assert.equal(
    delivered.logistics.shipments.find(
      (shipment) => shipment.id === collected.shipment.id,
    ).status,
    "arrived",
  );
  assert.equal(
    simulation.execute(
      { type: "set_workers", buildingId: farm.buildingId, workers: 99 },
      collected.shipment.arrivalTime,
    ).status,
    422,
  );
});

test("labor capacity scales production deterministically and survives save loading", () => {
  const {
    advanceProduction,
  } = require("../world/domain/production.ts");
  const {
    describeLabor,
    laborEfficiency,
  } = require("../world/domain/labor.ts");
  const { LocalGameSimulation, createStartingWorld } = require("../world/simulation/game-simulation.ts");

  assert.equal(laborEfficiency(1, 2), 0.5);
  assert.equal(laborEfficiency(2, 2), 1);
  assert.deepEqual(
    describeLabor(6, [
      { assignedWorkers: 2, requiredWorkers: 2 },
      { assignedWorkers: 1, requiredWorkers: 2 },
      { assignedWorkers: 3, requiredWorkers: 3 },
    ]),
    {
      totalWorkforce: 6,
      assignedWorkers: 6,
      unassignedWorkers: 0,
      shortageBuildings: 1,
    },
  );
  assert.throws(
    () =>
      describeLabor(5, [
        { assignedWorkers: 2, requiredWorkers: 2 },
        { assignedWorkers: 1, requiredWorkers: 2 },
        { assignedWorkers: 3, requiredWorkers: 3 },
      ]),
    /cannot exceed/,
  );

  const halfStaffedFarm = {
    buildingId: "partial-farm",
    assignedWorkers: 1,
    stored: 0,
    progressMs: 0,
    laborRemainder: 0,
    updatedAt: 0,
  };
  const partial = advanceProduction(halfStaffedFarm, "farm", 16_000);
  assert.equal(partial.stored, 4);
  assert.equal(partial.progressMs, 0);
  const full = advanceProduction(
    { ...halfStaffedFarm, assignedWorkers: 2 },
    "farm",
    8_000,
  );
  assert.equal(full.stored, 4);

  let split = {
    ...halfStaffedFarm,
    buildingId: "split-quarry",
    assignedWorkers: 2,
  };
  for (let time = 1_000; time <= 18_000; time += 1_000)
    split = advanceProduction(split, "quarry", time);
  const single = advanceProduction(
    { ...split, stored: 0, progressMs: 0, laborRemainder: 0, updatedAt: 0 },
    "quarry",
    18_000,
  );
  assert.equal(split.stored, 2);
  assert.deepEqual(
    (({ stored, progressMs, laborRemainder }) => ({
      stored,
      progressMs,
      laborRemainder,
    }))(split),
    (({ stored, progressMs, laborRemainder }) => ({
      stored,
      progressMs,
      laborRemainder,
    }))(single),
  );
  const removed = advanceProduction(
    { ...partial, assignedWorkers: 0, updatedAt: 16_000 },
    "farm",
    40_000,
  );
  assert.equal(removed.stored, partial.stored);
  assert.equal(removed.progressMs, partial.progressMs);

  const simulation = new LocalGameSimulation(createStartingWorld(), 1_000);
  const initial = simulation.read(1_000).economy;
  assert.deepEqual(initial.labor, {
    totalWorkforce: 6,
    assignedWorkers: 5,
    unassignedWorkers: 1,
    shortageBuildings: 3,
  });
  const farm = initial.sites.find((site) => site.type === "farm");
  const lumber = initial.sites.find((site) => site.type === "lumber_camp");
  const overAllocated = simulation.execute(
    { type: "set_workers", buildingId: lumber.buildingId, workers: 2 },
    1_000,
  );
  assert.equal(overAllocated.status, 422);
  assert.deepEqual(overAllocated.readModel.economy.labor, initial.labor);
  const reduced = simulation.execute(
    { type: "set_workers", buildingId: farm.buildingId, workers: 1 },
    1_000,
  );
  assert.equal(reduced.ok, true);
  assert.equal(
    reduced.readModel.economy.sites.find(
      (site) => site.buildingId === farm.buildingId,
    ).laborEfficiency,
    0.5,
  );
  assert.deepEqual(reduced.readModel.economy.labor, {
    totalWorkforce: 6,
    assignedWorkers: 4,
    unassignedWorkers: 2,
    shortageBuildings: 4,
  });
  const loaded = LocalGameSimulation.fromSave(
    JSON.parse(JSON.stringify(simulation.exportSave())),
  ).read(1_000);
  assert.equal(
    loaded.economy.sites.find((site) => site.buildingId === farm.buildingId)
      .assignedWorkers,
    1,
  );
  assert.deepEqual(loaded.economy.labor, reduced.readModel.economy.labor);
});

test("dependency-driven recipes consume inputs, respect labor and storage, and remain deterministic", () => {
  const {
    describeProduction,
    productionRecipes,
    resolveProduction,
  } = require("../world/domain/production.ts");
  const {
    normalizeCommodityInventory,
  } = require("../world/domain/commodities.ts");

  const workshop = {
    id: "workshop-1",
    type: "workshop",
    x: 0,
    y: 0,
    z: 1,
    settlementId: "novagrad",
    rotation: "north",
  };
  const state = {
    buildingId: workshop.id,
    recipeId: "saw_lumber",
    assignedWorkers: 2,
    stored: 0,
    progressMs: 0,
    laborRemainder: 0,
    updatedAt: 0,
  };
  const expectedRecipes = {
    grow_crops: ["farm", {}, { crops: 4 }],
    harvest_logs: ["lumber_camp", {}, { wood: 3 }],
    quarry_stone: ["quarry", {}, { stone: 2 }],
    mine_iron_ore: ["iron_mine", {}, { iron_ore: 2 }],
    saw_lumber: ["workshop", { wood: 2 }, { lumber: 2 }],
    make_basic_food: ["workshop", { crops: 2 }, { food: 3 }],
    make_animal_feed: ["workshop", { crops: 2 }, { animal_feed: 3 }],
    raise_livestock: ["farm", { animal_feed: 2 }, { livestock: 1 }],
    butcher_meat: ["workshop", { livestock: 1 }, { raw_meat: 2 }],
    cook_meat: ["workshop", { raw_meat: 2 }, { cooked_meat: 2 }],
    prepare_meal: [
      "workshop",
      { crops: 1, cooked_meat: 1 },
      { prepared_meal: 2 },
    ],
    cut_stone: ["workshop", { stone: 2 }, { cut_stone: 2 }],
    smelt_iron: ["workshop", { iron_ore: 2 }, { iron: 1 }],
    forge_iron_tools: ["workshop", { iron: 2 }, { iron_tools: 1 }],
  };
  // Industrialised tiers are configuration on the same registry, so they are
  // listed here too; they differ only by needing equipment they hold.
  const expectedImprovedRecipes = {
    grow_crops_improved: ["farm", {}, { crops: 5 }, { iron_tools: 1 }],
    harvest_logs_improved: ["lumber_camp", {}, { wood: 4 }, { iron_tools: 1 }],
    quarry_stone_improved: ["quarry", {}, { stone: 3 }, { iron_tools: 2 }],
  };
  assert.deepEqual(Object.keys(productionRecipes), [
    ...Object.keys(expectedRecipes),
    ...Object.keys(expectedImprovedRecipes),
  ]);
  for (const [recipeId, [producer, inputs, outputs, equipment]] of Object.entries(
    { ...expectedRecipes, ...expectedImprovedRecipes },
  )) {
    const configured = productionRecipes[recipeId];
    assert.equal(configured.producer, producer);
    assert.deepEqual(configured.consumableInputs, inputs);
    assert.deepEqual(configured.outputs, outputs);
    assert.deepEqual(configured.equipmentRequirements, equipment ?? {});
    assert.ok(configured.requiredWorkers > 0);
    assert.ok(configured.durationMs > 0);
    assert.ok(configured.storageCapacity > 0);
    assert.equal(configured.destinationStorage, "site");
  }

  const withoutInputs = resolveProduction(
    state,
    workshop.type,
    30_000,
    normalizeCommodityInventory({}),
  );
  assert.equal(withoutInputs.completedCycles, 0);
  assert.equal(withoutInputs.state.stored, 0);
  assert.equal(withoutInputs.state.progressMs, 0);
  assert.equal(
    describeProduction(
      withoutInputs.state,
      workshop,
      withoutInputs.inventory,
    ).status,
    "missing_inputs",
  );

  const partial = resolveProduction(
    { ...state, assignedWorkers: 1 },
    workshop.type,
    16_000,
    normalizeCommodityInventory({ wood: 5 }),
  );
  assert.equal(partial.completedCycles, 1);
  assert.equal(partial.state.stored, 2);
  assert.equal(partial.inventory.wood, 3);
  assert.deepEqual(partial.consumedInputs, { wood: 2 });

  const full = resolveProduction(
    state,
    workshop.type,
    8_000,
    normalizeCommodityInventory({ wood: 5 }),
  );
  assert.equal(full.completedCycles, 1);
  assert.equal(full.state.stored, 2);
  assert.equal(full.inventory.wood, 3);

  const stopped = resolveProduction(
    { ...partial.state, assignedWorkers: 0 },
    workshop.type,
    40_000,
    partial.inventory,
  );
  assert.equal(stopped.state.stored, partial.state.stored);
  assert.equal(stopped.inventory.wood, partial.inventory.wood);

  const fullStorage = resolveProduction(
    { ...state, stored: productionRecipes.saw_lumber.storageCapacity - 1 },
    workshop.type,
    40_000,
    normalizeCommodityInventory({ wood: 10 }),
  );
  assert.equal(fullStorage.completedCycles, 0);
  assert.equal(fullStorage.inventory.wood, 10);

  let splitState = state;
  let splitInventory = normalizeCommodityInventory({ wood: 6 });
  for (let time = 1_000; time <= 24_000; time += 1_000) {
    const resolution = resolveProduction(
      splitState,
      workshop.type,
      time,
      splitInventory,
    );
    splitState = resolution.state;
    splitInventory = resolution.inventory;
  }
  const single = resolveProduction(
    state,
    workshop.type,
    24_000,
    normalizeCommodityInventory({ wood: 6 }),
  );
  assert.deepEqual(splitState, single.state);
  assert.deepEqual(splitInventory, single.inventory);
  assert.equal(single.state.stored, 6);
  assert.equal(single.inventory.wood, 0);

  const meal = resolveProduction(
    { ...state, recipeId: "prepare_meal" },
    workshop.type,
    productionRecipes.prepare_meal.durationMs,
    normalizeCommodityInventory({ crops: 2, cooked_meat: 1 }),
  );
  assert.deepEqual(meal.consumedInputs, { crops: 1, cooked_meat: 1 });
  assert.equal(meal.inventory.crops, 1);
  assert.equal(meal.inventory.cooked_meat, 0);
  assert.equal(meal.state.stored, 2);
});

test("local simulation connects crop inputs to Basic Food and preserves the allocation in saves", () => {
  const {
    LocalGameSimulation,
    createStartingWorld,
  } = require("../world/simulation/game-simulation.ts");
  const simulation = new LocalGameSimulation(createStartingWorld(), 1_000);
  const initial = simulation.read(1_000).economy;
  const cropShipment = initial.logistics.shipments.find(
    (shipment) => shipment.cargo.commodity === "crops",
  );
  const arrived = simulation.read(cropShipment.arrivalTime).economy;
  const quarry = arrived.sites.find((site) => site.type === "quarry");
  const workshop = arrived.sites.find((site) => site.type === "workshop");
  assert.equal(workshop.recipeId, "make_basic_food");
  assert.equal(workshop.status, "missing_workers");

  assert.equal(
    simulation.execute(
      { type: "set_workers", buildingId: quarry.buildingId, workers: 0 },
      cropShipment.arrivalTime,
    ).ok,
    true,
  );
  assert.equal(
    simulation.execute(
      { type: "set_workers", buildingId: workshop.buildingId, workers: 2 },
      cropShipment.arrivalTime,
    ).ok,
    true,
  );
  const produced = simulation.read(cropShipment.arrivalTime + 6_000).economy;
  const producedWorkshop = produced.sites.find(
    (site) => site.buildingId === workshop.buildingId,
  );
  assert.equal(producedWorkshop.stored, 3);
  assert.equal(produced.logistics.warehouseInventory.crops, 2);
  assert.equal(produced.logistics.warehouseInventory.food, 8);

  const save = JSON.parse(JSON.stringify(simulation.exportSave()));
  const loaded = LocalGameSimulation.fromSave(save).read(
    cropShipment.arrivalTime + 6_000,
  ).economy;
  assert.equal(
    loaded.sites.find((site) => site.buildingId === workshop.buildingId)
      .recipeId,
    "make_basic_food",
  );
  assert.equal(loaded.logistics.warehouseInventory.crops, 2);

  const legacy = JSON.parse(JSON.stringify(save));
  for (const commodity of [
    "crops",
    "lumber",
    "cut_stone",
    "animal_feed",
    "livestock",
    "raw_meat",
    "cooked_meat",
    "prepared_meal",
    "iron_ore",
    "iron",
    "iron_tools",
  ]) {
    delete legacy.warehouseInventory[commodity];
    delete legacy.priceHistory[commodity];
    delete legacy.shortages[commodity];
  }
  legacy.productionStates = legacy.productionStates
    .filter((state) => state.buildingId !== workshop.buildingId)
    .map((state) => {
      const withoutRecipe = { ...state };
      delete withoutRecipe.recipeId;
      if (withoutRecipe.buildingId === "novagrad-farm") {
        withoutRecipe.stored = 4;
        withoutRecipe.progressMs = 3_000;
      }
      return withoutRecipe;
    });
  const legacyFood = legacy.warehouseInventory.food;
  const migrated = LocalGameSimulation.fromSave(legacy).read(
    cropShipment.arrivalTime + 6_000,
  ).economy;
  assert.equal(migrated.logistics.warehouseInventory.food, legacyFood + 4);
  assert.equal(migrated.logistics.warehouseInventory.crops, 0);
  assert.equal(
    migrated.sites.find((site) => site.buildingId === "novagrad-farm")
      .recipeId,
    "grow_crops",
  );
  assert.equal(
    migrated.sites.find((site) => site.buildingId === workshop.buildingId)
      .recipeId,
    "make_basic_food",
  );

  const configureBeforeArrival = () => {
    const candidate = new LocalGameSimulation(createStartingWorld(), 1_000);
    const economy = candidate.read(1_000).economy;
    const candidateQuarry = economy.sites.find(
      (site) => site.type === "quarry",
    );
    const candidateWorkshop = economy.sites.find(
      (site) => site.type === "workshop",
    );
    const shipment = economy.logistics.shipments.find(
      (entry) => entry.cargo.commodity === "crops",
    );
    candidate.execute(
      {
        type: "set_workers",
        buildingId: candidateQuarry.buildingId,
        workers: 0,
      },
      1_000,
    );
    candidate.execute(
      {
        type: "set_workers",
        buildingId: candidateWorkshop.buildingId,
        workers: 2,
      },
      1_000,
    );
    return { candidate, arrivalTime: shipment.arrivalTime };
  };
  const direct = configureBeforeArrival();
  const partitioned = configureBeforeArrival();
  direct.candidate.read(direct.arrivalTime + 6_000);
  partitioned.candidate.read(partitioned.arrivalTime);
  partitioned.candidate.read(partitioned.arrivalTime + 6_000);
  assert.deepEqual(direct.candidate.exportSave(), partitioned.candidate.exportSave());
});

test("player commands pause, resume, reassign labor, change recipes, and persist control state", () => {
  const {
    LocalGameSimulation,
    createStartingWorld,
  } = require("../world/simulation/game-simulation.ts");
  const simulation = new LocalGameSimulation(createStartingWorld(), 1_000);
  const initial = simulation.read(1_000).economy;
  const farm = initial.sites.find((site) => site.type === "farm");
  const lumber = initial.sites.find((site) => site.type === "lumber_camp");
  const quarry = initial.sites.find((site) => site.type === "quarry");
  const workshop = initial.sites.find((site) => site.type === "workshop");

  const paused = simulation.execute(
    {
      type: "set_production_paused",
      buildingId: farm.buildingId,
      paused: true,
    },
    5_000,
  );
  assert.equal(paused.ok, true);
  const pausedFarm = paused.readModel.economy.sites.find(
    (site) => site.buildingId === farm.buildingId,
  );
  assert.equal(pausedFarm.status, "paused");
  assert.equal(pausedFarm.assignedWorkers, 0);
  assert.equal(pausedFarm.expectedOutputPerCycle, 0);
  assert.equal(paused.readModel.economy.labor.unassignedWorkers, 3);

  const pausedLoaded = LocalGameSimulation.fromSave(
    JSON.parse(JSON.stringify(simulation.exportSave())),
  ).read(5_000).economy;
  assert.equal(
    pausedLoaded.sites.find((site) => site.buildingId === farm.buildingId)
      .paused,
    true,
  );

  const frozenProgress = pausedFarm.progressMs;
  assert.equal(
    simulation.read(20_000).economy.sites.find(
      (site) => site.buildingId === farm.buildingId,
    ).progressMs,
    frozenProgress,
  );
  assert.equal(
    simulation.execute(
      { type: "set_workers", buildingId: farm.buildingId, workers: 1 },
      20_000,
    ).status,
    422,
  );
  assert.equal(
    simulation.execute(
      { type: "set_workers", buildingId: lumber.buildingId, workers: 2 },
      20_000,
    ).ok,
    true,
  );
  const resumed = simulation.execute(
    {
      type: "set_production_paused",
      buildingId: farm.buildingId,
      paused: false,
    },
    20_000,
  );
  assert.equal(resumed.ok, true);
  assert.equal(
    resumed.readModel.economy.sites.find(
      (site) => site.buildingId === farm.buildingId,
    ).assignedWorkers,
    0,
  );
  assert.equal(
    simulation.execute(
      { type: "set_workers", buildingId: farm.buildingId, workers: 2 },
      20_000,
    ).status,
    422,
  );
  simulation.execute(
    { type: "set_workers", buildingId: lumber.buildingId, workers: 0 },
    20_000,
  );
  assert.equal(
    simulation.execute(
      { type: "set_workers", buildingId: farm.buildingId, workers: 2 },
      20_000,
    ).ok,
    true,
  );
  assert.equal(
    simulation.read(24_000).economy.sites.find(
      (site) => site.buildingId === farm.buildingId,
    ).stored,
    4,
  );
  const blockedByStoredOutput = simulation.execute(
    {
      type: "set_recipe",
      buildingId: farm.buildingId,
      recipeId: "raise_livestock",
    },
    24_000,
  );
  assert.equal(blockedByStoredOutput.status, 422);
  assert.match(blockedByStoredOutput.error, /Dispatch the current output/);

  assert.equal(
    simulation.execute(
      {
        type: "set_recipe",
        buildingId: workshop.buildingId,
        recipeId: "saw_lumber",
      },
      24_000,
    ).ok,
    true,
  );
  simulation.execute(
    { type: "set_workers", buildingId: quarry.buildingId, workers: 0 },
    24_000,
  );
  simulation.execute(
    { type: "set_workers", buildingId: workshop.buildingId, workers: 2 },
    24_000,
  );
  const tooManyForRecipe = simulation.execute(
    {
      type: "set_recipe",
      buildingId: workshop.buildingId,
      recipeId: "make_animal_feed",
    },
    24_000,
  );
  assert.equal(tooManyForRecipe.status, 422);
  assert.match(tooManyForRecipe.error, /Reduce this building to 1 worker/);
  simulation.execute(
    { type: "set_workers", buildingId: workshop.buildingId, workers: 1 },
    24_000,
  );
  assert.equal(
    simulation.execute(
      {
        type: "set_recipe",
        buildingId: workshop.buildingId,
        recipeId: "make_animal_feed",
      },
      24_000,
    ).ok,
    true,
  );
  assert.equal(
    simulation.execute(
      {
        type: "set_recipe",
        buildingId: lumber.buildingId,
        recipeId: "saw_lumber",
      },
      24_000,
    ).status,
    422,
  );
  assert.equal(
    simulation.execute(
      {
        type: "set_production_priority",
        buildingId: workshop.buildingId,
        priority: "high",
      },
      24_000,
    ).ok,
    true,
  );
  const loaded = LocalGameSimulation.fromSave(
    JSON.parse(JSON.stringify(simulation.exportSave())),
  ).read(24_000).economy;
  const loadedWorkshop = loaded.sites.find(
    (site) => site.buildingId === workshop.buildingId,
  );
  assert.equal(loadedWorkshop.recipeId, "make_animal_feed");
  assert.equal(loadedWorkshop.priority, "high");
  assert.equal(loadedWorkshop.assignedWorkers, 1);
});

test("player production priority decides which workshop receives scarce inputs", () => {
  const {
    LocalGameSimulation,
    createStartingWorld,
  } = require("../world/simulation/game-simulation.ts");
  const { validatePlacement } = require("../world/domain/construction.ts");
  const simulation = new LocalGameSimulation(createStartingWorld(), 1_000);
  const initial = simulation.read(1_000).economy;
  const quarry = initial.sites.find((site) => site.type === "quarry");
  const firstWorkshop = initial.sites.find((site) => site.type === "workshop");
  const stoneShipment = simulation.execute(
    { type: "dispatch_production", buildingId: quarry.buildingId },
    1_000,
  ).shipment;
  const cropShipment = initial.logistics.shipments.find(
    (shipment) => shipment.cargo.commodity === "crops",
  );
  const readyAt = Math.max(stoneShipment.arrivalTime, cropShipment.arrivalTime);
  const ready = simulation.read(readyAt);
  const placementCell = ready.world.cells.find((cell) =>
    validatePlacement(ready.world, {
      type: "workshop",
      x: cell.x,
      y: cell.y,
      rotation: "north",
    }).valid,
  );
  const constructed = simulation.execute(
    {
      type: "construct",
      expectedRevision: ready.revision,
      placement: {
        type: "workshop",
        x: placementCell.x,
        y: placementCell.y,
        rotation: "north",
      },
    },
    readyAt,
  );
  assert.equal(constructed.ok, true);
  const secondWorkshop = constructed.readModel.economy.sites.find(
    (site) => site.buildingId === constructed.building.id,
  );
  const crops = constructed.readModel.economy.market.listings.find(
    (listing) => listing.commodity === "crops",
  );
  assert.equal(
    simulation.execute(
      {
        type: "sell_goods",
        commodity: "crops",
        quantity: 2,
        expectedPriceCents: crops.priceCents,
      },
      readyAt,
    ).ok,
    true,
  );
  const farm = initial.sites.find((site) => site.type === "farm");
  simulation.execute(
    {
      type: "set_production_paused",
      buildingId: farm.buildingId,
      paused: true,
    },
    readyAt,
  );
  simulation.execute(
    {
      type: "set_production_paused",
      buildingId: quarry.buildingId,
      paused: true,
    },
    readyAt,
  );
  simulation.execute(
    { type: "set_workers", buildingId: firstWorkshop.buildingId, workers: 2 },
    readyAt,
  );
  simulation.execute(
    { type: "set_workers", buildingId: secondWorkshop.buildingId, workers: 2 },
    readyAt,
  );
  simulation.execute(
    {
      type: "set_production_priority",
      buildingId: firstWorkshop.buildingId,
      priority: "low",
    },
    readyAt,
  );
  simulation.execute(
    {
      type: "set_production_priority",
      buildingId: secondWorkshop.buildingId,
      priority: "high",
    },
    readyAt,
  );
  const resolved = simulation.read(readyAt + 6_000).economy;
  assert.equal(
    resolved.sites.find(
      (site) => site.buildingId === secondWorkshop.buildingId,
    ).stored,
    3,
  );
  const starved = resolved.sites.find(
    (site) => site.buildingId === firstWorkshop.buildingId,
  );
  assert.equal(starved.stored, 0);
  assert.equal(starved.status, "missing_inputs");
  assert.equal(resolved.logistics.warehouseInventory.crops, 0);
  const loaded = LocalGameSimulation.fromSave(
    JSON.parse(JSON.stringify(simulation.exportSave())),
  ).read(readyAt + 6_000).economy;
  assert.equal(
    loaded.sites.find(
      (site) => site.buildingId === secondWorkshop.buildingId,
    ).priority,
    "high",
  );
});

test("local authority is deterministic, monotonic, and exports versioned state", () => {
  const { LocalGameSimulation, createStartingWorld } = require("../world/simulation/game-simulation.ts");
  const first = new LocalGameSimulation(createStartingWorld(), 5_000);
  const second = new LocalGameSimulation(createStartingWorld(), 5_000);
  const initialSites = first.read(5_000).economy.sites;
  const lumberId = initialSites.find(
    (site) => site.type === "lumber_camp",
  ).buildingId;
  const farmId = initialSites.find((site) => site.type === "farm").buildingId;
  const releaseCommand = {
    type: "set_workers",
    buildingId: farmId,
    workers: 1,
  };
  const staffCommand = {
    type: "set_workers",
    buildingId: lumberId,
    workers: 2,
  };
  first.execute(releaseCommand, 6_000);
  second.execute(releaseCommand, 6_000);
  first.execute(staffCommand, 6_000);
  second.execute(staffCommand, 6_000);
  first.read(16_000);
  second.read(16_000);
  assert.deepEqual(first.exportSave(), second.exportSave());
  assert.equal(first.exportSave().saveVersion, 1);
  assert.doesNotThrow(() => JSON.stringify(first.exportSave()));
  assert.throws(() => first.read(15_999), /cannot move backward/);
});

test("logistics routes connect each producer to the settlement road network", () => {
  const {
    withStartingSettlement,
    buildingAt,
    footprintOf,
  } = require("../world/domain/settlement.ts");
  const { withStartingProduction } = require("../world/domain/production.ts");
  const {
    roadConnections,
    shipmentPosition,
    withStartingLogistics,
  } = require("../world/domain/logistics.ts");
  const settled = withStartingSettlement(world);
  const initialRoads = new Set(
    settled.roads.map((road) => `${road.x},${road.y}`),
  );
  const routed = withStartingLogistics(withStartingProduction(settled));
  assert.equal(routed.logisticsRoutes.length, 5);
  const roadKeys = new Set(routed.roads.map((road) => `${road.x},${road.y}`));
  for (const route of routed.logisticsRoutes) {
    const origin = routed.buildings.find(
      (building) => building.id === route.originBuildingId,
    );
    const destination = routed.buildings.find(
      (building) => building.id === route.destinationBuildingId,
    );
    assert.equal(destination.type, "warehouse");
    assert.ok(route.durationMs >= 6_000);
    assert.ok(
      initialRoads.has(`${route.path.at(-1).x},${route.path.at(-1).y}`),
    );
    assert.ok(route.path.every((cell) => roadKeys.has(`${cell.x},${cell.y}`)));
    assert.ok(route.path.every((cell) => !buildingAt(routed, cell.x, cell.y)));
    const footprint = footprintOf(origin.type, origin.rotation);
    const start = route.path[0];
    const besideOrigin =
      start.x >= origin.x - 1 &&
      start.x <= origin.x + footprint.width &&
      start.y >= origin.y - 1 &&
      start.y <= origin.y + footprint.depth;
    assert.equal(besideOrigin, true);
    for (let index = 1; index < route.path.length; index++) {
      const previous = route.path[index - 1],
        current = route.path[index];
      assert.equal(
        Math.abs(previous.x - current.x) + Math.abs(previous.y - current.y),
        1,
      );
    }
    assert.ok(
      Object.values(
        roadConnections(routed, route.path[Math.floor(route.path.length / 2)]),
      ).some(Boolean),
    );
    const shipment = { departureTime: 100, arrivalTime: 1_100 };
    assert.deepEqual(
      shipmentPosition(route, shipment, 100),
      (({ x, y, z }) => ({ x, y, z }))(route.path[0]),
    );
    assert.deepEqual(
      shipmentPosition(route, shipment, 1_100),
      (({ x, y, z }) => ({ x, y, z }))(route.path.at(-1)),
    );
  }
  assert.deepEqual(
    withStartingLogistics(withStartingProduction(settled)),
    routed,
  );
});

test("market listings expose price trends, shortages, and actionable opportunities", () => {
  const {
    buildEconomicOpportunities,
    buildMarketListings,
    marketPriceCents,
    shortageLevel,
  } = require("../world/domain/market.ts");
  const inventory = { food: 12, wood: 3, stone: 0 };
  const histories = {
    food: [
      { time: 0, priceCents: 620 },
      { time: 5_000, priceCents: 600 },
    ],
    wood: [
      { time: 0, priceCents: 1_100 },
      { time: 5_000, priceCents: 1_250 },
    ],
    stone: [
      { time: 0, priceCents: 1_600 },
      { time: 5_000, priceCents: 1_850 },
    ],
  };
  const listings = buildMarketListings(inventory, histories);
  assert.equal(
    listings.find((listing) => listing.commodity === "food").shortage,
    "none",
  );
  assert.equal(
    listings.find((listing) => listing.commodity === "wood").shortage,
    "critical",
  );
  assert.equal(
    listings.find((listing) => listing.commodity === "stone").trendPercent,
    15.6,
  );
  assert.equal(shortageLevel("stone", 0), "critical");
  assert.ok(marketPriceCents("stone", 0) > marketPriceCents("stone", 8));
  const sites = [
    {
      type: "lumber_camp",
      name: "Lumber Camp",
      buildingId: "lumber",
      output: "wood",
      recipeName: "Harvest Logs",
      statusReason: "No workers assigned.",
      status: "missing_workers",
      requiredWorkers: 2,
      assignedWorkers: 0,
    },
    {
      type: "quarry",
      name: "Quarry",
      buildingId: "quarry",
      output: "stone",
      recipeName: "Quarry Rough Stone",
      statusReason: "Output storage is full.",
      status: "storage_full",
      requiredWorkers: 3,
      assignedWorkers: 3,
      stored: 12,
    },
  ];
  const opportunities = buildEconomicOpportunities(listings, sites);
  assert.equal(opportunities[0].targetBuildingId, "lumber");
  assert.match(opportunities[0].reason, /critically short/);
  assert.ok(
    opportunities.some((opportunity) => opportunity.id === "stone-dispatch"),
  );
});

test("line and candle modes share genuine OHLC history without mutating market state", () => {
  const { buildPriceChartReadModel } = require("../world/domain/market.ts");
  const history = [
    { time: 20_000, priceCents: 1_300 },
    { time: 0, priceCents: 1_200 },
    { time: 10_000, priceCents: 1_100 },
    { time: 5_000, priceCents: 1_500 },
    { time: 15_000, priceCents: 1_400 },
    { time: 30_000, priceCents: 1_600 },
  ];
  const original = JSON.stringify(history);
  const chart = buildPriceChartReadModel(history, 15_000);

  assert.equal(JSON.stringify(history), original);
  assert.deepEqual(
    chart.observations.map((point) => point.time),
    [0, 5_000, 10_000, 15_000, 20_000, 30_000],
  );
  assert.deepEqual(chart.candles[0], {
    startTime: 0,
    endTime: 15_000,
    openCents: 1_200,
    highCents: 1_500,
    lowCents: 1_100,
    closeCents: 1_100,
    observationCount: 3,
    status: "complete",
  });
  assert.deepEqual(chart.candles[1], {
    startTime: 15_000,
    endTime: 30_000,
    openCents: 1_400,
    highCents: 1_400,
    lowCents: 1_300,
    closeCents: 1_300,
    observationCount: 2,
    status: "complete",
  });
  assert.deepEqual(chart.candles[2], {
    startTime: 30_000,
    endTime: 45_000,
    openCents: 1_600,
    highCents: 1_600,
    lowCents: 1_600,
    closeCents: 1_600,
    observationCount: 1,
    status: "active",
  });
  assert.equal(
    chart.candles.reduce(
      (total, candle) => total + candle.observationCount,
      0,
    ),
    chart.observations.length,
  );
  const lineAfterModeSwitch = buildPriceChartReadModel(
    history,
    15_000,
  ).observations;
  assert.deepEqual(lineAfterModeSwitch, chart.observations);
  assert.equal(JSON.stringify(history), original);
  assert.deepEqual(
    chart.linePoints.map((point) => point.priceCents),
    chart.candles.map((candle) => candle.closeCents),
  );
  assert.deepEqual(buildPriceChartReadModel([], 15_000), {
    observations: [],
    candles: [],
    linePoints: [],
    candleIntervalMs: 15_000,
  });
  assert.throws(() => buildPriceChartReadModel(history, 0), RangeError);
});

test("all market chart timeframes use deterministic boundaries and shared closes", () => {
  const {
    buildPriceChartReadModel,
    marketChartTimeframes,
  } = require("../world/domain/market.ts");
  assert.deepEqual(
    marketChartTimeframes.map((timeframe) => timeframe.label),
    ["1s", "1m", "5m", "15m", "1H", "4H", "1D"],
  );
  for (const timeframe of marketChartTimeframes) {
    const duration = timeframe.durationMs;
    const chart = buildPriceChartReadModel(
      [
        { time: duration - 1, priceCents: 1_000 },
        { time: duration, priceCents: 1_200 },
        { time: duration + 1, priceCents: 900 },
      ],
      duration,
      duration + 1,
    );
    assert.deepEqual(
      chart.candles.map((candle) => [candle.startTime, candle.endTime]),
      [
        [0, duration],
        [duration, duration * 2],
      ],
      timeframe.label,
    );
    assert.equal(chart.candles[0].status, "complete");
    assert.equal(chart.candles[1].status, "active");
    assert.deepEqual(
      chart.linePoints.map((point) => point.priceCents),
      chart.candles.map((candle) => candle.closeCents),
    );
  }
});

test("active market candle updates from genuine observations and completed candles stay fixed", () => {
  const { buildPriceChartReadModel } = require("../world/domain/market.ts");
  const initial = buildPriceChartReadModel(
    [{ time: 100, priceCents: 1_200 }],
    1_000,
    200,
  );
  assert.deepEqual(initial.candles[0], {
    startTime: 0,
    endTime: 1_000,
    openCents: 1_200,
    highCents: 1_200,
    lowCents: 1_200,
    closeCents: 1_200,
    observationCount: 1,
    status: "active",
  });
  const forming = buildPriceChartReadModel(
    [
      { time: 100, priceCents: 1_200 },
      { time: 220, priceCents: 1_240 },
      { time: 510, priceCents: 1_180 },
      { time: 840, priceCents: 1_230 },
    ],
    1_000,
    840,
  );
  assert.equal(forming.candles[0].openCents, 1_200);
  assert.equal(forming.candles[0].highCents, 1_240);
  assert.equal(forming.candles[0].lowCents, 1_180);
  assert.equal(forming.candles[0].closeCents, 1_230);
  const completed = buildPriceChartReadModel(
    forming.observations,
    1_000,
    1_000,
  ).candles[0];
  const nextBucket = buildPriceChartReadModel(
    [...forming.observations, { time: 1_000, priceCents: 1_300 }],
    1_000,
    1_100,
  );
  assert.deepEqual(nextBucket.candles[0], completed);
  assert.deepEqual(nextBucket.candles[1], {
    startTime: 1_000,
    endTime: 2_000,
    openCents: 1_300,
    highCents: 1_300,
    lowCents: 1_300,
    closeCents: 1_300,
    observationCount: 1,
    status: "active",
  });
  assert.equal(
    nextBucket.candles.reduce(
      (total, candle) => total + candle.observationCount,
      0,
    ),
    nextBucket.observations.length,
  );
});

test("market history retention is bounded without changing price observation cadence", () => {
  const {
    marketPriceHistoryLimit,
    marketPriceHistoryRetentionMs,
    retainMarketPriceHistory,
  } = require("../world/domain/market.ts");
  const latestTime = marketPriceHistoryRetentionMs + 10_000;
  const history = Array.from(
    { length: marketPriceHistoryLimit + 10 },
    (_, index) => ({ time: latestTime - index, priceCents: 1_000 + index }),
  ).reverse();
  history.unshift({ time: 0, priceCents: 500 });
  const retained = retainMarketPriceHistory(history, latestTime);
  assert.equal(retained.length, marketPriceHistoryLimit);
  assert.ok(
    retained.every(
      (point) => point.time >= latestTime - marketPriceHistoryRetentionMs,
    ),
  );

  const {
    LocalGameSimulation,
    createStartingWorld,
  } = require("../world/simulation/game-simulation.ts");
  const simulation = new LocalGameSimulation(createStartingWorld(), 1_000);
  const before = simulation.read(1_000).economy.market.listings.find(
    (listing) => listing.commodity === "crops",
  ).history.length;
  const beforeTick = simulation.read(5_999).economy.market.listings.find(
    (listing) => listing.commodity === "crops",
  ).history.length;
  const afterTick = simulation.read(6_000).economy.market.listings.find(
    (listing) => listing.commodity === "crops",
  ).history.length;
  assert.equal(beforeTick, before);
  assert.equal(afterTick, before + 1);
});

test("market sales remove warehouse goods, credit cash, and create events", () => {
  const { LocalGameSimulation, createStartingWorld } = require("../world/simulation/game-simulation.ts");
  const simulation = new LocalGameSimulation(createStartingWorld(), 1_000);
  const initial = simulation.read(1_000).economy;
  const food = initial.market.listings.find(
    (listing) => listing.commodity === "food",
  );
  assert.equal(initial.market.cashCents, 12_450_00);
  assert.ok(
    initial.market.opportunities.some(
      (opportunity) => opportunity.commodity === "wood",
    ),
  );
  const sale = simulation.execute(
    {
      type: "sell_goods",
      commodity: "food",
      quantity: 2,
      expectedPriceCents: food.priceCents,
    },
    1_500,
  );
  assert.equal(sale.ok, true);
  assert.equal(sale.revenueCents, food.priceCents * 2);
  assert.deepEqual(sale.sale, {
    commodity: "food",
    quantity: 2,
    unitPriceCents: food.priceCents,
    revenueCents: food.priceCents * 2,
    remainingInventory: 6,
  });
  assert.equal(sale.readModel.economy.logistics.warehouseInventory.food, 6);
  assert.equal(sale.readModel.economy.population.foodAvailable, 12);
  assert.equal(
    sale.readModel.economy.market.cashCents,
    initial.market.cashCents + sale.revenueCents,
  );
  assert.match(sale.readModel.economy.market.events[0].message, /Sold 2 food/);
  assert.equal(
    simulation.execute(
      {
        type: "sell_goods",
        commodity: "stone",
        quantity: 1,
        expectedPriceCents: sale.readModel.economy.market.listings.find(
          (listing) => listing.commodity === "stone",
        ).priceCents,
      },
      2_000,
    ).status,
    422,
  );
  assert.equal(
    simulation.execute(
      {
        type: "sell_goods",
        commodity: "food",
        quantity: 0,
        expectedPriceCents: sale.readModel.economy.market.listings.find(
          (listing) => listing.commodity === "food",
        ).priceCents,
      },
      2_000,
    ).status,
    400,
  );
  const staleQuote = simulation.execute(
    {
      type: "sell_goods",
      commodity: "food",
      quantity: 1,
      expectedPriceCents: food.priceCents,
    },
    2_000,
  );
  assert.equal(staleQuote.status, 409);
  assert.ok(staleQuote.readModel);
});

test("partial market sales retain unsold stock and rejected sales are atomic", () => {
  const { LocalGameSimulation, createStartingWorld } = require("../world/simulation/game-simulation.ts");
  const simulation = new LocalGameSimulation(createStartingWorld(), 1_000);
  const initial = simulation.read(1_000);
  const food = initial.economy.market.listings.find(
    (listing) => listing.commodity === "food",
  );
  const owned = initial.economy.logistics.warehouseInventory.food;
  const cash = initial.economy.market.cashCents;
  const accepted = simulation.execute(
    {
      type: "sell_goods",
      commodity: "food",
      quantity: 2,
      expectedPriceCents: food.priceCents,
    },
    1_000,
  );
  assert.equal(accepted.ok, true);
  assert.equal(accepted.sale.remainingInventory, owned - 2);
  assert.equal(
    accepted.readModel.economy.market.cashCents,
    cash + accepted.sale.revenueCents,
  );

  const beforeRejected = simulation.exportSave();
  const rejected = simulation.execute(
    {
      type: "sell_goods",
      commodity: "food",
      quantity: owned,
      expectedPriceCents: accepted.readModel.economy.market.listings.find(
        (listing) => listing.commodity === "food",
      ).priceCents,
    },
    1_000,
  );
  assert.equal(rejected.status, 422);
  assert.deepEqual(simulation.exportSave(), beforeRejected);
});

test("commodity browser search derives case-insensitive results from the catalog", () => {
  const {
    filterCommodityCatalog,
  } = require("../world/domain/commodity-navigation.ts");
  const { commodityIds } = require("../world/domain/commodities.ts");
  assert.deepEqual(filterCommodityCatalog(commodityIds, "cro"), ["crops"]);
  assert.deepEqual(filterCommodityCatalog(commodityIds, "IRON"), [
    "iron_ore",
    "iron",
    "iron_tools",
  ]);
  assert.deepEqual(filterCommodityCatalog(commodityIds, "  "), commodityIds);
  assert.deepEqual(filterCommodityCatalog(commodityIds, "unobtainium"), []);
});

test("commodity browser chains and related goods come from production recipes", () => {
  const {
    buildCommodityProductionChains,
    commodityRelationships,
  } = require("../world/domain/commodity-navigation.ts");
  const { commodityIds } = require("../world/domain/commodities.ts");
  const chains = buildCommodityProductionChains(commodityIds);
  const listed = chains.flatMap((chain) => chain.commodities);
  assert.deepEqual([...listed].sort(), [...commodityIds].sort());
  assert.equal(new Set(listed).size, commodityIds.length);

  const forestry = chains.find((chain) => chain.commodities.includes("wood"));
  assert.deepEqual(forestry.commodities, ["wood", "lumber"]);
  const metals = chains.find((chain) =>
    chain.commodities.includes("iron_ore"),
  );
  assert.deepEqual(metals.commodities, ["iron_ore", "iron", "iron_tools"]);
  assert.deepEqual(commodityRelationships("iron_ore"), {
    madeFrom: [],
    usedToMake: ["iron"],
  });
  assert.deepEqual(commodityRelationships("crops").usedToMake, [
    "food",
    "animal_feed",
    "prepared_meal",
  ]);
});

test("household food demand and configured food values are deterministic", () => {
  const {
    availableFoodValue,
    consumeHouseholdFood,
    foodRequired,
    populationPolicy,
  } = require("../world/domain/population.ts");
  const {
    normalizeCommodityInventory,
  } = require("../world/domain/commodities.ts");
  const oneOfEach = normalizeCommodityInventory({
    crops: 1,
    food: 1,
    cooked_meat: 1,
    prepared_meal: 1,
  });
  assert.equal(availableFoodValue(oneOfEach), 10);
  assert.deepEqual(
    Object.fromEntries(
      populationPolicy.foodSources.map((source) => [
        source.commodity,
        source.foodValue,
      ]),
    ),
    { prepared_meal: 4, cooked_meat: 3, food: 2, crops: 1 },
  );
  assert.equal(foodRequired(10), 10);
  assert.equal(foodRequired(25), 25);

  for (const [commodity, foodValue] of [
    ["crops", 1],
    ["food", 2],
    ["cooked_meat", 3],
    ["prepared_meal", 4],
  ]) {
    const result = consumeHouseholdFood(
      normalizeCommodityInventory({ [commodity]: 1 }),
      1,
    );
    assert.equal(result.inventory[commodity], 0);
    assert.equal(result.consumption.consumedFoodValue, foodValue);
  }
});

test("higher population consumes more food and shortages report unmet demand", () => {
  const {
    consumeHouseholdFood,
  } = require("../world/domain/population.ts");
  const {
    normalizeCommodityInventory,
  } = require("../world/domain/commodities.ts");
  const stocked = normalizeCommodityInventory({ food: 100 });
  const small = consumeHouseholdFood(stocked, 2);
  const large = consumeHouseholdFood(stocked, 10);
  assert.equal(small.inventory.food, 99);
  assert.equal(large.inventory.food, 95);
  assert.equal(small.consumption.requiredFoodValue, 2);
  assert.equal(large.consumption.requiredFoodValue, 10);

  const shortage = consumeHouseholdFood(
    normalizeCommodityInventory({ crops: 4 }),
    10,
  );
  assert.equal(shortage.inventory.crops, 0);
  assert.equal(shortage.consumption.availableFoodValue, 4);
  assert.equal(shortage.consumption.consumedFoodValue, 4);
  assert.equal(shortage.consumption.supplyPercent, 40);
});

test("timed household consumption is step-independent and survives save loading", () => {
  const {
    LocalGameSimulation,
    createStartingWorld,
  } = require("../world/simulation/game-simulation.ts");
  const direct = new LocalGameSimulation(createStartingWorld(), 1_000);
  const stepped = new LocalGameSimulation(createStartingWorld(), 1_000);
  direct.read(181_000);
  stepped.read(61_000);
  stepped.read(121_000);
  const finalStep = stepped.read(181_000).economy;
  assert.deepEqual(direct.exportSave(), stepped.exportSave());
  assert.equal(finalStep.logistics.warehouseInventory.food, 0);
  assert.equal(finalStep.logistics.warehouseInventory.crops, 0);
  // Population is no longer constant: food demand follows it.
  assert.equal(
    finalStep.population.foodRequired,
    finalStep.population.totalPopulation,
  );
  assert.ok(finalStep.population.totalPopulation >= 10);
  assert.equal(finalStep.population.foodConsumed, 0);
  assert.equal(finalStep.population.foodSupplyPercent, 0);

  const firstPeriod = new LocalGameSimulation(createStartingWorld(), 1_000);
  const afterFirst = firstPeriod.read(61_000).economy;
  assert.equal(afterFirst.logistics.warehouseInventory.food, 3);
  assert.equal(afterFirst.population.foodConsumed, 10);
  assert.equal(afterFirst.population.foodSupplyPercent, 100);
  assert.deepEqual(afterFirst.population.mainFoodSources, [
    {
      commodity: "food",
      name: "Basic Food",
      unitsConsumed: 5,
      foodValue: 2,
      totalFoodValue: 10,
    },
  ]);

  const saved = JSON.parse(JSON.stringify(firstPeriod.exportSave()));
  const restored = LocalGameSimulation.fromSave(saved);
  assert.deepEqual(restored.read(61_000), firstPeriod.read(61_000));
  assert.deepEqual(
    restored.read(121_000),
    firstPeriod.read(121_000),
  );

  delete saved.foodConsumptionUpdatedAt;
  delete saved.lastFoodConsumption;
  const legacy = LocalGameSimulation.fromSave(saved);
  assert.equal(
    legacy.read(saved.simulationTime).economy.logistics.warehouseInventory.food,
    saved.warehouseInventory.food,
  );
});

test("local price policy raises shortages and lowers oversupply for stated reasons", () => {
  const {
    marketPriceAnalysis,
    marketSupplyStatus,
  } = require("../world/domain/market.ts");
  const shortage = marketPriceAnalysis("food", 2, 600, {
    supply: 0,
    demand: 5,
    consumption: 5,
  });
  assert.ok(shortage.priceCents > 600);
  assert.equal(marketSupplyStatus("food", 2), "critical_shortage");
  assert.ok(shortage.reasons.some((reason) => /below the target/.test(reason)));
  assert.ok(
    shortage.reasons.some((reason) =>
      /demand 5 exceeded delivered supply 0/.test(reason),
    ),
  );
  assert.ok(
    shortage.reasons.some((reason) => /consumption used 5/.test(reason)),
  );
  assert.ok(
    shortage.reasons.some((reason) => /moved price up from/.test(reason)),
  );

  const oversupply = marketPriceAnalysis("food", 30, 600, {
    supply: 12,
    demand: 1,
    consumption: 1,
  });
  assert.ok(oversupply.priceCents < 600);
  assert.equal(marketSupplyStatus("food", 30), "oversupplied");
  assert.ok(
    oversupply.reasons.some((reason) => /above the target/.test(reason)),
  );
  assert.ok(
    oversupply.reasons.some((reason) =>
      /supply 12 exceeded recent demand 1/.test(reason),
    ),
  );
  assert.ok(
    oversupply.reasons.some((reason) => /moved price down from/.test(reason)),
  );
  assert.deepEqual(
    marketPriceAnalysis("food", 30, 600, {
      supply: 12,
      demand: 1,
      consumption: 1,
    }),
    oversupply,
  );
});

test("authoritative inventory flows feed local market activity exactly once", () => {
  const {
    LocalGameSimulation,
    createStartingWorld,
  } = require("../world/simulation/game-simulation.ts");
  const simulation = new LocalGameSimulation(createStartingWorld(), 1_000);
  const initial = simulation.read(1_000).economy;
  const cropShipment = initial.logistics.shipments.find(
    (shipment) => shipment.cargo.commodity === "crops",
  );
  const arrived = simulation.read(cropShipment.arrivalTime).economy;
  assert.equal(arrived.logistics.warehouseInventory.crops, 4);
  const afterSupply = simulation.read(cropShipment.arrivalTime + 5_000).economy;
  const crops = afterSupply.market.listings.find(
    (listing) => listing.commodity === "crops",
  );
  assert.equal(crops.available, 4);
  assert.equal(crops.recentSupply, 4);
  assert.equal(crops.recentDemand, 0);
  assert.equal(crops.recentConsumption, 0);
  assert.ok(
    crops.priceReasons.some((reason) =>
      /Delivered supply 4 exceeded recent demand 0/.test(reason),
    ),
  );
  const nextObservation = simulation.read(
    cropShipment.arrivalTime + 10_000,
  ).economy.market.listings.find((listing) => listing.commodity === "crops");
  assert.equal(nextObservation.recentSupply, 0);

  const afterHouseholds = simulation.read(66_000).economy;
  const food = afterHouseholds.market.listings.find(
    (listing) => listing.commodity === "food",
  );
  assert.equal(food.available, 3);
  assert.equal(food.recentDemand, 5);
  assert.equal(food.recentConsumption, 5);
  assert.ok(
    food.priceReasons.some((reason) => /Recent consumption used 5/.test(reason)),
  );
});

test("pending local market activity remains deterministic across save loading", () => {
  const {
    LocalGameSimulation,
    createStartingWorld,
  } = require("../world/simulation/game-simulation.ts");
  const direct = new LocalGameSimulation(createStartingWorld(), 1_000);
  const shipment = direct
    .read(1_000)
    .economy.logistics.shipments.find(
      (candidate) => candidate.cargo.commodity === "crops",
    );
  direct.read(shipment.arrivalTime);
  const save = JSON.parse(JSON.stringify(direct.exportSave()));
  const restored = LocalGameSimulation.fromSave(save);
  const nextTime = shipment.arrivalTime + 5_000;
  assert.deepEqual(restored.read(nextTime), direct.read(nextTime));

  delete save.recentMarketActivity;
  const legacy = LocalGameSimulation.fromSave(save).read(save.simulationTime);
  assert.ok(
    legacy.economy.market.listings.every(
      (listing) =>
        listing.recentSupply === 0 &&
        listing.recentDemand === 0 &&
        listing.recentConsumption === 0,
    ),
  );
});

test("market prices and flow history are independent of read frequency", () => {
  const {
    LocalGameSimulation,
    createStartingWorld,
  } = require("../world/simulation/game-simulation.ts");
  const direct = new LocalGameSimulation(createStartingWorld(), 1_000);
  const frequent = new LocalGameSimulation(createStartingWorld(), 1_000);
  direct.read(31_000);
  for (let time = 6_000; time <= 31_000; time += 5_000)
    frequent.read(time);
  assert.deepEqual(frequent.exportSave(), direct.exportSave());
});

test("NPC city specializations use existing recipes and create distinct regional economies", () => {
  const {
    advanceNpcCities,
    createNpcCities,
    npcCityProductionCapacity,
  } = require("../world/domain/npc-cities.ts");
  const { commodityIds } = require("../world/domain/commodities.ts");
  const { productionRecipes } = require("../world/domain/production.ts");
  const { createStartingWorld } = require("../world/simulation/game-simulation.ts");
  const cities = createNpcCities(createStartingWorld());
  assert.equal(cities.length, 5);
  assert.equal(new Set(cities.map((city) => city.id)).size, cities.length);
  for (const city of cities) {
    assert.ok(city.population > 0);
    assert.ok(city.resourceAdvantages.length > 0);
    assert.ok(Number.isInteger(city.position.x));
    assert.ok(Number.isInteger(city.position.y));
    assert.ok(Number.isInteger(city.position.z));
    assert.deepEqual(Object.keys(city.inventory), commodityIds);
    for (const recipeId of Object.keys(city.recipeCapacity))
      assert.ok(productionRecipes[recipeId]);
  }
  const greenvale = cities.find((city) => city.id === "greenvale");
  const ironhold = cities.find((city) => city.id === "ironhold");
  assert.ok(npcCityProductionCapacity(greenvale).crops > 0);
  assert.ok(npcCityProductionCapacity(ironhold).iron_ore > 0);

  let advanced = cities;
  for (let period = 0; period < 3; period++)
    advanced = advanceNpcCities(advanced);
  const advancedGreenvale = advanced.find((city) => city.id === "greenvale");
  const advancedIronhold = advanced.find((city) => city.id === "ironhold");
  assert.ok(advancedGreenvale.inventory.crops > advancedIronhold.inventory.crops);
  assert.ok(
    advancedGreenvale.localPrices.crops < advancedIronhold.localPrices.crops,
  );
  assert.ok(
    advancedIronhold.inventory.iron_ore > advancedGreenvale.inventory.iron_ore,
  );
  assert.ok(
    advancedIronhold.localPrices.iron_ore <
      advancedGreenvale.localPrices.iron_ore,
  );
});

test("NPC production and consumption conserve regional commodity inventories", () => {
  const {
    advanceNpcCities,
    createNpcCities,
  } = require("../world/domain/npc-cities.ts");
  const { commodityIds } = require("../world/domain/commodities.ts");
  const { createStartingWorld } = require("../world/simulation/game-simulation.ts");
  const initial = createNpcCities(createStartingWorld());
  const advanced = advanceNpcCities(initial);
  for (const commodity of commodityIds) {
    const before = initial.reduce(
      (total, city) => total + city.inventory[commodity],
      0,
    );
    const produced = advanced.reduce(
      (total, city) => total + city.recentProduction[commodity],
      0,
    );
    const consumed = advanced.reduce(
      (total, city) => total + city.recentConsumption[commodity],
      0,
    );
    const after = advanced.reduce(
      (total, city) => total + city.inventory[commodity],
      0,
    );
    assert.equal(after, before + produced - consumed);
  }
});

test("regional departures conserve cargo and derive capacity, cost, and time from distance", () => {
  const {
    advanceNpcCities,
    createNpcCities,
  } = require("../world/domain/npc-cities.ts");
  const {
    planRegionalShipments,
    quoteRegionalTransport,
  } = require("../world/domain/regional-logistics.ts");
  const { commodityIds } = require("../world/domain/commodities.ts");
  const { createStartingWorld } = require("../world/simulation/game-simulation.ts");
  const cities = advanceNpcCities(createNpcCities(createStartingWorld()));
  const plan = planRegionalShipments(cities, [], 61_000, 1);
  assert.ok(plan.shipments.length > 0);
  assert.equal(plan.nextShipmentSequence, plan.shipments.length + 1);
  for (const commodity of commodityIds) {
    const before = cities.reduce(
      (total, city) => total + city.inventory[commodity],
      0,
    );
    const heldByCities = plan.cities.reduce(
      (total, city) => total + city.inventory[commodity],
      0,
    );
    const inTransit = plan.shipments.reduce(
      (total, shipment) =>
        shipment.commodity === commodity ? total + shipment.quantity : total,
      0,
    );
    assert.equal(heldByCities + inTransit, before);
    for (const city of cities) {
      const afterCity = plan.cities.find((candidate) => candidate.id === city.id);
      const departed = plan.shipments.reduce(
        (total, shipment) =>
          shipment.origin.cityId === city.id &&
          shipment.commodity === commodity
            ? total + shipment.quantity
            : total,
        0,
      );
      assert.equal(
        afterCity.inventory[commodity],
        city.inventory[commodity] - departed,
      );
    }
  }
  for (const shipment of plan.shipments) {
    const originBefore = cities.find(
      (city) => city.id === shipment.origin.cityId,
    );
    const destinationBefore = cities.find(
      (city) => city.id === shipment.destination.cityId,
    );
    const quote = quoteRegionalTransport(
      originBefore,
      destinationBefore,
      shipment.quantity,
    );
    assert.equal(shipment.status, "in_transit");
    assert.ok(shipment.quantity <= shipment.transportCapacity);
    assert.equal(shipment.distanceTiles, quote.distanceTiles);
    assert.equal(shipment.transportCostCents, quote.transportCostCents);
    assert.equal(shipment.arrivalTime, shipment.departureTime + quote.travelTimeMs);
    assert.equal(
      shipment.estimatedProfitCents,
      shipment.estimatedRevenueCents -
        shipment.purchaseCostCents -
      shipment.transportCostCents,
    );
  }
  const exportedSincePlanning = plan.cities.reduce(
    (total, city) => {
      const before = cities.find((candidate) => candidate.id === city.id);
      return (
        total +
        commodityIds.reduce(
          (cityTotal, commodity) =>
            cityTotal + city.exports[commodity] - before.exports[commodity],
          0,
        )
      );
    },
    0,
  );
  assert.equal(
    exportedSincePlanning,
    plan.shipments.reduce((total, shipment) => total + shipment.quantity, 0),
  );
});

test("regional arrival deposits cargo once and settles against the changed destination price", () => {
  const {
    advanceNpcCities,
    createNpcCities,
    npcCitySimulationPeriodMs,
  } = require("../world/domain/npc-cities.ts");
  const {
    planRegionalShipments,
    settleRegionalShipment,
  } = require("../world/domain/regional-logistics.ts");
  const { createStartingWorld } = require("../world/simulation/game-simulation.ts");
  const departureTime = npcCitySimulationPeriodMs;
  const cities = advanceNpcCities(createNpcCities(createStartingWorld()));
  const plan = planRegionalShipments(cities, [], departureTime, 1);
  const shipment = [...plan.shipments].sort(
    (first, second) => second.arrivalTime - first.arrivalTime,
  )[0];
  assert.ok(shipment);
  let citiesInTransit = plan.cities;
  for (
    let time = departureTime + npcCitySimulationPeriodMs;
    time < shipment.arrivalTime;
    time += npcCitySimulationPeriodMs
  )
    citiesInTransit = advanceNpcCities(citiesInTransit);
  const destinationBefore = citiesInTransit.find(
    (city) => city.id === shipment.destination.cityId,
  );
  assert.notEqual(
    destinationBefore.localPrices[shipment.commodity],
    shipment.estimatedDestinationUnitPriceCents,
  );
  const inventoryBefore = destinationBefore.inventory[shipment.commodity];
  const importsBefore = destinationBefore.imports[shipment.commodity];
  assert.throws(
    () =>
      settleRegionalShipment(
        citiesInTransit,
        shipment,
        shipment.arrivalTime - 1,
      ),
    /before its arrival time/,
  );
  const settlement = settleRegionalShipment(
    citiesInTransit,
    shipment,
    shipment.arrivalTime,
  );
  const destinationAfter = settlement.cities.find(
    (city) => city.id === shipment.destination.cityId,
  );
  assert.equal(settlement.shipment.status, "arrived");
  assert.equal(
    destinationAfter.inventory[shipment.commodity],
    inventoryBefore + shipment.quantity,
  );
  assert.equal(
    destinationAfter.imports[shipment.commodity],
    importsBefore + shipment.quantity,
  );
  assert.equal(
    settlement.shipment.actualDestinationUnitPriceCents,
    destinationBefore.localPrices[shipment.commodity],
  );
  assert.equal(
    settlement.shipment.actualRevenueCents,
    settlement.shipment.actualDestinationUnitPriceCents * shipment.quantity,
  );
  assert.equal(
    settlement.shipment.actualProfitCents,
    settlement.shipment.actualRevenueCents -
      shipment.purchaseCostCents -
      shipment.transportCostCents,
  );
  assert.notEqual(
    settlement.shipment.actualProfitCents,
    shipment.estimatedProfitCents,
  );
  assert.throws(
    () =>
      settleRegionalShipment(
        settlement.cities,
        settlement.shipment,
        shipment.arrivalTime,
      ),
    /Only an in-transit/,
  );
});

test("NPC city simulation is step-independent and remains save compatible", () => {
  const {
    LocalGameSimulation,
    createStartingWorld,
  } = require("../world/simulation/game-simulation.ts");
  const { npcCitySimulationPeriodMs } = require("../world/domain/npc-cities.ts");
  const start = 1_000;
  const end = start + npcCitySimulationPeriodMs * 3;
  const direct = new LocalGameSimulation(createStartingWorld(), start);
  const stepped = new LocalGameSimulation(createStartingWorld(), start);
  direct.read(end);
  for (
    let time = start + npcCitySimulationPeriodMs;
    time <= end;
    time += npcCitySimulationPeriodMs
  )
    stepped.read(time);
  assert.deepEqual(direct.exportSave(), stepped.exportSave());
  assert.ok(direct.exportSave().regionalShipments.length > 0);

  const restored = LocalGameSimulation.fromSave(direct.exportSave());
  assert.deepEqual(restored.exportSave(), direct.exportSave());
  const legacy = { ...direct.exportSave() };
  delete legacy.npcCities;
  delete legacy.npcCitiesUpdatedAt;
  delete legacy.regionalShipments;
  delete legacy.nextRegionalShipment;
  const migrated = LocalGameSimulation.fromSave(legacy);
  assert.equal(migrated.read(end).economy.npcCities.length, 5);
  assert.deepEqual(migrated.exportSave().regionalShipments, []);
});

test("player regional import conserves cargo, charges cash, arrives by simulation time, and survives save/load", () => {
  const {
    LocalGameSimulation,
    createStartingWorld,
  } = require("../world/simulation/game-simulation.ts");
  const start = 10_000;
  const simulation = new LocalGameSimulation(createStartingWorld(), start);
  const before = simulation.read(start);
  const origin = before.economy.regionalLogistics.locations.find(
    (location) => location.id === "ironhold",
  );
  const destination = before.economy.regionalLogistics.locations.find(
    (location) => location.id === "novagrad",
  );
  const initialOriginInventory = origin.inventory.iron_tools;
  const initialCash = before.economy.market.cashCents;
  const result = simulation.execute(
    {
      type: "create_regional_shipment",
      expectedRevision: before.revision,
      originId: origin.id,
      destinationId: destination.id,
      commodity: "iron_tools",
      quantity: 1,
      expectedOriginPriceCents: origin.localPrices.iron_tools,
      expectedDestinationPriceCents: destination.localPrices.iron_tools,
    },
    start,
  );
  assert.equal(result.ok, true);
  const shipment = result.regionalShipment;
  assert.equal(shipment.owner, "player");
  assert.equal(shipment.destinationAction, "store");
  assert.equal(
    result.readModel.economy.market.cashCents,
    initialCash - shipment.purchaseCostCents - shipment.transportCostCents,
  );
  assert.equal(
    result.readModel.economy.regionalLogistics.locations.find(
      (location) => location.id === origin.id,
    ).inventory.iron_tools,
    initialOriginInventory - 1,
  );
  const restored = LocalGameSimulation.fromSave(simulation.exportSave());
  assert.deepEqual(restored.exportSave(), simulation.exportSave());
  const warehouseBeforeArrival =
    result.readModel.economy.logistics.warehouseInventory.iron_tools;
  const arrived = restored.read(shipment.arrivalTime);
  const settled = arrived.economy.regionalLogistics.shipments.find(
    (candidate) => candidate.id === shipment.id,
  );
  assert.equal(settled.status, "arrived");
  assert.equal(settled.actualCashChangeCents, 0);
  assert.equal(
    arrived.economy.logistics.warehouseInventory.iron_tools,
    warehouseBeforeArrival + 1,
  );
  assert.equal(
    arrived.economy.market.cashCents,
    result.readModel.economy.market.cashCents,
  );
});

test("player exports settle at the live destination price and poor routes remain valid", () => {
  const {
    LocalGameSimulation,
    createStartingWorld,
  } = require("../world/simulation/game-simulation.ts");
  const start = 20_000;
  const simulation = new LocalGameSimulation(createStartingWorld(), start);
  const before = simulation.read(start);
  const origin = before.economy.regionalLogistics.locations.find(
    (location) => location.id === "novagrad",
  );
  const destination = before.economy.regionalLogistics.locations.find(
    (location) => location.id === "ironhold",
  );
  const cashBefore = before.economy.market.cashCents;
  const foodBefore = origin.inventory.food;
  const result = simulation.execute(
    {
      type: "create_regional_shipment",
      expectedRevision: before.revision,
      originId: origin.id,
      destinationId: destination.id,
      commodity: "food",
      quantity: 1,
      expectedOriginPriceCents: origin.localPrices.food,
      expectedDestinationPriceCents: destination.localPrices.food,
    },
    start,
  );
  assert.equal(result.ok, true);
  const shipment = result.regionalShipment;
  assert.ok(shipment.estimatedProfitCents < 0);
  assert.equal(shipment.upfrontCostCents, shipment.transportCostCents);
  assert.equal(
    result.readModel.economy.logistics.warehouseInventory.food,
    foodBefore - 1,
  );
  assert.equal(
    result.readModel.economy.market.cashCents,
    cashBefore - shipment.transportCostCents,
  );
  const arrived = simulation.read(shipment.arrivalTime);
  const settled = arrived.economy.regionalLogistics.shipments.find(
    (candidate) => candidate.id === shipment.id,
  );
  assert.equal(settled.status, "arrived");
  assert.equal(
    settled.actualRevenueCents,
    settled.actualDestinationUnitPriceCents * shipment.quantity,
  );
  assert.equal(settled.actualCashChangeCents, settled.actualRevenueCents);
  assert.equal(
    arrived.economy.market.cashCents,
    cashBefore - shipment.transportCostCents + settled.actualRevenueCents,
  );
  assert.equal(
    settled.actualProfitCents,
    settled.actualRevenueCents -
      shipment.purchaseCostCents -
      shipment.transportCostCents,
  );
});

test("regional player commands reject impossible routes and stale prices without mutation", () => {
  const {
    LocalGameSimulation,
    createStartingWorld,
  } = require("../world/simulation/game-simulation.ts");
  const start = 30_000;
  const simulation = new LocalGameSimulation(createStartingWorld(), start);
  const before = simulation.read(start);
  const novagrad = before.economy.regionalLogistics.locations.find(
    (location) => location.id === "novagrad",
  );
  const saved = simulation.exportSave();
  const sameRegion = simulation.execute(
    {
      type: "create_regional_shipment",
      expectedRevision: before.revision,
      originId: "novagrad",
      destinationId: "novagrad",
      commodity: "food",
      quantity: 1,
      expectedOriginPriceCents: novagrad.localPrices.food,
      expectedDestinationPriceCents: novagrad.localPrices.food,
    },
    start,
  );
  assert.equal(sameRegion.ok, false);
  assert.equal(sameRegion.status, 422);
  const destination = before.economy.regionalLogistics.locations.find(
    (location) => location.id === "greenvale",
  );
  const stale = simulation.execute(
    {
      type: "create_regional_shipment",
      expectedRevision: before.revision,
      originId: "novagrad",
      destinationId: destination.id,
      commodity: "food",
      quantity: 1,
      expectedOriginPriceCents: novagrad.localPrices.food + 1,
      expectedDestinationPriceCents: destination.localPrices.food,
    },
    start,
  );
  assert.equal(stale.ok, false);
  assert.equal(stale.status, 409);
  assert.deepEqual(simulation.exportSave(), saved);
});

test("compact browser saves round-trip exact simulation state and remain below local storage scale", () => {
  const {
    LocalGameSimulation,
    createStartingWorld,
  } = require("../world/simulation/game-simulation.ts");
  const {
    serializeLocalSave,
    deserializeLocalSave,
  } = require("../presentation/world/local-save-storage.ts");
  const start = 40_000;
  const simulation = new LocalGameSimulation(createStartingWorld(), start);
  simulation.read(start + 4 * 60 * 60_000);
  const save = simulation.exportSave();
  const plain = JSON.stringify(save);
  const compact = serializeLocalSave(save);
  assert.deepEqual(deserializeLocalSave(compact), save);
  assert.deepEqual(deserializeLocalSave(plain), save);
  assert.ok(compact.length < plain.length * 0.4);
  assert.ok(compact.length < 4_000_000);
  assert.doesNotThrow(() => LocalGameSimulation.fromSave(deserializeLocalSave(compact)));
});

test("NPC producers use shared recipes, finite labor, cash, and real inventories", () => {
  const {
    createNpcCompanies,
    advanceNpcCompanies,
  } = require("../world/domain/npc-companies.ts");
  const { createNpcCities } = require("../world/domain/npc-cities.ts");
  const { createStartingWorld } = require("../world/simulation/game-simulation.ts");
  const cities = createNpcCities(createStartingWorld());
  const companies = createNpcCompanies(cities);
  const greenvaleBefore = cities.find((city) => city.id === "greenvale");
  const pantryBefore = companies.find(
    (company) => company.id === "greenvale-pantry",
  );
  const cropsBefore =
    greenvaleBefore.inventory.crops + pantryBefore.inventory.crops;
  const foodBefore = greenvaleBefore.inventory.food + pantryBefore.inventory.food;
  const result = advanceNpcCompanies({
    cities,
    companies,
    existingShipments: [],
    time: 61_000,
    nextShipmentSequence: 1,
  });
  const greenvaleAfter = result.cities.find((city) => city.id === "greenvale");
  const pantryAfter = result.companies.find(
    (company) => company.id === "greenvale-pantry",
  );
  assert.equal(
    greenvaleAfter.inventory.crops + pantryAfter.inventory.crops,
    cropsBefore - 20,
  );
  assert.equal(
    greenvaleAfter.inventory.food + pantryAfter.inventory.food,
    foodBefore + 30,
  );
  assert.equal(pantryAfter.inventory.food, 1);
  assert.equal(pantryAfter.facilities[0].assignedWorkers, 2);
  assert.ok(pantryAfter.facilities[0].assignedWorkers <= pantryAfter.workforce);
  assert.ok(pantryAfter.cashCents !== pantryBefore.cashCents);
  assert.equal(pantryAfter.decisions.at(-1).action, "produce");
  assert.ok(
    pantryAfter.decisions.at(-1).reasons.some((reason) =>
      reason.includes("Labor:"),
    ),
  );
});

test("NPC traders buy real cargo, use shared logistics, and can realize profit or loss", () => {
  const {
    createNpcCompanies,
    advanceNpcCompanies,
    settleNpcCompanyShipment,
  } = require("../world/domain/npc-companies.ts");
  const { createNpcCities } = require("../world/domain/npc-cities.ts");
  const {
    settleRegionalShipment,
    settleRegionalShipmentValue,
  } = require("../world/domain/regional-logistics.ts");
  const { createStartingWorld } = require("../world/simulation/game-simulation.ts");
  const cities = createNpcCities(createStartingWorld());
  const companies = createNpcCompanies(cities);
  const traderBefore = companies.find(
    (company) => company.id === "azure-mercantile",
  );
  const result = advanceNpcCompanies({
    cities,
    companies,
    existingShipments: [],
    time: 61_000,
    nextShipmentSequence: 1,
  });
  const shipment = result.shipments[0];
  assert.ok(shipment);
  assert.equal(shipment.owner, "npc_company");
  assert.equal(shipment.ownerId, traderBefore.id);
  const originBefore = cities.find(
    (city) => city.id === shipment.origin.cityId,
  );
  const originAfter = result.cities.find(
    (city) => city.id === shipment.origin.cityId,
  );
  assert.equal(
    originAfter.inventory[shipment.commodity],
    originBefore.inventory[shipment.commodity] - shipment.quantity,
  );
  const traderAfterPurchase = result.companies.find(
    (company) => company.id === traderBefore.id,
  );
  assert.equal(
    traderAfterPurchase.cashCents,
    traderBefore.cashCents - shipment.upfrontCostCents,
  );
  const profitableArrival = settleRegionalShipment(
    result.cities,
    shipment,
    shipment.arrivalTime,
  );
  const afterProfit = settleNpcCompanyShipment(
    result.companies,
    profitableArrival.shipment,
  ).find((company) => company.id === traderBefore.id);
  assert.equal(
    afterProfit.cashCents,
    traderAfterPurchase.cashCents +
      profitableArrival.shipment.actualRevenueCents,
  );
  assert.ok(profitableArrival.shipment.actualProfitCents > 0);

  const losingArrival = settleRegionalShipmentValue(
    shipment,
    shipment.arrivalTime,
    1,
  );
  const afterLoss = settleNpcCompanyShipment(
    result.companies,
    losingArrival,
  ).find((company) => company.id === traderBefore.id);
  assert.ok(losingArrival.actualProfitCents < 0);
  assert.equal(afterLoss.realizedTradeProfitCents, losingArrival.actualProfitCents);
  assert.ok(
    afterLoss.decisions.at(-1).reasons.some((reason) =>
      reason.includes("Realized profit"),
    ),
  );
});

test("NPC expanders add only labor-usable capacity when expected return is attractive", () => {
  const {
    createNpcCompanies,
    advanceNpcCompanies,
  } = require("../world/domain/npc-companies.ts");
  const { createNpcCities } = require("../world/domain/npc-cities.ts");
  const { createStartingWorld } = require("../world/simulation/game-simulation.ts");
  const cities = createNpcCities(createStartingWorld());
  const companies = createNpcCompanies(cities);
  const before = companies.find((company) => company.id === "ironhold-works");
  const result = advanceNpcCompanies({
    cities,
    companies,
    existingShipments: [],
    time: 61_000,
    nextShipmentSequence: 1,
  });
  const after = result.companies.find(
    (company) => company.id === "ironhold-works",
  );
  assert.equal(after.facilities[0].capacity, before.facilities[0].capacity + 1);
  assert.equal(after.facilities[0].assignedWorkers, 6);
  assert.ok(after.facilities[0].assignedWorkers <= after.workforce);
  assert.equal(after.decisions.at(-1).action, "expand");
  assert.ok(
    after.decisions.at(-1).reasons.some((reason) =>
      reason.includes("Expected margin"),
    ),
  );
  assert.ok(after.cashCents < before.cashCents);
});

test("NPC company decisions are deterministic and remain compatible with legacy saves", () => {
  const {
    LocalGameSimulation,
    createStartingWorld,
  } = require("../world/simulation/game-simulation.ts");
  const start = 50_000;
  const end = start + 6 * 60_000;
  const direct = new LocalGameSimulation(createStartingWorld(), start);
  const stepped = new LocalGameSimulation(createStartingWorld(), start);
  direct.read(end);
  for (let time = start + 60_000; time <= end; time += 60_000)
    stepped.read(time);
  assert.deepEqual(direct.exportSave(), stepped.exportSave());
  assert.ok(
    direct.exportSave().npcCompanies.every(
      (company) => company.decisions.length > 0,
    ),
  );
  const restored = LocalGameSimulation.fromSave(direct.exportSave());
  assert.deepEqual(restored.exportSave(), direct.exportSave());
  const legacy = { ...direct.exportSave() };
  delete legacy.npcCompanies;
  delete legacy.npcCompaniesUpdatedAt;
  const migrated = LocalGameSimulation.fromSave(legacy);
  assert.equal(migrated.read(end).economy.npcCompanies.length, 3);
});

const marketIntelligenceObservation = (overrides) => ({
  locationId: "ironhold",
  locationName: "Ironhold",
  kind: "npc_city",
  commodity: "food",
  inventory: 12,
  targetStock: 12,
  priceCents: 600,
  recentProduction: 6,
  recentSupply: 6,
  recentConsumption: 6,
  recentDemand: 6,
  imports: 0,
  exports: 0,
  ...overrides,
});

test("market intelligence classifies shortage, balance, and oversupply from real conditions", () => {
  const {
    classifyMarketCondition,
    marketIntelligencePolicy,
  } = require("../world/domain/market-intelligence.ts");

  const balanced = classifyMarketCondition(
    marketIntelligenceObservation({
      inventory: 12,
      recentProduction: 2,
      recentSupply: 2,
      recentConsumption: 2,
      recentDemand: 2,
    }),
    600,
  );
  assert.equal(balanced.condition, "balanced");
  assert.equal(balanced.shortageScore, 0);
  assert.equal(balanced.oversupplyScore, 0);
  assert.equal(balanced.reasons.length, 1);
  assert.match(balanced.reasons[0], /no dominant supply or demand pressure/);

  const shortage = classifyMarketCondition(
    marketIntelligenceObservation({
      inventory: 8,
      recentProduction: 4,
      recentSupply: 4,
      recentConsumption: 4,
      recentDemand: 4,
    }),
    600,
  );
  assert.equal(shortage.condition, "shortage");
  assert.ok(shortage.shortageScore >= marketIntelligencePolicy.shortageScore);
  assert.ok(
    shortage.shortageScore < marketIntelligencePolicy.severeShortageScore,
  );

  const severeShortage = classifyMarketCondition(
    marketIntelligenceObservation({
      inventory: 2,
      recentProduction: 0,
      recentSupply: 0,
      recentConsumption: 8,
      recentDemand: 8,
      priceCents: 1_000,
    }),
    600,
  );
  assert.equal(severeShortage.condition, "severe_shortage");
  assert.ok(
    severeShortage.shortageScore >=
      marketIntelligencePolicy.severeShortageScore,
  );

  const oversupplied = classifyMarketCondition(
    marketIntelligenceObservation({
      inventory: 20,
      recentProduction: 8,
      recentSupply: 8,
      recentConsumption: 6,
      recentDemand: 6,
    }),
    600,
  );
  assert.equal(oversupplied.condition, "oversupplied");
  assert.ok(
    oversupplied.oversupplyScore >= marketIntelligencePolicy.oversupplyScore,
  );
  assert.ok(
    oversupplied.oversupplyScore <
      marketIntelligencePolicy.severeOversupplyScore,
  );

  const severeOversupply = classifyMarketCondition(
    marketIntelligenceObservation({
      inventory: 60,
      recentProduction: 20,
      recentSupply: 20,
      recentConsumption: 4,
      recentDemand: 4,
      priceCents: 300,
    }),
    600,
  );
  assert.equal(severeOversupply.condition, "severe_oversupply");
  assert.ok(
    severeOversupply.oversupplyScore >=
      marketIntelligencePolicy.severeOversupplyScore,
  );
});

test("market intelligence reacts to regional price deviation and inventory coverage", () => {
  const {
    classifyMarketCondition,
    inventoryCoveragePeriods,
    regionalMedianPriceCents,
  } = require("../world/domain/market-intelligence.ts");

  const base = marketIntelligenceObservation({
    inventory: 12,
    recentProduction: 6,
    recentSupply: 6,
    recentConsumption: 6,
    recentDemand: 6,
    priceCents: 1_200,
  });
  const atMedian = classifyMarketCondition({ ...base, priceCents: 600 }, 600);
  const aboveMedian = classifyMarketCondition(base, 600);
  assert.equal(aboveMedian.priceDeviationBasisPoints, 10_000);
  assert.equal(atMedian.priceDeviationBasisPoints, 0);
  assert.ok(aboveMedian.shortageScore > atMedian.shortageScore);
  assert.ok(
    aboveMedian.reasons.some((reason) =>
      /far above the regional median \$6\.00/.test(reason),
    ),
  );

  const belowMedian = classifyMarketCondition(
    { ...base, priceCents: 300 },
    600,
  );
  assert.equal(belowMedian.priceDeviationBasisPoints, -5_000);
  assert.ok(belowMedian.oversupplyScore > 0);

  const thinCoverage = classifyMarketCondition(
    { ...base, priceCents: 600, recentConsumption: 12, recentDemand: 12 },
    600,
  );
  assert.equal(thinCoverage.coveragePeriods, 1);
  assert.ok(thinCoverage.shortageScore > atMedian.shortageScore);
  assert.equal(
    inventoryCoveragePeriods({ inventory: 21, recentConsumption: 10 }),
    2.1,
  );
  assert.equal(
    inventoryCoveragePeriods({ inventory: 21, recentConsumption: 0 }),
    null,
  );

  assert.equal(
    regionalMedianPriceCents(
      [
        marketIntelligenceObservation({ locationId: "a", priceCents: 500 }),
        marketIntelligenceObservation({ locationId: "b", priceCents: 900 }),
        marketIntelligenceObservation({ locationId: "c", priceCents: 700 }),
      ],
      "food",
    ),
    700,
  );
  assert.equal(
    regionalMedianPriceCents(
      [
        marketIntelligenceObservation({ locationId: "a", priceCents: 500 }),
        marketIntelligenceObservation({ locationId: "b", priceCents: 900 }),
      ],
      "food",
    ),
    700,
  );
});

test("market intelligence explanations match the conditions that actually fired", () => {
  const {
    detectMarketIntelligence,
  } = require("../world/domain/market-intelligence.ts");
  const observations = [
    marketIntelligenceObservation({
      locationId: "ironhold",
      locationName: "Ironhold",
      inventory: 2,
      targetStock: 24,
      priceCents: 2_200,
      recentProduction: 0,
      recentSupply: 0,
      recentConsumption: 12,
      recentDemand: 14,
      imports: 10,
    }),
    marketIntelligenceObservation({
      locationId: "greenvale",
      locationName: "Greenvale",
      inventory: 90,
      targetStock: 24,
      priceCents: 1_300,
      recentProduction: 40,
      recentSupply: 40,
      recentConsumption: 10,
      recentDemand: 10,
    }),
  ];
  const snapshot = detectMarketIntelligence(observations, 120_000);
  assert.equal(snapshot.updatedAt, 120_000);
  assert.equal(snapshot.regionalMedianPricesCents.food, 1_750);

  const ironhold = snapshot.reports.find(
    (report) => report.locationId === "ironhold",
  );
  assert.equal(ironhold.condition, "severe_shortage");
  assert.equal(ironhold.conditionLabel, "Severe Shortage");
  assert.ok(ironhold.inventory < ironhold.targetStock);
  assert.ok(
    ironhold.reasons.some((reason) =>
      /Inventory 2 is critically below the 24 unit target/.test(reason),
    ),
  );
  assert.equal(ironhold.inventoryCoveragePeriods, 0.2);
  assert.ok(
    ironhold.reasons.some((reason) =>
      /Inventory coverage is critically low at 0\.2 days/.test(reason),
    ),
  );
  assert.ok(ironhold.priceDeviationBasisPoints > 0);
  assert.ok(
    ironhold.reasons.some((reason) =>
      /above the regional median \$17\.50/.test(reason),
    ),
  );
  assert.equal(ironhold.productionShortfall, 12);
  assert.ok(
    ironhold.reasons.some((reason) =>
      /Consumption 12 exceeds local production 0/.test(reason),
    ),
  );
  assert.equal(ironhold.unfilledDemand, 14);
  assert.ok(
    ironhold.reasons.some((reason) =>
      /14 units of recent Basic Food demand went unfilled/.test(reason),
    ),
  );
  assert.equal(ironhold.importDependenceBasisPoints, 10_000);
  assert.ok(
    ironhold.reasons.some((reason) =>
      /Imports supplied 100% of available Basic Food/.test(reason),
    ),
  );

  const greenvale = snapshot.reports.find(
    (report) => report.locationId === "greenvale",
  );
  assert.equal(greenvale.condition, "severe_oversupply");
  assert.ok(greenvale.inventory > greenvale.targetStock);
  assert.ok(
    greenvale.reasons.every(
      (reason) => !/critically low|went unfilled/.test(reason),
    ),
  );

  assert.equal(snapshot.reports[0].locationId, "ironhold");
  assert.deepEqual(detectMarketIntelligence(observations, 120_000), snapshot);
});

test("possible responses stay informational and only name achievable actions", () => {
  const {
    detectMarketIntelligence,
    possibleResponses,
  } = require("../world/domain/market-intelligence.ts");
  const short = marketIntelligenceObservation({
    locationId: "ironhold",
    locationName: "Ironhold",
    inventory: 1,
    targetStock: 24,
    recentProduction: 0,
    recentSupply: 0,
    recentConsumption: 12,
    recentDemand: 12,
  });
  const surplus = marketIntelligenceObservation({
    locationId: "greenvale",
    locationName: "Greenvale",
    inventory: 90,
    targetStock: 24,
    priceCents: 400,
    recentProduction: 40,
    recentSupply: 40,
    recentConsumption: 4,
    recentDemand: 4,
  });
  const shortageResponses = possibleResponses(short, "severe_shortage", [
    short,
    surplus,
  ]);
  assert.deepEqual(
    shortageResponses.map((response) => response.kind),
    ["produce", "import"],
  );
  assert.match(shortageResponses[1].detail, /Greenvale holds 90 units/);
  for (const response of shortageResponses)
    assert.ok(
      !/guarantee|buy now|profit/i.test(
        `${response.label} ${response.detail}`,
      ),
    );

  assert.deepEqual(
    possibleResponses(short, "severe_shortage", [short]).map(
      (response) => response.kind,
    ),
    ["produce"],
  );
  assert.deepEqual(
    possibleResponses(surplus, "severe_oversupply", [short, surplus]).map(
      (response) => response.kind,
    ),
    ["reduce_production", "export"],
  );
  assert.deepEqual(
    possibleResponses(surplus, "balanced", [short, surplus]),
    [],
  );

  const producible = detectMarketIntelligence(
    [
      marketIntelligenceObservation({
        commodity: "iron_ore",
        inventory: 0,
        targetStock: 20,
        recentProduction: 0,
        recentSupply: 0,
        recentConsumption: 10,
        recentDemand: 10,
      }),
    ],
    1_000,
  );
  assert.equal(producible.reports[0].condition, "severe_shortage");
  assert.ok(
    producible.reports[0].responses.some(
      (response) => response.kind === "produce",
    ),
  );
});

test("changing economic conditions move a market between classifications", () => {
  const {
    detectMarketIntelligence,
  } = require("../world/domain/market-intelligence.ts");
  const at = (inventory, production, consumption) =>
    detectMarketIntelligence(
      [
        marketIntelligenceObservation({
          inventory,
          targetStock: 20,
          recentProduction: production,
          recentSupply: production,
          recentConsumption: consumption,
          recentDemand: consumption,
        }),
      ],
      1_000,
    ).reports[0].condition;
  assert.equal(at(1, 0, 10), "severe_shortage");
  assert.equal(at(12, 5, 5), "shortage");
  assert.equal(at(18, 5, 5), "balanced");
  assert.equal(at(32, 8, 5), "oversupplied");
  assert.equal(at(90, 30, 5), "severe_oversupply");
});

test("recent local flow is summed over one coverage period only", () => {
  const {
    marketIntelligencePolicy,
    summarizeRecentFlow,
  } = require("../world/domain/market-intelligence.ts");
  const history = [
    {
      time: 10_000,
      priceCents: 600,
      recentSupply: 5,
      recentDemand: 5,
      recentConsumption: 5,
    },
    {
      time: 70_000,
      priceCents: 600,
      recentSupply: 2,
      recentDemand: 3,
      recentConsumption: 1,
    },
    {
      time: 100_000,
      priceCents: 600,
      recentSupply: 4,
      recentDemand: 6,
      recentConsumption: 6,
    },
  ];
  assert.deepEqual(summarizeRecentFlow(history, 120_000), {
    supply: 6,
    demand: 9,
    consumption: 7,
  });
  assert.deepEqual(summarizeRecentFlow(history, 60_000), {
    supply: 5,
    demand: 5,
    consumption: 5,
  });
  assert.deepEqual(summarizeRecentFlow([], 60_000), {
    supply: 0,
    demand: 0,
    consumption: 0,
  });
  assert.equal(marketIntelligencePolicy.coveragePeriodMs, 60_000);
  assert.throws(() => summarizeRecentFlow(history, 1_000, 0), RangeError);
});

test("market intelligence observes the live economy without mutating it", () => {
  const {
    LocalGameSimulation,
    createStartingWorld,
  } = require("../world/simulation/game-simulation.ts");
  const {
    marketConditionLabels,
  } = require("../world/domain/market-intelligence.ts");
  const simulation = new LocalGameSimulation(createStartingWorld(), 1_000);
  const before = JSON.parse(JSON.stringify(simulation.exportSave()));
  const intelligence = simulation.read(200_000).economy.marketIntelligence;
  const afterFirstRead = JSON.parse(JSON.stringify(simulation.exportSave()));

  const repeated = simulation.read(200_000).economy.marketIntelligence;
  assert.deepEqual(repeated, intelligence);
  assert.deepEqual(
    JSON.parse(JSON.stringify(simulation.exportSave())),
    afterFirstRead,
  );
  assert.notDeepEqual(afterFirstRead, before);

  const economy = simulation.read(200_000).economy;
  assert.equal(
    intelligence.reports.length,
    (economy.npcCities.length + 1) * economy.market.listings.length,
  );
  assert.equal(
    new Set(intelligence.reports.map((report) => report.id)).size,
    intelligence.reports.length,
  );
  assert.ok(
    intelligence.reports.some((report) => report.locationId === "novagrad"),
  );
  for (const city of economy.npcCities)
    assert.ok(
      intelligence.reports.some((report) => report.locationId === city.id),
    );

  const greenvale = economy.npcCities.find((city) => city.id === "greenvale");
  const greenvaleCrops = intelligence.reports.find(
    (report) =>
      report.locationId === "greenvale" && report.commodity === "crops",
  );
  assert.equal(greenvaleCrops.inventory, greenvale.inventory.crops);
  assert.equal(greenvaleCrops.priceCents, greenvale.localPrices.crops);
  assert.equal(
    greenvaleCrops.recentProduction,
    greenvale.recentProduction.crops,
  );
  assert.equal(
    greenvaleCrops.recentConsumption,
    greenvale.recentConsumption.crops,
  );

  const novagradFood = intelligence.reports.find(
    (report) => report.locationId === "novagrad" && report.commodity === "food",
  );
  const foodListing = economy.market.listings.find(
    (listing) => listing.commodity === "food",
  );
  assert.equal(novagradFood.inventory, foodListing.available);
  assert.equal(novagradFood.priceCents, foodListing.priceCents);
  assert.equal(novagradFood.targetStock, foodListing.desiredStock);
  assert.equal(
    novagradFood.conditionLabel,
    marketConditionLabels[novagradFood.condition],
  );

  assert.ok(Array.isArray(economy.market.opportunities));
  assert.equal(intelligence.updatedAt, economy.simulationTime);
});

test("market intelligence is deterministic across identical simulations and saves", () => {
  const {
    LocalGameSimulation,
    createStartingWorld,
  } = require("../world/simulation/game-simulation.ts");
  const first = new LocalGameSimulation(createStartingWorld(), 1_000);
  const second = new LocalGameSimulation(createStartingWorld(), 1_000);
  assert.deepEqual(
    second.read(180_000).economy.marketIntelligence,
    first.read(180_000).economy.marketIntelligence,
  );

  const stepped = new LocalGameSimulation(createStartingWorld(), 1_000);
  for (let time = 20_000; time <= 180_000; time += 20_000) stepped.read(time);
  assert.deepEqual(
    stepped.read(180_000).economy.marketIntelligence,
    first.read(180_000).economy.marketIntelligence,
  );

  const save = first.exportSave();
  assert.equal("marketIntelligence" in save, false);
  const restored = LocalGameSimulation.fromSave(
    JSON.parse(JSON.stringify(save)),
  );
  assert.deepEqual(
    restored.read(180_000).economy.marketIntelligence,
    first.read(180_000).economy.marketIntelligence,
  );

  const legacy = JSON.parse(JSON.stringify(save));
  delete legacy.npcCompanies;
  delete legacy.npcCompaniesUpdatedAt;
  assert.ok(
    LocalGameSimulation.fromSave(legacy).read(180_000).economy
      .marketIntelligence.reports.length > 0,
  );
});

test("industry periods record authoritative production facts and stay bounded", () => {
  const {
    LocalGameSimulation,
    createStartingWorld,
  } = require("../world/simulation/game-simulation.ts");
  const {
    competitionPolicy,
    retainIndustryPeriods,
    emptyIndustryPeriodRecord,
    isIndustryPeriodRecord,
  } = require("../world/domain/competition.ts");
  const simulation = new LocalGameSimulation(createStartingWorld(), 1_000);

  assert.equal(simulation.read(1_000).economy.competition.periodsRecorded, 0);
  const firstPeriod = simulation.read(70_000).economy.competition;
  assert.equal(firstPeriod.periodsRecorded, 1);
  assert.equal(simulation.read(200_000).economy.competition.periodsRecorded, 3);

  // The starting farm's real output is attributed to the player, not to NPCs.
  const crops = firstPeriod.positions.find(
    (position) => position.commodity === "crops",
  );
  assert.ok(crops.playerSupply > 0);
  assert.equal(crops.currentSupply, crops.playerSupply + crops.npcSupply);
  assert.equal(
    crops.playerSupplyShareBasisPoints,
    Math.round((crops.playerSupply / crops.currentSupply) * 10_000),
  );
  assert.equal(crops.playerSiteCount, 1);

  // Every commodity is positioned exactly once.
  assert.equal(
    new Set(firstPeriod.positions.map((position) => position.commodity)).size,
    firstPeriod.positions.length,
  );

  const saved = simulation.exportSave();
  assert.ok(saved.industryPeriods.every(isIndustryPeriodRecord));
  let history = [];
  for (let index = 0; index < competitionPolicy.periodHistoryLimit + 5; index++)
    history = retainIndustryPeriods(
      history,
      emptyIndustryPeriodRecord(index * 60_000),
    );
  assert.equal(history.length, competitionPolicy.periodHistoryLimit);
  assert.equal(history[0].time, 5 * 60_000);
});

test("NPC company production is reported per commodity without changing decisions", () => {
  const {
    advanceNpcCompanies,
    createNpcCompanies,
  } = require("../world/domain/npc-companies.ts");
  const {
    createNpcCities,
    advanceNpcCities,
  } = require("../world/domain/npc-cities.ts");
  const { generateWorld } = require("../world/domain/world.ts");
  const { commodityIds } = require("../world/domain/commodities.ts");
  const cities = advanceNpcCities(createNpcCities(generateWorld()));
  const companies = createNpcCompanies(cities);
  const result = advanceNpcCompanies({
    cities,
    companies,
    existingShipments: [],
    time: 60_000,
    nextShipmentSequence: 1,
  });
  assert.ok(result.production);
  for (const commodity of commodityIds)
    assert.ok(Number.isSafeInteger(result.production[commodity]));
  assert.ok(
    commodityIds.some((commodity) => result.production[commodity] > 0),
    "at least one producing company should report output",
  );
  // Determinism and no change to the existing return contract.
  const repeated = advanceNpcCompanies({
    cities,
    companies,
    existingShipments: [],
    time: 60_000,
    nextShipmentSequence: 1,
  });
  assert.deepEqual(repeated.production, result.production);
  assert.deepEqual(repeated.companies, result.companies);
  assert.deepEqual(repeated.cities, result.cities);
});

test("industry position reports market size, share, growth, entrants, and real unit costs", () => {
  const {
    buildIndustryPositions,
    emptyIndustryPeriodRecord,
    unitInputCostCents,
    entryCostCents,
  } = require("../world/domain/competition.ts");
  const {
    detectMarketIntelligence,
  } = require("../world/domain/market-intelligence.ts");
  const { commodityRecord } = require("../world/domain/commodities.ts");

  const period = (time, overrides) => ({
    ...emptyIndustryPeriodRecord(time),
    ...overrides,
  });
  const withCrops = (base, value) => ({ ...commodityRecord(0), crops: value });
  const periods = [
    period(60_000, {
      playerProduction: withCrops(null, 10),
      npcCityProduction: withCrops(null, 40),
      npcCompanyProduction: withCrops(null, 10),
      demand: withCrops(null, 30),
      playerSites: withCrops(null, 1),
      npcCapacity: withCrops(null, 2),
    }),
    period(120_000, {
      playerProduction: withCrops(null, 20),
      npcCityProduction: withCrops(null, 40),
      npcCompanyProduction: withCrops(null, 20),
      demand: withCrops(null, 30),
      playerSites: withCrops(null, 2),
      npcCapacity: withCrops(null, 4),
    }),
  ];
  const intelligence = detectMarketIntelligence([], 120_000);
  const positions = buildIndustryPositions({
    periods,
    sites: [
      { output: "crops", paused: false, buildingId: "a", name: "Farm A" },
      { output: "crops", paused: true, buildingId: "b", name: "Farm B" },
    ],
    priceOf: () => 500,
    intelligence,
    localLocationId: "novagrad",
  });
  const crops = positions.find((position) => position.commodity === "crops");
  assert.equal(crops.playerSupply, 20);
  assert.equal(crops.npcSupply, 60);
  assert.equal(crops.currentSupply, 80);
  assert.equal(crops.marketSizeUnits, 80);
  assert.equal(crops.currentDemand, 30);
  assert.equal(crops.playerSupplyShareBasisPoints, 2_500);
  // Growth compares the newest period against the oldest in the window.
  assert.equal(crops.npcSupplyGrowthUnits, 10);
  assert.equal(crops.npcSupplyGrowthBasisPoints, 2_000);
  // Entrants count added player sites and NPC capacity across the window.
  assert.equal(crops.recentEntrants, 3);
  assert.equal(crops.playerSiteCount, 2);
  assert.equal(crops.playerActiveSiteCount, 1);
  assert.equal(crops.playerPausedSiteCount, 1);

  // Crops have no consumable inputs, so margin equals price; food does not.
  assert.equal(crops.unitInputCostCents, 0);
  assert.equal(crops.unitMarginCents, 500);
  assert.equal(crops.entryCostCents, entryCostCents("farm"));
  const food = positions.find((position) => position.commodity === "food");
  assert.ok(food.unitInputCostCents > 0);
  assert.equal(food.unitMarginCents, food.unitRevenueCents - food.unitInputCostCents);
  assert.equal(unitInputCostCents("crops", () => 500), 0);
  assert.ok(unitInputCostCents("food", () => 500) > 0);

  // Deriving twice from the same inputs gives the same positions.
  assert.deepEqual(
    buildIndustryPositions({
      periods,
      sites: [
        { output: "crops", paused: false, buildingId: "a", name: "Farm A" },
        { output: "crops", paused: true, buildingId: "b", name: "Farm B" },
      ],
      priceOf: () => 500,
      intelligence,
      localLocationId: "novagrad",
    }),
    positions,
  );
});

test("industry responses offer exit while active and re-entry while paused", () => {
  const {
    buildIndustryPositions,
    emptyIndustryPeriodRecord,
  } = require("../world/domain/competition.ts");
  const {
    detectMarketIntelligence,
  } = require("../world/domain/market-intelligence.ts");
  const intelligence = detectMarketIntelligence([], 60_000);
  const kindsFor = (sites) =>
    buildIndustryPositions({
      periods: [emptyIndustryPeriodRecord(60_000)],
      sites,
      priceOf: () => 500,
      intelligence,
      localLocationId: "novagrad",
    })
      .find((position) => position.commodity === "crops")
      .responses.map((response) => response.kind);

  assert.deepEqual(kindsFor([]), ["expand"]);
  assert.deepEqual(
    kindsFor([{ output: "crops", paused: false, buildingId: "a", name: "A" }]),
    ["expand", "reduce", "exit"],
  );
  assert.deepEqual(
    kindsFor([{ output: "crops", paused: true, buildingId: "a", name: "A" }]),
    ["expand", "reenter"],
  );
  assert.deepEqual(
    kindsFor([
      { output: "crops", paused: false, buildingId: "a", name: "A" },
      { output: "crops", paused: true, buildingId: "b", name: "B" },
    ]),
    ["expand", "reduce", "exit", "reenter"],
  );
});

test("exiting an industry pauses every site, frees labor, and is reversible", () => {
  const {
    LocalGameSimulation,
    createStartingWorld,
  } = require("../world/simulation/game-simulation.ts");
  const simulation = new LocalGameSimulation(createStartingWorld(), 1_000);
  const before = simulation.read(70_000).economy;
  const farm = before.sites.find((site) => site.output === "crops");
  assert.ok(farm.assignedWorkers > 0);
  const assignedBefore = before.labor.assignedWorkers;

  const exited = simulation.execute(
    { type: "set_industry_paused", commodity: "crops", paused: true },
    70_000,
  );
  assert.equal(exited.ok, true);
  const afterExit = exited.readModel.economy;
  for (const site of afterExit.sites.filter((s) => s.output === "crops")) {
    assert.equal(site.paused, true);
    assert.equal(site.assignedWorkers, 0);
  }
  // Released labor is genuinely available to other industries.
  assert.equal(
    afterExit.labor.assignedWorkers,
    assignedBefore - farm.assignedWorkers,
  );
  assert.ok(
    afterExit.market.events.some((event) => /Exited Crops/.test(event.message)),
  );
  // Sites producing other commodities are untouched.
  const quarry = afterExit.sites.find((site) => site.output === "stone");
  assert.equal(quarry.paused, false);

  // Repeating the command is a no-op rather than an error.
  assert.equal(
    simulation.execute(
      { type: "set_industry_paused", commodity: "crops", paused: true },
      70_000,
    ).ok,
    true,
  );

  // Reversible: re-entering resumes the sites.
  const reentered = simulation.execute(
    { type: "set_industry_paused", commodity: "crops", paused: false },
    70_000,
  );
  assert.equal(reentered.ok, true);
  const resumed = reentered.readModel.economy.sites.find(
    (site) => site.output === "crops",
  );
  assert.equal(resumed.paused, false);
  assert.ok(
    reentered.readModel.economy.market.events.some((event) =>
      /Re-entered Crops/.test(event.message),
    ),
  );

  // An industry the player does not run is rejected without mutation.
  const rejected = simulation.execute(
    { type: "set_industry_paused", commodity: "prepared_meal", paused: true },
    70_000,
  );
  assert.equal(rejected.ok, false);
  assert.equal(rejected.status, 422);
  assert.match(rejected.error, /No production site currently produces/);
  assert.deepEqual(
    rejected.readModel.economy.sites,
    simulation.read(70_000).economy.sites,
  );
});

test("player supply moves price and flips the industry into oversupply", () => {
  const {
    LocalGameSimulation,
    createStartingWorld,
  } = require("../world/simulation/game-simulation.ts");
  const simulation = new LocalGameSimulation(createStartingWorld(), 1_000);
  const start = simulation.read(70_000).economy;
  const farm = start.sites.find((site) => site.output === "crops");
  const priceBefore = start.market.listings.find(
    (listing) => listing.commodity === "crops",
  ).priceCents;

  const dispatched = simulation.execute(
    { type: "dispatch_production", buildingId: farm.buildingId },
    70_000,
  );
  assert.equal(dispatched.ok, true);
  assert.ok(dispatched.collected > 0);
  const arrival = dispatched.shipment.arrivalTime;
  const after = simulation.read(arrival + 15_000).economy;
  const priceAfter = after.market.listings.find(
    (listing) => listing.commodity === "crops",
  ).priceCents;

  // Supplying the market lowers the price the player can sell into.
  assert.ok(
    priceAfter < priceBefore,
    `expected ${priceAfter} < ${priceBefore}`,
  );
  const position = after.competition.positions.find(
    (candidate) => candidate.commodity === "crops",
  );
  assert.equal(position.condition, "severe_oversupply");
  // Margin falls with the price, so the industry becomes less attractive.
  assert.ok(position.unitMarginCents < priceBefore);
  assert.ok(
    position.responses.some((response) => response.kind === "exit"),
    "an oversupplied industry the player runs can be exited",
  );
});

test("competition read model is deterministic and survives save loading", () => {
  const {
    LocalGameSimulation,
    createStartingWorld,
  } = require("../world/simulation/game-simulation.ts");
  const first = new LocalGameSimulation(createStartingWorld(), 1_000);
  const second = new LocalGameSimulation(createStartingWorld(), 1_000);
  assert.deepEqual(
    second.read(300_000).economy.competition,
    first.read(300_000).economy.competition,
  );

  const stepped = new LocalGameSimulation(createStartingWorld(), 1_000);
  for (let time = 20_000; time <= 300_000; time += 20_000) stepped.read(time);
  assert.deepEqual(
    stepped.read(300_000).economy.competition,
    first.read(300_000).economy.competition,
  );

  // Reading does not advance or mutate authoritative state.
  const snapshot = JSON.parse(JSON.stringify(first.exportSave()));
  first.read(300_000);
  assert.deepEqual(JSON.parse(JSON.stringify(first.exportSave())), snapshot);

  const restored = LocalGameSimulation.fromSave(
    JSON.parse(JSON.stringify(first.exportSave())),
  );
  assert.deepEqual(
    restored.read(300_000).economy.competition,
    first.read(300_000).economy.competition,
  );
  // Industry history and pending output round-trip exactly.
  assert.deepEqual(
    restored.exportSave().industryPeriods,
    first.exportSave().industryPeriods,
  );
  assert.deepEqual(
    restored.exportSave().pendingPlayerProduction,
    first.exportSave().pendingPlayerProduction,
  );

  // A legacy save without competition fields still loads and rebuilds history.
  const legacy = JSON.parse(JSON.stringify(first.exportSave()));
  delete legacy.industryPeriods;
  delete legacy.pendingPlayerProduction;
  const migrated = LocalGameSimulation.fromSave(legacy);
  assert.equal(migrated.read(300_000).economy.competition.periodsRecorded, 0);
  assert.ok(
    migrated.read(400_000).economy.competition.periodsRecorded > 0,
    "a migrated save resumes recording periods",
  );
});

test("industry positions expose competition without promising a profit", () => {
  const {
    LocalGameSimulation,
    createStartingWorld,
  } = require("../world/simulation/game-simulation.ts");
  const simulation = new LocalGameSimulation(createStartingWorld(), 1_000);
  const competition = simulation.read(300_000).economy.competition;
  assert.equal(competition.updatedAt, 300_000);
  for (const position of competition.positions) {
    // Margin is stated as price minus input cost, never as realized profit.
    assert.equal(
      position.unitMarginCents,
      position.unitRevenueCents - position.unitInputCostCents,
    );
    for (const response of position.responses)
      assert.ok(
        !/guaranteed|risk-free|always profitable|optimal/i.test(
          `${response.label} ${response.detail}`,
        ),
      );
  }
  // NPC capacity growth is observable, so opportunities are not static.
  const ironOre = competition.positions.find(
    (position) => position.commodity === "iron_ore",
  );
  assert.ok(Number.isSafeInteger(ironOre.npcSupplyGrowthUnits));
  assert.ok(ironOre.npcSupply > 0);
});

test("a flat price series stays centred and labelled instead of collapsing", () => {
  const {
    priceScale,
    flatPriceScalePaddingBasisPoints,
  } = require("../presentation/world/price-chart.tsx");
  const dimensions = {
    width: 620,
    height: 250,
    top: 14,
    bottom: 30,
    left: 16,
    right: 16,
  };
  const plotHeight = dimensions.height - dimensions.top - dimensions.bottom;
  const middle = dimensions.top + plotHeight / 2;

  // A market at a fixed point reports one repeated price.
  const flat = priceScale([742, 742, 742, 742], dimensions);
  const padding = Math.round((742 * flatPriceScalePaddingBasisPoints) / 10_000);
  assert.ok(padding > 0);
  assert.equal(flat.minimum, 742 - padding);
  assert.equal(flat.maximum, 742 + padding);
  // The series sits mid-plot, not pinned to the top edge.
  assert.equal(flat.y(742), middle);
  assert.ok(flat.y(742) > dimensions.top);
  assert.ok(flat.y(742) < dimensions.height - dimensions.bottom);
  // The two axis labels now differ, so the chart no longer reads as broken.
  assert.notEqual(flat.minimum, flat.maximum);

  // A very small price still gets at least one cent of padding.
  const tiny = priceScale([1, 1], dimensions);
  assert.equal(tiny.minimum, 0);
  assert.equal(tiny.maximum, 2);
  assert.equal(tiny.y(1), middle);

  // A series with real movement is unchanged: exact bounds, full plot height.
  const moving = priceScale([504, 627, 742], dimensions);
  assert.equal(moving.minimum, 504);
  assert.equal(moving.maximum, 742);
  assert.equal(moving.y(742), dimensions.top);
  assert.equal(moving.y(504), dimensions.top + plotHeight);
  assert.ok(moving.y(627) > moving.y(742) && moving.y(627) < moving.y(504));

  // Flat candles resolve to a visible body rather than a zero-height sliver.
  const flatCandle = priceScale([742, 742], dimensions);
  const openY = flatCandle.y(742);
  const closeY = flatCandle.y(742);
  assert.equal(Math.max(2, Math.abs(closeY - openY)), 2);
  assert.equal(openY, middle);
});

// A minimal in-memory IndexedDB good enough for the repository's usage:
// open -> upgrade -> transaction -> objectStore -> get/put/delete.
function createFakeIndexedDb(options = {}) {
  const stores = new Map();
  const succeed = (result) => {
    const request = { result, onsuccess: null, onerror: null };
    queueMicrotask(() => {
      if (request.onsuccess) request.onsuccess();
    });
    return request;
  };
  const fail = (error) => {
    const request = { error, onsuccess: null, onerror: null };
    queueMicrotask(() => {
      if (request.onerror) request.onerror();
    });
    return request;
  };
  return {
    stores,
    open(name, version) {
      const request = {
        result: null,
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
        onblocked: null,
      };
      queueMicrotask(() => {
        if (options.refuseOpen) {
          request.error = new Error("blocked");
          if (request.onerror) request.onerror();
          return;
        }
        const database = {
          name,
          version,
          objectStoreNames: {
            contains: (storeName) => stores.has(storeName),
          },
          createObjectStore: (storeName) => {
            stores.set(storeName, new Map());
            return {};
          },
          transaction: (storeName) => ({
            onabort: null,
            error: null,
            objectStore: () => ({
              get: (key) => succeed(stores.get(storeName)?.get(key)),
              put: (value, key) => {
                if (options.refuseWrite) return fail(new Error("write refused"));
                stores.get(storeName).set(key, value);
                return succeed(undefined);
              },
              delete: (key) => {
                stores.get(storeName).delete(key);
                return succeed(undefined);
              },
            }),
          }),
          close: () => {},
        };
        request.result = database;
        if (!stores.has("saves") && request.onupgradeneeded)
          request.onupgradeneeded();
        if (request.onsuccess) request.onsuccess();
      });
      return request;
    },
  };
}

function createFakeLocalStorage(options = {}) {
  const entries = new Map();
  return {
    entries,
    getItem: (key) => (entries.has(key) ? entries.get(key) : null),
    setItem: (key, value) => {
      if (options.refuseWrite) {
        const error = new Error("quota");
        error.name = "QuotaExceededError";
        throw error;
      }
      entries.set(key, String(value));
    },
    removeItem: (key) => entries.delete(key),
  };
}

const withBrowser = async (indexedDbValue, localStorageValue, run) => {
  const priorIndexedDb = globalThis.indexedDB;
  const priorWindow = globalThis.window;
  globalThis.indexedDB = indexedDbValue;
  globalThis.window = { localStorage: localStorageValue };
  try {
    return await run();
  } finally {
    globalThis.indexedDB = priorIndexedDb;
    globalThis.window = priorWindow;
  }
};

test("saves round-trip through IndexedDB without the localStorage size ceiling", async () => {
  const {
    LocalGameSimulation,
    createStartingWorld,
  } = require("../world/simulation/game-simulation.ts");
  const repository = require("../presentation/world/save-repository.ts");

  const simulation = new LocalGameSimulation(createStartingWorld(), 40_000);
  simulation.read(400_000);
  const save = simulation.exportSave();

  const db = createFakeIndexedDb();
  const storage = createFakeLocalStorage();
  await withBrowser(db, storage, async () => {
    assert.deepEqual(await repository.loadLocalSave(), {
      save: null,
      backend: "indexeddb",
      migrated: false,
    });
    assert.equal(await repository.storeLocalSave(save), "indexeddb");

    const loaded = await repository.loadLocalSave();
    assert.equal(loaded.backend, "indexeddb");
    assert.equal(loaded.migrated, false);
    // The persisted payload is the unchanged save contract, stored structurally.
    assert.deepEqual(loaded.save, save);
    assert.doesNotThrow(() => LocalGameSimulation.fromSave(loaded.save));
    // Nothing was written to localStorage once IndexedDB accepted the save.
    assert.equal(storage.entries.size, 0);

    await repository.clearLocalSave();
    assert.equal((await repository.loadLocalSave()).save, null);
  });
});

test("an existing localStorage save migrates into IndexedDB exactly once", async () => {
  const {
    LocalGameSimulation,
    createStartingWorld,
  } = require("../world/simulation/game-simulation.ts");
  const { serializeLocalSave } = require(
    "../presentation/world/local-save-storage.ts",
  );
  const repository = require("../presentation/world/save-repository.ts");

  const simulation = new LocalGameSimulation(createStartingWorld(), 40_000);
  simulation.read(300_000);
  const save = simulation.exportSave();

  const db = createFakeIndexedDb();
  const storage = createFakeLocalStorage();
  storage.setItem(repository.localSaveKey, serializeLocalSave(save));

  await withBrowser(db, storage, async () => {
    const migrated = await repository.loadLocalSave();
    assert.equal(migrated.backend, "indexeddb");
    assert.equal(migrated.migrated, true);
    assert.deepEqual(migrated.save, save);
    // The legacy key is cleared so the migration cannot repeat.
    assert.equal(storage.getItem(repository.localSaveKey), null);

    const second = await repository.loadLocalSave();
    assert.equal(second.migrated, false);
    assert.deepEqual(second.save, save);
  });
});

test("storage falls back to localStorage and reports failure when nothing accepts a save", async () => {
  const {
    LocalGameSimulation,
    createStartingWorld,
  } = require("../world/simulation/game-simulation.ts");
  const repository = require("../presentation/world/save-repository.ts");
  const simulation = new LocalGameSimulation(createStartingWorld(), 40_000);
  simulation.read(200_000);
  const save = simulation.exportSave();

  // IndexedDB unavailable: localStorage still takes the save and reads back.
  const storage = createFakeLocalStorage();
  await withBrowser(undefined, storage, async () => {
    assert.equal(await repository.storeLocalSave(save), "localstorage");
    const loaded = await repository.loadLocalSave();
    assert.equal(loaded.backend, "localstorage");
    assert.deepEqual(loaded.save, save);
  });

  // IndexedDB refuses writes: localStorage is used instead.
  const refusing = createFakeIndexedDb({ refuseWrite: true });
  const spare = createFakeLocalStorage();
  await withBrowser(refusing, spare, async () => {
    assert.equal(await repository.storeLocalSave(save), "localstorage");
  });

  // Both refuse: the failure surfaces so the UI can warn instead of diverging.
  const blocked = createFakeIndexedDb({ refuseOpen: true });
  const full = createFakeLocalStorage({ refuseWrite: true });
  await withBrowser(blocked, full, async () => {
    await assert.rejects(() => repository.storeLocalSave(save));
    // A blocked store reports "no save" rather than throwing during load.
    assert.equal((await repository.loadLocalSave()).save, null);
  });
});

test("each timeframe carries a visible window that matches its label", () => {
  const { marketChartTimeframes } = require("../world/domain/market.ts");
  for (const timeframe of marketChartTimeframes) {
    assert.ok(
      Number.isSafeInteger(timeframe.visibleBuckets) &&
        timeframe.visibleBuckets > 1,
      `${timeframe.label} needs a visible window`,
    );
  }
  const byId = Object.fromEntries(
    marketChartTimeframes.map((timeframe) => [timeframe.id, timeframe]),
  );
  // "1m" shows the last hour, not every retained minute.
  assert.equal(byId["1m"].durationMs * byId["1m"].visibleBuckets, 60 * 60_000);
  // Longer timeframes cover proportionally longer spans.
  const spans = marketChartTimeframes.map(
    (timeframe) => timeframe.durationMs * timeframe.visibleBuckets,
  );
  for (let index = 1; index < spans.length; index++)
    assert.ok(
      spans[index] > spans[index - 1],
      `${marketChartTimeframes[index].label} should span longer than ${marketChartTimeframes[index - 1].label}`,
    );
});

test("chart buckets are positioned by time so gaps stay visible", () => {
  const {
    chartWindow,
    timeScale,
  } = require("../presentation/world/price-chart.tsx");
  const dimensions = {
    width: 620,
    height: 250,
    top: 14,
    bottom: 30,
    left: 16,
    right: 16,
  };
  const plotWidth = dimensions.width - dimensions.left - dimensions.right;

  const window = chartWindow(600_000, 60_000, 10);
  assert.deepEqual(window, { windowStart: 0, windowEnd: 600_000 });

  const scale = timeScale(window.windowStart, window.windowEnd, dimensions);
  assert.equal(scale.plotWidth, plotWidth);
  assert.equal(scale.x(0), dimensions.left);
  assert.equal(scale.x(600_000), dimensions.left + plotWidth);
  assert.equal(scale.x(300_000), dimensions.left + plotWidth / 2);

  // A gap occupies real width: two buckets an hour apart are not adjacent.
  const early = scale.x(60_000);
  const late = scale.x(540_000);
  assert.ok(late - early > plotWidth * 0.7);

  // Times outside the window clamp to its edges rather than escaping the plot.
  assert.equal(scale.x(-1_000_000), dimensions.left);
  assert.equal(scale.x(9_999_999), dimensions.left + plotWidth);

  // A degenerate window still produces a usable scale.
  const flat = timeScale(1_000, 1_000, dimensions);
  assert.ok(Number.isFinite(flat.x(1_000)));
});

test("the visible window keeps recent movement legible on a long flat history", () => {
  const {
    buildPriceChartReadModel,
    marketChartTimeframes,
  } = require("../world/domain/market.ts");
  const { chartWindow } = require("../presentation/world/price-chart.tsx");
  const oneMinute = marketChartTimeframes.find(
    (timeframe) => timeframe.id === "1m",
  );

  // Four hours of flat price, then a late crash: the shape that used to render
  // as a dead line with the movement crushed into the final few pixels.
  const history = [];
  for (let time = 0; time < 4 * 60 * 60_000; time += 5_000)
    history.push({ time, priceCents: 742 });
  for (const price of [653, 575, 506, 445]) {
    history.push({ time: history.at(-1).time + 5_000, priceCents: price });
  }
  const latest = history.at(-1).time;
  const chart = buildPriceChartReadModel(history, oneMinute.durationMs, latest);
  const window = chartWindow(
    chart.candles.at(-1).endTime,
    oneMinute.durationMs,
    oneMinute.visibleBuckets,
  );
  const visible = chart.candles.filter(
    (candle) => candle.startTime >= window.windowStart,
  );

  assert.ok(
    chart.candles.length > 200,
    "the full history is long enough to bury the movement",
  );
  assert.equal(visible.length, oneMinute.visibleBuckets);
  const moving = visible.filter(
    (candle) => candle.highCents !== candle.lowCents,
  ).length;
  // The moving candle is now a meaningful share of the visible chart.
  assert.ok(moving >= 1);
  assert.ok(
    moving / visible.length > chart.candles.filter((c) => c.highCents !== c.lowCents).length / chart.candles.length,
    "windowing raises the proportion of the chart that shows movement",
  );
  // The visible price scale reflects the crash rather than the old plateau.
  assert.equal(Math.min(...visible.map((candle) => candle.lowCents)), 445);
});

test("retention discards impossible future timestamps from a real poisoned history", () => {
  const {
    retainMarketPriceHistory,
    latestPricePoint,
    marketPriceHistoryRetentionMs,
  } = require("../world/domain/market.ts");
  const fixture = require("./fixtures/corrupt-price-history.json");
  const toPoint = ([time, priceCents]) => ({ time, priceCents });
  const history = [
    ...fixture.points.head,
    ...fixture.points.preBreak,
    ...fixture.points.postBreak,
    ...fixture.points.tail,
  ].map(toPoint);
  const latestTime = fixture.simulationTime;

  // The captured history really is poisoned: points dated far beyond the clock.
  assert.ok(history.some((point) => point.time > latestTime));
  assert.ok(Math.max(...history.map((p) => p.time)) > 2e15);

  const retained = retainMarketPriceHistory(history, latestTime);
  // Nothing unreachable survives, and nothing outside the retention window does.
  assert.equal(
    retained.filter((point) => point.time > latestTime).length,
    0,
    "future timestamps must be discarded",
  );
  for (const point of retained) {
    assert.ok(point.time <= latestTime);
    assert.ok(point.time >= latestTime - marketPriceHistoryRetentionMs);
  }
  assert.ok(retained.length > 0, "genuine recent observations are kept");
  // The survivors are exactly the real points from after the break that still
  // fall inside the retention window; every poisoned one is gone.
  assert.deepEqual(
    retained.map((point) => point.time),
    [...fixture.points.postBreak, ...fixture.points.tail].map(
      ([time]) => time,
    ),
  );

  // Retention is now idempotent on an already-clean history.
  assert.deepEqual(retainMarketPriceHistory(retained, latestTime), retained);

  // The latest point by time is the genuinely newest, not the array's last.
  assert.equal(latestPricePoint(history).time, Math.max(...history.map((p) => p.time)));
  assert.equal(
    latestPricePoint(retained).time,
    fixture.points.tail.at(-1)[0],
  );
  assert.equal(latestPricePoint([]), undefined);
});

test("a listing reports the newest observation by time, not by array position", () => {
  const { buildMarketListings } = require("../world/domain/market.ts");
  const { commodityRecord } = require("../world/domain/commodities.ts");
  // Array order disagrees with time order, the shape that made the market
  // header read $2.51 while the chart drew a flat $7.42.
  const histories = commodityRecord([]);
  histories.crops = [
    { time: 5_000, priceCents: 700 },
    { time: 20_000, priceCents: 251 },
    { time: 10_000, priceCents: 742 },
  ];
  const listings = buildMarketListings(commodityRecord(0), histories);
  const crops = listings.find((listing) => listing.commodity === "crops");
  assert.equal(crops.priceCents, 251, "newest by time wins");
  assert.equal(crops.previousPriceCents, 742, "second newest by time");

  // Time-ordered history is unaffected.
  const ordered = commodityRecord([]);
  ordered.crops = [
    { time: 5_000, priceCents: 700 },
    { time: 10_000, priceCents: 742 },
    { time: 20_000, priceCents: 251 },
  ];
  const same = buildMarketListings(commodityRecord(0), ordered).find(
    (listing) => listing.commodity === "crops",
  );
  assert.equal(same.priceCents, 251);
  assert.equal(same.previousPriceCents, 742);
});

test("a poisoned history heals as the simulation keeps recording", () => {
  const {
    LocalGameSimulation,
    createStartingWorld,
  } = require("../world/simulation/game-simulation.ts");
  const start = 1_788_768_863_171;
  const simulation = new LocalGameSimulation(createStartingWorld(), start);
  const save = simulation.read(start + 60_000) && simulation.exportSave();

  // Inject the real corruption: far-future points alongside genuine ones.
  const fixture = require("./fixtures/corrupt-price-history.json");
  const poisoned = {
    ...save,
    priceHistory: {
      ...save.priceHistory,
      crops: [
        ...fixture.points.preBreak.map(([time, priceCents]) => ({
          time,
          priceCents,
        })),
        ...save.priceHistory.crops,
      ],
    },
  };
  const restored = LocalGameSimulation.fromSave(
    JSON.parse(JSON.stringify(poisoned)),
  );
  const economy = restored.read(start + 300_000).economy;
  const crops = economy.market.listings.find(
    (listing) => listing.commodity === "crops",
  );

  // Continuing to play trims the unreachable points away for good.
  assert.equal(
    crops.history.filter((point) => point.time > economy.simulationTime).length,
    0,
  );
  assert.ok(Math.max(...crops.history.map((point) => point.time)) < 2e15);
  // The listing price now matches the newest point the chart would draw.
  const newest = [...crops.history].sort((a, b) => a.time - b.time).at(-1);
  assert.equal(crops.priceCents, newest.priceCents);
});

test("the regional price level follows available supply, not the majority", () => {
  const {
    regionalSupplyWeightedPriceCents,
    regionalMedianPriceCents,
  } = require("../world/domain/market-intelligence.ts");
  const at = (locationId, inventory, priceCents) => ({
    locationId,
    locationName: locationId,
    kind: "npc_city",
    commodity: "crops",
    inventory,
    targetStock: 20,
    priceCents,
    recentProduction: 0,
    recentSupply: 0,
    recentConsumption: 0,
    recentDemand: 0,
    imports: 0,
    exports: 0,
  });
  // One city drowning in crops, four with none: the region is cheap, because
  // the glut is the only place anyone could actually buy.
  const observations = [
    at("greenvale", 2721, 181),
    at("northwood", 0, 742),
    at("stonebridge", 0, 742),
    at("ironhold", 0, 742),
    at("port-azure", 0, 742),
  ];
  assert.equal(regionalMedianPriceCents(observations, "crops"), 742);
  assert.equal(regionalSupplyWeightedPriceCents(observations, "crops"), 181);

  // Two stocked cities blend by how much each holds.
  assert.equal(
    regionalSupplyWeightedPriceCents(
      [at("a", 300, 100), at("b", 100, 500)],
      "crops",
    ),
    200,
  );
  // With nothing stocked anywhere there is nothing to buy, so the median stands in.
  assert.equal(
    regionalSupplyWeightedPriceCents([at("a", 0, 400), at("b", 0, 600)], "crops"),
    500,
  );
  assert.equal(regionalSupplyWeightedPriceCents([], "crops"), 0);
});

test("a regional price level pulls the local target without erasing local scarcity", () => {
  const {
    marketPriceAnalysis,
    marketPricingPolicy,
  } = require("../world/domain/market.ts");
  const idle = { supply: 0, demand: 0, consumption: 0 };

  // Omitting the reference reproduces the local-only price exactly.
  const local = marketPriceAnalysis("crops", 0, 742, idle);
  assert.deepEqual(marketPriceAnalysis("crops", 0, 742, idle, undefined), local);
  assert.deepEqual(marketPriceAnalysis("crops", 0, 742, idle, 0), local);

  // A cheap region drags the target down; an expensive one lifts it.
  const cheap = marketPriceAnalysis("crops", 0, 742, idle, 181);
  const dear = marketPriceAnalysis("crops", 0, 742, idle, 1_400);
  assert.ok(cheap.targetPriceCents < local.targetPriceCents);
  assert.ok(dear.targetPriceCents > local.targetPriceCents);

  // The pull is bounded: local scarcity still matters, so the target never
  // collapses onto the regional number.
  assert.ok(
    cheap.targetPriceCents > 181,
    "a cheap region must not erase local scarcity",
  );
  assert.ok(marketPricingPolicy.regionalAnchorWeight > 0);
  assert.ok(marketPricingPolicy.regionalAnchorWeight < 1);
  // The blend is exactly the configured weight.
  const localTarget = local.targetPriceCents;
  const weight = marketPricingPolicy.regionalAnchorWeight;
  assert.equal(
    cheap.targetPriceCents,
    Math.round(localTarget * (1 - weight) + 181 * weight),
  );

  // The reason explains which way the region pulled and to what.
  assert.ok(
    cheap.reasons.some((reason) =>
      /wider region prices this at \$1\.81, below the local/.test(reason),
    ),
  );
  assert.ok(
    dear.reasons.some((reason) =>
      /wider region prices this at \$14\.00, above the local/.test(reason),
    ),
  );
  assert.equal(
    local.reasons.filter((reason) => /wider region/.test(reason)).length,
    0,
  );
});

test("unfilled demand raises price where an empty market used to go silent", () => {
  const { marketPriceAnalysis } = require("../world/domain/market.ts");
  const silent = marketPriceAnalysis("crops", 0, 500, {
    supply: 0,
    demand: 0,
    consumption: 0,
  });
  // Demand that could not be met is still demand.
  const hungry = marketPriceAnalysis("crops", 0, 500, {
    supply: 0,
    demand: 10,
    consumption: 0,
  });
  assert.ok(hungry.targetPriceCents > silent.targetPriceCents);
  // A single observation can be capped by the per-step change limit, so the
  // divergence shows once the price is allowed to converge on its target.
  const settle = (activity) => {
    let price = 500;
    for (let step = 0; step < 20; step++)
      price = marketPriceAnalysis("crops", 0, price, activity).priceCents;
    return price;
  };
  assert.ok(
    settle({ supply: 0, demand: 10, consumption: 0 }) >
      settle({ supply: 0, demand: 0, consumption: 0 }),
  );
  assert.ok(
    hungry.reasons.some((reason) => /10 units of demand went unfilled/.test(reason)),
  );
  assert.equal(
    silent.reasons.filter((reason) => /went unfilled/.test(reason)).length,
    0,
  );
  // Demand that was fully met is not reported as unfilled.
  const fed = marketPriceAnalysis("crops", 4, 500, {
    supply: 0,
    demand: 6,
    consumption: 6,
  });
  assert.equal(
    fed.reasons.filter((reason) => /went unfilled/.test(reason)).length,
    0,
  );
});

test("a starving settlement moves its own price instead of freezing", () => {
  const {
    LocalGameSimulation,
    createStartingWorld,
  } = require("../world/simulation/game-simulation.ts");
  const simulation = new LocalGameSimulation(createStartingWorld(), 1_000);
  const economy = simulation.read(1_200_000).economy;
  const crops = economy.market.listings.find(
    (listing) => listing.commodity === "crops",
  );

  // Hunger is recorded as demand even though nothing could be consumed.
  const hungryPoints = crops.history.filter(
    (point) => (point.recentDemand ?? 0) > 0 && (point.recentConsumption ?? 0) === 0,
  );
  assert.ok(
    hungryPoints.length > 0,
    "an empty warehouse must still register demand",
  );
  assert.equal(economy.logistics.warehouseInventory.crops, 0);

  // That demand keeps the price alive rather than pinned at one value.
  const prices = crops.history.map((point) => point.priceCents);
  assert.ok(
    new Set(prices).size > 5,
    `expected a moving price, saw ${new Set(prices).size} distinct values`,
  );
  assert.ok(Math.max(...prices) > Math.min(...prices));

  // The regional level reaches the local market.
  assert.ok(
    crops.priceReasons.some((reason) => /wider region/.test(reason)),
    "local pricing must cite the regional level",
  );
});

test("connected pricing stays deterministic and step independent", () => {
  const {
    LocalGameSimulation,
    createStartingWorld,
  } = require("../world/simulation/game-simulation.ts");
  const direct = new LocalGameSimulation(createStartingWorld(), 1_000);
  const stepped = new LocalGameSimulation(createStartingWorld(), 1_000);
  for (let time = 50_000; time <= 1_200_000; time += 50_000) stepped.read(time);
  const pricesOf = (simulation) =>
    simulation
      .read(1_200_000)
      .economy.market.listings.map((listing) => [
        listing.commodity,
        listing.priceCents,
      ]);
  assert.deepEqual(pricesOf(stepped), pricesOf(direct));

  const repeat = new LocalGameSimulation(createStartingWorld(), 1_000);
  assert.deepEqual(pricesOf(repeat), pricesOf(direct));

  // Prices stay inside their configured band over a long run.
  const { marketDefinitions, marketPricingPolicy } = require(
    "../world/domain/market.ts",
  );
  for (const [commodity, priceCents] of pricesOf(direct)) {
    const definition = marketDefinitions[commodity];
    assert.ok(
      priceCents >=
        Math.round(
          definition.basePriceCents *
            marketPricingPolicy.minimumBasePriceMultiplier,
        ),
      `${commodity} fell below its floor`,
    );
    assert.ok(
      priceCents <=
        Math.round(
          definition.basePriceCents *
            marketPricingPolicy.maximumBasePriceMultiplier,
        ),
      `${commodity} rose above its ceiling`,
    );
  }
});

const migrationConditions = (overrides) => ({
  population: 10,
  housingCapacity: 12,
  workingAgePopulation: 6,
  employedWorkers: 6,
  openPositions: 0,
  foodSupplyPercent: 100,
  ...overrides,
});

test("migration answers to food, housing, and jobs as separate named signals", () => {
  const {
    resolveMigration,
    populationPolicy,
  } = require("../world/domain/population.ts");
  const policy = populationPolicy.migration;

  // Every factor reports its own signal, so no single hidden score decides.
  const balanced = resolveMigration(migrationConditions());
  assert.deepEqual(
    balanced.signals.map((signal) => signal.factor),
    ["food", "housing", "employment"],
  );

  // Food alone attracts when secure and repels when short.
  const secure = resolveMigration(migrationConditions());
  assert.ok(secure.arrivals > 0);
  assert.equal(
    secure.signals.find((signal) => signal.factor === "food").direction,
    "attract",
  );
  const hungry = resolveMigration(
    migrationConditions({ foodSupplyPercent: 0, openPositions: 0 }),
  );
  assert.ok(hungry.departures > 0);
  assert.equal(
    hungry.signals.find((signal) => signal.factor === "food").direction,
    "repel",
  );

  // Jobs attract; a mostly idle workforce with no openings drives people away.
  const hiring = resolveMigration(
    migrationConditions({ foodSupplyPercent: 80, openPositions: 4 }),
  );
  assert.ok(hiring.arrivals > 0);
  assert.equal(
    hiring.signals.find((signal) => signal.factor === "employment").direction,
    "attract",
  );
  const idle = resolveMigration(
    migrationConditions({
      foodSupplyPercent: 80,
      employedWorkers: 0,
      openPositions: 0,
    }),
  );
  assert.ok(idle.departures > 0);
  assert.equal(
    idle.signals.find((signal) => signal.factor === "employment").direction,
    "repel",
  );

  // Hunger outweighs an open position: a job is no reason to stay unfed.
  const starvingButHiring = resolveMigration(
    migrationConditions({ foodSupplyPercent: 0, openPositions: 5 }),
  );
  assert.ok(
    starvingButHiring.departures > 0,
    "famine must be able to empty a settlement that still has jobs",
  );
  assert.ok(policy.foodRepelWeight > policy.employmentAttractWeight);
});

test("housing gates arrivals without ever expelling residents", () => {
  const { resolveMigration } = require("../world/domain/population.ts");

  // Full housing stops growth.
  const full = resolveMigration(
    migrationConditions({ population: 12, housingCapacity: 12, openPositions: 4 }),
  );
  assert.equal(full.arrivals, 0);
  assert.equal(full.housingHeadroom, 0);
  assert.equal(
    full.signals.find((signal) => signal.factor === "housing").direction,
    "neutral",
  );

  // One free bed admits at most one newcomer.
  const oneBed = resolveMigration(
    migrationConditions({ population: 11, housingCapacity: 12, openPositions: 4 }),
  );
  assert.equal(oneBed.arrivals, 1);
  assert.equal(oneBed.population, 12);

  // Housing never causes departures on its own.
  const overcrowded = resolveMigration(
    migrationConditions({ population: 20, housingCapacity: 4, openPositions: 4 }),
  );
  assert.equal(overcrowded.departures, 0);
  assert.equal(overcrowded.housingHeadroom, 0);
});

test("migration is bounded, deterministic, and arithmetically consistent", () => {
  const {
    resolveMigration,
    populationPolicy,
    isMigrationResult,
  } = require("../world/domain/population.ts");
  const policy = populationPolicy.migration;

  const strong = resolveMigration(
    migrationConditions({ population: 2, housingCapacity: 500, openPositions: 50 }),
  );
  assert.ok(strong.arrivals <= policy.maximumMovePerPeriod);
  const collapse = resolveMigration(
    migrationConditions({
      population: 1,
      foodSupplyPercent: 0,
      employedWorkers: 0,
      openPositions: 0,
    }),
  );
  // A settlement is never migrated out of existence.
  assert.equal(collapse.departures, 0);
  assert.ok(collapse.population >= policy.minimumPopulation);

  for (const result of [strong, collapse]) {
    assert.equal(result.netMigration, result.arrivals - result.departures);
    assert.ok(Number.isInteger(result.population) && result.population >= 0);
    assert.ok(isMigrationResult(result));
  }

  // No randomness: identical conditions give identical movement.
  assert.deepEqual(
    resolveMigration(migrationConditions({ openPositions: 3 })),
    resolveMigration(migrationConditions({ openPositions: 3 })),
  );
  assert.throws(
    () => resolveMigration(migrationConditions({ population: -1 })),
    RangeError,
  );
  assert.throws(
    () => resolveMigration(migrationConditions({ employedWorkers: 99 })),
    RangeError,
  );
});

test("the settlement grows and shrinks on its own economic conditions", () => {
  const {
    LocalGameSimulation,
    createStartingWorld,
  } = require("../world/simulation/game-simulation.ts");
  const { populationPolicy } = require("../world/domain/population.ts");
  const simulation = new LocalGameSimulation(createStartingWorld(), 1_000);

  // No migration before the first period elapses.
  assert.equal(simulation.read(60_000).economy.population.lastMigration, null);
  assert.equal(simulation.read(60_000).economy.population.totalPopulation, 10);

  // Food is secure and jobs are open, so citizens arrive.
  const grown = simulation.read(121_000).economy.population;
  assert.ok(grown.totalPopulation > 10);
  assert.ok(grown.lastMigration.arrivals > 0);
  assert.equal(grown.lastMigration.departures, 0);
  assert.equal(
    grown.totalPopulation,
    grown.lastMigration.population,
  );
  // Growth stops at housing capacity.
  assert.ok(grown.totalPopulation <= grown.housingCapacity);

  // The starting settlement never staffs its food chain, so it starves and
  // people leave; the collapse stops at the configured floor.
  const starved = simulation.read(3_000_000).economy.population;
  assert.ok(
    starved.totalPopulation < grown.totalPopulation,
    "a starving settlement must lose people",
  );
  assert.ok(
    starved.totalPopulation >= populationPolicy.migration.minimumPopulation,
  );
  assert.ok(
    starved.lastMigration.signals.some(
      (signal) => signal.factor === "food" && signal.direction === "repel",
    ),
  );
  // The economy log explains the change in plain terms.
  const economy = simulation.read(3_000_000).economy;
  assert.ok(
    economy.market.events.some((event) => /left Novagrad/.test(event.message)) ||
      economy.market.events.some((event) => /moved to Novagrad/.test(event.message)),
  );
});

test("a shrinking workforce never leaves more workers assigned than exist", () => {
  const {
    LocalGameSimulation,
    createStartingWorld,
  } = require("../world/simulation/game-simulation.ts");
  const {
    workingAgePopulation,
  } = require("../world/domain/population.ts");
  const simulation = new LocalGameSimulation(createStartingWorld(), 1_000);
  for (let time = 121_000; time <= 3_000_000; time += 120_000) {
    const economy = simulation.read(time).economy;
    const assigned = economy.sites.reduce(
      (total, site) => total + site.assignedWorkers,
      0,
    );
    const workforce = workingAgePopulation(economy.population.totalPopulation);
    assert.ok(
      assigned <= workforce,
      `at t=${time}: ${assigned} assigned exceeds a workforce of ${workforce}`,
    );
    assert.equal(economy.labor.assignedWorkers, assigned);
  }
});

test("population change is step independent and survives save loading", () => {
  const {
    LocalGameSimulation,
    createStartingWorld,
  } = require("../world/simulation/game-simulation.ts");
  const direct = new LocalGameSimulation(createStartingWorld(), 1_000);
  const stepped = new LocalGameSimulation(createStartingWorld(), 1_000);
  for (let time = 40_000; time < 900_000; time += 40_000) stepped.read(time);
  // Both must stand at the same instant before their states are comparable.
  stepped.read(900_000);
  direct.read(900_000);
  assert.deepEqual(stepped.exportSave(), direct.exportSave());
  assert.equal(
    stepped.read(900_000).economy.population.totalPopulation,
    direct.read(900_000).economy.population.totalPopulation,
  );

  // Migration state round-trips exactly.
  const save = direct.exportSave();
  assert.ok(Number.isSafeInteger(save.migrationUpdatedAt));
  const restored = LocalGameSimulation.fromSave(
    JSON.parse(JSON.stringify(save)),
  );
  assert.deepEqual(
    restored.read(1_200_000).economy.population,
    direct.read(1_200_000).economy.population,
  );

  // A save written before this milestone loads and starts migrating.
  const legacy = JSON.parse(JSON.stringify(direct.exportSave()));
  delete legacy.migrationUpdatedAt;
  delete legacy.lastMigration;
  const migrated = LocalGameSimulation.fromSave(legacy);
  assert.equal(
    migrated.read(legacy.simulationTime).economy.population.lastMigration,
    null,
  );
  assert.ok(
    migrated.read(legacy.simulationTime + 200_000).economy.population
      .lastMigration !== null,
    "a legacy save resumes migrating",
  );
});

test("industrialised tiers trade labor for manufactured capital", () => {
  const {
    productionRecipes,
    upgradeRecipeFor,
    outputPerWorker,
  } = require("../world/domain/production.ts");

  const upgraded = Object.values(productionRecipes).filter(
    (recipe) => recipe.tier === "improved",
  );
  assert.ok(upgraded.length > 0);
  for (const improved of upgraded) {
    const base = productionRecipes[improved.upgradeOf];
    assert.ok(base, `${improved.id} must industrialise a primitive recipe`);
    assert.equal(base.tier, "primitive");
    assert.equal(improved.producer, base.producer);

    // Fewer workers, more output, and therefore more output per worker. Raw
    // output alone is not enough: another primitive site could raise that too.
    assert.ok(
      improved.requiredWorkers < base.requiredWorkers,
      `${improved.id} must need fewer workers than ${base.id}`,
    );
    const baseOutput = Object.values(base.outputs)[0];
    const improvedOutput = Object.values(improved.outputs)[0];
    assert.ok(improvedOutput > baseOutput);
    assert.ok(outputPerWorker(improved.id) > outputPerWorker(base.id));

    // It costs manufactured capital, and the primitive tier never does.
    assert.ok(Object.keys(improved.equipmentRequirements).length > 0);
    assert.deepEqual(base.equipmentRequirements, {});
    assert.equal(upgradeRecipeFor(base.id).id, improved.id);
  }
  // Every primitive extractor keeps a toolless path, so a tier is a choice.
  assert.equal(upgradeRecipeFor("grow_crops").id, "grow_crops_improved");
  assert.equal(upgradeRecipeFor("forge_iron_tools"), undefined);
});

test("equipment is held rather than consumed and gates production entirely", () => {
  const { executeRecipeCycles } = require("../world/domain/production.ts");
  const { normalizeCommodityInventory } = require(
    "../world/domain/commodities.ts",
  );

  // Tools enable cycles and survive them: capacity is occupied, not spent.
  const equipped = executeRecipeCycles(
    "grow_crops_improved",
    3,
    normalizeCommodityInventory({ iron_tools: 1 }),
  );
  assert.equal(equipped.completedCycles, 3);
  assert.equal(equipped.inventory.crops, 15);
  assert.equal(equipped.inventory.iron_tools, 1, "tools must not be consumed");
  assert.deepEqual(equipped.consumedInputs, {});

  // Without them the site produces nothing at all, not merely less.
  const bare = executeRecipeCycles(
    "grow_crops_improved",
    3,
    normalizeCommodityInventory({}),
  );
  assert.equal(bare.completedCycles, 0);
  assert.equal(bare.blockedReason, "missing_equipment");
  assert.deepEqual(bare.producedOutputs, {});

  // Partial equipment is still insufficient.
  const partial = executeRecipeCycles(
    "quarry_stone_improved",
    2,
    normalizeCommodityInventory({ iron_tools: 1 }),
  );
  assert.equal(partial.completedCycles, 0);
  assert.equal(partial.blockedReason, "missing_equipment");
});

test("industrialisation cannot create a bootstrap loop", () => {
  const { productionRecipes } = require("../world/domain/production.ts");
  // Nothing needed to make tools may itself require tools, or the first pair
  // could never be produced.
  for (const recipeId of ["mine_iron_ore", "smelt_iron", "forge_iron_tools"]) {
    assert.deepEqual(
      productionRecipes[recipeId].equipmentRequirements,
      {},
      `${recipeId} must not require the equipment it helps produce`,
    );
  }
  // No improved tier may require its own output as equipment.
  for (const recipe of Object.values(productionRecipes)) {
    for (const equipment of Object.keys(recipe.equipmentRequirements))
      assert.ok(
        !(equipment in recipe.outputs),
        `${recipe.id} would need its own output to run`,
      );
  }
});

test("upgrading a site frees labor and raises output through the upgrade verb", () => {
  const {
    LocalGameSimulation,
    createStartingWorld,
  } = require("../world/simulation/game-simulation.ts");
  const {
    productionUpgradePolicy,
  } = require("../world/domain/production.ts");
  const simulation = new LocalGameSimulation(createStartingWorld(), 1_000);
  const before = simulation.read(70_000).economy;
  const farm = before.sites.find((site) => site.type === "farm");
  assert.equal(farm.tier, "primitive");
  const assignedBefore = before.labor.assignedWorkers;

  // Without the tools it is refused, and nothing changes.
  const unequipped = simulation.execute(
    { type: "upgrade_production", buildingId: farm.buildingId },
    70_000,
  );
  assert.equal(unequipped.ok, false);
  assert.match(unequipped.error, /Iron Tools/);
  assert.equal(
    unequipped.readModel.economy.market.cashCents,
    before.market.cashCents,
    "a refused upgrade must not charge",
  );

  // Hold the tools, then upgrade in one action.
  const save = simulation.exportSave();
  save.warehouseInventory.iron_tools = 1;
  const equipped = LocalGameSimulation.fromSave(
    JSON.parse(JSON.stringify(save)),
  );
  const cashBefore = equipped.read(save.simulationTime).economy.market.cashCents;
  const upgraded = equipped.execute(
    { type: "upgrade_production", buildingId: farm.buildingId },
    save.simulationTime,
  );
  assert.equal(upgraded.ok, true);
  const economy = upgraded.readModel.economy;
  const site = economy.sites.find((candidate) => candidate.type === "farm");
  assert.equal(site.tier, "improved");
  assert.equal(site.requiredWorkers, 1);
  assert.ok(site.outputPerWorkerPerCycle > farm.outputPerWorkerPerCycle);

  // Capital was spent exactly once and the tools were kept, not consumed.
  assert.equal(
    economy.market.cashCents,
    cashBefore - productionUpgradePolicy.upgradeCostCents,
  );
  assert.equal(economy.logistics.warehouseInventory.iron_tools, 1);

  // A worker was released to the rest of the economy.
  assert.equal(economy.labor.assignedWorkers, assignedBefore - 1);
  assert.ok(
    economy.market.events.some((event) => /upgraded to/.test(event.message)),
  );

  // One worker now outproduces the two it replaced.
  const ran = equipped
    .read(save.simulationTime + 50_000)
    .economy.sites.find((candidate) => candidate.type === "farm");
  const primitive = new LocalGameSimulation(createStartingWorld(), 1_000);
  const primitiveFarm = primitive.read(70_000).economy.sites.find(
    (candidate) => candidate.type === "farm",
  );
  primitive.execute(
    { type: "dispatch_production", buildingId: primitiveFarm.buildingId },
    70_000,
  );
  const primitiveRan = primitive
    .read(70_000 + 50_000)
    .economy.sites.find((candidate) => candidate.type === "farm");
  assert.ok(ran.assignedWorkers < primitiveRan.assignedWorkers);
});

test("a site short of tools reports demand for them", () => {
  const {
    LocalGameSimulation,
    createStartingWorld,
  } = require("../world/simulation/game-simulation.ts");
  const simulation = new LocalGameSimulation(createStartingWorld(), 1_000);
  const farm = simulation.read(70_000).economy.sites.find(
    (site) => site.type === "farm",
  );
  const save = simulation.exportSave();
  save.warehouseInventory.iron_tools = 1;
  const equipped = LocalGameSimulation.fromSave(
    JSON.parse(JSON.stringify(save)),
  );
  assert.equal(
    equipped.execute(
      { type: "upgrade_production", buildingId: farm.buildingId },
      save.simulationTime,
    ).ok,
    true,
  );

  // Losing the tools afterwards strands the industrialised site, and the
  // shortfall becomes demand for the manufactured good.
  const stripped = equipped.exportSave();
  stripped.warehouseInventory.iron_tools = 0;
  const blocked = LocalGameSimulation.fromSave(
    JSON.parse(JSON.stringify(stripped)),
  );
  const economy = blocked.read(stripped.simulationTime + 70_000).economy;
  const site = economy.sites.find((candidate) => candidate.type === "farm");
  assert.equal(site.status, "missing_equipment");
  const tools = economy.market.listings.find(
    (listing) => listing.commodity === "iron_tools",
  );
  assert.ok(
    tools.history.some((point) => (point.recentDemand ?? 0) > 0),
    "an equipment shortfall must register as demand",
  );
});

test("technology tiers persist and stay deterministic", () => {
  const {
    LocalGameSimulation,
    createStartingWorld,
  } = require("../world/simulation/game-simulation.ts");
  const { isRecipeId } = require("../world/domain/production.ts");
  assert.equal(isRecipeId("grow_crops_improved"), true);

  const simulation = new LocalGameSimulation(createStartingWorld(), 1_000);
  const farm = simulation.read(70_000).economy.sites.find(
    (site) => site.type === "farm",
  );
  const save = simulation.exportSave();
  save.warehouseInventory.iron_tools = 1;
  const equipped = LocalGameSimulation.fromSave(
    JSON.parse(JSON.stringify(save)),
  );
  equipped.execute(
    { type: "upgrade_production", buildingId: farm.buildingId },
    save.simulationTime,
  );

  // The chosen tier round-trips: it lives in the recipe id that already saved.
  const upgradedSave = JSON.parse(JSON.stringify(equipped.exportSave()));
  const restored = LocalGameSimulation.fromSave(upgradedSave);
  const restoredSite = restored
    .read(upgradedSave.simulationTime + 60_000)
    .economy.sites.find((site) => site.type === "farm");
  assert.equal(restoredSite.recipeId, "grow_crops_improved");
  assert.equal(restoredSite.tier, "improved");
  assert.deepEqual(
    restored.read(upgradedSave.simulationTime + 120_000).economy.sites,
    equipped.read(upgradedSave.simulationTime + 120_000).economy.sites,
  );
});

test("the upgrade verb is atomic and charges nothing when it refuses", () => {
  const {
    LocalGameSimulation,
    createStartingWorld,
  } = require("../world/simulation/game-simulation.ts");
  const {
    productionUpgradePolicy,
  } = require("../world/domain/production.ts");
  const simulation = new LocalGameSimulation(createStartingWorld(), 1_000);
  const before = simulation.read(70_000).economy;
  const farm = before.sites.find((site) => site.type === "farm");

  // Refused for want of equipment: no cash moved, no recipe changed.
  const noTools = simulation.execute(
    { type: "upgrade_production", buildingId: farm.buildingId },
    70_000,
  );
  assert.equal(noTools.ok, false);
  assert.equal(noTools.status, 422);
  assert.equal(noTools.readModel.economy.market.cashCents, before.market.cashCents);
  assert.equal(
    noTools.readModel.economy.sites.find((site) => site.type === "farm").tier,
    "primitive",
  );

  // Refused for want of credits: still nothing changes.
  const poor = simulation.exportSave();
  poor.warehouseInventory.iron_tools = 1;
  poor.cashCents = productionUpgradePolicy.upgradeCostCents - 1;
  const broke = LocalGameSimulation.fromSave(JSON.parse(JSON.stringify(poor)));
  const refused = broke.execute(
    { type: "upgrade_production", buildingId: farm.buildingId },
    poor.simulationTime,
  );
  assert.equal(refused.ok, false);
  assert.match(refused.error, /costs/);
  assert.equal(
    refused.readModel.economy.market.cashCents,
    productionUpgradePolicy.upgradeCostCents - 1,
  );
  assert.equal(
    refused.readModel.economy.sites.find((site) => site.type === "farm").tier,
    "primitive",
  );

  // A site with no industrial tier cannot be upgraded at all.
  const workshop = before.sites.find((site) => site.type === "workshop");
  const unsupported = simulation.execute(
    { type: "upgrade_production", buildingId: workshop.buildingId },
    70_000,
  );
  assert.equal(unsupported.ok, false);
  assert.match(unsupported.error, /no industrialised upgrade/);
});

test("an industrial tier can only be adopted through the upgrade verb", () => {
  const {
    LocalGameSimulation,
    createStartingWorld,
  } = require("../world/simulation/game-simulation.ts");
  const simulation = new LocalGameSimulation(createStartingWorld(), 1_000);
  const farm = simulation.read(70_000).economy.sites.find(
    (site) => site.type === "farm",
  );
  simulation.execute(
    { type: "dispatch_production", buildingId: farm.buildingId },
    70_000,
  );
  simulation.execute(
    { type: "set_workers", buildingId: farm.buildingId, workers: 1 },
    70_000,
  );
  // Selecting the tier directly would dodge its cost and equipment check.
  const bypass = simulation.execute(
    {
      type: "set_recipe",
      buildingId: farm.buildingId,
      recipeId: "grow_crops_improved",
    },
    70_000,
  );
  assert.equal(bypass.ok, false);
  assert.match(bypass.error, /upgrade action/);
  assert.equal(
    bypass.readModel.economy.sites.find((site) => site.type === "farm").tier,
    "primitive",
  );
});

test("every industrial tier keeps the output commodity of the recipe it upgrades", () => {
  const {
    productionRecipes,
    recipeOutput,
  } = require("../world/domain/production.ts");
  // Upgrading is allowed to leave stored output in place precisely because the
  // commodity does not change; this pins that assumption.
  for (const recipe of Object.values(productionRecipes)) {
    if (recipe.tier !== "improved") continue;
    assert.equal(
      recipeOutput(recipe).commodity,
      recipeOutput(productionRecipes[recipe.upgradeOf]).commodity,
      `${recipe.id} must produce the same commodity as ${recipe.upgradeOf}`,
    );
  }
});

test("the site compares upgrading against building another, and neither always wins", () => {
  const {
    LocalGameSimulation,
    createStartingWorld,
  } = require("../world/simulation/game-simulation.ts");
  const {
    productionRecipes,
    productionUpgradePolicy,
  } = require("../world/domain/production.ts");
  const { constructionCosts } = require("../world/domain/construction.ts");
  const simulation = new LocalGameSimulation(createStartingWorld(), 1_000);
  const farm = simulation.read(70_000).economy.sites.find(
    (site) => site.type === "farm",
  );
  const upgrade = farm.upgradeOption;
  const expand = farm.expansionOption;
  assert.ok(upgrade && expand);

  // The comparison reports the real configured numbers.
  assert.equal(upgrade.costCents, productionUpgradePolicy.upgradeCostCents);
  assert.equal(expand.costCents, constructionCosts.farm.cashCents);
  assert.deepEqual(expand.materials, constructionCosts.farm.materials);
  assert.equal(
    upgrade.upgradedWorkers,
    productionRecipes.grow_crops_improved.requiredWorkers,
  );
  assert.equal(upgrade.currentWorkers, productionRecipes.grow_crops.requiredWorkers);
  assert.equal(upgrade.workersFreed, upgrade.currentWorkers - upgrade.upgradedWorkers);
  assert.deepEqual(
    upgrade.equipmentRequirements,
    productionRecipes.grow_crops_improved.equipmentRequirements,
  );
  assert.deepEqual(upgrade.blockedReasons, ["Needs 1 more Iron Tools."]);
  assert.deepEqual(expand.blockedReasons, []);

  // Neither option dominates: building yields more total output, upgrading
  // yields far more per worker. Which is better depends on what is scarce.
  const buildTotalOutput = upgrade.currentOutputPerCycle * 2;
  const buildTotalWorkers = upgrade.currentWorkers * 2;
  assert.ok(
    buildTotalOutput > upgrade.upgradedOutputPerCycle,
    "building more must win on raw output",
  );
  assert.ok(
    upgrade.upgradedOutputPerWorker > expand.outputPerWorker,
    "upgrading must win on output per worker",
  );
  assert.ok(upgrade.upgradedWorkers < buildTotalWorkers);
});

test("the housing, migration, labor and upgrade loop plays through end to end", () => {
  const {
    LocalGameSimulation,
    createStartingWorld,
  } = require("../world/simulation/game-simulation.ts");
  const { validatePlacement } = require("../world/domain/construction.ts");
  const seed = new LocalGameSimulation(createStartingWorld(), 1_000);
  seed.read(70_000);
  // The settlement has quarried the stone a house needs; the quarry produces
  // it in play, and seeding it keeps this test about the expansion loop.
  const stocked = seed.exportSave();
  stocked.warehouseInventory.stone = 4;
  stocked.warehouseInventory.wood = 4;
  const simulation = LocalGameSimulation.fromSave(
    JSON.parse(JSON.stringify(stocked)),
  );

  // 1. Housing is what limits population, and the player can see it.
  const start = simulation.read(70_000).economy;
  assert.ok(start.population.housingCapacity >= start.population.totalPopulation);
  const capacityBefore = start.population.housingCapacity;

  // 2. Build housing, which raises capacity through the existing verb.
  const world = simulation.read(70_000).world;
  let built = null;
  for (let y = 0; y < world.size && !built; y++)
    for (let x = 0; x < world.size && !built; x++) {
      const request = { type: "house", x, y, rotation: "north" };
      if (!validatePlacement(world, request).valid) continue;
      const result = simulation.execute(
        {
          type: "construct",
          expectedRevision: simulation.read(70_000).revision,
          placement: request,
        },
        70_000,
      );
      if (result.ok) built = result;
    }
  assert.ok(built, "a house must be placeable somewhere");
  const housed = built.readModel.economy;
  assert.ok(
    housed.population.housingCapacity > capacityBefore,
    "housing must raise population capacity",
  );

  // 3. More housing headroom means migration can bring workers in.
  const grown = simulation.read(400_000).economy;
  assert.ok(grown.population.totalPopulation >= start.population.totalPopulation);

  // 4. Upgrade an existing facility and watch the labor requirement fall.
  const save = simulation.exportSave();
  save.warehouseInventory.iron_tools = 1;
  const equipped = LocalGameSimulation.fromSave(
    JSON.parse(JSON.stringify(save)),
  );
  const beforeUpgrade = equipped.read(save.simulationTime).economy;
  const farm = beforeUpgrade.sites.find((site) => site.type === "farm");
  const assignedBefore = beforeUpgrade.labor.assignedWorkers;
  const upgraded = equipped.execute(
    { type: "upgrade_production", buildingId: farm.buildingId },
    save.simulationTime,
  );
  assert.equal(upgraded.ok, true);
  const after = upgraded.readModel.economy;
  const upgradedFarm = after.sites.find((site) => site.type === "farm");
  assert.ok(upgradedFarm.requiredWorkers < farm.requiredWorkers);

  // 5. The freed labor is genuinely reassignable somewhere else.
  const freed = assignedBefore - after.labor.assignedWorkers;
  assert.ok(freed > 0, "the upgrade must release workers");
  const target = after.sites.find(
    (site) =>
      site.buildingId !== farm.buildingId &&
      site.assignedWorkers < site.requiredWorkers,
  );
  assert.ok(target, "somewhere must still want workers");
  const reassigned = equipped.execute(
    {
      type: "set_workers",
      buildingId: target.buildingId,
      workers: target.assignedWorkers + 1,
    },
    save.simulationTime,
  );
  assert.equal(reassigned.ok, true, reassigned.error);
  assert.equal(
    reassigned.readModel.economy.labor.assignedWorkers,
    after.labor.assignedWorkers + 1,
  );
});

test("dispatch policies decide only whether output ships, and manual is the default", () => {
  const {
    shouldDispatch,
    defaultDispatchPolicy,
    isDispatchPolicy,
    dispatchPolicies,
  } = require("../world/domain/production.ts");
  assert.equal(defaultDispatchPolicy, "manual");
  assert.deepEqual(dispatchPolicies, ["manual", "when_full", "continuous"]);
  assert.equal(isDispatchPolicy("continuous"), true);
  assert.equal(isDispatchPolicy("whenever"), false);

  // Nothing stored, nothing ships, whatever the policy.
  for (const policy of dispatchPolicies)
    assert.equal(
      shouldDispatch({ policy, stored: 0, storageCapacity: 24 }),
      false,
    );
  // Manual never ships on its own.
  assert.equal(
    shouldDispatch({ policy: "manual", stored: 24, storageCapacity: 24 }),
    false,
  );
  // When full waits for capacity; continuous does not.
  assert.equal(
    shouldDispatch({ policy: "when_full", stored: 23, storageCapacity: 24 }),
    false,
  );
  assert.equal(
    shouldDispatch({ policy: "when_full", stored: 24, storageCapacity: 24 }),
    true,
  );
  assert.equal(
    shouldDispatch({ policy: "continuous", stored: 1, storageCapacity: 24 }),
    true,
  );
});

test("a standing order keeps a producer running instead of stalling full", () => {
  const {
    LocalGameSimulation,
    createStartingWorld,
  } = require("../world/simulation/game-simulation.ts");
  const stalled = new LocalGameSimulation(createStartingWorld(), 1_000);
  const idle = stalled.read(300_000).economy.sites.find(
    (site) => site.type === "farm",
  );
  // The default is unchanged: the farm fills its storage and stops.
  assert.equal(idle.dispatchPolicy, "manual");
  assert.equal(idle.status, "storage_full");

  const running = new LocalGameSimulation(createStartingWorld(), 1_000);
  const farm = running.read(70_000).economy.sites.find(
    (site) => site.type === "farm",
  );
  const set = running.execute(
    {
      type: "set_dispatch_policy",
      buildingId: farm.buildingId,
      policy: "continuous",
    },
    70_000,
  );
  assert.equal(set.ok, true);
  const economy = running.read(300_000).economy;
  const site = economy.sites.find((candidate) => candidate.type === "farm");
  assert.equal(site.dispatchPolicy, "continuous");
  assert.notEqual(site.status, "storage_full");
  assert.ok(
    economy.logistics.warehouseInventory.crops > 0,
    "a standing order must actually deliver",
  );
  assert.ok(
    economy.market.events.some((event) => /departed on/.test(event.message)),
  );
});

test("standing orders stop the settlement starving beside full storage", () => {
  const {
    LocalGameSimulation,
    createStartingWorld,
  } = require("../world/simulation/game-simulation.ts");
  // Left alone the settlement starves while its farm sits full.
  const starving = new LocalGameSimulation(createStartingWorld(), 1_000);
  const abandoned = starving.read(900_000).economy;
  assert.equal(abandoned.population.foodSupplyPercent, 0);
  assert.equal(
    abandoned.sites.find((site) => site.type === "farm").status,
    "storage_full",
  );

  // Delivering the same output feeds it and the population grows instead.
  const fed = new LocalGameSimulation(createStartingWorld(), 1_000);
  const farm = fed.read(70_000).economy.sites.find(
    (site) => site.type === "farm",
  );
  fed.execute(
    {
      type: "set_dispatch_policy",
      buildingId: farm.buildingId,
      policy: "when_full",
    },
    70_000,
  );
  const supplied = fed.read(900_000).economy;
  assert.equal(supplied.population.foodSupplyPercent, 100);
  assert.ok(
    supplied.population.totalPopulation >
      abandoned.population.totalPopulation,
    "a fed settlement must outgrow a starving one",
  );
});

test("holding stock back protects the price that flooding the market destroys", () => {
  const {
    LocalGameSimulation,
    createStartingWorld,
  } = require("../world/simulation/game-simulation.ts");
  const priceUnder = (policy) => {
    const simulation = new LocalGameSimulation(createStartingWorld(), 1_000);
    const farm = simulation.read(70_000).economy.sites.find(
      (site) => site.type === "farm",
    );
    if (policy !== "manual")
      simulation.execute(
        { type: "set_dispatch_policy", buildingId: farm.buildingId, policy },
        70_000,
      );
    const economy = simulation.read(900_000).economy;
    const listing = economy.market.listings.find(
      (candidate) => candidate.commodity === "crops",
    );
    return {
      price: listing.priceCents,
      series: listing.history
        .filter((point) => point.time >= 70_000)
        .map((point) => point.priceCents),
      shipments: economy.logistics.shipments.filter(
        (shipment) => shipment.originBuildingId === farm.buildingId,
      ).length,
    };
  };
  const manual = priceUnder("manual");
  const whenFull = priceUnder("when_full");
  const continuous = priceUnder("continuous");

  // Withholding supply keeps the price far above what flooding it achieves.
  assert.ok(
    manual.price > whenFull.price * 2,
    `manual ${manual.price} should far exceed when_full ${whenFull.price}`,
  );
  assert.ok(manual.price > continuous.price * 2);

  // The policies are genuinely different economic behaviours, not labels.
  assert.ok(manual.shipments < whenFull.shipments);
  assert.ok(whenFull.shipments < continuous.shipments);
  assert.notDeepEqual(manual.series, whenFull.series);
  assert.notDeepEqual(whenFull.series, continuous.series);
});

test("standing dispatch is step independent and conserves cargo", () => {
  const {
    LocalGameSimulation,
    createStartingWorld,
  } = require("../world/simulation/game-simulation.ts");
  const start = (simulation) => {
    const farm = simulation.read(70_000).economy.sites.find(
      (site) => site.type === "farm",
    );
    simulation.execute(
      {
        type: "set_dispatch_policy",
        buildingId: farm.buildingId,
        policy: "continuous",
      },
      70_000,
    );
  };
  const direct = new LocalGameSimulation(createStartingWorld(), 1_000);
  const stepped = new LocalGameSimulation(createStartingWorld(), 1_000);
  start(direct);
  start(stepped);
  for (let time = 90_000; time < 600_000; time += 20_000) stepped.read(time);
  stepped.read(600_000);
  direct.read(600_000);
  // One long advance must match many short ones exactly.
  assert.deepEqual(stepped.exportSave(), direct.exportSave());

  // Cargo exists in one place: nothing is duplicated in flight.
  const economy = direct.read(600_000).economy;
  const inTransit = economy.logistics.shipments
    .filter((shipment) => shipment.status === "in_transit")
    .reduce((total, shipment) => total + shipment.cargo.quantity, 0);
  const delivered = economy.logistics.shipments
    .filter((shipment) => shipment.status === "arrived")
    .reduce((total, shipment) => total + shipment.cargo.quantity, 0);
  assert.ok(delivered > 0);
  const site = economy.sites.find((candidate) => candidate.type === "farm");
  for (const shipment of economy.logistics.shipments)
    assert.ok(shipment.cargo.quantity > 0);
  assert.ok(inTransit >= 0);
  assert.ok(site.stored >= 0);
});

test("a dispatch policy persists and legacy saves keep manual delivery", () => {
  const {
    LocalGameSimulation,
    createStartingWorld,
  } = require("../world/simulation/game-simulation.ts");
  const simulation = new LocalGameSimulation(createStartingWorld(), 1_000);
  const farm = simulation.read(70_000).economy.sites.find(
    (site) => site.type === "farm",
  );
  simulation.execute(
    {
      type: "set_dispatch_policy",
      buildingId: farm.buildingId,
      policy: "when_full",
    },
    70_000,
  );
  const save = JSON.parse(JSON.stringify(simulation.exportSave()));
  const restored = LocalGameSimulation.fromSave(save);
  assert.equal(
    restored.read(save.simulationTime).economy.sites.find(
      (site) => site.type === "farm",
    ).dispatchPolicy,
    "when_full",
  );
  assert.deepEqual(
    restored.read(400_000).economy.sites,
    simulation.read(400_000).economy.sites,
  );

  // A save written before this milestone delivers manually, as it always did.
  const legacy = JSON.parse(JSON.stringify(simulation.exportSave()));
  legacy.productionStates = legacy.productionStates.map((state) => {
    const copy = { ...state };
    delete copy.dispatchPolicy;
    return copy;
  });
  delete legacy.standingDispatchUpdatedAt;
  const migrated = LocalGameSimulation.fromSave(legacy);
  for (const site of migrated.read(legacy.simulationTime).economy.sites)
    assert.equal(site.dispatchPolicy, "manual");

  // An unknown policy is rejected without mutating anything.
  const rejected = simulation.execute(
    {
      type: "set_dispatch_policy",
      buildingId: farm.buildingId,
      policy: "whenever",
    },
    400_000,
  );
  assert.equal(rejected.ok, false);
  assert.equal(rejected.status, 400);
});

const developmentConditions = (overrides) => ({
  population: 12,
  housingCapacity: 12,
  foodSupplyPercent: 100,
  employedWorkers: 5,
  sites: [
    { output: "crops", paused: false, assignedWorkers: 2, tier: "primitive" },
    { output: "stone", paused: false, assignedWorkers: 3, tier: "primitive" },
  ],
  arrivedPlayerDeliveries: 0,
  ...overrides,
});

test("tier targets rise monotonically so tiers can be judged in order", () => {
  const {
    developmentPolicy,
    settlementTiers,
    developmentRequirementIds,
  } = require("../world/domain/development.ts");
  assert.deepEqual(settlementTiers, [
    "hamlet",
    "village",
    "town",
    "industrial_city",
  ]);
  // Hamlet is the floor: it asks for nothing, so a settlement always has it.
  assert.deepEqual(developmentPolicy.hamlet, {});
  for (const id of developmentRequirementIds) {
    let previous = 0;
    for (const tier of settlementTiers) {
      const target = developmentPolicy[tier][id];
      if (target === undefined) continue;
      assert.ok(
        target >= previous,
        `${id} target fell from ${previous} to ${target} at ${tier}`,
      );
      previous = target;
    }
  }
});

test("the tier is derived from named conditions with no aggregate score", () => {
  const {
    describeSettlementDevelopment,
    developmentPolicy,
  } = require("../world/domain/development.ts");

  // A settlement meeting nothing is a Hamlet, and the gap is stated plainly.
  const bare = describeSettlementDevelopment(
    developmentConditions({ population: 4, foodSupplyPercent: 0, employedWorkers: 0, sites: [] }),
  );
  assert.equal(bare.tier, "hamlet");
  assert.equal(bare.nextTier, "village");
  assert.ok(bare.unmetRequirements.length > 0);
  for (const requirement of bare.unmetRequirements) {
    assert.equal(requirement.met, false);
    assert.ok(requirement.current < requirement.target);
    assert.ok(requirement.label.length > 0);
  }

  // Meeting every Village target advances exactly one tier, not further.
  const village = describeSettlementDevelopment(developmentConditions());
  assert.equal(village.tier, "village");
  assert.equal(village.nextTier, "town");
  assert.ok(
    village.unmetRequirements.some(
      (requirement) => requirement.id === "housing",
    ),
  );

  // A single unmet requirement is enough to hold the settlement back.
  const oneShort = describeSettlementDevelopment(
    developmentConditions({ population: developmentPolicy.village.population - 1 }),
  );
  assert.equal(oneShort.tier, "hamlet");
  assert.deepEqual(
    oneShort.unmetRequirements.map((requirement) => requirement.id),
    ["population"],
  );

  // Every tier is reported with its own requirements, so nothing is hidden.
  assert.equal(village.tiers.length, 4);
  assert.equal(village.tiers[0].met, true);
  assert.equal(village.tiers[1].met, true);
  assert.equal(village.tiers[2].met, false);
});

test("production breadth counts staffed industries, not built ones", () => {
  const {
    staffedIndustryBreadth,
    industrialisedSiteCount,
  } = require("../world/domain/development.ts");
  const sites = [
    { output: "crops", paused: false, assignedWorkers: 2, tier: "improved" },
    { output: "stone", paused: false, assignedWorkers: 0, tier: "primitive" },
    { output: "wood", paused: true, assignedWorkers: 0, tier: "primitive" },
    { output: "crops", paused: false, assignedWorkers: 1, tier: "primitive" },
  ];
  // Unstaffed and paused sites do not count, and duplicates count once.
  assert.equal(staffedIndustryBreadth(sites), 1);
  assert.equal(
    staffedIndustryBreadth([
      ...sites,
      { output: "iron_ore", paused: false, assignedWorkers: 3, tier: "primitive" },
    ]),
    2,
  );
  assert.equal(staffedIndustryBreadth([]), 0);
  // An upgraded site counts only while it is actually operating, so the
  // requirement cannot be satisfied by capital left on a shelf.
  assert.equal(industrialisedSiteCount(sites), 1);
  assert.equal(
    industrialisedSiteCount([
      { output: "stone", paused: false, assignedWorkers: 0, tier: "improved" },
      { output: "wood", paused: true, assignedWorkers: 2, tier: "improved" },
    ]),
    0,
  );
});

test("the highest tier requires industrialisation and trade", () => {
  const {
    describeSettlementDevelopment,
    developmentPolicy,
  } = require("../world/domain/development.ts");
  const industrial = developmentPolicy.industrial_city;
  const capable = developmentConditions({
    population: industrial.population,
    housingCapacity: industrial.housing,
    employedWorkers: industrial.employment,
    arrivedPlayerDeliveries: industrial.trade,
    sites: [
      { output: "crops", paused: false, assignedWorkers: 1, tier: "improved" },
      { output: "stone", paused: false, assignedWorkers: 1, tier: "primitive" },
      { output: "wood", paused: false, assignedWorkers: 1, tier: "primitive" },
      { output: "iron_ore", paused: false, assignedWorkers: 1, tier: "primitive" },
    ],
  });
  assert.equal(describeSettlementDevelopment(capable).tier, "industrial_city");
  assert.equal(describeSettlementDevelopment(capable).nextTier, null);
  assert.deepEqual(describeSettlementDevelopment(capable).unmetRequirements, []);

  // Remove the industrialised site and the top tier is lost.
  const primitiveOnly = describeSettlementDevelopment({
    ...capable,
    sites: capable.sites.map((site) => ({ ...site, tier: "primitive" })),
  });
  assert.equal(primitiveOnly.tier, "town");
  assert.deepEqual(
    primitiveOnly.unmetRequirements.map((requirement) => requirement.id),
    ["industrialisation"],
  );

  // Remove the trade record and the settlement drops further still.
  const untraded = describeSettlementDevelopment({
    ...capable,
    arrivedPlayerDeliveries: 0,
  });
  assert.equal(untraded.tier, "village");
});

test("a settlement that loses its economy falls back a tier", () => {
  const {
    describeSettlementDevelopment,
  } = require("../world/domain/development.ts");
  const village = describeSettlementDevelopment(developmentConditions());
  assert.equal(village.tier, "village");

  // Losing food security alone is enough to lose the standing.
  const starving = describeSettlementDevelopment(
    developmentConditions({ foodSupplyPercent: 0 }),
  );
  assert.equal(starving.tier, "hamlet");
  assert.ok(
    starving.unmetRequirements.some(
      (requirement) => requirement.id === "foodSecurity",
    ),
  );

  // So is losing population. Regression uses the same path as progress.
  const emptied = describeSettlementDevelopment(
    developmentConditions({ population: 3 }),
  );
  assert.equal(emptied.tier, "hamlet");
  assert.deepEqual(
    describeSettlementDevelopment(developmentConditions()),
    village,
    "the same conditions always give the same tier",
  );
});

test("the settlement tier is derived on every read and never persisted", () => {
  const {
    LocalGameSimulation,
    createStartingWorld,
  } = require("../world/simulation/game-simulation.ts");
  const simulation = new LocalGameSimulation(createStartingWorld(), 1_000);

  // The starting settlement is a Hamlet with a single stated goal.
  const start = simulation.read(70_000).economy;
  assert.equal(start.development.tier, "hamlet");
  assert.equal(start.development.nextTier, "village");
  assert.ok(start.development.unmetRequirements.length > 0);
  // It reports real measured values, not placeholders.
  const populationGoal = start.development.tiers
    .find((tier) => tier.tier === "village")
    .requirements.find((requirement) => requirement.id === "population");
  assert.equal(populationGoal.current, start.population.totalPopulation);

  // Nothing about the tier reaches the save.
  const save = simulation.exportSave();
  assert.equal("development" in save, false);
  assert.equal(JSON.stringify(save).includes('"tierName"'), false);

  // Delivering food advances the settlement using existing verbs only.
  const fed = new LocalGameSimulation(createStartingWorld(), 1_000);
  const farm = fed.read(70_000).economy.sites.find(
    (site) => site.type === "farm",
  );
  fed.execute(
    {
      type: "set_dispatch_policy",
      buildingId: farm.buildingId,
      policy: "when_full",
    },
    70_000,
  );
  const advanced = fed.read(400_000).economy;
  assert.equal(advanced.development.tier, "village");
  assert.equal(advanced.development.nextTier, "town");

  // A restored save derives the same tier without storing it.
  const restored = LocalGameSimulation.fromSave(
    JSON.parse(JSON.stringify(fed.exportSave())),
  );
  assert.equal(
    restored.read(400_000).economy.development.tier,
    advanced.development.tier,
  );
});
