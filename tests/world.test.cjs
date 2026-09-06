/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness loads TypeScript in-process. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
// Test-process-only TS loading; type safety is checked separately by tsc/build.
require.extensions['.ts'] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 } }).outputText, filename);
};
const { generateWorld, chunkOf, resourceAt } = require('../world/domain/world.ts');
const { project, unproject, toScreen, screenToWorld, pickCell, panCamera, zoomCamera, focusCell, terrainFaces } = require('../presentation/world/projection.ts');
const world = generateWorld();
const viewport = { width: 1100, height: 700 };
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test('seeded semantic world is repeatable, bounded, elevated, and includes economic terrain', () => {
  assert.deepEqual(generateWorld(), world);
  assert.notDeepEqual(generateWorld('another-seed'), world);
  assert.equal(world.cells.length, 128 * 128);
  assert.deepEqual(new Set(world.cells.map(c => c.terrain)), new Set(['grassland', 'water', 'mountain', 'forest_ground', 'farmland']));
  for (const cell of world.cells) { assert.ok(Number.isInteger(cell.z) && cell.z >= 0); if (cell.terrain === "water") assert.equal(cell.z, 0); else assert.ok(cell.z >= 1); assert.ok(cell.x >= 0 && cell.x < 128 && cell.y >= 0 && cell.y < 128); }
  assert.deepEqual(chunkOf({ x: 32, y: 63, z: 0 }, 32), { x: 1, y: 1 });
  assert.throws(() => generateWorld('seed', 0), RangeError);
});

test('resource nodes reference matching cells and preserve semantic reserves', () => {
  assert.deepEqual(world.resourceNodes.map(node => node.type).sort(), ['forest', 'forest', 'iron', 'stone']);
  for (const node of world.resourceNodes) {
    const cells = world.cells.filter(cell => cell.resourceNodeId === node.id);
    assert.equal(cells.length, node.cellCount);
    assert.ok(node.estimatedReserve > node.cellCount);
    const anchor = world.cells[node.anchor.y * world.size + node.anchor.x];
    assert.equal(anchor.resourceNodeId, node.id);
    assert.equal(resourceAt(world, anchor), node);
    if (node.type === 'forest') assert.ok(cells.every(cell => cell.terrain === 'forest_ground'));
    else assert.ok(cells.every(cell => cell.terrain === 'mountain'));
  }
  assert.ok(world.cells.some(cell => cell.terrain === 'farmland' && !cell.resourceNodeId));
  assert.ok(world.cells.some(cell => cell.terrain === 'forest_ground'));
});

test('settlement reserve stays grassland and construction rejects economic terrain', () => {
  const { withStartingSettlement, buildingDefinitions } = require('../world/domain/settlement.ts');
  const { validatePlacement } = require('../world/domain/construction.ts');
  const settled = withStartingSettlement(world);
  for (const building of settled.buildings) {
    const definition = buildingDefinitions[building.type];
    for (let y = building.y; y < building.y + definition.depth; y++) for (let x = building.x; x < building.x + definition.width; x++) {
      assert.equal(settled.cells[y * settled.size + x].terrain, 'grassland');
    }
  }
  for (const terrain of ['forest_ground', 'farmland', 'mountain']) {
    const cell = settled.cells.find(candidate => candidate.terrain === terrain);
    const isolatedRoad = { ...settled, roads: [{ x: cell.x, y: cell.y + 1, z: cell.z }] };
    assert.ok(validatePlacement(isolatedRoad, { type: 'house', x: cell.x, y: cell.y, rotation: 'north' }).reasons.includes('Requires grassland'));
  }
});
test('projection preserves coordinates at different elevations', () => {
  for (const point of [{ x: 0, y: 0, z: 0 }, { x: 13.5, y: 90.5, z: 3 }, { x: -4, y: 10, z: 7 }]) {
    const result = unproject(project(point), point.z);
    close(result.x, point.x); close(result.y, point.y);
  }
});
test('flat terrain picking remains compatible at all zoom levels', () => {
  const generated = generateWorld('flat-test', 16);
  const world = { ...generated, cells: generated.cells.map(cell => ({ ...cell, z: 0 })) };
  for (const zoom of [0.25, 1, 3]) {
    const camera = { focus: { x: 47.25, y: 82.5 }, zoom };
    for (const cell of world.cells) {
      const screen = toScreen({ x: cell.x + 0.5, y: cell.y + 0.5, z: 0 }, camera, viewport);
      assert.equal(pickCell(screen, camera, viewport, world), cell);
    }
    for (const x of [-0.1, 16.1]) assert.equal(pickCell(toScreen({ x, y: 10, z: 0 }, camera, viewport), camera, viewport, world), null);
  }
});
test('zoom retains world position under pointer and respects limits', () => {
  const camera = { focus: { x: 64, y: 64 }, zoom: 1 };
  const anchor = { x: 210, y: 320 };
  const before = screenToWorld(anchor, camera, viewport);
  const next = zoomCamera(camera, 1.7, anchor, viewport, world.size);
  const after = screenToWorld(anchor, next, viewport);
  close(before.x, after.x); close(before.y, after.y);
  assert.equal(zoomCamera(camera, 100, anchor, viewport, 128).zoom, 3);
  assert.equal(zoomCamera(camera, 0.001, anchor, viewport, 128).zoom, 0.25);
});
test('pan moves rendered tiles by pointer delta and clamps world focus', () => {
  const camera = { focus: { x: 64, y: 64 }, zoom: 1.5 };
  const cell = world.cells[100];
  const before = toScreen(cell, camera, viewport);
  const after = toScreen(cell, panCamera(camera, { x: 75, y: -40 }, 128), viewport);
  close(after.x - before.x, 75); close(after.y - before.y, -40);
  const far = panCamera(camera, { x: 1e6, y: 1e6 }, 128);
  assert.ok(far.focus.x >= 0 && far.focus.x <= 128 && far.focus.y >= 0 && far.focus.y <= 128);
});

