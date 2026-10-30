// What is marked for the person: the nodes carrying a flag, by them or by an
// agent. The bell in the header counts and lists them; green ones, which ask
// nothing, are counted apart from those that do. Lowering or clearing a mark
// is the person's.

import type { Flag, Node } from "./node.ts";
import type { Vault } from "./vault.ts";

export interface Flagged {
  node: Node;
  flag: Flag;
  /** The map it is shown in, or null for the top of the vault. */
  mapId: string | null;
}

/** How much a mark asks of the person; none is 0. */
export function rank(flag: Flag | null): number {
  return flag === "critical" ? 3 : flag === "attention" ? 2 : flag === "ok" ? 1 : 0;
}

/** What a key press moves a node's mark to: none, then attention, critical, ok, and round. */
export function nextFlag(flag: Flag | null): Flag | null {
  return flag === null ? "attention" : flag === "attention" ? "critical" : flag === "critical" ? "ok" : null;
}

/** What each mark is called, in the places that name one. */
const WORDS: Record<Flag, { name: string; label: string; as: string }> = {
  ok: { name: "OK", label: "OK", as: "OK" },
  attention: { name: "needs attention", label: "Needs attention", as: "needing attention" },
  critical: { name: "critical", label: "Critical", as: "critical" },
};

/** A mark in words: "critical", "needs attention", "OK". */
export function flagName(flag: Flag): string {
  return WORDS[flag].name;
}

/** The same as a heading: "Critical", "Needs attention", "OK". */
export function flagLabel(flag: Flag): string {
  return WORDS[flag].label;
}

/** The same after "as": "critical", "needing attention", "OK". */
export function flagAs(flag: Flag): string {
  return WORDS[flag].as;
}

/** The sign drawn for a mark: a shape each, so that colour is not all that tells them apart. */
export function flagGlyph(flag: Flag): string {
  return flag === "critical" ? "‼" : flag === "attention" ? "⚑" : "✓";
}

/** The nodes carrying a mark, in the order of the tree, deleted ones left out. One walk over the tree. */
export function flagged(vault: Vault): Flagged[] {
  const found: Flagged[] = [];
  const visit = (node: Node, mapId: string | null) => {
    if (node.flag) found.push({ node, flag: node.flag, mapId });
    for (const child of vault.children(node.id)) visit(child, node.isMap ? node.id : mapId);
  };
  const root = vault.get(vault.rootId);
  if (root) visit(root, null);
  return found;
}

/** The same, the most urgent first; those alike stay in the order of the tree. */
export function byUrgency(list: Flagged[]): Flagged[] {
  return [...list].sort((a, b) => rank(b.flag) - rank(a.flag));
}

export interface Counts {
  critical: number;
  attention: number;
  ok: number;
  /** Those that ask something of the person: critical and attention. */
  asking: number;
}

export function counts(list: Flagged[]): Counts {
  const c = { critical: 0, attention: 0, ok: 0, asking: 0 };
  for (const { flag } of list) c[flag]++;
  c.asking = c.critical + c.attention;
  return c;
}

/** Sets the mark on several nodes, or takes it away with null, as one step. */
export function setFlag(vault: Vault, ids: string[], flag: Flag | null): void {
  vault.transact(() => {
    for (const id of ids) if (vault.get(id)) vault.update(id, { flag });
  });
}
