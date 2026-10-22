// Finding nodes by what they say. The whole vault is in memory, so search
// reads it there: every word typed must appear in a node's title or text,
// ignoring case and accents, and titles count for more than text. Among
// matches alike, a node's place in the vault and how it has been used decide.
// Nothing is sent anywhere; this runs on each key press.

import type { Node } from "./node.ts";
import type { Vault } from "./vault.ts";

export type Scope =
  /** Every node of the vault. */
  | { kind: "all" }
  /** The nodes under a map, maps inside it included. */
  | { kind: "within"; mapId: string }
  /** Maps only. */
  | { kind: "maps" };

export interface Hit {
  node: Node;
  /** Its ancestors, from the top of the vault down. */
  path: Node[];
  /** Where in the title the words were found, as [start, end) ranges, for showing them. */
  marks: [number, number][];
  /** A stretch of the text around the first word found there, when the title alone does not match. */
  snippet: string | null;
}

/** Lower case, without accents, so that "Café" is found by "cafe". */
export function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** Folded titles and texts, kept until a node changes. */
const folded = new WeakMap<Node, { title: string; body: string }>();

function foldedOf(node: Node) {
  let f = folded.get(node);
  if (!f) folded.set(node, (f = { title: fold(node.title), body: fold(node.body) }));
  return f;
}

const SNIPPET = 70;

/** What, besides the words, decides which of the nodes found comes first. */
export interface Ranking {
  /** The open map: nodes in it, then in the maps just under it, come first among equals. */
  here?: string | null;
  /** What use adds to a node's score (`boostFor` in `usage.ts`). */
  boost?: (id: string) => number;
}

/**
 * What a node's place in the vault adds to its score. A map, or a branch
 * with more under it, is more often what is looked for than a leaf; so is a
 * node near the top, or near the open map, rather than one deep in another.
 * It stays within what a title match is worth over a match in the text, so
 * that the words still decide first.
 */
function placeScore(node: Node, hasChildren: boolean, depth: number, nearHere: number | undefined): number {
  let score = 0;
  if (node.isMap) score += 1.5;
  else if (hasChildren) score += 0.25;
  if (nearHere === 0) score += 1;
  else if (nearHere === 1) score += 0.5;
  score -= Math.min(depth, 5) * 0.1;
  if (node.task === "done") score -= 0.5;
  return Math.max(-1, Math.min(2, score));
}

/**
 * The nodes matching `query`, best first. An empty query gives the nodes
 * gone to most lately, then those changed most recently, to go back to.
 */
export function search(vault: Vault, query: string, scope: Scope = { kind: "all" }, ranking: Ranking = {}, limit = 50): Hit[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  const top = scope.kind === "within" ? scope.mapId : vault.rootId;
  const boost = ranking.boost ?? (() => 0);
  const found: { node: Node; score: number; boost: number }[] = [];

  // Walk the tree rather than the list of nodes: it holds only what is not
  // deleted. Only scores are kept on the way; paths, marks and snippets are
  // made for the hits that are shown. `nearHere` counts the maps between the
  // open map and the one a node is in: 0 in the open map itself.
  const visit = (node: Node, depth: number, nearHere: number | undefined) => {
    const children = vault.children(node.id);
    if (scope.kind !== "maps" || node.isMap) {
      if (words.length === 0) {
        found.push({ node, score: node.updatedAt, boost: boost(node.id) });
      } else {
        const text = match(node, words)?.score;
        if (text !== undefined) {
          const score = text + placeScore(node, children.length > 0, depth, nearHere) + boost(node.id);
          found.push({ node, score, boost: 0 });
        }
      }
    }
    const below = !node.isMap ? nearHere : node.id === ranking.here ? 0 : nearHere === undefined ? undefined : nearHere + 1;
    for (const child of children) visit(child, depth + 1, below);
  };
  const start = vault.get(top);
  if (start) visit(start, start.id === vault.rootId ? 0 : vault.ancestors(start.id).length, undefined);

  found.sort(
    (a, b) =>
      b.boost - a.boost ||
      b.score - a.score ||
      a.node.title.length - b.node.title.length ||
      b.node.updatedAt - a.node.updatedAt,
  );
  return found.slice(0, limit).map(({ node }) => {
    const detail = words.length === 0 ? null : match(node, words, true);
    return { node, path: vault.ancestors(node.id), marks: detail?.marks ?? [], snippet: detail?.snippet ?? null };
  });
}

/** How well a node matches, or null; with `detail`, also where, for showing it. */
function match(
  node: Node,
  words: string[],
  detail = false,
): { score: number; marks: [number, number][]; snippet: string | null } | null {
  const { title, body } = foldedOf(node);
  let score = 0;
  const marks: [number, number][] = [];
  let bodyAt = -1;
  for (const word of words) {
    const t = title.indexOf(word);
    if (t >= 0) {
      // A word that starts a word of the title counts for more than one inside it.
      const startsWord = t === 0 || /[^\p{L}\p{N}]/u.test(title[t - 1]);
      score += startsWord ? 3 : 1;
      marks.push([t, t + word.length]);
      continue;
    }
    const b = body.indexOf(word);
    if (b < 0) return null;
    score += 0.5;
    if (bodyAt < 0) bodyAt = b;
  }
  const whole = words.join(" ");
  if (title === whole) score += 10;
  else if (title.startsWith(whole)) score += 5;
  if (!detail) return { score, marks: [], snippet: null };
  // Folding keeps lengths for most text; where it does not, marks are left out.
  const usable = title.length === node.title.length;
  return {
    score,
    marks: usable ? merge(marks) : [],
    snippet: bodyAt >= 0 && body.length === node.body.length ? snippetAt(node.body, bodyAt) : null,
  };
}

function merge(ranges: [number, number][]): [number, number][] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const r of sorted) {
    const last = out.at(-1);
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push([...r]);
  }
  return out;
}

function snippetAt(text: string, at: number): string {
  let start = Math.max(0, at - SNIPPET / 3);
  // Start at a word, not inside one.
  if (start > 0) {
    const space = text.slice(start, at).search(/\s/);
    start = space >= 0 ? start + space + 1 : at;
  }
  const end = Math.min(text.length, start + SNIPPET);
  const piece = text.slice(start, end).replace(/\s+/g, " ").trim();
  return (start > 0 ? "…" : "") + piece + (end < text.length ? "…" : "");
}

/**
 * The node a [[Title]] in a note means: the one with that title, ignoring
 * case and accents. Of several, one in the map `nearMap` first, then the one
 * nearest the top of the vault, then the oldest.
 */
export function findByTitle(vault: Vault, title: string, nearMap: string | null): Node | null {
  const wanted = fold(title.trim());
  if (!wanted) return null;
  let best: { node: Node; rank: number } | null = null;
  const visit = (node: Node, depth: number) => {
    if (foldedOf(node).title.trim() === wanted) {
      const here = node.id === nearMap || vault.mapOf(node.id) === nearMap;
      const rank = (here ? 0 : 1_000_000) + depth;
      if (!best || rank < best.rank || (rank === best.rank && node.createdAt < best.node.createdAt)) best = { node, rank };
    }
    for (const child of vault.children(node.id)) visit(child, depth + 1);
  };
  visit(vault.get(vault.rootId)!, 0);
  return (best as { node: Node } | null)?.node ?? null;
}