test('elevated top and exposed cliff picking work at each zoom', () => {
  const cells = Array.from({ length: 9 }, (_, i) => ({ x: i % 3, y: Math.floor(i / 3), z: i === 4 ? 3 : 0, terrain: 'grassland' }));
  const fixture = { seed: 'cliff', size: 3, chunkSize: 32, cells };
  for (const zoom of [0.25, 1, 3]) {
    const camera = { focus: { x: 1.5, y: 1.5 }, zoom };
    const top = toScreen({ x: 1.5, y: 1.5, z: 3 }, camera, viewport);
    assert.equal(pickCell(top, camera, viewport, fixture), cells[4]);
    for (const face of terrainFaces(cells[4], fixture, camera, viewport)) {
      const center = face.points.reduce((sum, point) => ({ x: sum.x + point.x / 4, y: sum.y + point.y / 4 }), { x: 0, y: 0 });
      assert.equal(pickCell(center, camera, viewport, fixture), cells[4]);
    }
    const focused = toScreen({ x: 1.5, y: 1.5, z: 3 }, { ...camera, focus: focusCell(cells[4]) }, viewport);
    close(focused.x, viewport.width / 2); close(focused.y, viewport.height / 2);
  }
});
test('nearby elevated terrain occludes a lower tile and shared sides are hidden', () => {
  const cells = Array.from({ length: 9 }, (_, i) => ({ x: i % 3, y: Math.floor(i / 3), z: i === 4 ? 3 : 0, terrain: 'grassland' }));
  const fixture = { seed: 'overlap', size: 3, chunkSize: 32, cells };
  const camera = { focus: { x: 1, y: 1 }, zoom: 1 };
  const hidden = toScreen({ x: 0.5, y: 0.5, z: 0 }, camera, viewport);
  assert.equal(pickCell(hidden, camera, viewport, fixture), cells[4]);
  const plateau = { ...fixture, cells: cells.map(cell => ({ ...cell, z: 3 })) };
  assert.deepEqual(terrainFaces(plateau.cells[4], plateau, camera, viewport).map(face => face.kind), ['top']);
});

test('starting settlement has valid dry footprints and connected roads', () => {
  const { withStartingSettlement, buildingDefinitions } = require('../world/domain/settlement.ts');
  const settled = withStartingSettlement(world);
  assert.ok(settled.settlement);
  assert.equal(settled.settlement.population, 10);
  assert.equal(settled.buildings.length, 6);
  assert.deepEqual(withStartingSettlement(world), settled);
  const occupied = new Set();
  for (const building of settled.buildings) {
    const definition = buildingDefinitions[building.type];
    for (let y = building.y; y < building.y + definition.depth; y++) for (let x = building.x; x < building.x + definition.width; x++) {
      const key = `${x},${y}`;
      assert.ok(!occupied.has(key)); occupied.add(key);
      const cell = settled.cells[y * settled.size + x];
      assert.equal(cell.terrain, 'grassland'); assert.equal(cell.z, building.z);
    }
    assert.ok(settled.roads.some(road => road.x >= building.x - 1 && road.x <= building.x + definition.width && road.y >= building.y - 1 && road.y <= building.y + definition.depth));
  }
  const remaining = new Set(settled.roads.map(road => `${road.x},${road.y}`));
  for (const key of remaining) assert.ok(!occupied.has(key));
  const queue = [settled.roads[0]]; remaining.delete(`${queue[0].x},${queue[0].y}`);
  while (queue.length) {
    const cell = queue.pop();
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const key = `${cell.x + dx},${cell.y + dy}`;
      if (remaining.delete(key)) queue.push({ x: cell.x + dx, y: cell.y + dy });
    }
  }
  assert.equal(remaining.size, 0);
  assert.deepEqual(settled.cells, world.cells);
});

