import { test } from "node:test";
import assert from "node:assert/strict";
import { History, type Place } from "../src/core/history.ts";

const at = (map: string, node: string | null = null): Place => ({ map, node });
const always = () => true;

test("back and forward go through the maps visited, as in a browser", () => {
  const h = new History();
  assert.equal(h.canGoBack, false);
  h.leave(at("home", "a"));
  h.leave(at("tokyo", "b"));
  let here = at("kyoto");
  const back1 = h.back(here, always)!;
  assert.deepEqual(back1, at("tokyo", "b"), "with the node that was selected");
  here = back1;
  const back2 = h.back(here, always)!;
  assert.deepEqual(back2, at("home", "a"));
  assert.equal(h.back(back2, always), null, "nothing before the first");
  assert.equal(h.canGoForward, true);
  assert.deepEqual(h.forward(back2, always), at("tokyo", "b"));
});

test("going somewhere new forgets what was ahead", () => {
  const h = new History();
  h.leave(at("home"));
  h.back(at("tokyo"), always);
  h.leave(at("home"));
  assert.equal(h.canGoForward, false);
});

test("maps deleted since are passed over", () => {
  const h = new History();
  h.leave(at("home"));
  h.leave(at("gone"));
  assert.deepEqual(
    h.back(at("kyoto"), (p) => p.map !== "gone"),
    at("home"),
  );
});
