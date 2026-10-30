// Tasks across the vault: how far along the tasks under a node are, and the
// tasks of a map, or of all of them, for the tasks panel.

import type { Node } from "./node.ts";
import type { Vault } from "./vault.ts";

export interface Progress {
  done: number;
  total: number;
}

/**
 * For every node under `topId` with tasks under it, how many of those are
 * done: maps inside counted in full, the node itself not. One walk.
 */
export function progressUnder(vault: Vault, topId: string): Map<string, Progress> {
  const out = new Map<string, Progress>();
  const walk = (id: string): Progress => {
    const sum = { done: 0, total: 0 };
    for (const child of vault.children(id)) {
      const below = walk(child.id);
      sum.done += below.done + (child.task === "done" ? 1 : 0);
      sum.total += below.total + (child.task !== null ? 1 : 0);
    }
    if (sum.total > 0) out.set(id, sum);
    return sum;
  };
  walk(topId);
  return out;
}

export interface TaskGroup {
  /** The map the tasks are drawn in. */
  map: Node;
  /** Its tasks still to do, in the order of the tree. */
  open: Node[];
}

export interface TaskList {
  groups: TaskGroup[];
  /** Tasks done, the latest first, with the map each is in. */
  done: { node: Node; map: Node }[];
}

/** The tasks under `topId`, maps inside it included, grouped by the map they are drawn in. */
export function tasksUnder(vault: Vault, topId: string): TaskList {
  const groups = new Map<string, TaskGroup>();
  const done: { node: Node; map: Node }[] = [];
  const top = vault.get(topId);
  if (!top) return { groups: [], done };
  const visit = (node: Node, map: Node) => {
    for (const child of vault.children(node.id)) {
      if (child.task === "open") {
        let group = groups.get(map.id);
        if (!group) groups.set(map.id, (group = { map, open: [] }));
        group.open.push(child);
      } else if (child.task === "done") {
        done.push({ node: child, map });
      }
      visit(child, child.isMap ? child : map);
    }
  };
  // The top is the map its own nodes are drawn in, or, for a node that is not a
  // map, the map it is in.
  visit(top, top.isMap ? top : vault.get(vault.mapOf(topId) ?? vault.rootId)!);
  // Within a map, the most important first, the soonest due among equals; the
  // tree's order otherwise (sort is stable).
  for (const group of groups.values()) group.open.sort((a, b) => byPriority(a, b) || byDue(a, b));
  done.sort((a, b) => (b.node.doneAt ?? 0) - (a.node.doneAt ?? 0));
  return { groups: [...groups.values()], done };
}

/**
 * Makes several nodes tasks, or, if all of them are, ordinary nodes again:
 * the way a toolbar button works on a mixed selection. One step.
 */
export function toggleTasks(vault: Vault, ids: string[]): void {
  const nodes = ids.map((id) => vault.get(id)).filter((n): n is Node => !!n);
  const make = nodes.some((n) => n.task === null);
  vault.transact(() => {
    for (const n of nodes) if ((n.task === null) === make) vault.toggleTask(n.id);
  });
}

/** Ticks the tasks among several nodes done, or, if all of them are done, not done. One step. */
export function tickAll(vault: Vault, ids: string[]): void {
  const tasks = ids.map((id) => vault.get(id)).filter((n): n is Node => !!n && n.task !== null);
  const done = tasks.some((n) => n.task === "open");
  vault.transact(() => {
    for (const n of tasks) vault.tick(n.id, done);
  });
}

/** The highest priority, and the lowest. */
export const PRIORITIES = [1, 2, 3, 4, 5] as const;

/**
 * Where a priority sorts: 1 to 3 before what has none, 4 and 5 after it, so
 * that "none" means ordinary rather than least.
 */
export function priorityRank(priority: number | null): number {
  return priority ?? 3.5;
}

export function byPriority(a: Node, b: Node): number {
  return priorityRank(a.priority) - priorityRank(b.priority);
}

/** The soonest due first, and what has no date last. Dates in this form sort as text. */
export function byDue(a: Node, b: Node): number {
  if (a.due === b.due) return 0;
  if (a.due === null) return 1;
  if (b.due === null) return -1;
  return a.due < b.due ? -1 : 1;
}

/**
 * Gives several nodes a priority, or, if all of them have it already, takes
 * it off: pressing the same number again clears it. One step.
 */
export function setPriority(vault: Vault, ids: string[], priority: number): void {
  const nodes = ids.map((id) => vault.get(id)).filter((n): n is Node => !!n);
  const clear = nodes.length > 0 && nodes.every((n) => n.priority === priority);
  vault.transact(() => {
    for (const n of nodes) vault.update(n.id, { priority: clear ? null : priority });
  });
}

