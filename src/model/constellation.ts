import type { MapState, NodeKind } from './types';

/** The cloud of a node with no cluster above it (the root): it floats at the center. */
export const CORE = 'core';
/** How a link joins two nodes: `tree` is parent → child; `cross` is one the data draws between any two nodes. */
export type LinkKind = 'tree' | 'cross';

/** A node as the constellation draws it: its cloud (a cluster's id, or `CORE`), its size metrics, and its warmth. */
export interface StarNode {
  id: string; kind: NodeKind; label: string; cluster: string;
  /** The items at or under it. */
  items: number;
  /** 1 when it or a node under it changed today, halving every half-life; 0 when nothing under it has a `daysAgo` (cold). */
  warmth: number;
  /** How much there is to it (`WEIGHT`): its note, the groups and items under it, the links that touch it. Its name's size follows. */
  weight: number;
}
export interface StarLink { source: string; target: string; kind: LinkKind }
export interface Constellation { nodes: StarNode[]; links: StarLink[] }

/**
 * A node's weight: log2(1 + chars / `charsPerStep`) for its note's length, plus log2(1 + n) for the n groups and items under
 * it, plus log2(1 + n) for the n links that touch it (tree and cross: a child counts in both). Logs, so the 50th item adds
 * less than the 5th: an item with nothing to it is near 1, a full cluster near 8.
 */
export const WEIGHT = { charsPerStep: 200 };
/** Warmth halves every this many days, by default. */
export const HALF_LIFE_DAYS = 7;
/** The kinds counted under a node, for its weight. */
const COUNTED = new Set<NodeKind>(['group', 'item']);

/** The ids from the root down to `id`. */
function pathToRoot(state: MapState, id: string): string[] {
  const path: string[] = [];
  for (let node = state.nodes[id]; node; node = node.parentId ? state.nodes[node.parentId] : undefined) path.unshift(node.id);
  return path;
}

/**
 * The map as a graph: every node with its cloud, size and warmth, and every link with its kind. A node's cloud is the cluster
 * above it, else `CORE`. A cross link is drawn only to a node other than the parent, so it never doubles a tree link. Pure: the
 * same map gives the same graph.
 */
export function constellation(state: MapState, halfLifeDays = HALF_LIFE_DAYS): Constellation {
  const freshest = new Map<string, number>();
  /** The fewest days since a change at or under `id`, or NaN when none is known. */
  const age = (id: string): number => {
    if (freshest.has(id)) return freshest.get(id)!;
    const node = state.nodes[id]!;
    const days = node.children.map(age).reduce((a, b) => (Number.isNaN(a) || b < a ? b : a), node.daysAgo ?? NaN);
    return freshest.set(id, days), days;
  };
  const counted = new Map<string, number>();
  /** How many groups and items are under `id`. */
  const under = (id: string): number => {
    if (!counted.has(id)) counted.set(id, state.nodes[id]!.children.reduce((n, c) => n + under(c) + (COUNTED.has(state.nodes[c]!.kind) ? 1 : 0), 0));
    return counted.get(id)!;
  };
  /** How many items are at or under `id`. */
  const items = (id: string): number => state.nodes[id]!.children.reduce((n, c) => n + items(c), state.nodes[id]!.kind === 'item' ? 1 : 0);
  const links: StarLink[] = [];
  const seen = new Set<string>();
  const link = (source: string, target: string | undefined, kind: LinkKind) => {
    const key = `${source}>${target}`;
    if (target && target in state.nodes && target !== state.nodes[source]!.parentId && !seen.has(key)) seen.add(key), links.push({ source, target, kind });
  };
  for (const { id, parentId } of Object.values(state.nodes)) if (parentId) link(parentId, id, 'tree');
  for (const { source, target } of state.links) link(source, target, 'cross');
  const touches = new Map<string, number>();
  for (const { source, target } of links) [source, target].forEach((id) => touches.set(id, (touches.get(id) ?? 0) + 1));
  const nodes = Object.values(state.nodes).map(({ id, kind, label, note = '' }): StarNode => {
    const days = age(id);
    const weight = Math.log2(1 + note.length / WEIGHT.charsPerStep) + Math.log2(1 + under(id)) + Math.log2(1 + (touches.get(id) ?? 0));
    return {
      id, kind, label, cluster: pathToRoot(state, id).find((p) => state.nodes[p]!.kind === 'cluster') ?? CORE,
      items: items(id), warmth: Number.isNaN(days) ? 0 : 0.5 ** (Math.max(0, days) / halfLifeDays), weight: round(weight),
    };
  });
  return { nodes, links };
}

/** The layout's physics (a style's `physics`): charge between nodes, a tree link's rest length, a hub's pull on its cloud, a ring spot's hold on its hub. */
export const PHYSICS = { charge: -60, linkDistance: 30, cluster: 0.08, anchor: 0.02 };
/**
 * A drag runs the layout `heat` hot (d3's `alphaTarget`), so the dragged star's cloud follows it on its springs, and keeps that heat
 * `afterTicks` ticks after the release before it cools: heat builds slowly, so a quick flick that cooled at once would leave the
 * cloud behind. Ticks, not time, so it behaves the same on any machine.
 */
