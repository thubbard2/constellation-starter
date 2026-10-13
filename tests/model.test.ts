// The model seam: data/clusters.json, through `loadClusters` and `constellation`, to the graph the scene draws.
import { describe, expect, it } from 'vitest';
import clusters from '../data/clusters.json';
import { DataError, loadClusters } from '../src/data';
import { constellation } from '../src/model/constellation';

/** What a failed check of the starter's own data says to do. */
const OWN = "the starter's data: after editing data/clusters.json, update this test";
const CLUSTERS = ['Ocean Lab', 'Sky Watch', 'Greenhouse', 'Workshop', 'Archive', 'Test Kitchen', 'Music Room'];

describe('data/clusters.json as a constellation', () => {
  // These pin the starter's own data: after editing data/clusters.json, update the counts and names here.
  const { nodes, links } = constellation(loadClusters(clusters));
  const byLabel = (label: string) => {
    const node = nodes.find((n) => n.label === label);
    expect(node, `no node "${label}": ${OWN}`).toBeDefined();
    return node!;
  };

  it('has the 7 clusters, about 130 nodes and 15 cross links', () => {
    expect(nodes.filter((n) => n.kind === 'cluster').map((n) => n.label), OWN).toEqual(CLUSTERS);
    expect(nodes.length, OWN).toBeGreaterThanOrEqual(120);
    expect(nodes.length, OWN).toBeLessThanOrEqual(140);
    expect(links.filter((l) => l.kind === 'cross'), OWN).toHaveLength(15);
  });

  it('joins every node but the root to its parent, and puts it in its cluster\'s cloud', () => {
    expect(links.filter((l) => l.kind === 'tree')).toHaveLength(nodes.length - 1);
    const kelp = byLabel('Kelp growth log');
    expect(kelp.cluster, OWN).toBe(byLabel('Ocean Lab').id);
    expect(byLabel('Seaweed salad').cluster, OWN).toBe(byLabel('Test Kitchen').id);
    expect(links, OWN).toContainEqual({ source: kelp.id, target: byLabel('Seaweed salad').id, kind: 'cross' });
  });

  it('warms what changed lately, and rolls the warmth and the item count up the tree', () => {
    expect(byLabel('Kelp growth log').warmth, OWN).toBe(1);
    expect(byLabel('Urchin survey').warmth, OWN).toBe(0);
    expect(byLabel('Kelp Forest').warmth, OWN).toBe(1);
    expect(byLabel('Archive').warmth, OWN).toBeCloseTo(0.5 ** (12 / 7));
    expect(byLabel('Herb Shelf').items, OWN).toBe(3);
    expect(byLabel('Ocean Lab').items, OWN).toBe(15);
  });
});

describe('a broken data file', () => {
  /** The file with one edit, as `loadClusters` reads it. */
  const load = (edit: (data: any) => void) => () => {
    const data = structuredClone(clusters);
    edit(data);
    return loadClusters(data);
  };

  it.each([
    ['a cluster with no name', (d: any) => delete d.clusters[2].name, 'clusters[2].name is missing. Every cluster needs a name.'],
    ['an item that is a number', (d: any) => (d.clusters[0].groups[0].items[1] = 7), 'clusters[0].groups[0].items[1] must be an object'],
    ['a name used twice', (d: any) => (d.clusters[1].groups[0].items[0] = 'Rain gauge'), 'clusters[1].groups[2].items[2].name is "Rain gauge", a name already used at clusters[1].groups[0].items[0].'],
    ['a misspelt setting', (d: any) => (d.clusters[3].colour = '#ff8800'), 'clusters[3].colour is not a setting here.'],
    ['a colour that is not one', (d: any) => (d.clusters[3].color = 'orange'), 'clusters[3].color must be a colour like "#38bdf8".'],
    ['days that are not a number', (d: any) => (d.clusters[0].groups[1].items[0].daysAgo = 'today'), 'clusters[0].groups[1].items[0].daysAgo must be a number'],
    ['a link to a name no node has', (d: any) => (d.links[4][1] = 'Nowhere'), 'links[4] names "Nowhere", but no node has that name.'],
    ['a link that is not a pair', (d: any) => (d.links[0] = ['Rain gauge']), 'links[0] must be two names'],
    ['no clusters at all', (d: any) => delete d.clusters, 'clusters must be a list of clusters.'],
  ])('%s: a plain-word error naming the field', (_, edit, message) => {
    expect(load(edit)).toThrow(DataError);
    expect(load(edit)).toThrow(`data/clusters.json: ${message}`);
  });
});
