import { test } from "node:test";
import assert from "node:assert/strict";
import { centreOn, fit, reveal, zoomAt, ZOOM_MAX } from "../src/ui/camera.ts";

const toScreen = (c: { x: number; y: number; zoom: number }, mx: number, my: number) => [mx * c.zoom + c.x, my * c.zoom + c.y];

test("zooming keeps the point under the pointer still", () => {
  const camera = { x: 100, y: 50, zoom: 1 };
  const before = [(300 - camera.x) / camera.zoom, (200 - camera.y) / camera.zoom];
  const zoomed = zoomAt(camera, 2, 300, 200);
  assert.equal(zoomed.zoom, 2);
  assert.deepEqual(toScreen(zoomed, before[0], before[1]), [300, 200]);
  assert.equal(zoomAt(camera, 100, 0, 0).zoom, ZOOM_MAX);
});

test("centring and fitting", () => {
  assert.deepEqual(toScreen(centreOn(10, 20, 1, 800, 600), 10, 20), [400, 300]);
  const small = fit({ x: -50, y: -10, width: 100, height: 20 }, 800, 600);
  assert.equal(small.zoom, 1, "a small map is not blown up");
  const big = fit({ x: 0, y: 0, width: 2000, height: 400 }, 800, 600, 0);
  assert.equal(big.zoom, 0.4);
  assert.deepEqual(toScreen(big, 1000, 200), [400, 300]);
});

test("revealing moves only as far as needed", () => {
  const camera = { x: 0, y: 0, zoom: 1 };
  assert.equal(reveal(camera, { x: 100, y: 100, width: 50, height: 20 }, 800, 600), camera);
  const right = reveal(camera, { x: 900, y: 100, width: 50, height: 20 }, 800, 600, 10);
  assert.deepEqual(toScreen(right, 950, 100), [790, 100]);
  const up = reveal(camera, { x: 100, y: -100, width: 50, height: 20 }, 800, 600, 10);
  assert.deepEqual(toScreen(up, 100, -100), [100, 10]);
});
