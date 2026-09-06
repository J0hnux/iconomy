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
  const { describePopulation } = require("../world/domain/population.ts");
  const { LocalGameSimulation, createStartingWorld } = require("../world/simulation/game-simulation.ts");
  const startingWorld = createStartingWorld();
  assert.deepEqual(describePopulation(startingWorld, 5, 8), {
    totalPopulation: 10,
    workingAgePopulation: 6,
    availableWorkers: 1,
    employedWorkers: 5,
    unemployedWorkers: 1,
    housingCapacity: 12,
    foodSupply: 8,
  });
  assert.throws(() => describePopulation(startingWorld, 7, 8), RangeError);
  assert.throws(() => describePopulation(startingWorld, 5, -1), RangeError);

  const simulation = new LocalGameSimulation(startingWorld, 1_000);
  const initialEconomy = simulation.read(1_000).economy;
  assert.deepEqual(
    initialEconomy.population,
    describePopulation(startingWorld, 5, 8),
  );
  const initialFoodShipment = initialEconomy.logistics.shipments.find(
    (shipment) => shipment.cargo.commodity === "food",
  );
  const arrived = simulation.read(initialFoodShipment.arrivalTime).economy
    .population;
  assert.equal(arrived.foodSupply, 12);
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
    "lumber_camp",
    "quarry",
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
  assert.match(lumber.statusReason, /Needs 2 more workers/);
  assert.equal(quarry.status, "storage_full");
  assert.match(quarry.statusReason, /Dispatch stone/);
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
    foodSupply: 8,
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
  assert.equal(routed.logisticsRoutes.length, 3);
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
  const listings = buildMarketListings(inventory, histories, 1);
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
  assert.ok(marketPriceCents("stone", 0, 1) > marketPriceCents("stone", 8, 1));
  const sites = [
    {
      type: "lumber_camp",
      name: "Lumber Camp",
      buildingId: "lumber",
      status: "missing_workers",
      requiredWorkers: 2,
      assignedWorkers: 0,
    },
    {
      type: "quarry",
      name: "Quarry",
      buildingId: "quarry",
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

test("market sales remove warehouse goods, credit cash, and create events", () => {
  const { LocalGameSimulation, createStartingWorld } = require("../world/simulation/game-simulation.ts");
  const simulation = new LocalGameSimulation(createStartingWorld(), 1_000);
  const initial = simulation.read(1_000).economy;
  const food = initial.market.listings.find(
    (listing) => listing.commodity === "food",
  );
  assert.equal(initial.market.cashCents, 12_450_00);
  assert.equal(initial.market.opportunities[0].commodity, "wood");
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
  assert.equal(sale.readModel.economy.logistics.warehouseInventory.food, 6);
  assert.equal(sale.readModel.economy.population.foodSupply, 6);
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
