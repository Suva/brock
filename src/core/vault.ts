// The vault in memory: every node, an index of each node's children, the edits
// that can be made and their undo. Nothing here knows about storage or the
// screen. Each edit ends in a list of changes handed to whoever listens, which
// is how the app saves.

import { newId } from "./ids.ts";
import type { Change, Node, NodeFields } from "./node.ts";
import { keyBetween, keysBetween } from "./sort-key.ts";

export interface VaultOptions {
  /** The clock, for tests. */
  now?: () => number;
  /**
   * Called with the changes of every edit, undo and redo. It is also called
   * while the vault opens if the nodes had to be repaired, or the vault was
   * empty and its first node was made.
   */
  onChange?: (changes: Change[], origin: string) => void;
  /** Called with the ids of nodes removed for good, when the trash is emptied. */
  onPurge?: (ids: string[]) => void;
}

/** A branch in the trash: the node deleted, and how much went with it. */
export interface Trashed {
  node: Node;
  /** The nodes under it, which come back with it. */
  under: number;
}

interface Step {
  changes: Change[];
  /** Edits with the same key in a row become one step, such as typing. */
  mergeKey?: string;
}

const UNDO_LIMIT = 500;

/** The text of the first node of a new vault. */
export const ROOT_TITLE = "Home";

