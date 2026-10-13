// The render seam, part 1: the camera's tween (it replaces gsap), on a clock the test turns by hand.
import { describe, expect, it } from 'vitest';
import { tween, type Clock } from '../src/tween';

/** A clock whose frames run only when `next` says so, `ms` after the one before. */
function handClock() {
  let time = 0, ids = 0;
  const waiting = new Map<number, () => void>();
  const clock: Clock = { now: () => time, frame: (step) => (waiting.set(++ids, step), ids), cancel: (id) => waiting.delete(id) };
  const next = (ms: number) => {
    time += ms;
    const steps = [...waiting.values()];
    waiting.clear();
    steps.forEach((step) => step());
  };
  return { clock, next, pending: () => waiting.size };
}

describe('tween', () => {
  it('starts on the next frame, at 0', () => {
    const { clock, next } = handClock(), seen: number[] = [];
    tween(0.8, (t) => seen.push(t), clock);
    expect(seen).toEqual([]);
    next(0);
    expect(seen).toEqual([0]);
  });

  it('eases in and out, and ends at exactly 1, then asks for no more frames', () => {
    const { clock, next, pending } = handClock(), seen: number[] = [];
    tween(0.8, (t) => seen.push(t), clock);
    for (let i = 0; i < 6; i++) next(200);
    expect(seen.slice(0, 4)).toEqual([0.125, 0.5, 0.875, 1]);
    expect(seen).toHaveLength(4);
    expect(pending()).toBe(0);
  });

  it('stops where it is when cancelled', () => {
    const { clock, next, pending } = handClock(), seen: number[] = [];
    const flight = tween(0.8, (t) => seen.push(t), clock);
    next(200);
    flight.cancel();
    next(200);
    expect(seen).toEqual([0.125]);
    expect(pending()).toBe(0);
  });

  it('jumps to the end when finished, once', () => {
    const { clock, next } = handClock(), seen: number[] = [];
    const flight = tween(0.8, (t) => seen.push(t), clock);
    next(200);
    flight.finish();
    flight.finish();
    next(200);
    expect(seen).toEqual([0.125, 1]);
  });
});
