import { PRESETS, type Style } from './style';

/** The ladder judges the frames of this much drawing (ms) at a time: a window. */
export const WINDOW_MS = 3000;
/** A window whose 95th-percentile frame time (ms) is over this steps down: the budget is p95 < 20 ms. */
export const BUDGET_MS = 20;
/** The rungs, as the page's note names each: rung `n` has done the first `n`. */
export const SPEED_NOTES = ['Lowered bloom for speed', 'Halved the mesh for speed', 'Link particles off for speed', 'Switched to minimal for speed'];

/** The bloom's resolution on the first rung (0.5 → 0.25). */
const LOW_BLOOM = 0.25;
const MINIMAL = PRESETS.find((s) => s.name === 'minimal')!;
/** The last rung: the switch to the `minimal` preset. */
const MINIMAL_RUNG = SPEED_NOTES.length;

/**
 * The rung after you pick a look yourself (another style, or the mesh on or off): the switch to minimal is undone, as you asked
 * for that look; the cheaper rungs above it hold. The ladder may step down again later, if the frames stay slow.
 */
export const afterPick = (rung: number) => Math.min(rung, MINIMAL_RUNG - 1);

/**
 * `style` drawn at `rung`, each rung cheaper than the one above: (1) bloom worked out at a quarter of the screen, (2) half the
 * mesh's points, (3) no link particles, (4) the `minimal` preset. The last keeps `style`'s physics, so no star moves for speed.
 * A rung that has nothing to cut in `style` (bloom off, no mesh, no particles) leaves it as it is.
 */
export function slowed(style: Style, rung: number): Style {
  if (rung >= MINIMAL_RUNG) return { ...MINIMAL, physics: style.physics };
  const { bloom, mesh, links } = style;
  return {
    ...style,
    bloom: rung >= 1 && bloom.on ? { ...bloom, resolution: Math.min(bloom.resolution, LOW_BLOOM) } : bloom,
    mesh: rung >= 2 && mesh.on ? { ...mesh, count: Math.floor(mesh.count / 2) } : mesh,
    links: rung >= 3 ? { ...links, particles: 0 } : links,
  };
}

/**
 * Where a mounting scene's ladder starts (the page keeps the rung for the session), who hears each step down (the page, for its
 * note), and who hears each frame drawn, as the ladder does (the `?stats` overlay).
 */
export interface Speed { rung: number; onStep(rung: number): void; onFrame?(at: number, asked: boolean): void }

/** The speed ladder: fed each frame the scene draws, it steps the look down when too slow. */
export interface Ladder {
  /** The rung it stands on: 0 is the style as picked. */
  readonly rung: number;
  /**
   * A frame drawn at `at` (ms, `performance.now()`) in `style`, the style as picked; `asked` when the frame before asked for
   * it (the scene draws on), so the time between them is this frame's. The new rung, when this frame steps down.
   */
  frame(at: number, style: Style, asked: boolean): number | undefined;
}

/** The 95th-percentile of `times`. It sorts `times` in place: pass a copy to keep the order. */
export const p95 = (times: number[]) => times.sort((a, b) => a - b)[Math.ceil(times.length * 0.95) - 1]!;

/** The first rung below `rung` that draws `style` differently from it; none when no rung left changes anything. */
function below(style: Style, rung: number) {
  const now = JSON.stringify(slowed(style, rung));
  for (let next = rung + 1; next <= MINIMAL_RUNG; next++) if (JSON.stringify(slowed(style, next)) !== now) return next;
}

/**
 * A ladder standing on `rung`. Frames count only while the scene draws back to back: a frame the one before did not ask for
 * follows a pause (the scene idle, not slow), however long, and is not counted; nor is the first, asked for or not, which only
 * starts the clock (the scene makes a new ladder as a look is picked, and draws on). Each `WINDOW_MS` of them, a p95 over
 * `BUDGET_MS` steps down to the next rung that changes the picked style; then a new window starts. It never steps back up:
 * the page keeps the rung for the session.
 */
export function createLadder(rung = 0): Ladder {
  let last: number | undefined, spent = 0, times: number[] = [];
  return {
    get rung() {
      return rung;
    },
    frame(at, style, asked) {
      const time = at - (last ?? at), first = last === undefined;
      last = at;
      if (!asked || first) return;
      times.push(time);
      if ((spent += time) < WINDOW_MS) return;
      const slow = p95(times) > BUDGET_MS;
      (times = []), (spent = 0);
      const next = slow ? below(style, rung) : undefined;
      if (next !== undefined) return (rung = next);
    },
  };
}
