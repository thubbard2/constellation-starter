import { Color } from 'three';
import galaxy from '../../styles/galaxy.json';
import mesh from '../../styles/mesh.json';
import minimal from '../../styles/minimal.json';

/**
 * A style: the constellation's whole look in one JSON object, in the shape of `styles/galaxy.json`, whose numbers were tuned
 * by eye on screenshots.
 * - `palette`: the background's top and bottom; one hue per cluster cloud in ring order, and the core's; what a node leans to as
 *   it warms (and the highlight's colour); the cross-links'; search matches (`glow`).
 * - `bloom`: on or off, and `UnrealBloomPass`'s numbers; `resolution` is the share of the screen the glow is worked out at.
 * - `exposure`: the tone mapping's brightness, before the highlights roll off toward white (1 is as drawn).
 * - `nodes`: `sphere`, `ring` or `sprite`; a radius from `minSize` to `maxSize` by √(metric / the biggest): `items` (at or
 *   under it), `weight` (how much there is to it) or `recency` (its warmth).
 * - `links`: `width` 0 is a hairline; the opacity of tree links, cross-links, a hovered node's (`lit`) and the rest then (`dim`);
 *   particles a cross-link (and the focus's links), each moving `particleSpeed` of the link a frame.
 * - `mesh`: `count` points drifting `drift` a frame in a shell between two radii; pairs nearer than `linkDistance` joined by lines
 *   up to `lineOpacity` bright; points within `reach` of the cursor move off it (`repel`) or reach for it with lines (`grab`).
 * - `physics`: the layout's forces (`layoutForces`). `recency`: warmth's half-life, and a node's brightness cold (`ember`) and
 *   touched today (`peak`), and how far it leans to the warm colour then (`lean`). `dim`: what is not lit fades to this opacity.
 */
export type Style = typeof galaxy;
/** A style as a file holds it: a name, and any settings. */
export type UserStyle = { name: string } & Record<string, unknown>;
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** The presets that ship, in the order the panel lists them. */
export const PRESETS: readonly [Style, ...Style[]] = [galaxy, mesh, minimal];

const warmOf = new Color();
/**
 * Sets `color` to a node's by its warmth: its hue, leaning `lean` of the way to the warm colour when touched
 * today, set to a brightness, not left as bright as the hue happens to be. Bloom picks pixels by brightness: a cold node is at
 * `ember` (linear luminance, as the bloom pass weighs it), so every cluster's ember clears the threshold alike, and a node
 * touched today is at `peak`. A hue too dark to reach it stops at its brightest unclipped shade, so it never turns white.
 */
export function burn(color: Color, hue: string, warmth: number, { palette, recency }: Style) {
  color.set(hue).lerp(warmOf.set(palette.warm), recency.lean * warmth);
  const luma = 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b, top = Math.max(color.r, color.g, color.b, 1e-6);
  return color.multiplyScalar(Math.min((recency.ember + (recency.peak - recency.ember) * warmth) / Math.max(luma, 1e-6), 1 / top));
}

/** A style may ask for fewer mesh points, never more: 400 points is 80,000 pair checks a frame. */
export const MESH_MAX = 400;
const UNIT: [number, number] = [0, 1];
/** The range a number must be in, by its key; any other number is 0 or more. */
const RANGES: Record<string, [number, number]> = {
  'bloom.radius': UNIT, 'bloom.threshold': UNIT, 'bloom.resolution': [0.05, 1], 'links.tree': UNIT, 'links.cross': UNIT, 'links.lit': UNIT,
  'links.dim': UNIT, 'links.particles': [0, 8], 'links.particleSpeed': UNIT, 'mesh.lineOpacity': UNIT, 'physics.charge': [-Infinity, 0],
  'physics.cluster': UNIT, 'physics.anchor': UNIT, 'recency.halfLifeDays': [0.01, Infinity], 'recency.ember': UNIT, 'recency.peak': UNIT,
  'recency.lean': UNIT, dim: UNIT, exposure: [0, 4],
};
/** The numbers that count things. */
const WHOLE = new Set(['links.particles', 'mesh.count']);
/** The words a setting may be, by its key; any other text setting is a colour, `#rgb` or `#rrggbb`. */
const CHOICES: Record<string, string[]> = {
  'nodes.shape': ['sphere', 'ring', 'sprite'], 'nodes.metric': ['items', 'weight', 'recency'], 'mesh.cursor': ['repel', 'grab'],
};
const COLOUR = /^#([\da-f]{3}|[\da-f]{6})$/i;

