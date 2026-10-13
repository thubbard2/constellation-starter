/** A press that moves less than this, in px, is a click; more is a drag (on a star or its name) or an orbit (anywhere else). */
export const CLICK_PX = 5;

/** What the constellation does with the pointer (`attachPress`): it finds a star at a point and acts on what a press means. */
export interface Grip {
  /** The star at (x, y), CSS px on the canvas: the one whose shown name is there (names are drawn on top), else the one under it. */
  pick(x: number, y: number): string | undefined;
  /** A press holds a star (true), so the orbit controls must be off; it let go (false), so they are on again. */
  holding(on: boolean): void;
  /** The pointer, pressing nothing, is over this star; none: over no star, or orbiting. */
  hover(id: string | undefined): void;
  /** The held star follows the pointer to (x, y); the press began at `from`. */
  drag(id: string, x: number, y: number, from: readonly [number, number]): void;
  /** A short press on a star: it is a click (focus). */
  click(id: string): void;
  /** A drag let go: the star is pinned where it is. */
  drop(id: string): void;
}

/**
 * The pointer on the constellation's `canvas`. A main-button press on a star or its shown
 * name holds that star: heard before the orbit controls (capture), so no orbit starts. Past `CLICK_PX` it drags the star; let go, a
 * drag pins it and a short press is a click; a cancelled press that never moved is nothing. Only the pointer that grabbed counts:
 * another pointer's press, moves and release leave the held star alone, and the controls come back on that one pointer's release or
 * cancel, whatever it was. The other buttons pan and dolly. Returns the detach.
 */
export function attachPress(canvas: HTMLElement, grip: Grip): () => void {
  let held: { pointer: number; id: string; from: readonly [number, number]; dragging: boolean } | null = null;
  const local = (e: PointerEvent) => {
    const box = canvas.getBoundingClientRect();
    return [e.clientX - box.left, e.clientY - box.top] as const;
  };
  const down = (e: PointerEvent) => {
    if (held || e.button !== 0) return;
    const at = local(e), id = grip.pick(...at);
    if (!id) return;
    held = { pointer: e.pointerId, id, from: at, dragging: false };
    grip.holding(true);
    canvas.setPointerCapture?.(e.pointerId);
  };
  const move = (e: PointerEvent) => {
    const at = local(e);
    if (!held) return grip.hover(e.buttons ? undefined : grip.pick(...at)); // an orbit or a pan hovers nothing
    if (e.pointerId !== held.pointer) return;
    held.dragging ||= Math.hypot(at[0] - held.from[0], at[1] - held.from[1]) >= CLICK_PX;
    if (held.dragging) grip.drag(held.id, ...at, held.from);
  };
  const up = (e: PointerEvent) => {
    if (!held || e.pointerId !== held.pointer) return;
    const { id, dragging } = held;
    held = null;
    grip.holding(false);
    if (dragging) grip.drop(id);
    else if (e.type === 'pointerup') grip.click(id);
  };
  canvas.addEventListener('pointerdown', down, { capture: true });
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  return () => {
    canvas.removeEventListener('pointerdown', down, { capture: true });
    canvas.removeEventListener('pointermove', move);
    canvas.removeEventListener('pointerup', up);
    canvas.removeEventListener('pointercancel', up);
  };
}
