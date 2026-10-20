// Where a vault is kept. The window only knows this interface, so a web
// version can keep a vault somewhere else without the rest changing.

import type { Change, Node } from "../core/node.ts";

export interface Store {
  /** Every node, deleted ones too. */
  load(): Promise<Node[]>;
  /** Writes changes, all or none. */
  save(changes: Change[]): Promise<void>;
}