/** Why `v` cannot stand where the base has `was`, at `key`, in a few words; nothing when it can. */
function fault(key: string, v: unknown, was: unknown): string | undefined {
  if (isObject(was)) return 'is not a group of settings';
  if (Array.isArray(was)) {
    const any = key === 'palette.clusters', kind = typeof was[0] === 'number' ? 'numbers' : 'colours'; // the clusters' colours: as many as you like
    const fits = Array.isArray(v) && v.length > 0 && (any || v.length === was.length) && v.every((x) => !fault(key, x, was[0]));
    return fits ? undefined : `is not a list of ${any ? '' : `${was.length} `}${kind}`;
  }
  if (typeof was === 'boolean') return typeof v === 'boolean' ? undefined : 'is not true or false';
  const choices = CHOICES[key];
  if (choices) return choices.includes(v as string) ? undefined : `is not ${choices.slice(0, -1).join(', ')} or ${choices.at(-1)}`;
  if (typeof was === 'string') return typeof v === 'string' && COLOUR.test(v) ? undefined : 'is not a colour';
  if (typeof v !== 'number' || !Number.isFinite(v)) return 'is not a number';
  const [min, max] = RANGES[key] ?? [0, Infinity];
  return v < min ? `is below ${min}` : v > max ? `is above ${max}` : WHOLE.has(key) && !Number.isInteger(v) ? 'is not a whole number' : undefined;
}

/**
 * A user style (`raw`, as its file holds it) as a whole style: each setting it leaves out is `base`'s. A key the app does not
 * know is left out, and `dropped` names it ("bloom.glitter"). A value of the wrong kind or out of range is `base`'s too, and
 * `problems` says why, by its key ("bloom.strength is not a number").
 */
export function checkStyle(raw: UserStyle, base: Style): { style: Style; problems: string[]; dropped: string[] } {
  const problems: string[] = [], dropped: string[] = [];
  const walk = (value: Record<string, unknown>, like: Record<string, unknown>, path: string): Record<string, unknown> => {
    for (const k of Object.keys(value)) if (!Object.hasOwn(like, k)) dropped.push(path + k);
    return Object.fromEntries(Object.entries(like).map(([k, was]) => {
      const v = value[k], key = path + k, why = v === undefined || key === 'name' || (isObject(was) && isObject(v)) ? undefined : fault(key, v, was);
      if (why) problems.push(`${key} ${why}`);
      return [k, v === undefined || why ? was : isObject(was) ? walk(v as Record<string, unknown>, was, `${key}.`) : v];
    }));
  };
  const style = walk(raw, base, '') as Style;
  style.mesh = { ...style.mesh, count: Math.min(style.mesh.count, MESH_MAX) }; // a new group: an unset one is the base's own
  return { style, problems, dropped };
}

/**
 * The styles to pick from, with your own (`users`, as their files hold them): the presets, each replaced by your style of its
 * name, checked against it; then your new names in order, checked against galaxy. One line a style that had a problem;
 * a console warning a key dropped.
 */
export function stylesFrom(users: UserStyle[]): { styles: Style[]; problems: string[] } {
  const problems: string[] = [];
  const checked = users.map((raw) => {
    const base = PRESETS.find((p) => p.name === raw.name) ?? PRESETS[0], { style, problems: wrong, dropped } = checkStyle(raw, base);
    dropped.forEach((key) => console.warn(`${raw.name}: no setting "${key}"; left out`));
    if (wrong.length) problems.push(`${raw.name}: ${wrong.join(', ')}; using ${base.name}'s`);
    return style;
  });
  const own = (name: string) => checked.find((s) => s.name === name);
  return { styles: [...PRESETS.map((p) => own(p.name) ?? p), ...checked.filter((s) => !PRESETS.some((p) => p.name === s.name))], problems };
}
