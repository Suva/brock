import { test } from "node:test";
import assert from "node:assert/strict";
import { toSVG, type Picture } from "../src/core/picture.ts";

const black = { hex: "#000000", alpha: 1 };
const font = { family: "-apple-system", size: 14, weight: "600", style: "normal" };

function picture(): Picture {
  return {
    x: -100,
    y: -50,
    width: 200,
    height: 100,
    background: { hex: "#ffffff", alpha: 1 },
    shapes: [
      { kind: "curve", d: "M0 0 C10 0 10 20 30 20", stroke: { hex: "#1c7ed6", alpha: 1 }, strokeWidth: 2, dash: [], opacity: 1, arrow: null },
      { kind: "curve", d: "M0 0 L40 40", stroke: { hex: "#4dabf7", alpha: 1 }, strokeWidth: 1.5, dash: [5, 4], opacity: 0.8, arrow: { hex: "#4dabf7", alpha: 1 } },
      { kind: "box", x: -20, y: -10, width: 40, height: 20, radius: 7, fill: null, stroke: black, strokeWidth: 2, opacity: 1 },
      { kind: "text", x: -15, y: 5, width: 30, text: "Fish & <chips>", font, fill: black, opacity: 0.55, strike: true },
    ],
  };
}

test("a picture is written as SVG of plain shapes", () => {
  const svg = toSVG(picture());
  assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="200" height="100" viewBox="-100 -50 200 100">/);
  assert.match(svg, /<rect x="-100" y="-50" width="200" height="100" fill="#ffffff"\/>/, "the background");
  assert.match(svg, /<rect x="-19" y="-9" width="38" height="18" rx="6" fill="none" stroke="#000000" stroke-width="2"\/>/, "a border inside its box");
  assert.match(svg, />Fish &amp; &lt;chips&gt;<\/text>/, "text escaped");
  assert.match(svg, /font-weight="600"/);
  assert.match(svg, /<line /, "a line through done text");
  assert.match(svg, /stroke-dasharray="5 4"/);
  assert.match(svg, /marker-end="url\(#arrow0\)"/);
  assert.equal((svg.match(/<marker /g) ?? []).length, 1, "one arrowhead for each colour");
  assert.ok(!svg.includes("foreignObject"), "no HTML inside, so other programs open it");
});

test("a clear background is left out", () => {
  const svg = toSVG({ ...picture(), background: null });
  assert.ok(!svg.includes('width="200" height="100" fill'));
});
