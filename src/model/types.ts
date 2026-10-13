/** The kinds of node, from the top: the one root, a cluster (one cloud each), a group in a cluster, an item in a group. */
export type NodeKind = 'root' | 'cluster' | 'group' | 'item';

/** One node of the tree, as `data.ts` builds it from `data/clusters.json`. */
export interface MapNode {
  id: string;
  kind: NodeKind;
  label: string;
  parentId: string | null;
  children: string[];
  /** A cluster's own colour; none: the style's palette gives it one. */
  color?: string;
  /** How many days ago it changed (0 is today); none is cold. Its warmth follows. */
  daysAgo?: number;
  /** A few words about it: a longer note makes its name a little bigger. */
  note?: string;
}

/** A link the data draws between two nodes anywhere in the tree, by id. */
export interface CrossLink { source: string; target: string }

/** The whole map: every node by id, the root's id, and the cross links. */
export interface MapState {
  rootId: string;
  nodes: Record<string, MapNode>;
  links: CrossLink[];
}
