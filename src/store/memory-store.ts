// A vault in memory, for tests, and kept in the browser's local storage when
// the window is opened in a browser (`npm run dev`) to work on the interface
// without the app around it.

import type { Change, Node } from "../core/node.ts";
import type { Store } from "./store.ts";

/** The part of the Web Storage API this needs, so tests can pass a stand-in. */
interface KeyValue {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export class MemoryStore implements Store {
  #nodes = new Map<string, Node>();
  #storage: KeyValue | null;
  #key: string;
  /** Every call to `save`, for tests. */
  saves: Change[][] = [];
  /** Set to make the next saves fail, for tests. */
  failing: Error | null = null;

  constructor(nodes: Node[] = [], storage: KeyValue | null = null, key = "mindmap-vault") {
    this.#storage = storage;
    this.#key = key;
    const stored = storage?.getItem(key);
    for (const node of stored ? (JSON.parse(stored) as Node[]) : nodes) this.#nodes.set(node.id, node);
  }

  async load(): Promise<Node[]> {
    return [...this.#nodes.values()].map((n) => ({ ...n }));
  }

  async save(changes: Change[]): Promise<void> {
    if (this.failing) throw this.failing;
    this.saves.push(changes);
    for (const { after } of changes) this.#nodes.set(after.id, { ...after });
    this.#storage?.setItem(this.#key, JSON.stringify([...this.#nodes.values()]));
  }

  async purge(ids: string[]): Promise<void> {
    if (this.failing) throw this.failing;
    for (const id of ids) this.#nodes.delete(id);
    this.#storage?.setItem(this.#key, JSON.stringify([...this.#nodes.values()]));
  }
}
