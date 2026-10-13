/** Render on demand: the map draws only on the frame after something moved, never on a loop. */
export interface Frames {
  /** Something moved: draw once on the next animation frame (however many invalidations came in). */
  invalidate(): void;
  /** Stop for good: drop the pending frame and stop listening. */
  dispose(): void;
}

/**
 * One pending frame at most. While the page is hidden nothing is drawn: the pending frame is
 * dropped and invalidations are ignored; when it shows again the map draws once. `draw` hears whether
 * the frame before asked for this one (it invalidated while it drew, and the page was not hidden since):
 * the scene drawing on, not waking from a pause.
 */
export function createFrames(draw: (asked: boolean) => void): Frames {
  let pending = 0;
  let disposed = false;
  let drawing = false;
  let asked = false;
  const drop = () => {
    cancelAnimationFrame(pending);
    pending = 0;
  };
  const invalidate = () => {
    if (disposed || pending || document.visibilityState === 'hidden') return;
    asked = drawing;
    pending = requestAnimationFrame(() => {
      pending = 0;
      drawing = true;
      try {
        draw(asked);
      } finally {
        drawing = false;
      }
    });
  };
  const onVisibility = () => (document.visibilityState === 'hidden' ? drop() : invalidate());
  document.addEventListener('visibilitychange', onVisibility);
  return {
    invalidate,
    dispose() {
      disposed = true;
      drop();
      document.removeEventListener('visibilitychange', onVisibility);
    },
  };
}
