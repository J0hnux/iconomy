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
const { project, unproject, toScreen, screenToWorld, pickCell, panCamera, zoomCamera } = require('../presentation/world/projection.ts');
const world = generateWorld();
const viewport = { width: 1100, height: 700 };
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test('seeded semantic world is repeatable, bounded, flat, and includes land/water', () => {
  assert.deepEqual(generateWorld(), world);
  assert.notDeepEqual(generateWorld('another-seed'), world);
  assert.equal(world.cells.length, 128 * 128);
  assert.deepEqual(new Set(world.cells.map(c => c.terrain)), new Set(['grassland', 'water']));
  for (const cell of world.cells) { assert.equal(cell.z, 0); assert.ok(cell.x >= 0 && cell.x < 128 && cell.y >= 0 && cell.y < 128); }
  assert.deepEqual(chunkOf({ x: 32, y: 63, z: 0 }, 32), { x: 1, y: 1 });
  assert.throws(() => generateWorld('seed', 0), RangeError);
});
test('projection preserves coordinates at different elevations', () => {
  for (const point of [{ x: 0, y: 0, z: 0 }, { x: 13.5, y: 90.5, z: 3 }, { x: -4, y: 10, z: 7 }]) {
    const result = unproject(project(point), point.z);
    close(result.x, point.x); close(result.y, point.y);
  }
});
test('picking every tile center survives zoom and camera offsets', () => {
  for (const zoom of [0.25, 1, 3]) {
    const camera = { focus: { x: 47.25, y: 82.5 }, zoom };
    for (const cell of world.cells) {
      const screen = toScreen({ x: cell.x + 0.5, y: cell.y + 0.5, z: 0 }, camera, viewport);
      assert.equal(pickCell(screen, camera, viewport, world), cell);
    }
    for (const x of [-0.1, 128.1]) assert.equal(pickCell(toScreen({ x, y: 10, z: 0 }, camera, viewport), camera, viewport, world), null);
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