export const DRAG = { heat: 0.3, afterTicks: 60 };
/** The cluster hubs' ring: its radius, and how far the disc leans back (radians), like a galaxy seen at an angle. */
const RING = 260;
const TILT = 0.5;
/** A node first appears this far from its hub, at most, in each axis. */
const SPREAD = 80;
/** The rest length of the root's links, so its clusters stand apart and their names do not pile up. */
const ROOT_LINK = 110;

export type Vec3 = [number, number, number];
/** A node as `d3-force-3d` moves it: it writes the position and velocity. */
export interface Body { id: string; x?: number; y?: number; z?: number; vx?: number; vy?: number; vz?: number }
/** A `d3-force-3d` force. */
export interface Force { (alpha: number): void; initialize(nodes: Body[]): void }
type End = string | Body;

const round = (v: number) => Math.round(v * 1000) / 1000 + 0;

/** Cluster `i` of `n` on the ring: from 12 o'clock, clockwise; its top leans away from the camera. */
export function ringSpot(i: number, n: number): Vec3 {
  const angle = (i * 2 * Math.PI) / n;
  const up = RING * Math.cos(angle);
  return [round(RING * Math.sin(angle)), round(up * Math.cos(TILT)), round(-up * Math.sin(TILT))];
}

/** A fixed random source per id (FNV-1a, then mulberry32): the same id always gives the same numbers in [0, 1). */
export function seeded(id: string) {
  let seed = 2166136261;
  for (const c of id) seed = Math.imul(seed ^ c.codePointAt(0)!, 16777619);
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A force that nudges each body toward the point `toward` names for it (none: left alone), by `strength` × alpha. */
function pull(strength: number, toward: (bodies: Map<string, Body>) => (body: Body) => Vec3 | undefined): Force {
  let bodies: Body[] = [];
  let target: (body: Body) => Vec3 | undefined = () => undefined;
  return Object.assign((alpha: number) => {
    for (const b of bodies) {
      const t = target(b);
      if (!t) continue;
      b.vx = (b.vx ?? 0) + (t[0] - (b.x ?? 0)) * strength * alpha;
      b.vy = (b.vy ?? 0) + (t[1] - (b.y ?? 0)) * strength * alpha;
      b.vz = (b.vz ?? 0) + (t[2] - (b.z ?? 0)) * strength * alpha;
    }
  }, { initialize(nodes: Body[]) {
    bodies = nodes;
    target = toward(new Map(nodes.map((b) => [b.id, b])));
  } });
}

/**
 * The constellation's own forces, and where each node starts. With `d3-force-3d`'s own
 * random source, a fixed-seed LCG, the same map settles the same way on every launch.
 */
export interface LayoutForces {
  /** A cluster hub starts on its ring spot (the root at the center); any other node near its hub, nudged by a hash of its id. */
  start(id: string): Vec3;
  /** Pulls each node toward its hub (its cluster, or the root for the core) where the hub is now, so a cloud follows its hub. */
  cluster: Force;
  /** Holds each cluster hub near its ring spot, and the root at the center. */
  anchor: Force;
  /**
   * Tree links are springs (d3's default strength, over tree links only). The root's link to a cluster pulls nothing (the
   * anchor holds the hub on the ring), nor does a cross-link: they are only drawn.
   */
  linkStrength(link: { source: End; target: End; kind: LinkKind }): number;
  /** A link's rest length: `physics.linkDistance`, but `ROOT_LINK` from the root. */
  linkDistance(link: { source: End }): number;
}

export function layoutForces({ nodes, links }: Constellation, physics = PHYSICS): LayoutForces {
  const root = nodes.find((n) => n.kind === 'root')?.id ?? '';
  const clusters = nodes.filter((n) => n.kind === 'cluster');
  const spots = new Map<string, Vec3>([[root, [0, 0, 0]], ...clusters.map((n, i): [string, Vec3] => [n.id, ringSpot(i, clusters.length)])]);
  const hubOf = new Map(nodes.map((n) => [n.id, n.cluster === CORE ? root : n.cluster]));
  const degree = new Map<string, number>();
  for (const { source, target, kind } of links) if (kind === 'tree') [source, target].forEach((id) => degree.set(id, (degree.get(id) ?? 0) + 1));
  const idOf = (end: End) => (typeof end === 'string' ? end : end.id);
  return {
    start(id) {
      const hub = spots.get(id) ?? spots.get(hubOf.get(id) ?? '') ?? [0, 0, 0];
      const random = seeded(id);
      return spots.has(id) ? [...hub] : (hub.map((v) => round(v + (random() * 2 - 1) * SPREAD)) as Vec3);
    },
    cluster: pull(physics.cluster, (bodies) => (b) => {
      const hub = bodies.get(hubOf.get(b.id) ?? '');
      return hub && hub !== b ? [hub.x ?? 0, hub.y ?? 0, hub.z ?? 0] : undefined;
    }),
    anchor: pull(physics.anchor, () => (b) => spots.get(b.id)),
    linkStrength: ({ source, target, kind }) => (kind !== 'tree' || (idOf(source) === root && spots.has(idOf(target))) ? 0
      : 1 / Math.min(degree.get(idOf(source)) ?? 1, degree.get(idOf(target)) ?? 1)),
    linkDistance: ({ source }) => (idOf(source) === root ? ROOT_LINK : physics.linkDistance),
  };
}
