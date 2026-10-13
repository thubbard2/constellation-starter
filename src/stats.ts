import { BUDGET_MS, p95 } from './scene/ladder';

/** The overlay judges the last this many frames the scene drew back to back, and writes itself again every `EVERY`. */
const WINDOW = 120;
const EVERY = 15;

/**
 * The `?stats` overlay (bottom right): the 95th-percentile time between frames the scene drew back to back, over the last
 * `WINDOW` of them, in ms, and the frame rate it means. The budget is the speed ladder's (`BUDGET_MS`). A frame after a pause
 * (the scene went idle) is not counted, so idle time never reads as slow. Feed it each frame drawn: `frame(now, asked)`.
 */
export function createStats(host: HTMLElement) {
  const box = host.appendChild(document.createElement('pre'));
  Object.assign(box.style, {
    position: 'fixed', right: '16px', bottom: '12px', margin: '0', padding: '6px 10px', borderRadius: '6px', pointerEvents: 'none',
    font: '12px/1.4 ui-monospace, monospace', color: '#e2e8f0', background: 'rgb(15 23 42 / 0.8)',
  });
  box.textContent = 'p95 …';
  const times: number[] = [];
  let last: number | undefined, since = 0;
  return {
    frame(now: number, asked: boolean) {
      if (asked && last !== undefined) times.push(now - last), times.length > WINDOW && times.shift();
      last = now;
      if (++since < EVERY || !times.length) return;
      since = 0;
      const ms = p95([...times]);
      box.textContent = `p95 ${ms.toFixed(1)} ms (${Math.round(1000 / ms)} fps) · ${times.length} frames${ms > BUDGET_MS ? ' · over budget' : ''}`;
    },
  };
}
