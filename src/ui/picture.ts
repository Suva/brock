// A picture of the open map: its shapes read off the map as the page draws
// it (core/picture.ts has them, and writes SVG), and drawn onto a canvas for
// PNG or the clipboard. Reading what the page drew, rather than drawing it
// again from the layout, keeps the picture exactly as the map looks: the same
// line breaks in titles, colours, badges and boxes.
//
// The PNG is drawn from the shapes, not by drawing the SVG into a canvas:
// WebKit may refuse to read back a canvas that has had an image drawn in it.

import type { Colour, Font, Picture, Shape } from "../core/picture.ts";

/** Room around the map, in the map's pixels. */
const MARGIN = 32;

/** Parts of a node that are controls, not content: the up button, and fold buttons unless folded. */
function skipped(el: Element): boolean {
  return el.classList.contains("up") || (el.classList.contains("fold") && !el.classList.contains("folded"));
}

/** Any CSS colour as hex and alpha, by letting a canvas read it. */
const colours = new Map<string, Colour>();
let probe: CanvasRenderingContext2D | null = null;
function colour(css: string): Colour {
  const known = colours.get(css);
  if (known) return known;
  probe ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = "#000";
  probe.fillStyle = css;
  probe.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
  const hex = "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
  const out = { hex, alpha: a / 255 };
  colours.set(css, out);
  return out;
}

const visible = (c: Colour | null): c is Colour => c !== null && c.alpha > 0;

/**
 * The shapes of the map drawn in `layer`, the layer the map's nodes and lines
 * are in, drawn at `zoom`. `bounds` is the part of the map to show.
 */
