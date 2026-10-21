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
  // Within a map, the most important first; the tree's order otherwise (sort is stable).
  for (const group of groups.values()) group.open.sort(byPriority);
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
