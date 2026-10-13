import type { MapNode, MapState, NodeKind } from './model/types';

/** A problem in the data file, in plain words, naming the field: the page shows it instead of the map. */
export class DataError extends Error {
  override name = 'DataError';
}

/** The file every message names first. */
const FILE = 'data/clusters.json';
type Entry = Record<string, unknown>;
const isObject = (v: unknown): v is Entry => !!v && typeof v === 'object' && !Array.isArray(v);
const COLOUR = /^#([\da-f]{3}|[\da-f]{6})$/i;
/** The settings each part of the file may have: any other key is a typo, and the error says so. */
const KEYS = {
  file: ['title', 'clusters', 'links'],
  cluster: ['name', 'color', 'daysAgo', 'note', 'groups'],
  group: ['name', 'daysAgo', 'note', 'items'],
  item: ['name', 'daysAgo', 'note'],
};

/**
 * `data/clusters.json` as the map: a root named by `title`, then a node for each cluster, group and item, and the cross links,
 * each joining two names. An item may be just its name. Every name must be different, so a link can find it. Throws a
 * `DataError` at the first problem, naming the field (`clusters[2].groups[0].name`).
 */
export function loadClusters(raw: unknown): MapState {
  function fail(where: string, why: string): never {
    throw new DataError(`${FILE}: ${where} ${why}`);
  }
  const object = (v: unknown, where: string, keys: string[]): Entry => {
    if (!isObject(v)) return fail(where, 'must be an object, like { "name": "…" }.');
    const typo = Object.keys(v).find((k) => !keys.includes(k));
    return typo === undefined ? v : fail(`${where}.${typo}`, `is not a setting here. Use ${keys.join(', ')}.`);
  };
  const list = (v: unknown, where: string, what: string): unknown[] => (Array.isArray(v) ? v : fail(where, `must be a list of ${what}.`));

  const top = object(raw, 'the file', KEYS.file);
  const title = top.title ?? 'Constellation';
  if (typeof title !== 'string') fail('title', 'must be text.');
  const root: MapNode = { id: 'root', kind: 'root', label: title, parentId: null, children: [] };
  const nodes: Record<string, MapNode> = { root };
  /** Each name's node, and where in the file it stands. */
  const named = new Map<string, { id: string; where: string }>();
  const add = (entry: Entry, where: string, kind: Exclude<NodeKind, 'root'>, id: string, parent: MapNode): MapNode => {
    const { name, color, daysAgo, note } = entry;
    if (typeof name !== 'string' || !name.trim()) fail(`${where}.name`, `is missing. Every ${kind} needs a name.`);
    const twin = named.get(name);
    if (twin) fail(`${where}.name`, `is "${name}", a name already used at ${twin.where}. Every name must be different, so links can find it.`);
    if (color !== undefined && !(typeof color === 'string' && COLOUR.test(color))) fail(`${where}.color`, 'must be a colour like "#38bdf8".');
    if (daysAgo !== undefined && !(typeof daysAgo === 'number' && daysAgo >= 0)) fail(`${where}.daysAgo`, 'must be a number of days, 0 or more.');
    if (note !== undefined && typeof note !== 'string') fail(`${where}.note`, 'must be text.');
    named.set(name, { id, where });
    parent.children.push(id);
    const node: MapNode = { id, kind, label: name, parentId: parent.id, children: [] };
    return (nodes[id] = Object.assign(node, color && { color }, daysAgo !== undefined && { daysAgo }, note && { note }));
  };

  const clusters = list(top.clusters, 'clusters', 'clusters');
  if (!clusters.length) fail('clusters', 'is empty. Add at least one cluster.');
  clusters.forEach((c, i) => {
    const at = `clusters[${i}]`, entry = object(c, at, KEYS.cluster);
    const cluster = add(entry, at, 'cluster', `c${i}`, root);
    list(entry.groups ?? [], `${at}.groups`, 'groups').forEach((g, j) => {
      const gAt = `${at}.groups[${j}]`, gEntry = object(g, gAt, KEYS.group);
      const group = add(gEntry, gAt, 'group', `c${i}g${j}`, cluster);
      list(gEntry.items ?? [], `${gAt}.items`, 'items').forEach((item, k) => {
        const iAt = `${gAt}.items[${k}]`;
        add(typeof item === 'string' ? { name: item } : object(item, iAt, KEYS.item), iAt, 'item', `c${i}g${j}i${k}`, group);
      });
    });
  });

  const links = list(top.links ?? [], 'links', 'name pairs, like ["Kelp growth log", "Seaweed salad"]').map((pair, i) => {
    const at = `links[${i}]`;
    if (!Array.isArray(pair) || pair.length !== 2 || !pair.every((n) => typeof n === 'string')) {
      fail(at, 'must be two names, like ["Kelp growth log", "Seaweed salad"].');
    }
    const [source, target] = (pair as string[]).map((n) => named.get(n)?.id ?? fail(at, `names "${n}", but no node has that name.`));
    if (source === target) fail(at, `joins "${pair[0]}" to itself.`);
    return { source: source!, target: target! };
  });
  return { rootId: root.id, nodes, links };
}