export function capture(
  layer: HTMLElement,
  zoom: number,
  bounds: { left: number; top: number; right: number; bottom: number },
  background: string | null,
): Picture {
  const box = layer.getBoundingClientRect();
  // The page's positions, which are on screen, in the map's own pixels.
  const origin = { left: box.left, top: box.top };
  const px = (v: number) => v / zoom;
  /** How far what is being drawn moves left: see the centre's up button below. */
  let dx = 0;
  const at = (r: DOMRect) => ({ x: px(r.left - origin.left) - dx, y: px(r.top - origin.top), width: px(r.width), height: px(r.height) });
  const shapes: Shape[] = [];

  // The lines: links, then the branches, as the map draws them.
  for (const path of layer.querySelectorAll<SVGPathElement>("svg.edges > path")) {
    const cs = getComputedStyle(path);
    const stroke = colour(cs.stroke);
    if (!visible(stroke)) continue;
    const marker = path.getAttribute("marker-end") ? layer.querySelector(".link-arrow") : null;
    shapes.push({
      kind: "curve",
      d: path.getAttribute("d") ?? "",
      stroke,
      strokeWidth: parseFloat(cs.strokeWidth) || 1,
      dash: cs.strokeDasharray === "none" ? [] : cs.strokeDasharray.split(/[ ,]+/).map(parseFloat).filter((v) => v > 0),
      opacity: parseFloat(cs.opacity),
      arrow: marker ? colour(getComputedStyle(marker).fill) : null,
    });
  }

  for (const node of layer.querySelectorAll<HTMLElement>(":scope > .node")) {
    const cs = getComputedStyle(node);
    const nodeOpacity = parseFloat(cs.opacity);
    if (nodeOpacity === 0) continue;
    // A map inside shows as a stack of cards, drawn by a shadow in the page.
    if (node.classList.contains("portal")) {
      const r = at(node.getBoundingClientRect());
      const edge = colour(cs.borderTopColor);
      const fill = colour(cs.backgroundColor);
      const radius = parseFloat(cs.borderTopLeftRadius) || 0;
      for (const k of [6, 3]) {
        shapes.push({ kind: "box", x: r.x + k, y: r.y + k, width: r.width, height: r.height, radius, fill, stroke: edge, strokeWidth: 2, opacity: nodeOpacity });
      }
    }
    // The up button on a map's centre is a control, left out; what is left
    // moves over to the middle of the box, which stays where the lines meet it.
    const up = node.querySelector<HTMLElement>(":scope > .up");
    dx = up ? (px(up.getBoundingClientRect().width) + (parseFloat(cs.columnGap) || 0)) / 2 : 0;
    draw(node, nodeOpacity);
    dx = 0;
  }

  /** An element's box and its own text, then its children. */
  function draw(el: HTMLElement, opacity: number) {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return;
    opacity *= el.classList.contains("node") ? 1 : parseFloat(cs.opacity);
    if (opacity <= 0.01) return;
    const r = at(el.getBoundingClientRect());
    // The node's own box stays put; only what is in it moves.
    if (el.classList.contains("node")) r.x += dx;

    const fill = colour(cs.backgroundColor);
    const borderWidth = parseFloat(cs.borderTopWidth) || 0;
    const border = borderWidth > 0 ? colour(cs.borderTopColor) : null;
    if (visible(fill) || visible(border)) {
      const corner = cs.borderTopLeftRadius;
      const radius = corner.endsWith("%") ? (Math.min(r.width, r.height) * parseFloat(corner)) / 100 : parseFloat(corner) || 0;
      shapes.push({
        kind: "box",
        ...r,
        radius: Math.min(radius, r.width / 2, r.height / 2),
        fill: visible(fill) ? fill : null,
        stroke: visible(border) ? border : null,
        strokeWidth: borderWidth,
        opacity,
      });
    }

    for (const child of el.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) text(child as Text, cs, opacity);
      else if (child instanceof HTMLElement && !skipped(child)) draw(child, opacity);
    }
  }

  /** A run of text, a shape for each line it is broken into on the page. */
  function text(node: Text, cs: CSSStyleDeclaration, opacity: number) {
    const content = node.data;
    if (!content.trim()) return;
    const font: Font = { family: cs.fontFamily, size: parseFloat(cs.fontSize), weight: cs.fontWeight, style: cs.fontStyle };
    const fill = colour(cs.color);
    const strike = cs.textDecorationLine.includes("line-through");
    const { ascent, descent } = metrics(font);

    // The lines, found from where each character is drawn.
    const range = document.createRange();
    const lines: { text: string; left: number; right: number; top: number; height: number }[] = [];
    for (let i = 0; i < content.length; i++) {
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      const r = at(range.getBoundingClientRect());
      if (r.width === 0 && r.height === 0) continue;
      const line = lines.at(-1);
      if (line && Math.abs(line.top - r.y) < r.height / 2) {
        line.text += content[i];
        line.right = Math.max(line.right, r.x + r.width);
      } else {
        lines.push({ text: content[i], left: r.x, right: r.x + r.width, top: r.y, height: r.height });
      }
    }
    for (const line of lines) {
      const words = line.text.replace(/\s+$/, "");
      if (!words) continue;
      // The baseline: as far down the line's box as the font's ascent is of its full height.
      const baseline = line.top + (line.height * ascent) / (ascent + descent);
      shapes.push({ kind: "text", x: line.left, y: baseline, width: line.right - line.left, text: words, font, fill, opacity, strike });
    }
  }

  return {
    x: bounds.left - MARGIN,
    y: bounds.top - MARGIN,
    width: bounds.right - bounds.left + 2 * MARGIN,
    height: bounds.bottom - bounds.top + 2 * MARGIN,
    background: background === null ? null : colour(background),
    shapes,
  };
}

/** How high a font reaches above its baseline and below it, as the canvas measures it. */
function metrics(font: Font): { ascent: number; descent: number } {
  probe ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
  probe.font = cssFont(font);
  const m = probe.measureText("Hg");
  return { ascent: m.fontBoundingBoxAscent || font.size * 0.8, descent: m.fontBoundingBoxDescent || font.size * 0.2 };
}

const cssFont = (f: Font) => `${f.style} ${f.weight} ${f.size}px ${f.family}`;

