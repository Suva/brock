// Where a vault is kept. The window only knows this interface, so a web
// version can keep a vault somewhere else without the rest changing.

import type { LogEntry } from "../core/activity.ts";
import type { Change, Node } from "../core/node.ts";

export interface Store {
  /** Every node, deleted ones too. */
  load(): Promise<Node[]>;
  /** Writes changes, all or none. `origin` says who made them: "user" if not said. */
  save(changes: Change[], origin?: string): Promise<void>;
  /** The latest entries of the log, newest first. */
  history(limit: number): Promise<LogEntry[]>;
  /** Removes nodes for good, with what the log holds of them. */
  purge(ids: string[]): Promise<void>;
}