/**
 * The done tasks to leave out when done tasks are hidden, under `topId`:
 * each done task with no open task under it, maps inside included. What is
 * under one goes with it; one with work still open under it stays, so open
 * work never disappears. The top itself is never left out.
 */
export function doneToHide(vault: Vault, topId: string): Set<string> {
  return doneBranches(vault, topId, () => true);
}

/**
 * The highest done tasks under `topId` that `chosen` picks and that nothing
 * under them has to outlive: no open task, and no done task it does not pick.
 */
function doneBranches(vault: Vault, topId: string, chosen: (node: Node) => boolean): Set<string> {
  const out = new Set<string>();
  // Whether anything at or under a node has to stay.
  const staysAtOrUnder = (node: Node): boolean => {
    let under = false;
    for (const child of vault.children(node.id)) if (staysAtOrUnder(child)) under = true;
    const picked = node.task === "done" && chosen(node);
    if (picked && !under && node.id !== topId) out.add(node.id);
    return under || node.task === "open" || (node.task === "done" && !picked);
  };
  const top = vault.get(topId);
  if (top) staysAtOrUnder(top);
  // Only the highest of each: the rest go with them.
  return new Set([...out].filter((id) => !vault.ancestors(id).some((a) => out.has(a.id))));
}

/**
 * Moves the done tasks under `topId` to the trash, as `doneToHide` picks
 * them, as one step, and returns how many branches went. Given `chosen`,
 * only the done tasks it picks go, and a done task stays if one it does not
 * pick is under it: clearing last week's leaves today's alone.
 */
export function clearDone(vault: Vault, topId: string, chosen: (node: Node) => boolean = () => true): number {
  const ids = [...doneBranches(vault, topId, chosen)];
  if (ids.length) vault.transact(() => ids.forEach((id) => vault.delete(id)));
  return ids.length;
}

/**
 * A due date as the tasks panel shows it, by the calendar of this computer's
 * time zone, seen at `now`: today, tomorrow and yesterday by name, other days
 * by their date, with the year when it is not this one. A task ticked done
 * is never overdue or due today: there is nothing left to warn of.
 */
export function dueLabel(node: Pick<Node, "due" | "task">, now: number, locale?: string): { text: string; overdue: boolean; today: boolean } | null {
  if (!node.due) return null;
  const [year, month, day] = node.due.split("-").map(Number);
  const due = new Date(year, month - 1, day);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  // Rounded, as a change of summer time makes a day an hour longer or shorter.
  const days = Math.round((due.getTime() - today.getTime()) / 86_400_000);
  const named = { [-1]: "Yesterday", 0: "Today", 1: "Tomorrow" }[days];
  const sameYear = due.getFullYear() === today.getFullYear();
  const text = named ?? due.toLocaleDateString(locale, { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
  const open = node.task !== "done";
  return { text, overdue: open && days < 0, today: open && days === 0 };
}

/** When a task was done, as the tasks panel groups them. */
export type DoneWhen = "today" | "yesterday" | "week" | "earlier";

export const DONE_WHEN: { when: DoneWhen; label: string }[] = [
  { when: "today", label: "Today" },
  { when: "yesterday", label: "Yesterday" },
  { when: "week", label: "This week" },
  { when: "earlier", label: "Earlier" },
];

/**
 * When `doneAt` was, by the calendar of this computer's time zone, seen at
 * `now`: today, yesterday, earlier this week or before it. Weeks start on
 * `weekStart`, 0 for Sunday to 6 for Saturday. A time a little ahead of
 * `now`, from a clock set back, counts as today; one never set, as before.
 */
export function doneWhen(doneAt: number | null, now: number, weekStart = 1): DoneWhen {
  if (doneAt === null) return "earlier";
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  if (doneAt >= today.getTime()) return "today";
  // Days are moved by the calendar, not by 24 hours, which a change of
  // summer time would get wrong.
  const daysBefore = (n: number) => new Date(today.getFullYear(), today.getMonth(), today.getDate() - n).getTime();
  if (doneAt >= daysBefore(1)) return "yesterday";
  if (doneAt >= daysBefore((today.getDay() - weekStart + 7) % 7)) return "week";
  return "earlier";
}

/** Done tasks grouped by when they were done, latest group first; empty groups left out. */
export function groupDone<T extends { node: Node }>(
  done: T[],
  now: number,
  weekStart = 1,
): { when: DoneWhen; label: string; items: T[] }[] {
  return DONE_WHEN.map(({ when, label }) => ({
    when,
    label,
    items: done.filter((d) => doneWhen(d.node.doneAt, now, weekStart) === when),
  })).filter((g) => g.items.length > 0);
}