/** The picture drawn on a canvas, `scale` pixels to each of the map's. */
export function toCanvas(picture: Picture, scale = 2): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(picture.width * scale);
  canvas.height = Math.ceil(picture.height * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);
  ctx.translate(-picture.x, -picture.y);
  const css = (c: Colour) => `rgb(${parseInt(c.hex.slice(1, 3), 16)} ${parseInt(c.hex.slice(3, 5), 16)} ${parseInt(c.hex.slice(5, 7), 16)} / ${c.alpha})`;
  if (picture.background) {
    ctx.fillStyle = css(picture.background);
    ctx.fillRect(picture.x, picture.y, picture.width, picture.height);
  }
  for (const s of picture.shapes) {
    ctx.save();
    if (s.kind === "box") {
      ctx.globalAlpha = s.opacity;
      const inset = s.stroke ? s.strokeWidth / 2 : 0;
      ctx.beginPath();
      ctx.roundRect(s.x + inset, s.y + inset, Math.max(0, s.width - 2 * inset), Math.max(0, s.height - 2 * inset), Math.max(0, s.radius - inset));
      if (s.fill) {
        ctx.fillStyle = css(s.fill);
        ctx.fill();
      }
      if (s.stroke) {
        ctx.strokeStyle = css(s.stroke);
        ctx.lineWidth = s.strokeWidth;
        ctx.stroke();
      }
    } else if (s.kind === "text") {
      ctx.globalAlpha = s.opacity;
      ctx.font = cssFont(s.font);
      ctx.fillStyle = css(s.fill);
      ctx.textBaseline = "alphabetic";
      ctx.fillText(s.text, s.x, s.y);
      if (s.strike) {
        const y = s.y - s.font.size * 0.3;
        ctx.strokeStyle = css(s.fill);
        ctx.lineWidth = Math.max(1, s.font.size / 14);
        ctx.beginPath();
        ctx.moveTo(s.x, y);
        ctx.lineTo(s.x + s.width, y);
        ctx.stroke();
      }
    } else {
      ctx.globalAlpha = s.opacity;
      const path = new Path2D(s.d);
      ctx.strokeStyle = css(s.stroke);
      ctx.lineWidth = s.strokeWidth;
      ctx.lineCap = "round";
      ctx.setLineDash(s.dash);
      ctx.stroke(path);
      if (s.arrow) arrowhead(ctx, s.d, css(s.arrow), s.strokeWidth);
    }
    ctx.restore();
  }
  return canvas;
}

/** An arrowhead at the end of a path, pointing the way it ends, as the SVG's marker draws it. */
function arrowhead(ctx: CanvasRenderingContext2D, d: string, fill: string, width: number) {
  const svgPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
  svgPath.setAttribute("d", d);
  const length = svgPath.getTotalLength();
  if (length === 0) return;
  const end = svgPath.getPointAtLength(length);
  const before = svgPath.getPointAtLength(Math.max(0, length - 1));
  ctx.setLineDash([]);
  ctx.translate(end.x, end.y);
  ctx.rotate(Math.atan2(end.y - before.y, end.x - before.x));
  // The marker's shape: 10 units drawn at 7 times the line's width, its tip at the end.
  const k = 0.7 * width;
  ctx.beginPath();
  ctx.moveTo(-9 * k, -4 * k);
  ctx.lineTo(0, 0);
  ctx.lineTo(-9 * k, 4 * k);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

/** The picture as PNG bytes. */
export async function toPNG(picture: Picture): Promise<Uint8Array> {
  const canvas = toCanvas(picture);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("The picture could not be made.");
  return new Uint8Array(await blob.arrayBuffer());
}

const CLEAR_KEY = "brock-picture-clear";

/** Whether pictures are made with a clear background, chosen in Settings; else the map's own. */
export function clearBackground(): boolean {
  try {
    return localStorage.getItem(CLEAR_KEY) === "true";
  } catch {
    return false;
  }
}

export function setClearBackground(clear: boolean): void {
  try {
    localStorage.setItem(CLEAR_KEY, String(clear));
  } catch {
    // Without storage the choice lasts until the window closes.
  }
}
