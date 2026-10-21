// A picture of a map, as plain shapes: boxes, lines of text and curves, in
// the map's own coordinates. The window reads them off the map it draws
// (ui/picture.ts); here they are written out as SVG, which any drawing
// program opens: real shapes and text, no HTML inside.

export interface Colour {
  /** "#rrggbb". */
  hex: string;
  /** 0 to 1. */
  alpha: number;
}

export interface Font {
  family: string;
  size: number;
  weight: string;
  style: string;
}

export type Shape =
  | {
      kind: "box";
      x: number;
      y: number;
      width: number;
      height: number;
      radius: number;
      fill: Colour | null;
      stroke: Colour | null;
      strokeWidth: number;
      opacity: number;
    }
  | {
      kind: "text";
      /** Where the line starts, and its baseline. */
      x: number;
      y: number;
      width: number;
      text: string;
      font: Font;
      fill: Colour;
      opacity: number;
      /** A line through it, as done tasks have. */
      strike: boolean;
    }
  | {
      kind: "curve";
      /** SVG path data. */
      d: string;
      stroke: Colour;
      strokeWidth: number;
      dash: number[];
      opacity: number;
      /** An arrowhead at its end, filled with this colour. */
      arrow: Colour | null;
    };

export interface Picture {
  /** The part of the map shown, in its coordinates. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Null for a clear background. */
  background: Colour | null;
  shapes: Shape[];
}

/** A number written short: whole, or to two places. */
const n = (v: number) => String(Math.round(v * 100) / 100);

const escape = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A colour as SVG attributes: the colour, and its opacity when not whole. */
function paint(name: "fill" | "stroke", colour: Colour | null): string {
  if (!colour || colour.alpha === 0) return ` ${name}="none"`;
  return ` ${name}="${colour.hex}"` + (colour.alpha < 1 ? ` ${name}-opacity="${n(colour.alpha)}"` : "");
}

const opacity = (o: number) => (o < 1 ? ` opacity="${n(o)}"` : "");

/** The family list, with common fonts after it, for programs without the system's own. */
function families(family: string): string {
  return `${family}, Helvetica, Arial, sans-serif`.replace(/"/g, "'");
}

/** The picture as an SVG document. */
export function toSVG(picture: Picture): string {
  const out: string[] = [];
  const { x, y, width, height } = picture;
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${n(width)}" height="${n(height)}" viewBox="${n(x)} ${n(y)} ${n(width)} ${n(height)}">`,
  );
  // One arrowhead for each colour of link.
  const arrows = [...new Set(picture.shapes.flatMap((s) => (s.kind === "curve" && s.arrow ? [s.arrow.hex] : [])))];
  if (arrows.length) {
    out.push("<defs>");
    arrows.forEach((hex, i) =>
      out.push(
        `<marker id="arrow${i}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,1 L9,5 L0,9 z" fill="${hex}"/></marker>`,
      ),
    );
    out.push("</defs>");
  }
  if (picture.background) out.push(`<rect x="${n(x)}" y="${n(y)}" width="${n(width)}" height="${n(height)}"${paint("fill", picture.background)}/>`);

  for (const s of picture.shapes) {
    if (s.kind === "box") {
      // A border is drawn inside the box, as CSS draws it; SVG centres a stroke on the edge.
      const inset = s.stroke ? s.strokeWidth / 2 : 0;
      out.push(
        `<rect x="${n(s.x + inset)}" y="${n(s.y + inset)}" width="${n(Math.max(0, s.width - 2 * inset))}" height="${n(Math.max(0, s.height - 2 * inset))}"` +
          (s.radius > 0 ? ` rx="${n(Math.max(0, s.radius - inset))}"` : "") +
          paint("fill", s.fill) +
          (s.stroke ? paint("stroke", s.stroke) + ` stroke-width="${n(s.strokeWidth)}"` : "") +
          opacity(s.opacity) +
          "/>",
      );
    } else if (s.kind === "text") {
      const f = s.font;
      out.push(
        `<text x="${n(s.x)}" y="${n(s.y)}" font-family="${escape(families(f.family))}" font-size="${n(f.size)}"` +
          (f.weight !== "400" && f.weight !== "normal" ? ` font-weight="${f.weight}"` : "") +
          (f.style !== "normal" ? ` font-style="${f.style}"` : "") +
          paint("fill", s.fill) +
          opacity(s.opacity) +
          ` xml:space="preserve">${escape(s.text)}</text>`,
      );
      if (s.strike) {
        const at = s.y - f.size * 0.3;
        out.push(
          `<line x1="${n(s.x)}" y1="${n(at)}" x2="${n(s.x + s.width)}" y2="${n(at)}" stroke-width="${n(Math.max(1, f.size / 14))}"${paint("stroke", s.fill)}${opacity(s.opacity)}/>`,
        );
      }
    } else {
      const arrow = s.arrow ? ` marker-end="url(#arrow${arrows.indexOf(s.arrow.hex)})"` : "";
      out.push(
        `<path d="${escape(s.d)}" fill="none"${paint("stroke", s.stroke)} stroke-width="${n(s.strokeWidth)}" stroke-linecap="round"` +
          (s.dash.length ? ` stroke-dasharray="${s.dash.map(n).join(" ")}"` : "") +
          opacity(s.opacity) +
          arrow +
          "/>",
      );
    }
  }
  out.push("</svg>");
  return out.join("\n") + "\n";
}