test('building roof and wall picking return the building origin after zoom', () => {
  const { withStartingSettlement } = require('../world/domain/settlement.ts');
  const { buildingFaces } = require('../presentation/world/buildings.ts');
  const settled = withStartingSettlement(world);
  for (const zoom of [0.5, 1, 3]) for (const building of settled.buildings) {
    const camera = { focus: focusCell(building), zoom };
    for (const face of buildingFaces(building, camera, viewport)) {
      const center = face.points.reduce((sum, p) => ({ x: sum.x + p.x / 4, y: sum.y + p.y / 4 }), { x: 0, y: 0 });
      assert.equal(pickCell(center, camera, viewport, settled), settled.cells[building.y * settled.size + building.x]);
    }
  }
});

test('no suitable site leaves terrain unchanged and omits the settlement', () => {
  const { withStartingSettlement } = require('../world/domain/settlement.ts');
  const tiny = generateWorld('tiny', 8);
  const result = withStartingSettlement(tiny);
  assert.equal(result.settlement, undefined);
  assert.deepEqual(result.buildings, []);
  assert.equal(result.cells, tiny.cells);
});

test('placement validation handles rotation, access, terrain, slopes, and occupancy', () => {
  const { withStartingSettlement, footprintOf } = require('../world/domain/settlement.ts');
  const { validatePlacement, placeBuilding } = require('../world/domain/construction.ts');
  const settled = withStartingSettlement(world);
  assert.deepEqual(footprintOf('workshop', 'north'), { width: 2, depth: 1 });
  assert.deepEqual(footprintOf('workshop', 'east'), { width: 1, depth: 2 });
  const road = settled.roads.find(road => {
    const request = { type: 'house', x: road.x + 1, y: road.y, rotation: 'north' };
    return validatePlacement(settled, request).valid;
  });
  assert.ok(road, 'fixture needs a valid road-adjacent site');
  const valid = { type: 'house', x: road.x + 1, y: road.y, rotation: 'north' };
  assert.equal(validatePlacement(settled, valid).valid, true);
  const placed = placeBuilding(settled, valid, 'test-building');
  assert.equal(placed.buildings.at(-1).id, 'test-building');
  assert.ok(validatePlacement(placed, valid).reasons.includes('Footprint is occupied'));
  const onRoad = { ...valid, x: road.x, y: road.y };
  assert.ok(validatePlacement(settled, onRoad).reasons.includes('Cannot build over a road'));
  assert.ok(validatePlacement(settled, { ...valid, x: -1 }).reasons.includes('Footprint extends beyond the world'));
  const waterCell = settled.cells.find(cell => cell.terrain === 'water');
  assert.ok(validatePlacement(settled, { ...valid, x: waterCell.x, y: waterCell.y }).reasons.includes('Requires grassland'));
  const isolated = settled.cells.find(cell => cell.terrain === 'grassland' && !validatePlacement(settled, { ...valid, x: cell.x, y: cell.y }).reasons.includes('Requires adjacent road access'));
  assert.ok(isolated);
  const noRoadWorld = { ...settled, roads: [] };
  assert.ok(validatePlacement(noRoadWorld, valid).reasons.includes('Requires adjacent road access'));
  const slopeOrigin = settled.cells.find(cell => cell.x + 1 < settled.size && cell.terrain === 'grassland' && settled.cells[cell.y * settled.size + cell.x + 1].terrain === 'grassland' && settled.cells[cell.y * settled.size + cell.x + 1].z !== cell.z);
  assert.ok(slopeOrigin, 'fixture needs two neighboring grass cells at different heights');
  const slopeWorld = { ...settled, roads: [{ x: slopeOrigin.x, y: slopeOrigin.y + 1, z: slopeOrigin.z }] };
  assert.ok(validatePlacement(slopeWorld, { type: 'workshop', x: slopeOrigin.x, y: slopeOrigin.y, rotation: 'north' }).reasons.includes('Requires level ground'));
  assert.deepEqual(validatePlacement(settled, { ...valid, rotation: 'upside-down' }).reasons, ['Rotation is unavailable']);
});

