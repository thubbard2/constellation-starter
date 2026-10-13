/** The frames and the time a tween runs on: the browser's by default; a test passes its own. */
export interface Clock { now(): number; frame(step: () => void): number; cancel(id: number): void }
const BROWSER: Clock = { now: () => performance.now(), frame: (step) => requestAnimationFrame(step), cancel: (id) => cancelAnimationFrame(id) };

/** A tween under way: `finish` jumps to the end (one last `update(1)`), `cancel` stops where it is. */
export interface Tween { finish(): void; cancel(): void }

/** Slow at both ends (gsap calls it `power2.inOut`). */
export const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/** Calls `update` once a frame with t going from 0 to 1 over `seconds`, eased; the last call is `update(1)`. */
export function tween(seconds: number, update: (t: number) => void, clock: Clock = BROWSER): Tween {
  const start = clock.now();
  let id = 0, running = true;
  const step = () => {
    const t = Math.min(1, (clock.now() - start) / (seconds * 1000));
    update(easeInOut(t));
    if (t < 1) id = clock.frame(step);
    else running = false;
  };
  id = clock.frame(step);
  const cancel = () => ((running = false), clock.cancel(id));
  return { cancel, finish: () => running && (cancel(), update(1)) };
}
