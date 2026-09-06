/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness loads TypeScript in-process. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
// Test-process-only TS loading; type safety is checked separately by tsc/build.
require.extensions['.ts'] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 } }).outputText, filename);
};
const { generateWorld, chunkOf } = require('../world/domain/world.ts');
const { project, unproject, toScreen, screenToWorld, pickCell, panCamera, zoomCamera, focusCell, terrainFaces } = require('../presentation/world/projection.ts');
const world = generateWorld();
const viewport = { width: 1100, height: 700 };
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test('seeded semantic world is repeatable, bounded, elevated, and includes land/water/mountains', () => {
  assert.deepEqual(generateWorld(), world);
  assert.notDeepEqual(generateWorld('another-seed'), world);
  assert.equal(world.cells.length, 128 * 128);
  assert.deepEqual(new Set(world.cells.map(c => c.terrain)), new Set(['grassland', 'water', 'mountain']));
  for (const cell of world.cells) { assert.ok(Number.isInteger(cell.z) && cell.z >= 0); if (cell.terrain === "water") assert.equal(cell.z, 0); else assert.ok(cell.z >= 1); assert.ok(cell.x >= 0 && cell.x < 128 && cell.y >= 0 && cell.y < 128); }
  assert.deepEqual(chunkOf({ x: 32, y: 63, z: 0 }, 32), { x: 1, y: 1 });
  assert.throws(() => generateWorld('seed', 0), RangeError);
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