test('server construction sessions enforce revision and authoritative validation', () => {
  const { clearConstructionSessionsForTests, constructForSession } = require('../world/server/construction-store.ts');
  const { withStartingSettlement } = require('../world/domain/settlement.ts');
  const { validatePlacement } = require('../world/domain/construction.ts');
  clearConstructionSessionsForTests();
  const settled = withStartingSettlement(world);
  const road = settled.roads.find(road => validatePlacement(settled, { type: 'house', x: road.x + 1, y: road.y, rotation: 'north' }).valid);
  const placement = { type: 'house', x: road.x + 1, y: road.y, rotation: 'north' };
  const accepted = constructForSession('test-session', 0, placement);
  assert.equal(accepted.ok, true);
  assert.equal(accepted.revision, 1);
  assert.equal(accepted.building.id, 'player-1');
  const stale = constructForSession('test-session', 0, { ...placement, x: placement.x + 1 });
  assert.equal(stale.status, 409);
  assert.equal(stale.revision, 1);
  assert.ok(stale.buildings.some(building => building.id === 'player-1'));
  const invalid = constructForSession('second-session', 0, { ...placement, x: -5 });
  assert.equal(invalid.status, 422);
});

test('starting producers occupy level resource footprints without changing terrain', () => {
  const { withStartingSettlement, footprintOf } = require('../world/domain/settlement.ts');
  const { withStartingProduction, producerTypes } = require('../world/domain/production.ts');
  const settled = withStartingSettlement(world);
  const result = withStartingProduction(settled);
  const producers = result.buildings.filter(building => producerTypes.includes(building.type));
  assert.deepEqual(producers.map(building => building.type).sort(), ['farm', 'lumber_camp', 'quarry']);
  for (const building of producers) {
    const footprint = footprintOf(building.type, building.rotation);
    const cells = [];
    for (let dy = 0; dy < footprint.depth; dy++) for (let dx = 0; dx < footprint.width; dx++) cells.push(result.cells[(building.y + dy) * result.size + building.x + dx]);
    assert.ok(cells.every(cell => cell.z === building.z));
    if (building.type === 'farm') assert.ok(cells.every(cell => cell.terrain === 'farmland'));
    if (building.type === 'lumber_camp') assert.ok(cells.every(cell => cell.resourceNodeId === 'northwood'));
    if (building.type === 'quarry') assert.ok(cells.every(cell => cell.resourceNodeId === 'stone-ridge'));
  }
  assert.equal(result.cells, settled.cells);
  assert.deepEqual(withStartingProduction(settled), result);
});

test('production advances from elapsed server time and explains idle states', () => {
  const { clearProductionSessionsForTests, collectProduction, productionForSession, setProductionWorkers } = require('../world/server/production-store.ts');
  clearProductionSessionsForTests();
  const initial = productionForSession('production-test', 1_000);
  const farm = initial.sites.find(site => site.type === 'farm');
  const lumber = initial.sites.find(site => site.type === 'lumber_camp');
  const quarry = initial.sites.find(site => site.type === 'quarry');
  assert.equal(farm.status, 'running');
  assert.equal(lumber.status, 'missing_workers');
  assert.match(lumber.statusReason, /Needs 2 more workers/);
  assert.equal(quarry.status, 'storage_full');
  assert.match(quarry.statusReason, /Collect stone/);
  const advanced = productionForSession('production-test', 9_000);
  assert.equal(advanced.sites.find(site => site.type === 'farm').stored, 4);
  assert.equal(advanced.sites.find(site => site.type === 'lumber_camp').progressMs, 0);
  const staffed = setProductionWorkers('production-test', lumber.buildingId, 2, 9_000);
  assert.equal(staffed.ok, true);
  assert.equal(staffed.snapshot.sites.find(site => site.type === 'lumber_camp').status, 'running');
  assert.equal(productionForSession('production-test', 19_000).sites.find(site => site.type === 'lumber_camp').stored, 3);
  const collected = collectProduction('production-test', quarry.buildingId, 19_000);
  assert.equal(collected.ok, true);
  assert.equal(collected.collected, 12);
  assert.equal(collected.snapshot.sites.find(site => site.type === 'quarry').status, 'running');
  assert.equal(setProductionWorkers('production-test', farm.buildingId, 99, 19_000).status, 422);
});
