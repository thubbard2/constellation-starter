// @vitest-environment happy-dom
// The render seam, part 2: the look panel. Each control changes the style setting it names, and the scene gets the new style.
import { afterEach, describe, expect, it } from 'vitest';
import { createPanel, type Panel } from '../src/panel';
import { PRESETS, type Style } from '../src/scene/style';

/** The value at `path` in `style` (`bloom.strength`). */
const at = (style: Style, path: string) => path.split('.').reduce<any>((v, key) => v[key], style);
/** `style` with `value` at `path`. */
function withValue(style: Style, path: string, value: unknown) {
  const copy: any = structuredClone(style), keys = path.split('.'), last = keys.pop()!;
  keys.reduce((v, key) => v[key], copy)[last] = value;
  return copy as Style;
}
/** For each choice control, two of its choices (`CHOICES` in `src/scene/style.ts`): one differs from the setting now. */
const CHOICES: Record<string, string[]> = {
  'nodes.shape': ['sphere', 'ring'], 'nodes.metric': ['items', 'weight'], 'mesh.cursor': ['repel', 'grab'],
};
/** A value for the setting at `path` that differs from `now`: the other boolean, another choice, another colour, or another number. */
function another(path: string, now: unknown) {
  if (typeof now === 'boolean') return !now;
  if (CHOICES[path]) return CHOICES[path].find((c) => c !== now);
  if (typeof now === 'string') return now === '#123456' ? '#654321' : '#123456';
  return (now as number) + 1;
}

let panel: Panel | undefined;
afterEach(() => panel?.dispose());

describe('the look panel', () => {
  it('has controls for bloom, exposure, links, particles, the mesh and physics', () => {
    panel = createPanel(() => {});
    const paths = [...panel.controls.keys()];
    for (const path of ['bloom.on', 'bloom.strength', 'exposure', 'links.cross', 'links.particles', 'links.particleSpeed', 'mesh.on', 'mesh.count', 'physics.charge']) {
      expect(paths).toContain(path);
    }
  });

  it('each control changes the style setting it names, and only that one', () => {
    const seen: Style[] = [];
    panel = createPanel((style) => seen.push(style));
    for (const [path, control] of panel.controls) {
      const before = seen.at(-1) ?? PRESETS[0];
      const next = another(path, control.getValue());
      control.setValue(next);
      expect(at(seen.at(-1)!, path), path).toEqual(next);
      expect(seen.at(-1), path).toEqual(withValue(before, path, next));
    }
  });

  it('puts in every setting of the preset picked', () => {
    const seen: Style[] = [];
    panel = createPanel((style) => seen.push(style));
    panel.controls.get('bloom.strength')!.setValue(2.5);
    panel.gui.controllers.find((c) => c.property === 'style')!.setValue('minimal');
    expect(seen.at(-1)).toEqual(PRESETS.find((p) => p.name === 'minimal'));
    expect(panel.controls.get('bloom.strength')!.getValue()).toBe(0);
  });

  it('copies the style as a style file holds it', async () => {
    let copied = '';
    panel = createPanel(() => {}, async (text) => void (copied = text));
    panel.controls.get('links.particles')!.setValue(5);
    panel.gui.controllers.find((c) => c.property === 'Copy JSON')!.domElement.querySelector('button')!.click();
    expect(JSON.parse(copied)).toEqual({ ...PRESETS[0], links: { ...PRESETS[0].links, particles: 5 } });
  });
});
