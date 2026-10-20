// A node as it is stored. The vault is one tree of these; a map is a node with
// `isMap` set, and holds every node under it down to the next map.

export type Side = "left" | "right";

export interface Node {
  id: string;
  /** Null only for the top node of the vault. */
  parentId: string | null;
  /** Order among siblings: see sort-key.ts. */
  sortKey: string;
  /**
   * Which side of its map's centre a direct child of the centre is drawn on.
   * Null lets the layout choose. Other nodes follow their branch and ignore it.
   */
  side: Side | null;
  title: string;
  /** The longer text, shown beside the map. */
  body: string;
  isMap: boolean;
  collapsed: boolean;
  color: string | null;
  icon: string | null;
  /** Milliseconds since 1970, as `Date.now()` gives them. */
  createdAt: number;
  updatedAt: number;
  /**
   * When the node was deleted, or null. Deleting marks only the node itself:
   * the nodes under it go with it and come back with it.
   */
  deletedAt: number | null;
}

/**
 * One node changed. Every edit is a list of these, which is all that is saved,
 * undone and, later, synced. `before` is null for a node just made.
 */
export interface Change {
  before: Node | null;
  after: Node;
}

/** The fields an edit may set directly. */
export type NodeFields = Pick<Node, "title" | "body" | "side" | "collapsed" | "color" | "icon">;