function byOrder(a: Node, b: Node): number {
  // Two devices can give siblings the same key; the id settles it the same
  // way everywhere.
  if (a.sortKey !== b.sortKey) return a.sortKey < b.sortKey ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export class Vault {
  #nodes = new Map<string, Node>();
  /** Each node's children that are not deleted, in order. */
  #children = new Map<string, Node[]>();
  #rootId = "";
  #now: () => number;
  #listeners: ((changes: Change[], origin: string) => void)[] = [];
  /** Who the edit under way is made for, when not the person at the keyboard. */
  #origin: string | null = null;
  #onPurge: ((ids: string[]) => void) | undefined;
  #undo: Step[] = [];
  #redo: Step[] = [];
  /** The changes of the edit under way, or null outside an edit. */
  #pending: Change[] | null = null;
  #version = 0;

  constructor(nodes: Iterable<Node>, options: VaultOptions = {}) {
    this.#now = options.now ?? Date.now;
    if (options.onChange) this.#listeners.push(options.onChange);
    this.#onPurge = options.onPurge;
    // Nodes saved before a field existed get its default.
    for (const node of nodes) this.#nodes.set(node.id, withDefaults(node));
    for (const node of this.#nodes.values()) this.#index(node);
    this.#pending = [];
    this.#repair();
    const repairs = this.#pending;
    this.#pending = null;
    this.#finish(repairs, false);
  }

  // ---- Reading -------------------------------------------------------------

  get rootId(): string {
    return this.#rootId;
  }

  /** Goes up by one on every change, for a view to know it is out of date. */
  get version(): number {
    return this.#version;
  }

  get size(): number {
    return this.#nodes.size;
  }

  get(id: string): Node | undefined {
    return this.#nodes.get(id);
  }

  /** A node that is neither deleted nor under a deleted node. */
  isLive(id: string): boolean {
    let node = this.#nodes.get(id);
    while (node) {
      if (node.deletedAt !== null) return false;
      if (node.parentId === null) return node.id === this.#rootId;
      node = this.#nodes.get(node.parentId);
    }
    return false;
  }

  children(id: string): readonly Node[] {
    return this.#children.get(id) ?? [];
  }

  /** The node's ancestors from the top of the vault down, without the node. */
  ancestors(id: string): Node[] {
    const path: Node[] = [];
    let node = this.#nodes.get(id);
    while (node && node.parentId !== null) {
      node = this.#nodes.get(node.parentId);
      if (node) path.unshift(node);
    }
    return path;
  }

  /**
   * The map a node is shown in: its nearest ancestor that is a map. A map is
   * shown in its parent's map as a portal, and as the centre of its own. The
   * top of the vault is in no map but its own, and gets null.
   */
  mapOf(id: string): string | null {
    let node = this.#nodes.get(id);
    while (node && node.parentId !== null) {
      node = this.#nodes.get(node.parentId);
      if (node?.isMap) return node.id;
    }
    return null;
  }

  /** The maps from the top of the vault down to this map, for breadcrumbs. */
  mapPath(mapId: string): Node[] {
    const node = this.#nodes.get(mapId);
    if (!node) return [];
    return [...this.ancestors(mapId).filter((n) => n.isMap), node];
  }

  /**
   * The portal in map `mapId` that leads towards `insideId`, a map somewhere
   * inside it: the next map on the way down. Null if `insideId` is not inside.
   */
  portalToward(mapId: string, insideId: string): string | null {
    const path = this.mapPath(insideId);
    const i = path.findIndex((n) => n.id === mapId);
    return i >= 0 && i + 1 < path.length ? path[i + 1].id : null;
  }

  /**
   * Every node shown in a map, the centre first and then depth first. A map
   * inside it is included, as a portal, but nothing under it.
   */
  mapNodes(mapId: string): Node[] {
    const centre = this.#nodes.get(mapId);
    if (!centre) return [];
    const out: Node[] = [centre];
    const visit = (id: string) => {
      for (const child of this.children(id)) {
        out.push(child);
        if (!child.isMap) visit(child.id);
      }
    };
    visit(mapId);
    return out;
  }

  // ---- Editing -------------------------------------------------------------

  /**
   * Runs `edit` as one step: its changes are saved together and undone
   * together. Edits inside it join it rather than making steps of their own.
   */
  transact<T>(edit: () => T, mergeKey?: string): T {
    if (this.#pending) return edit();
    this.#pending = [];
    try {
      const result = edit();
      this.#finish(this.#pending, true, mergeKey);
      return result;
    } catch (error) {
      // Put back what the failed edit had already changed.
      const pending = this.#pending;
      this.#pending = null;
      for (let i = pending.length - 1; i >= 0; i--) this.#put(pending[i].before ?? null, pending[i].after.id);
      throw error;
    } finally {
      this.#pending = null;
    }
  }

  /** A new child at `index` among the parent's children, or last. */
  addChild(parentId: string, fields: Partial<NodeFields> = {}, index?: number): Node {
    return this.transact(() => {
      this.#requireLive(parentId);
      const now = this.#now();
      const node: Node = {
        id: newId(now),
        parentId,
        sortKey: this.#keyAt(parentId, index ?? this.children(parentId).length),
        side: null,
        title: "",
        body: "",
        isMap: false,
        collapsed: false,
        color: null,
        icon: null,
        links: [],
        task: null,
        doneAt: null,
        priority: null,
        due: null,
        layout: null,
        flag: null,
        ...fields,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      this.#write(node);
      return node;
    });
  }

  /** A new node beside `id`, after it or before it. */
  addSibling(id: string, fields: Partial<NodeFields> = {}, before = false): Node {
    const node = this.#requireLive(id);
    if (node.parentId === null) throw new Error("The top of the vault has no siblings");
    const index = this.children(node.parentId).indexOf(node);
    return this.addChild(node.parentId, fields, before ? index : index + 1);
  }

  update(id: string, fields: Partial<NodeFields>, mergeKey?: string): void {
    this.transact(() => {
      const node = this.#requireLive(id);
      const changed = (Object.keys(fields) as (keyof NodeFields)[]).some((k) => !same(node[k], fields[k]));
      if (changed) this.#write({ ...node, ...fields, updatedAt: this.#now() });
    }, mergeKey);
  }

  /**
   * Moves a node to be the child of `parentId` at `index`, counted among the
   * parent's other children. A node given a new parent forgets its side.
   */
  move(id: string, parentId: string, index: number): void {
    this.transact(() => {
      const node = this.#requireLive(id);
      this.#requireLive(parentId);
      if (node.parentId === null) throw new Error("The top of the vault cannot be moved");
      if (id === parentId || this.ancestors(parentId).some((n) => n.id === id)) {
        throw new Error("A node cannot be moved under itself");
      }
      const sortKey = this.#keyAt(parentId, index, id);
      const side = node.parentId === parentId ? node.side : null;
      this.#write({ ...node, parentId, sortKey, side, updatedAt: this.#now() });
    });
  }

  /**
   * Deletes the nodes among `candidates` (every node, if not given) that have no
   * title and nothing else: no notes, no branches under them, not a map, no
   * icon, except those in `keep`, which are being worked on. A node whose last
   * branch went is looked at again, so an empty chain goes whole. Not steps for
   * undo, and gone from the undo and redo steps too, so that ⌘Z never lands on
   * a node that is not there. Returns the ids deleted.
   */
  sweepEmpty(keep: ReadonlySet<string> = new Set(), candidates?: Iterable<string>): string[] {
    const gone: string[] = [];
    let look = [...(candidates ?? this.#nodes.keys())];
    while (look.length > 0) {
      const found = look.filter((id) => {
        const node = this.#nodes.get(id);
        return !!node && node.parentId !== null && node.deletedAt === null && !keep.has(id) && isUntitled(node) && this.children(id).length === 0 && this.isLive(id);
      });
      if (found.length === 0) break;
      this.as("tidy", () =>
        this.transact(() => {
          for (const id of found) this.delete(id);
        }),
      );
      gone.push(...found);
      // The parents may be empty now.
      look = [...new Set(found.map((id) => this.#nodes.get(id)!.parentId!))];
    }
    if (gone.length > 0) {
      const dropped = new Set(gone);
      const without = (steps: Step[]) =>
        steps.flatMap((step) => {
          const changes = step.changes.filter((c) => !dropped.has(c.after.id));
          return changes.length > 0 ? [{ ...step, changes }] : [];
        });
      this.#undo = without(this.#undo);
      this.#redo = without(this.#redo);
    }
    return gone;
  }

  /** Deletes a node and everything under it; undo, or `restore`, brings them back. */
  delete(id: string): void {
    this.transact(() => {
      const node = this.#requireLive(id);
      if (node.parentId === null) throw new Error("The top of the vault cannot be deleted");
      const now = this.#now();
      this.#write({ ...node, deletedAt: now, updatedAt: now });
    });
  }

  restore(id: string): void {
    this.transact(() => {
      const node = this.#nodes.get(id);
      if (!node || node.deletedAt === null) return;
      if (node.parentId === null || !this.isLive(node.parentId)) {
        throw new Error("The node's parent is deleted; restore that first");
      }
      this.#write({ ...node, deletedAt: null, updatedAt: this.#now() });
    });
  }

  /** Links node `from` to node `to`, once; a node does not link to itself. */
  link(from: string, to: string): void {
    const node = this.#requireLive(from);
    this.#requireLive(to);
    if (from === to || node.links.includes(to)) return;
    this.update(from, { links: [...node.links, to] });
  }

  unlink(from: string, to: string): void {
    const node = this.#requireLive(from);
    if (node.links.includes(to)) this.update(from, { links: node.links.filter((id) => id !== to) });
  }

  /**
   * The live nodes that link to `id`: by a link of their own, or by one in
   * their notes, written as node:id. Reads the whole vault, so not for every
   * frame. A [[Title]] in notes is not counted: what it means can change.
   */
  linksTo(id: string): Node[] {
    const written = `(node:${id})`;
    return [...this.#nodes.values()].filter(
      (n) => n.id !== id && (n.links.includes(id) || n.body.includes(written)) && n.deletedAt === null && this.isLive(n.id),
    );
  }

  // ---- The trash -----------------------------------------------------------

  /**
   * The branches deleted, the latest first: each node deleted whose parent is
   * not. A node made and left empty at once, as when a new node is taken
   * back, holds nothing worth bringing back and is left out.
   */
  trash(): Trashed[] {
    const out: Trashed[] = [];
    for (const node of this.#nodes.values()) {
      if (node.deletedAt === null || node.parentId === null || !this.isLive(node.parentId)) continue;
      const under = this.#countUnder(node.id);
      if (isUntitled(node) && under === 0) continue;
      out.push({ node, under });
    }
    return out.sort((a, b) => b.node.deletedAt! - a.node.deletedAt!);
  }

  #countUnder(id: string): number {
    return this.children(id).reduce((sum, child) => sum + 1 + this.#countUnder(child.id), 0);
  }

  /**
   * Removes every deleted branch for good, the ones left out of `trash` too,
   * and returns how many nodes went. It cannot be undone, and it clears what
   * could be undone before, which could bring removed nodes back.
   */
  emptyTrash(): number {
    const gone = new Set<string>();
    const take = (id: string) => {
      if (gone.has(id)) return;
      gone.add(id);
      // Every node under it, deleted or not: all of it goes.
      for (const n of this.#nodes.values()) if (n.parentId === id) take(n.id);
    };
    for (const node of this.#nodes.values()) {
      if (node.deletedAt !== null && node.parentId !== null && this.isLive(node.parentId)) take(node.id);
    }
    if (gone.size === 0) return 0;
    for (const id of gone) this.#put(null, id);
    this.#undo = [];
    this.#redo = [];
    this.#version++;
    this.#onPurge?.([...gone]);
    for (const listener of this.#listeners) listener([], "user");
    return gone.size;
  }

  // ---- Tasks ---------------------------------------------------------------

  /** Makes a node a task to do, or, if it is one, an ordinary node again. */
  toggleTask(id: string): void {
    const node = this.#requireLive(id);
    this.update(id, node.task === null ? { task: "open" } : { task: null, doneAt: null });
  }

  /** Ticks a task done, or not done. Nothing for a node that is not a task. */
  tick(id: string, done = this.#requireLive(id).task === "open"): void {
    const node = this.#requireLive(id);
    if (node.task === null) return;
    this.update(id, done ? { task: "done", doneAt: this.#now() } : { task: "open", doneAt: null });
  }

  /**
   * Brings a deleted node back as the last child of `parentId`, with all
   * that went with it: how a cut branch is pasted, keeping its identity, so
   * that links to it still lead to it.
   */
  restoreTo(id: string, parentId: string): void {
    this.transact(() => {
      const node = this.#nodes.get(id);
      if (!node || node.deletedAt === null) throw new Error(`No deleted node ${id}`);
      this.#requireLive(parentId);
      if (id === parentId || this.ancestors(parentId).some((n) => n.id === id)) {
        throw new Error("A node cannot be put under itself");
      }
      const sortKey = this.#keyAt(parentId, this.children(parentId).length);
      const side = node.parentId === parentId ? node.side : null;
      this.#write({ ...node, parentId, sortKey, side, deletedAt: null, updatedAt: this.#now() });
    });
  }

  /** Makes a node a map of its own, or an ordinary node of its parent's map again. */
  setMap(id: string, isMap: boolean): void {
    this.transact(() => {
      const node = this.#requireLive(id);
      if (node.parentId === null && !isMap) throw new Error("The top of the vault is always a map");
      if (node.isMap !== isMap) this.#write({ ...node, isMap, updatedAt: this.#now() });
    });
  }

  // ---- Undo ----------------------------------------------------------------

  get canUndo(): boolean {
    return this.#undo.length > 0;
  }

  get canRedo(): boolean {
    return this.#redo.length > 0;
  }

  /**
   * Forgets every step to undo and redo, for what the app did by itself, such
   * as the tour added to a new vault, which the first ⌘Z should not take away.
   */
  forgetUndo(): void {
    this.#undo = [];
    this.#redo = [];
  }

  /**
   * Runs edits made for someone else, such as an agent: they are saved and
   * shown, and told to the listeners with `origin`, but are not steps for ⌘Z,
   * so that undoing never takes back what the person did not do. The history
   * brings them back with `revert`.
   */
  as<T>(origin: string, edit: () => T): T {
    const was = this.#origin;
    this.#origin = origin;
    try {
      return edit();
    } finally {
      this.#origin = was;
    }
  }

  /**
   * Puts nodes back as they were before `changes`, as one step like any
   * other, which ⌘Z undoes. A node the change made is marked deleted, never
   * removed. Returns the ids put back; a node whose old parent is gone or
   * deleted, or would now be under itself, is left as it is.
   */
  revert(changes: Change[]): string[] {
    const done: string[] = [];
    this.transact(() => {
      const now = this.#now();
      for (const { before, after } of [...changes].reverse()) {
        if (!this.#nodes.has(after.id)) continue;
        const parent = before?.parentId ?? null;
        if (before && parent !== null) {
          const loop = parent === before.id || this.ancestors(parent).some((n) => n.id === before.id);
          // A parent that is deleted would hide the node, in a branch the trash does not list.
          if (!this.isLive(parent) || loop) continue;
        }
        this.#write({ ...(before ?? { ...after, deletedAt: after.deletedAt ?? now }), updatedAt: now });
        done.push(after.id);
      }
    });
    return done;
  }

  /** Undoes the last step and returns its changes, or null if there is none. */
  undo(): Change[] | null {
    const step = this.#undo.pop();
    if (!step) return null;
    const now = this.#now();
    // A node that did not exist before the step stays, marked deleted, so
    // that redo, and later other devices, find it. Undo and redo are changes
    // like any other, made now, which syncing will need to know. Only what the
    // step changed is put back: what something else changed in the node since,
    // such as an agent's tick, is left.
    const changes = this.#apply([...step.changes].reverse().map((c) => this.#restore(c, "before", now)));
    this.#redo.push(step);
    return changes;
  }

  /**
   * Takes back the making of node `id`, if that was the last step, as if it
   * had not been made: nothing is left to redo. For a new node left empty.
   */
  cancelCreation(id: string): boolean {
    const step = this.#undo.at(-1);
    if (!step?.changes.some((c) => c.before === null && c.after.id === id)) return false;
    this.undo();
    this.#redo.pop();
    return true;
  }

  redo(): Change[] | null {
    const step = this.#redo.pop();
    if (!step) return null;
    const now = this.#now();
    const changes = this.#apply(step.changes.map((c) => this.#restore(c, "after", now)));
    this.#undo.push(step);
    return changes;
  }

  /**
   * The node as it is now with the fields `change` changed put back to their
   * state `to` the step: before it (undo) or after it (redo).
   */
  #restore(change: Change, to: "before" | "after", now: number): Node {
    const current = this.#nodes.get(change.after.id)!;
    if (change.before === null) {
      // A node the step made: undone it is deleted, and redone it is as it was made.
      return { ...current, deletedAt: to === "before" ? (current.deletedAt ?? now) : change.after.deletedAt, updatedAt: now };
    }
    const [from, target] = to === "before" ? [change.after, change.before] : [change.before, change.after];
    const next: Record<string, unknown> = { ...current, updatedAt: now };
    for (const key of Object.keys(target) as (keyof Node)[]) {
      if (key !== "updatedAt" && !same(from[key], target[key])) next[key] = target[key];
    }
    return next as unknown as Node;
  }

  // ---- Listening -----------------------------------------------------------

  /** Calls `listener` with the changes of every edit; returns a way to stop. */
  onChange(listener: (changes: Change[], origin: string) => void): () => void {
    this.#listeners.push(listener);
    return () => {
      this.#listeners = this.#listeners.filter((l) => l !== listener);
    };
  }

  // ---- Inside --------------------------------------------------------------

  #requireLive(id: string): Node {
    const node = this.#nodes.get(id);
    if (!node || !this.isLive(id)) throw new Error(`No node ${id}`);
    return node;
  }

  /** A sort key for position `index` among the children of `parentId`, leaving out `moving`. */
  #keyAt(parentId: string, index: number, moving?: string): string {
    let siblings = this.children(parentId).filter((n) => n.id !== moving);
    const i = Math.max(0, Math.min(index, siblings.length));
    let before = siblings[i - 1]?.sortKey ?? null;
    let after = siblings[i]?.sortKey ?? null;
    if (before !== null && after !== null && before >= after) {
      // Siblings with the same key, as syncing can leave them: give them
      // all new ones first. This is part of the same step.
      const keys = keysBetween(null, null, siblings.length);
      siblings.forEach((n, k) => this.#write({ ...n, sortKey: keys[k] }));
      siblings = this.children(parentId).filter((n) => n.id !== moving);
      before = siblings[i - 1]?.sortKey ?? null;
      after = siblings[i]?.sortKey ?? null;
    }
    return keyBetween(before, after);
  }

  /** Changes a node within the edit under way. */
  #write(next: Node): void {
    if (!this.#pending) throw new Error("Nodes change only inside an edit");
    const before = this.#nodes.get(next.id) ?? null;
    this.#pending.push({ before, after: next });
    this.#put(next, next.id);
  }

  /** Puts a node in the map and the children index, or takes it out for null. */
  #put(next: Node | null, id: string): void {
    const old = this.#nodes.get(id);
    if (old) this.#unindex(old);
    if (next) {
      this.#nodes.set(id, next);
      this.#index(next);
    } else {
      this.#nodes.delete(id);
    }
  }

  #index(node: Node): void {
    if (node.deletedAt !== null || node.parentId === null) return;
    let list = this.#children.get(node.parentId);
    if (!list) this.#children.set(node.parentId, (list = []));
    let i = list.length;
    while (i > 0 && byOrder(list[i - 1], node) > 0) i--;
    list.splice(i, 0, node);
  }

  #unindex(node: Node): void {
    if (node.parentId === null) return;
    const list = this.#children.get(node.parentId);
    const i = list ? list.indexOf(node) : -1;
    if (i >= 0) list!.splice(i, 1);
  }

  #apply(targets: Node[]): Change[] {
    this.#pending = [];
    try {
      for (const target of targets) this.#write(target);
      const changes = this.#pending;
      this.#finish(changes, false);
      return changes;
    } finally {
      this.#pending = null;
    }
  }

  /** Ends an edit: joins the changes of each node, keeps them for undo, tells the listeners. */
  #finish(raw: Change[], undoable: boolean, mergeKey?: string): void {
    const changes = joinChanges(raw);
    if (changes.length === 0) return;
    this.#version++;
    // What is done for someone else is the person's to see and take back in
    // the history, not by ⌘Z, which is for their own steps.
    if (undoable && this.#origin === null) {
      const last = this.#undo.at(-1);
      if (mergeKey !== undefined && last?.mergeKey === mergeKey && this.#redo.length === 0) {
        last.changes = joinChanges([...last.changes, ...changes]);
        // Typing that ended where it began leaves nothing to undo.
        if (last.changes.length === 0) this.#undo.pop();
      } else {
        this.#undo.push({ changes, mergeKey });
        if (this.#undo.length > UNDO_LIMIT) this.#undo.shift();
      }
      this.#redo = [];
    }
    for (const listener of this.#listeners) listener(changes, this.#origin ?? "user");
  }

  /**
   * Makes the stored nodes a single tree with one top node, whatever state
   * they came in: an empty vault gets its first node, and nodes whose parent
   * is missing, or that are their own ancestors, are put under the top node.
   * These changes are saved but cannot be undone.
   */
  #repair(): void {
    const tops = [...this.#nodes.values()]
      .filter((n) => n.parentId === null)
      .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
    const now = this.#now();
    let root = tops.find((n) => n.deletedAt === null) ?? tops[0];
    if (!root) {
      root = {
        id: newId(now),
        parentId: null,
        sortKey: keyBetween(null, null),
        side: null,
        title: ROOT_TITLE,
        body: "",
        isMap: true,
        collapsed: false,
        color: null,
        icon: null,
        links: [],
        task: null,
        doneAt: null,
        priority: null,
        due: null,
        layout: null,
        flag: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      this.#write(root);
    } else if (root.deletedAt !== null || !root.isMap) {
      this.#write({ ...root, deletedAt: null, isMap: true, updatedAt: now });
    }
    this.#rootId = root.id;

    const strays: Node[] = [];
    for (const node of this.#nodes.values()) {
      if (node.id === root.id) continue;
      // Walk up until the top, a missing parent or a loop.
      const seen = new Set<string>();
      let n: Node | undefined = node;
      while (n && n.parentId !== null && !seen.has(n.id)) {
        seen.add(n.id);
        n = this.#nodes.get(n.parentId);
      }
      const reachesRoot = n?.id === root.id;
      if (!reachesRoot) strays.push(node);
    }
    // Only the highest node of each stray branch is moved, and the rest come
    // with it: the one whose parent is missing, another top node, or one node
    // of a loop.
    for (const node of strays) {
      const parentMissing = node.parentId === null || !this.#nodes.has(node.parentId);
      if (!parentMissing && !(this.#inLoop(node.id) && this.#isLoopHead(node.id))) continue;
      this.#write({
        ...this.#nodes.get(node.id)!,
        parentId: root.id,
        sortKey: this.#keyAt(root.id, this.children(root.id).length, node.id),
        updatedAt: now,
      });
    }
  }

  /** Whether following parents from `id` comes back to `id`. */
  #inLoop(id: string): boolean {
    const seen = new Set<string>();
    let n = this.#nodes.get(id);
    while (n && n.parentId !== null && !seen.has(n.id)) {
      seen.add(n.id);
      if (n.parentId === id) return true;
      n = this.#nodes.get(n.parentId);
    }
    return false;
  }

  /** The node of a loop that is cut out of it: the one with the smallest id. */
  #isLoopHead(id: string): boolean {
    let smallest = id;
    let n = this.#nodes.get(this.#nodes.get(id)!.parentId!);
    while (n && n.id !== id) {
      if (n.id < smallest) smallest = n.id;
      n = this.#nodes.get(n.parentId!);
    }
    return smallest === id;
  }
}

/** A node with no title and no notes, which is not a map and has no icon: nothing worth keeping on its own. */
export function isUntitled(node: Node): boolean {
  return node.title.trim() === "" && node.body.trim() === "" && !node.isMap && node.icon === null;
}

/**
 * Whether new nodes may be made under `node`: not under one that has no title
 * yet, which is nearly always a second Tab pressed by accident. A map may, as
 * it is made on purpose and kept.
 */
export function canAddChild(node: Node): boolean {
  return node.isMap || node.title.trim() !== "";
}

/**
 * What to do once an undo or redo has made `changes`: the node to select, the
 * last it touched that is worth stopping at (not an empty one it brought
 * back), or `selected` if none; and the nodes it left without a title are
 * deleted, as when any other node is left, except the one selected.
 */
export function settle(vault: Vault, changes: Change[] | null, selected: string | null): string | null {
  const ids = (changes ?? []).map((c) => c.after.id).filter((id) => vault.isLive(id));
  const last = ids.filter((id) => !isUntitled(vault.get(id)!)).at(-1) ?? selected;
  vault.sweepEmpty(new Set(last ? [last] : []), ids);
  return last;
}

/** A node as stored, with the fields added since it was saved given their defaults. */
function withDefaults(node: Node): Node {
  if (Array.isArray(node.links) && node.task !== undefined && node.doneAt !== undefined && node.priority !== undefined && node.due !== undefined && node.layout !== undefined && node.flag !== undefined) {
    return node;
  }
  return {
    ...node,
    links: Array.isArray(node.links) ? node.links : [],
    task: node.task ?? null,
    doneAt: node.doneAt ?? null,
    priority: node.priority ?? null,
    due: node.due ?? null,
    layout: node.layout ?? null,
    // A mark made before it had levels was a yes or no.
    flag: node.flag ?? ((node as { attention?: boolean }).attention === true ? "attention" : null),
  };
}

/** One change per node: the state before the first change and after the last. */
function joinChanges(changes: Change[]): Change[] {
  const byId = new Map<string, Change>();
  for (const change of changes) {
    const first = byId.get(change.after.id);
    byId.set(change.after.id, { before: first ? first.before : change.before, after: change.after });
  }
  return [...byId.values()].filter((c) => c.before === null || !sameNode(c.before, c.after));
}

/** The same node with the same content; when it last changed does not count. */
function sameNode(a: Node, b: Node): boolean {
  return (Object.keys(a) as (keyof Node)[]).every((k) => k === "updatedAt" || same(a[k], b[k]));
}

/** Two values of a node's field are the same: lists by their items. */
function same(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => x === b[i]);
  return a === b;
}
