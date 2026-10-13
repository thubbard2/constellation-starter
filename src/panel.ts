import GUI, { type Controller } from 'lil-gui';
import { PRESETS, type Style } from './scene/style';

/** The look panel: the lil-gui, and each control by the style setting it names (`bloom.strength`). */
export interface Panel { gui: GUI; controls: Map<string, Controller>; dispose(): void }

/** Each folder's controls: the setting (a path into the style), and its range and step, or its choices. */
const FOLDERS: Record<string, [path: string, ...range: (number | string[])[]][]> = {
  Bloom: [['bloom.on'], ['bloom.strength', 0, 3, 0.01], ['bloom.radius', 0, 1, 0.01], ['bloom.threshold', 0, 1, 0.01], ['bloom.resolution', 0.05, 1, 0.05]],
  Links: [['links.tree', 0, 1, 0.01], ['links.cross', 0, 1, 0.01], ['links.lit', 0, 1, 0.01], ['links.dim', 0, 1, 0.01], ['links.width', 0, 3, 0.1]],
  Particles: [['links.particles', 0, 8, 1], ['links.particleSpeed', 0, 0.03, 0.001], ['links.particleWidth', 0, 4, 0.1]],
  Nodes: [['nodes.shape', ['sphere', 'ring', 'sprite']], ['nodes.metric', ['items', 'weight', 'recency']], ['nodes.minSize', 0, 10, 0.5], ['nodes.maxSize', 1, 30, 0.5]],
  Mesh: [
    ['mesh.on'], ['mesh.count', 0, 400, 1], ['mesh.drift', 0, 1, 0.01], ['mesh.linkDistance', 0, 400, 1], ['mesh.lineOpacity', 0, 1, 0.01],
    ['mesh.reach', 0, 400, 1], ['mesh.cursor', ['repel', 'grab']], ['mesh.color'], ['mesh.size', 0, 20, 0.5],
  ],
  Physics: [['physics.charge', -300, 0, 1], ['physics.linkDistance', 5, 100, 1], ['physics.cluster', 0, 0.5, 0.01], ['physics.anchor', 0, 0.2, 0.005]],
};

/** The object a setting's path lives in, and its key there: `bloom.strength` is `style.bloom` and `strength`. */
const slot = (style: Style, path: string): [Record<string, unknown>, string] => {
  const keys = path.split('.');
  const last = keys.pop()!;
  return [keys.reduce((at, key) => at[key] as Record<string, unknown>, style as unknown as Record<string, unknown>), last];
};

/**
 * The look panel (lil-gui, top right): a style picker, exposure, then a folder each for bloom, links, particles, nodes, the mesh
 * and the physics. Each control changes the style setting it names; then `onChange` gets a copy of the whole style. Picking a
 * preset puts all its settings in. Copy JSON hands `copy` the style as a style file holds it (the clipboard, by default).
 */
export function createPanel(onChange: (style: Style) => void, copy = (text: string) => navigator.clipboard.writeText(text)): Panel {
  const style = structuredClone(PRESETS[0]) as Style;
  const gui = new GUI({ title: 'Look' });
  const controls = new Map<string, Controller>();
  const pick = { style: style.name };
  const changed = () => onChange(structuredClone(style));
  const add = (folder: GUI, path: string, ...range: (number | string[])[]) => {
    const [object, key] = slot(style, path);
    const control = typeof object[key] === 'string' && !range.length ? folder.addColor(object, key) : folder.add(object, key, ...(range as [number, number, number]));
    controls.set(path, control);
  };

  gui.add(pick, 'style', PRESETS.map((p) => p.name)).onChange((name: string) => {
    const preset = structuredClone(PRESETS.find((p) => p.name === name)!) as unknown as Record<string, unknown>;
    const into = style as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(preset)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) Object.assign(into[key] as object, value); // the controls hold these objects
      else into[key] = value;
    }
    gui.controllersRecursive().forEach((c) => c.updateDisplay());
    changed();
  });
  add(gui, 'exposure', 0, 3, 0.01);
  for (const [title, settings] of Object.entries(FOLDERS)) {
    const folder = gui.addFolder(title);
    settings.forEach(([path, ...range]) => add(folder, path, ...range));
    if (title !== 'Bloom') folder.close();
  }
  gui.add({ 'Copy JSON': () => copy(`${JSON.stringify(style, null, 2)}\n`) }, 'Copy JSON');
  // A setting changed. Not the picker: lil-gui tells the panel before the picker has put the preset in, so it tells its own.
  gui.onChange(({ property }) => property !== 'style' && property !== 'Copy JSON' && changed());
  return { gui, controls, dispose: () => gui.destroy() };
}
