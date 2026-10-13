import { chooseLabels, labelAt, type LabelBox, type Screen } from '../model/labels';
import type { NodeKind } from '../model/types';
import { CanvasTexture, Sprite, SpriteMaterial, Vector3, type PerspectiveCamera, type Scene } from 'three';

/** A label's height as a share of the view at distance 1 (`sizeAttenuation: false`): the same size on screen, near or far. Times its `size`. */
const HEIGHT = 0.026;
/** Drawn with the page's own font (the system sans stack), at this many pixels, light on a soft dark shadow. */
const FONT_PX = 44;
const FONT = `600 ${FONT_PX}px ui-sans-serif, system-ui, sans-serif`;
/** A name's canvas: its text's width plus this much each side, and this tall. */
const PAD = 12;
const TALL = Math.ceil(FONT_PX * 1.6);
/** Where a name stands on its anchor (`Sprite.center`): its bottom a little above it, so it sits on its star's top edge. */
const CENTER = { x: 0.5, y: -0.35 };
/** A name fades in or out over this many ms (so a name never pops). */
export const FADE_MS = 200;
/** A fade steps at most this many ms a frame: the first frame after the scene slept does not jump to the end. */
const MAX_STEP_MS = 50;
/** A name can be pressed or hovered once it has faded in this far: one still too faint to see is not under the pointer. */
const SOLID = 0.5;

/** A name that may show: its star's id, its text, its size (`labelSize`), its star's kind, and its `priority` in `chooseLabels`. */
export interface Name { id: string; text: string; size: number; kind: NodeKind; priority?: LabelBox['priority'] }
/** Where a star's name stands (its star's top edge, as seen), or none when the star is gone. */
export type Anchor = (id: string) => Vector3 | undefined;

export interface Labels {
  /**
   * Picks the names that show among `names` (`chooseLabels`: room on screen, the zoom band, nearest first) from where the stars
   * are now, seen from `camera` on a `view` this big (CSS px): those fade in, the rest fade out. Not every frame: on a settle,
   * or every few frames while things move (too slow for every frame).
   */
  choose(names: Name[], at: Anchor, camera: PerspectiveCamera, view: Screen): void;
  /** Each frame: puts each drawn name at its star and steps its fade (`now`, ms). True while a name still fades. */
  place(at: Anchor, camera: PerspectiveCamera, view: Screen, now: number): boolean;
  /** The star whose shown name is under (x, y), CSS px on the canvas, once it has faded in half way; none when no such name is there. */
  at(x: number, y: number): string | undefined;
  dispose(): void;
}

/** Text sprites: one canvas each, drawn when a name first shows and dropped once it has faded out; over the glow, never picked by the ray. */
export function createLabels(scene: Scene): Labels {
  /** Each drawn name: its text, size, kind and sprite, whether it should show, and how far it has faded in (0…1). */
  const drawn = new Map<string, Name & { sprite: Sprite; showing: boolean; alpha: number }>();
  /** The shown names' boxes as last placed, for `at`. */
  let boxes: LabelBox[] = [];
  let last = 0;
  const ndc = new Vector3();
  const pen = document.createElement('canvas').getContext('2d');
  const widths = new Map<string, number>();
  /** A name's canvas width for `text`, measured once. */
  const widthOf = (text: string) => {
    if (!widths.has(text) && pen) (pen.font = FONT), widths.set(text, Math.ceil(pen.measureText(text).width) + 2 * PAD);
    return widths.get(text) ?? TALL;
  };
  const draw = (text: string) => {
    const canvas = Object.assign(document.createElement('canvas'), { width: widthOf(text), height: TALL });
    const ink = canvas.getContext('2d')!;
    Object.assign(ink, { font: FONT, fillStyle: '#e2e8f0', shadowColor: '#000', shadowBlur: 10, textBaseline: 'middle' });
    ink.fillText(text, PAD, TALL / 2);
    const sprite = new Sprite(new SpriteMaterial({ map: new CanvasTexture(canvas), depthTest: false, sizeAttenuation: false, transparent: true, opacity: 0 }));
    sprite.center.set(CENTER.x, CENTER.y);
    sprite.renderOrder = 1;
    return sprite;
  };
  const drop = (id: string) => {
    const { sprite } = drawn.get(id)!;
    scene.remove(sprite);
    sprite.material.map?.dispose();
    sprite.material.dispose();
    drawn.delete(id);
  };
  /**
   * The box (CSS px, top left and size) of a name `size` tall reading `text`, anchored at `p`, and its depth; none behind the
   * camera. A `sizeAttenuation: false` sprite is `HEIGHT × size / tan(fov / 2)` of the view's height tall, at any distance.
   */
  const boxOf = (name: Name, p: Vector3, camera: PerspectiveCamera, view: Screen) => {
    ndc.copy(p).project(camera);
    if (ndc.z > 1) return undefined;
    const h = ((HEIGHT * name.size) / Math.tan((camera.fov * Math.PI) / 360)) * (view.height / 2);
    const w = (h * widthOf(name.text)) / TALL;
    const [x, y] = [(ndc.x + 1) * (view.width / 2), (1 - ndc.y) * (view.height / 2)];
    return { id: name.id, kind: name.kind, depth: p.distanceTo(camera.position), priority: name.priority, x: x - w * CENTER.x, y: y + h * CENTER.y - h, w, h };
  };
  return {
    choose(names, at, camera, view) {
      camera.updateMatrixWorld();
      const candidates = names.flatMap((name) => {
        const p = at(name.id);
        const box = p && boxOf(name, p, camera, view);
        return box ? [box] : [];
      });
      const showing = new Set([...drawn.values()].filter((l) => l.showing).map((l) => l.id));
      const show = new Set(chooseLabels(candidates, view, showing));
      const byId = new Map(names.map((n) => [n.id, n]));
      for (const [id, label] of drawn) {
        const name = byId.get(id);
        if (name && name.text !== label.text) drop(id); // drawn again below with its new text
        else label.showing = show.has(id);
      }
      for (const id of show) {
        const { text, size, kind } = byId.get(id)!;
        if (!drawn.has(id)) drawn.set(id, { id, text, size, kind, sprite: draw(text), showing: true, alpha: 0 }), scene.add(drawn.get(id)!.sprite);
        const label = Object.assign(drawn.get(id)!, { size, kind });
        label.sprite.scale.set((HEIGHT * size * widthOf(text)) / TALL, HEIGHT * size, 1);
      }
    },
    place(at, camera, view, now) {
      const step = Math.min(last ? now - last : 16, MAX_STEP_MS) / FADE_MS; // a frame after a pause steps as one frame, so nothing pops
      last = now;
      let fading = false;
      boxes = [];
      for (const [id, label] of drawn) {
        const p = at(id);
        label.alpha = p ? Math.min(1, Math.max(0, label.alpha + (label.showing ? step : -step))) : 0;
        if (label.alpha === 0 && !label.showing) {
          drop(id);
          continue;
        }
        fading ||= label.alpha < 1;
        const { sprite } = label;
        sprite.material.opacity = label.alpha;
        sprite.visible = !!p && label.alpha > 0;
        if (!p) continue;
        sprite.position.copy(p);
        const box = label.showing && label.alpha >= SOLID && boxOf(label, p, camera, view);
        if (box) boxes.push(box);
      }
      return fading;
    },
    at: (x, y) => labelAt(boxes, x, y),
    dispose() {
      [...drawn.keys()].forEach(drop);
    },
  };
}
