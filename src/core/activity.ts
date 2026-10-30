// The history of the vault: what was changed, when, and by whom, read from
// the log the store keeps, and the means to take a step back. A step is what
// one write put in the log; steps made close together on one node by the same
// hand, as typing makes, are shown as one.

import type { Change, Flag, Node } from "./node.ts";
import type { Vault } from "./vault.ts";

/** One line of the log: a node changed. `source` is "user", or who it was made for, such as "agent". */
export interface LogEntry {
  seq: number;
  at: number;
  source: string;
  before: Node | null;
  after: Node;
}

/** What one hand did in one go: one change per node, from its state before to its state after. */
export interface Step {
  /** The log's number of its last entry, which names it. */
  seq: number;
  /** When it was made, in milliseconds, as of its last entry. */
  at: number;
  source: string;
  changes: Change[];
}

/** Steps made this close together on a node's words are one step. */
export const SAME_STEP_MS = 2 * 60 * 1000;

/**
 * Steps from the log's entries, newest first. Entries written together by the
 * same hand are one step; typing in one node, step after step, is joined.
 */
export function stepsOf(entries: LogEntry[]): Step[] {
  const steps: Step[] = [];
  // Oldest first, so that a step is joined with the one before it.
  for (const entry of [...entries].sort((a, b) => a.seq - b.seq)) {
    const last = steps.at(-1);
    if (last && last.at === entry.at && last.source === entry.source) {
      join(last, entry);
      last.seq = entry.seq;
    } else {
      steps.push({ seq: entry.seq, at: entry.at, source: entry.source, changes: [{ before: entry.before, after: entry.after }] });
    }
  }
  const joined: Step[] = [];
  for (const step of steps) {
    const before = joined.at(-1);
    if (before && sameTyping(before, step)) {
      before.changes = [{ before: before.changes[0].before, after: step.changes[0].after }];
      before.at = step.at;
      before.seq = step.seq;
    } else joined.push(step);
  }
  return joined.reverse();
}

/** Adds an entry to a step, joining it with the step's change to the same node. */
function join(step: Step, entry: LogEntry): void {
  const i = step.changes.findIndex((c) => c.after.id === entry.after.id);
  if (i < 0) step.changes.push({ before: entry.before, after: entry.after });
  else step.changes[i] = { before: step.changes[i].before, after: entry.after };
}

/** Whether `next` goes on with `step`'s words in the same node, by the same hand, soon after. */
function sameTyping(step: Step, next: Step): boolean {
  if (step.source !== next.source || step.changes.length !== 1 || next.changes.length !== 1) return false;
  const [a, b] = [step.changes[0], next.changes[0]];
  return (
    a.after.id === b.after.id &&
    next.at - step.at <= SAME_STEP_MS &&
    wordsOnly(a) &&
    wordsOnly(b)
  );
}

/** A change to a node's title or notes and nothing else. */
function wordsOnly({ before, after }: Change): boolean {
  return before !== null && !changedBesides(before, after, ["title", "body"]);
}

/** Whether any field but `allowed` and `updatedAt` differs. */
function changedBesides(a: Node, b: Node, allowed: (keyof Node)[]): boolean {
  return (Object.keys(b) as (keyof Node)[]).some((key) => key !== "updatedAt" && !allowed.includes(key) && !equal(a[key], b[key]));
}

const equal = (x: unknown, y: unknown) => (Array.isArray(x) || Array.isArray(y) ? JSON.stringify(x) === JSON.stringify(y) : x === y);

/** Whether two states of a node are the same, whenever each was written. */
export function sameState(a: Node, b: Node): boolean {
  return !changedBesides(a, b, []);
}

// ---- In words --------------------------------------------------------------

type Kind = "added" | "deleted" | "restored" | "ticked" | "unticked" | "task" | "plain" | "marked" | "cleared" | "renamed" | "notes" | "moved" | "changed";

