/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness loads TypeScript in-process. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
// Test-process-only TS loading; type safety is checked separately by tsc/build.
require.extensions[".ts"] = (module, filename) => {
  module._compile(
    ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2017,
      },
    }).outputText,
    filename,
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
  assert.deepEqual(
    initialEconomy.population,
    describePopulation(startingWorld, 5, foodNeed),
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
  assert.deepEqual(Object.keys(productionRecipes), Object.keys(expectedRecipes));
  for (const [recipeId, [producer, inputs, outputs]] of Object.entries(
    expectedRecipes,
  )) {
    const configured = productionRecipes[recipeId];
    assert.equal(configured.producer, producer);
    assert.deepEqual(configured.consumableInputs, inputs);
    assert.deepEqual(configured.outputs, outputs);
    assert.deepEqual(configured.equipmentRequirements, {});
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
  assert.equal(finalStep.population.foodRequired, 10);
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

test("NPC intercity trade conserves goods while recording matched imports and exports", () => {
  const {
    advanceNpcCities,
    createNpcCities,
  } = require("../world/domain/npc-cities.ts");
  const { commodityIds } = require("../world/domain/commodities.ts");
  const { createStartingWorld } = require("../world/simulation/game-simulation.ts");
  const initial = createNpcCities(createStartingWorld());
  const advanced = advanceNpcCities(initial);
  let traded = 0;
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
    const imported = advanced.reduce(
      (total, city) => total + city.imports[commodity],
      0,
    );
    const exported = advanced.reduce(
      (total, city) => total + city.exports[commodity],
      0,
    );
    assert.equal(after, before + produced - consumed);
    assert.equal(imported, exported);
    traded += imported;
  }
  assert.ok(traded > 0);
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

  const restored = LocalGameSimulation.fromSave(direct.exportSave());
  assert.deepEqual(restored.exportSave(), direct.exportSave());
  const legacy = { ...direct.exportSave() };
  delete legacy.npcCities;
  delete legacy.npcCitiesUpdatedAt;
  const migrated = LocalGameSimulation.fromSave(legacy);
  assert.equal(migrated.read(end).economy.npcCities.length, 5);
});
