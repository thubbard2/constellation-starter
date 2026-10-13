import type { StarNode } from './constellation';
import type { NodeKind } from './types';

/**
 * A name's size in the constellation, as a multiple of the base label height: `min` for a node with nothing to it, rising
 * with its weight to `max` at a weight of `full`; a cluster or the root never under `hub`, so the clusters read from afar.
 */
export const LABEL_SIZE = { min: 0.7, max: 1.5, full: 12, hub: 1.15 };

/** The size of a node's name, by its kind and weight: less to it, smaller. Absolute, so a node keeps its size as the map grows. */
export function labelSize({ kind, weight }: Pick<StarNode, 'kind' | 'weight'>): number {
  const size = LABEL_SIZE.min + (LABEL_SIZE.max - LABEL_SIZE.min) * Math.min(1, Math.max(0, weight) / LABEL_SIZE.full);
  return Math.round((kind === 'cluster' || kind === 'root' ? Math.max(LABEL_SIZE.hub, size) : size) * 1000) / 1000;
}

/**
 * A name's tier in the chooser: the hubs (the clusters, and the root) first, so they read from afar; then groups, then items.
 */
export const LABEL_TIER: Record<NodeKind, number> = { root: 0, cluster: 0, group: 1, item: 2 };
/**
 * How far from the camera a star's name may show, in world units, by kind (its zoom band): flying in brings groups, then items
 * within reach; the hubs show from any distance. The camera frames the whole map from about 1,100 away, and a focus from about 400.
 */
export const LABEL_BAND: Record<NodeKind, number> = { root: Infinity, cluster: Infinity, group: 1500, item: 550 };
/** Two names closer than this, in px, overlap: a little air between them. */
export const LABEL_GAP = 4;
/** A name that shows now keeps showing until its star is this much past its band, so it does not flicker at the edge. */
export const BAND_HOLD = 1.1;
/** The screen a name shows on, in CSS px. */
export interface Screen { width: number; height: number }

/**
 * A name the chooser may show: its star's kind and distance from the camera, and its box on screen in px (top left, size), and its
 * `priority`: a `must` name (the hover, the highlight, the focus) shows whenever it is on screen; a `first` one (the focus's children,
 * an opened node's children) comes before the rest, where it has room.
 */
export interface LabelBox { id: string; kind: NodeKind; depth: number; x: number; y: number; w: number; h: number; priority?: 'must' | 'first' }

const overlap = (a: LabelBox, b: LabelBox) =>
  a.x < b.x + b.w + LABEL_GAP && b.x < a.x + a.w + LABEL_GAP && a.y < b.y + b.h + LABEL_GAP && b.y < a.y + a.h + LABEL_GAP;

const RANK = { must: 0, first: 1 };
const rank = (box: LabelBox) => (box.priority ? RANK[box.priority] : 2);

/**
 * Which names show (they pop in and out by room), in the order chosen: the `must` ones, then the `first` ones, each in the order
 * given, then the rest by tier (`LABEL_TIER`), nearest the camera first within a tier. A `must` name shows when its box's centre is
 * on screen (`view`, px). Any other shows when its whole box is on screen, overlaps no name chosen before it, and its star is within
 * its kind's zoom band (`LABEL_BAND`; `BAND_HOLD` times that for a name in `shown`, the names that show now). Pure.
 */
export function chooseLabels(boxes: LabelBox[], view: Screen, shown: ReadonlySet<string> = new Set()): string[] {
  const order = boxes.map((box, i) => ({ box, i })).sort((a, b) => rank(a.box) - rank(b.box)
    || (a.box.priority ? 0 : LABEL_TIER[a.box.kind] - LABEL_TIER[b.box.kind] || a.box.depth - b.box.depth) || a.i - b.i);
  const kept: LabelBox[] = [];
  for (const { box } of order) {
    const [cx, cy] = [box.x + box.w / 2, box.y + box.h / 2];
    if (box.priority === 'must') {
      if (cx >= 0 && cy >= 0 && cx <= view.width && cy <= view.height) kept.push(box);
      continue;
    }
    if (box.x < 0 || box.y < 0 || box.x + box.w > view.width || box.y + box.h > view.height) continue;
    if (box.depth > LABEL_BAND[box.kind] * (shown.has(box.id) ? BAND_HOLD : 1)) continue;
    if (!kept.some((k) => overlap(k, box))) kept.push(box);
  }
  return kept.map((k) => k.id);
}

/** The name under (x, y) px among `boxes` (the names that show), nearest the camera first; none when the point is on none. */
export function labelAt(boxes: LabelBox[], x: number, y: number): string | undefined {
  const under = boxes.filter((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
  return under.sort((a, b) => a.depth - b.depth)[0]?.id;
}