function kindOf({ before, after }: Change): Kind {
  if (before === null) return after.deletedAt === null ? "added" : "deleted";
  if (before.deletedAt === null && after.deletedAt !== null) return "deleted";
  if (before.deletedAt !== null && after.deletedAt === null) return "restored";
  if (before.task !== "done" && after.task === "done") return "ticked";
  if (before.task === "done" && after.task === "open") return "unticked";
  if (before.task === null && after.task !== null) return "task";
  if (before.task !== null && after.task === null) return "plain";
  if (before.flag !== after.flag) return after.flag ? "marked" : "cleared";
  if (before.title !== after.title) return "renamed";
  if (before.body !== after.body) return "notes";
  if (before.parentId !== after.parentId || before.sortKey !== after.sortKey) return "moved";
  return "changed";
}

const TITLE_MAX = 40;

const markWords = (flag: Flag) => (flag === "critical" ? "critical" : flag === "attention" ? "needing attention" : "OK");

function quoted(node: Node): string {
  const title = node.title.trim() || "Untitled";
  return `“${title.length > TITLE_MAX ? title.slice(0, TITLE_MAX - 1) + "…" : title}”`;
}

const MANY: Record<Kind, string> = {
  added: "Added",
  deleted: "Deleted",
  restored: "Restored",
  ticked: "Ticked",
  unticked: "Unticked",
  task: "Made tasks of",
  plain: "Made plain nodes of",
  marked: "Marked",
  cleared: "Cleared the mark on",
  renamed: "Renamed",
  notes: "Edited the notes of",
  moved: "Moved",
  changed: "Changed",
};

/** What a step did, in a line: “Ticked “Buy seeds””, “Added 3 nodes”. */
export function describe(step: Step): string {
  const kinds = step.changes.map(kindOf);
  const first = step.changes[0];
  const kind = kinds[0];
  if (step.changes.length === 1) {
    const node = first.after;
    switch (kind) {
      case "added": return `Added ${quoted(node)}`;
      case "deleted": return `Deleted ${quoted(node)}`;
      case "restored": return `Restored ${quoted(node)}`;
      case "ticked": return `Ticked ${quoted(node)}`;
      case "unticked": return `Unticked ${quoted(node)}`;
      case "task": return `Made ${quoted(node)} a task`;
      case "plain": return `Made ${quoted(node)} an ordinary node`;
      case "marked": return `Marked ${quoted(node)} as ${markWords(node.flag!)}`;
      case "cleared": return `Cleared the mark on ${quoted(node)}`;
      case "renamed": return `Renamed ${quoted(first.before!)} to ${quoted(node)}`;
      case "notes": return `Edited the notes of ${quoted(node)}`;
      case "moved": return `Moved ${quoted(node)}`;
      case "changed": return `Changed ${quoted(node)}`;
    }
  }
  const n = step.changes.length;
  return kinds.every((k) => k === kind) ? `${MANY[kind]} ${n} nodes` : `Changed ${n} nodes`;
}

/** The node a step is about, to go to: the first one it touched that is still there. */
export function aboutNode(step: Step): Node {
  return step.changes[0].after;
}

// ---- Taking a step back ----------------------------------------------------

export interface Reversible {
  /** Changes whose node is still as the step left it, and so can be put back. */
  clean: Change[];
  /** All the step changed. */
  total: number;
}

/** What of a step can still be taken back: a node changed since, or gone, is left. */
export function reversible(vault: Vault, step: Step): Reversible {
  const clean = step.changes.filter((c) => {
    const now = vault.get(c.after.id);
    return now !== undefined && sameState(now, c.after);
  });
  return { clean, total: step.changes.length };
}

/**
 * Takes a step back, for the nodes still as it left them, as a step of its own
 * that ⌘Z undoes. Returns how many nodes were put back and how many were left
 * because they have changed since.
 */
export function revertStep(vault: Vault, step: Step): { reverted: number; left: number } {
  const { clean, total } = reversible(vault, step);
  const done = clean.length ? vault.revert(clean).length : 0;
  return { reverted: done, left: total - done };
}
