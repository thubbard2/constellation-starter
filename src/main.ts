import clusters from '../data/clusters.json';
import { loadClusters } from './data';
import { createPanel } from './panel';
import { createConstellationScene } from './scene';
import { afterPick, SPEED_NOTES } from './scene/ladder';
import { PRESETS } from './scene/style';
import { createStats } from './stats';

const host = document.querySelector<HTMLElement>('#map')!;
const note = document.querySelector<HTMLElement>('#note')!;
/** Says something over the map, in plain words: a problem in the data, no GPU, a step down for speed. */
const say = (text: string) => (note.textContent = text);

/**
 * The page: the map from `data/clusters.json`, drawn in the first style. A click on a star focuses it (the camera flies there);
 * Esc or `h` goes back to the whole map; `e` opens the focus (its children spread out and show their names); `u` lets go of
 * the pinned star under the pointer. The look panel restyles it live. `?focus=<name>` starts on that node; `?stats` shows the
 * frame times.
 */
function start() {
  const state = loadClusters(clusters);
  const params = new URLSearchParams(location.search), asked = params.get('focus');
  const stats = params.has('stats') ? createStats(document.body) : undefined;
  let rung = 0;
  let focus = Object.values(state.nodes).find((n) => n.label === asked)?.id ?? state.rootId, open = false;
  /** Focuses `id`: the camera flies to it and its children; an opened node closes. */
  const select = (id: string) => ((focus = id), open && ((open = false), scene.expand(null)), scene.show(state, id));
  const scene = createConstellationScene(
    host,
    select,
    () => say('No hardware-accelerated WebGL2 here, so the map cannot draw. Turn on hardware acceleration in the browser settings, or try another browser.'),
    () => {},
    PRESETS[0],
    { rung, onStep: (step) => ((rung = step), say(`${SPEED_NOTES[step - 1]} (frames were slow).`)), onFrame: stats?.frame },
  );
  createPanel((style) => scene.setStyle(style, (rung = afterPick(rung))));
  if (asked && focus === state.rootId) say(`No node is named "${asked}": showing the whole map.`);
  scene.show(state, focus);
  if (focus === state.rootId) scene.home(); // frame every star, not just the clusters' hubs
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.key === 'Escape' || e.key === 'h') select(state.rootId), scene.home();
    else if (e.key === 'e') (open = !open), scene.expand(open ? focus : null);
    else if (e.key === 'u') scene.unpinHovered();
  });
  return scene;
}

try {
  start();
} catch (error) {
  say(error instanceof Error ? error.message : String(error));
  throw error;
}
