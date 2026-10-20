// The vault at a glance: its maps as a tree, each map under the map it is
// drawn in, with how much each holds.

import type { Node } from "./node.ts";
import type { Vault } from "./vault.ts";

export interface MapEntry {
  node: Node;
  /** The nodes drawn in the map besides its centre, maps inside it counted as one each. */
  size: number;
  /** When anything drawn in the map last changed. */
  changedAt: number;
  /** The maps drawn in it, in the order of the tree. */
  maps: MapEntry[];
}

/** Every map of the vault, from its top down. One walk over the tree. */
export function mapTree(vault: Vault): MapEntry {
  const entry = (map: Node): MapEntry => {
    const out: MapEntry = { node: map, size: 0, changedAt: map.updatedAt, maps: [] };
    const visit = (id: string) => {
      for (const child of vault.children(id)) {
        out.size++;
        out.changedAt = Math.max(out.changedAt, child.updatedAt);
        if (child.isMap) out.maps.push(entry(child));
        else visit(child.id);
      }
    };
    visit(map.id);
    return out;
  };
  return entry(vault.get(vault.rootId)!);
}
