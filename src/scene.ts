import { constellation, CORE, DRAG, layoutForces, type LayoutForces, type LinkKind, type StarNode, type Vec3 } from './model/constellation';
import { labelSize } from './model/labels';
import type { MapState } from './model/types';
import {
  CanvasTexture, Color, LineBasicMaterial, Matrix4, Mesh, MeshBasicMaterial, NeutralToneMapping, PerspectiveCamera, Plane, PlaneGeometry, Raycaster, RingGeometry, Scene,
  Sphere, SphereGeometry, SRGBColorSpace, Vector2, Vector3, WebGLRenderer, type BufferGeometry,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import ThreeForceGraph from 'three-forcegraph';
import { createFrames } from './scene/frames';
import { createLabels, type Anchor, type Name } from './scene/labels';
import { createLadder, slowed, type Speed } from './scene/ladder';
import { createCursorMesh, type CursorMesh } from './scene/mesh';
import { attachPress } from './scene/press';
import { burn, type Style } from './scene/style';
import { tween, type Tween } from './tween';

/** A search highlight: the matches glow (the selected one brightest), everything else dims. */
export interface Highlight { matches: string[]; selected: string | null }
/** What a page asks of a map view: draw the map around a focus, light a search (`null` clears it), and go. */
export interface MapScene { show(state: MapState, focusId: string): void; highlight(h: Highlight | null): void; destroy(): void }

/**
 * The constellation: the map view's contract, plus `home`, which frames the whole map, and `expand`, which opens a node: its
 * children show their names and spread out a little, and the rest dims a little; `null` closes it. `pins` holds pinned stars
 * where they were put, and `unpinHovered` lets go of the one under the pointer. `setStyle` draws the same map in another style,
 * at the page's speed rung. `remember` is what it was, for the next one to start from.
 */
export interface ConstellationScene extends MapScene {
  home(): void; expand(id: string | null): void; pins(at: Record<string, Vec3>): void; unpinHovered(): void; setStyle(style: Style, rung: number): void;
  remember(): Recall | undefined;
}

/**
 * What the constellation was when it unmounted: the camera's eye and target, the focus and the opened node, each star's
 * place, and the graph those places had settled for (`load`'s key; `null` while the layout still ran).
 */
export interface Recall {
  eye: Vec3; target: Vec3; focus: string | null; expanded: string | null; places: Record<string, Vec3>; settled: string | null;
}

/**
 * No context at all on a software or blocklisted GPU. Depth for the spheres. No MSAA: every pass draws
 * into the composer's own targets, so the canvas's samples would never be used.
 */
const CONTEXT: WebGLContextAttributes = {
  antialias: false, alpha: false, depth: true, stencil: false, powerPreference: 'high-performance', failIfMajorPerformanceCaveat: true,
};
/** Never more pixels than this per CSS pixel: bloom's cost grows with the pixel count. */
const MAX_PIXEL_RATIO = 1.5;
/** A camera flight's length, in seconds. */
const FLY_S = 0.8;
/** The camera holds at least this much space around a focus, so a node with few or near children does not fill the screen. */
const MIN_REACH = 160;
/** The layout stops after this many ticks: a count, not a time, so the same map settles the same way on any machine. */
const COOL_TICKS = 300;
/** A pinned star's ring, in its star's hue: its inner and outer radius as a share of the star's, and its opacity. Faint, so it never blooms white. */
const RING = { inner: 1.5, outer: 1.85, opacity: 0.35 };
/** With no input or map update for this long, the scene stops drawing and the GPU idles; any input wakes it. */
const IDLE_MS = 20_000;
/** The highlight's node pulses this slowly (seconds a beat), its brightness between `low` and full. */
const PULSE = { s: 2.4, low: 0.55 };
/** An opened node's links to its children grow `spread` times as long; what is not it or a child fades to `dim` (a little). */
const EXPAND = { spread: 1.8, dim: 0.45 };
/** The arrow to an off-screen highlight: how far in from the screen's edge it stands, and its length and width, in px. */
const ARROW = { inset: 28, long: 32, wide: 36 };
/**
 * While the camera or the stars move, the names are chosen again every this many frames, and once more on the first frame the
 * camera holds still (the overlap test never runs every frame).
 */
const CHOOSE_EVERY = 6;

/** A node as the layout moves it: the sim writes `x`, `y`, `z`; its shape follows. A pinned one holds `fx`, `fy`, `fz` and wears a ring. */
interface Star extends StarNode {
  mesh: Mesh<BufferGeometry, MeshBasicMaterial>; hue: string; x?: number; y?: number; z?: number; fx?: number; fy?: number; fz?: number;
  ring?: Mesh<BufferGeometry, MeshBasicMaterial>;
}
interface Line { source: string | Star; target: string | Star; kind: LinkKind; material: LineBasicMaterial }
const ends = (l: Line) => [l.source, l.target].map((end) => (typeof end === 'string' ? end : end.id));

/** A soft round dot, white in the middle and clear at the edge: a `sprite` star's look, tinted by its colour. */
function dot() {
  const canvas = Object.assign(document.createElement('canvas'), { width: 64, height: 64 });
  const pen = canvas.getContext('2d')!;
  const fill = pen.createRadialGradient(32, 32, 0, 32, 32, 32);
  [[0, 1], [0.35, 0.8], [1, 0]].forEach(([at, alpha]) => fill.addColorStop(at!, `rgba(255,255,255,${alpha})`));
  pen.fillStyle = fill;
  pen.fillRect(0, 0, 64, 64);
  return Object.assign(new CanvasTexture(canvas), { colorSpace: SRGBColorSpace });
}
/** A star's shape by the style's `nodes.shape`, each 1 in radius: a ball, a ring or a soft dot, the last two facing the camera. */
const SHAPES = { sphere: new SphereGeometry(1, 16, 12), ring: new RingGeometry(0.6, 1, 32), sprite: new PlaneGeometry(2, 2) };
const NO_SCENE: ConstellationScene = {
  show() {}, highlight() {}, destroy() {}, home() {}, expand() {}, pins() {}, unpinHovered() {}, setStyle() {}, remember: () => undefined,
};

/** The background: the palette's two colours, top to bottom, drawn once. */
function gradient([top, bottom]: readonly string[]) {
  const canvas = Object.assign(document.createElement('canvas'), { width: 2, height: 256 });
  const pen = canvas.getContext('2d')!;
  const fill = pen.createLinearGradient(0, 0, 0, canvas.height);
  fill.addColorStop(0, top!);
  fill.addColorStop(1, bottom!);
  pen.fillStyle = fill;
  pen.fillRect(0, 0, canvas.width, canvas.height);
  return Object.assign(new CanvasTexture(canvas), { colorSpace: SRGBColorSpace });
}

/**
 * The map in 3D (`constellation`), drawn in a style: a sphere per node in its cluster's hue, sized by the style's metric, in
 * one cloud per cluster (the core around the root); faint tree lines, brighter cross-links. Laid out by `three-forcegraph`'s
 * d3 engine (its ngraph engine builds code with `new Function`, which a strict content security policy blocks) with the model's
 * forces. Orbit to look around; hover lights a node's links and neighbours and dims the rest; a click focuses a node, and the
 * camera flies to each new focus. Names show where they have room and their stars are near enough (`paint`). It draws only while something
 * moves, and never while the page is hidden. `onNoGpu` fires instead of a blank screen when there is no hardware-accelerated
 * WebGL2. A star dragged (by itself or by its name) and let go is pinned there; `onPin` reports it, and an unpin (`null`). Each frame drawn feeds the speed ladder
 * from `speed.rung`: a step down draws the style cheaper from then on, and `speed.onStep` reports it. Mounted
 * with a `recall`, it starts from it: the same camera, the stars where they were, and no new settle when they had
 * settled for the same graph and pins; it flies only when the focus has moved since.
 */
export function createConstellationScene(
  host: HTMLElement, onSelect: (id: string) => void, onNoGpu: () => void, onPin: (id: string, at: Vec3 | null) => void, first: Style,
  speed: Speed, recall?: Recall,
): ConstellationScene {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('webgl2', CONTEXT);
  if (!context) return onNoGpu(), NO_SCENE;
  /** The style picked, and the one drawn: it at the ladder's rung. */
  let picked = first;
  let ladder = createLadder(speed.rung);
  let style = slowed(picked, ladder.rung);
  const renderer = new WebGLRenderer({ canvas, context });
  renderer.setPixelRatio(Math.min(devicePixelRatio, MAX_PIXEL_RATIO));
  // Highlights roll off toward white instead of clipping, so a glowing star keeps its hue.
  renderer.toneMapping = NeutralToneMapping;
  const scene = new Scene();
  const camera = new PerspectiveCamera(50, 1, 1, 20_000);
  camera.position.set(0, 0, 900);
  // Bloom turns brightness into glow. The pass works at half the size it is given: give it `resolution` × 2.
  const composer = new EffectComposer(renderer);
  const bloom = new UnrealBloomPass(new Vector2(1, 1), 0, 0, 0);
  const bloomSize = bloom.setSize.bind(bloom);
  bloom.setSize = (width, height) => bloomSize(width * style.bloom.resolution * 2, height * style.bloom.resolution * 2);
  // Names are drawn after the glow, over it, so they stay sharp: their own scene, on the same camera.
  const overlay = new Scene();
  const names = Object.assign(new RenderPass(overlay, camera), { clear: false });
  [new RenderPass(scene, camera), bloom, names, new OutputPass()].forEach((pass) => composer.addPass(pass));
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  if (recall) camera.position.fromArray(recall.eye), controls.target.fromArray(recall.target), controls.update();
  const stars = new Map<string, Star>();
  let lines: Line[] = [];
  const graph = new ThreeForceGraph<Star, Line>().forceEngine('d3').numDimensions(3).cooldownTicks(COOL_TICKS).cooldownTime(Infinity)
    .nodeThreeObject((s) => s.mesh).linkMaterial((l) => l.material).d3Force('center', null).linkDirectionalParticleColor(() => style.palette.cross);
  scene.add(graph);
  const labels = createLabels(overlay);
  /** The style's warm colour (the highlight burns in it), the soft dot a `sprite` star wears, the background, and the mesh. */
  const warm = new Color();
  const soft = dot();
  const up = new Vector3();
  let background: CanvasTexture | null = null;
  let cursorMesh: CursorMesh | null = null;
  let state: MapState | null = null;
  let shape = '';
  let focus = recall?.focus ?? null;
  let search: Highlight | null = null;
  let hover: string | undefined;
  /** The opened node (`expand`), and the layout's forces, whose link lengths it stretches. */
  let expanded = recall?.expanded ?? null;
  let forces: LayoutForces | null = null;
  /** The pins: a listed star holds its place; an id with no star (its node is gone) is skipped. */
  let pinned = new Map<string, Vec3>();
  /** One ring shape for every pinned star, facing the camera; each wears its star's hue. */
  const ringShape = new RingGeometry(RING.inner, RING.outer, 32);
  /** When the last input or map update came: the scene draws on (particles, the mesh) until it has been idle for `IDLE_MS`. */
  let awake = performance.now();
  /** The focus whose links the particles flow on now. */
  let flowing: string | null | undefined;
  let flight: Tween | null = null;
  /** The layout runs after every change to the graph, until it cools. */
  let settling = false;
  /** Ticks left of a released drag's heat (`DRAG.afterTicks`); then it cools. */
  let afterglow = 0;
  /** Every star's name, the ones that must show first (`paint`); the chooser picks among them when `rechoose`, or on its beat. */
  let named: Name[] = [];
  let rechoose = true;
  let sinceChoice = 0;
  /** The camera as the last frame saw it, and whether it moved then: the first still frame after a move chooses again. */
  const eye = new Matrix4();
  let turned = false;

  /** The layout's own cooling rate, put back after a cold start from a recall (`load`), which cools it in one tick. */
  const decay = graph.d3AlphaDecay();
  const frames = createFrames((asked) => {
    const now = performance.now();
    const step = ladder.frame(now, picked, asked);
    speed.onFrame?.(now, asked);
    if (step !== undefined) speed.onStep(step), restyle();
    graph.tickFrame();
    controls.update(); // damping: it fires `change` while the camera still glides
    if (pointer) ray.setFromCamera(pointer, camera);
    cursorMesh?.step(pointer && ray.ray);
    up.set(0, 1, 0).applyQuaternion(camera.quaternion); // a name stands on its star's top edge, as seen, so its glow never covers it
    const view = { width: host.clientWidth, height: host.clientHeight };
    camera.updateMatrixWorld();
    const turning = !camera.matrixWorld.equals(eye);
    eye.copy(camera.matrixWorld);
    if (turning || settling) sinceChoice++;
    if (rechoose || sinceChoice >= CHOOSE_EVERY || (turned && !turning)) (rechoose = false), (sinceChoice = 0), labels.choose(named, anchor, camera, view);
    turned = turning;
    const fading = labels.place(anchor, camera, view, performance.now());
    for (const star of stars.values()) star.mesh.quaternion.copy(camera.quaternion); // each star, and its ring, faces the camera
    const beat = 0.5 + 0.5 * Math.cos((2 * Math.PI * performance.now()) / (PULSE.s * 1000));
    stars.get(search?.selected ?? '')?.mesh.material.color.copy(warm).multiplyScalar(PULSE.low + (1 - PULSE.low) * beat);
    composer.render();
    pointAt(); // after the render: the camera's matrices are this frame's
    if (settling || fading || performance.now() - awake < IDLE_MS) frames.invalidate();
  });
  const invalidate = frames.invalidate;
  const wake = () => ((awake = performance.now()), invalidate());
  graph.onFinishUpdate(() => ((settling = true), invalidate())).onEngineStop(() => ((settling = false), (rechoose = true))).onEngineTick(() => {
    graph.d3AlphaDecay(decay); // a cold start's one tick is over
    if (afterglow && !--afterglow) graph.d3AlphaTarget(0).resetCountdown(); // a released drag's beat is over: it cools
  });
  /** The layout runs again from full heat, at its own cooling rate (a cold start's may not have ticked yet). */
  const reheat = () => (graph.d3AlphaDecay(decay).d3ReheatSimulation(), (settling = true), invalidate());
  controls.addEventListener('change', wake);
  const INPUT = ['keydown', 'pointermove', 'pointerdown', 'wheel'] as const; // anywhere on the page: the panel too
  INPUT.forEach((type) => window.addEventListener(type, wake, { passive: true }));

  const resize = () => {
    renderer.setSize(host.clientWidth, host.clientHeight);
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(host.clientWidth, host.clientHeight);
    camera.aspect = host.clientWidth / Math.max(host.clientHeight, 1);
    camera.updateProjectionMatrix();
    rechoose = true;
    invalidate();
  };
  const sizer = new ResizeObserver(resize);
  sizer.observe(host);
  host.appendChild(canvas);
  /** Points to the highlight's node while it is off screen (`pointAt`): over the canvas, never in the way, unseen by a screen reader. */
  const arrow = host.appendChild(document.createElement('div'));
  arrow.setAttribute('aria-hidden', 'true');
  Object.assign(arrow.style, {
    position: 'absolute', left: '0', top: '0', width: '0', height: '0', pointerEvents: 'none', display: 'none',
    borderTop: `${ARROW.wide / 2}px solid transparent`, borderBottom: `${ARROW.wide / 2}px solid transparent`,
  });

  /**
   * Puts on the style's look where it is cheap to change in place: the background, bloom (on or off, its numbers, its
   * resolution), the exposure, link width and particles, the warm colour and the arrow; and builds the cursor mesh anew.
   */
  function dress() {
    const { palette, bloom: glow, links, mesh } = style;
    background?.dispose();
    scene.background = background = gradient(palette.background);
    Object.assign(bloom, { enabled: glow.on, strength: glow.strength, radius: glow.radius, threshold: glow.threshold });
    renderer.toneMappingExposure = style.exposure;
    graph.linkWidth(links.width).linkDirectionalParticleSpeed(links.particleSpeed).linkDirectionalParticleWidth(links.particleWidth);
    flowing = undefined; // `paint` hands the graph the particle count again
    warm.set(palette.warm);
    Object.assign(arrow.style, { borderLeft: `${ARROW.long}px solid ${palette.warm}`, filter: `drop-shadow(0 0 6px ${palette.warm})` });
    cursorMesh?.dispose();
    cursorMesh = mesh.on && mesh.count ? createCursorMesh(scene, mesh) : null;
  }
  dress();
  resize();
  canvas.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 400 }); // the view fades in; it does not morph from the other

  const ray = new Raycaster();
  /** Where the pointer is on the canvas (-1…1 each way); none once it leaves. */
  let pointer: Vector2 | null = null;
  /** Aims the ray at (x, y), CSS px on the canvas. */
  const aim = (x: number, y: number) => {
    const box = canvas.getBoundingClientRect();
    pointer = new Vector2((x / box.width) * 2 - 1, -(y / box.height) * 2 + 1);
    ray.setFromCamera(pointer, camera);
  };
  /**
   * The nearest node under the ray, if any: each star is tested as the ball it fills, whatever its shape (a ring's hole
   * counts). Only stars are tested: the mesh and the rings are never picked.
   */
  const ball = new Sphere(), hit = new Vector3();
  const starAt = () => {
    let id: string | undefined, nearest = Infinity;
    for (const star of stars.values()) {
      const d = ray.ray.intersectSphere(ball.set(star.mesh.position, star.mesh.scale.x), hit)?.distanceTo(ray.ray.origin) ?? Infinity;
      if (d < nearest) (nearest = d), (id = star.id);
    }
    return id;
  };
  /**
   * The pointer (`press.ts`): a press on a star or its name holds it, and the orbit is off until that pointer lets go. Once it
   * drags: the plane it drags on (through the star, facing the camera) and the star's offset from the point it was grabbed by, so
   * the name or the edge it was taken by stays under the pointer.
   */
  let dragging: { id: string; plane: Plane; offset: Vector3 } | null = null;
  const detach = attachPress(canvas, {
    pick: (x, y) => (aim(x, y), labels.at(x, y) ?? starAt()), // its name first: names are drawn on top
    holding(on) {
      controls.enabled = !on;
      if (!on) (dragging = null), (canvas.style.cursor = '');
    },
    hover(id) {
      canvas.style.cursor = id ? 'pointer' : '';
      if (id !== hover) (hover = id), paint();
    },
    drag,
    click: onSelect,
    /** A drag's release pins the star where it is and reports it; the layout stays hot a beat, so its cloud settles around it. */
    drop(id) {
      afterglow = DRAG.afterTicks; // still hot a beat, then it cools: even a quick flick's cloud settles around where it was put
      graph.resetCountdown();
      (settling = true), invalidate();
      const star = stars.get(id);
      if (!star) return;
      const at = [star.x ?? 0, star.y ?? 0, star.z ?? 0].map(Math.round) as Vec3;
      pinned = new Map(pinned).set(id, at);
      hold();
      onPin(id, at);
    },
  });
  canvas.addEventListener('pointerleave', () => {
    pointer = null;
    if (hover) (hover = undefined), paint();
  });

  /** Once the press has moved `CLICK_PX`, the held star follows the pointer; the layout runs hot meanwhile, so its cloud follows it. */
  function drag(id: string, x: number, y: number, from: readonly [number, number]) {
    const star = stars.get(id);
    if (!star) return;
    if (!dragging) {
      const plane = new Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(new Vector3()), where(id));
      aim(...from);
      const grabbed = ray.ray.intersectPlane(plane, new Vector3());
      dragging = { id, plane, offset: grabbed ? where(id).sub(grabbed) : new Vector3() };
    }
    aim(x, y);
    const at = ray.ray.intersectPlane(dragging.plane, new Vector3())?.add(dragging.offset);
    if (at) Object.assign(star, { x: at.x, y: at.y, z: at.z, fx: at.x, fy: at.y, fz: at.z });
    afterglow = 0;
    graph.d3AlphaTarget(DRAG.heat).resetCountdown(); // again on each move: a long drag outlasts the layout's tick count
    settling = true;
    canvas.style.cursor = 'grabbing';
  }

  /**
   * Holds each pinned star at its pin, with its ring, and lets go of a star no longer pinned (the one being dragged is the
   * pointer's). True when one changed.
   */
  function hold() {
    let changed = false;
    for (const star of stars.values()) {
      if (dragging?.id === star.id) continue;
      const at = pinned.get(star.id);
      if (at ? at[0] === star.fx && at[1] === star.fy && at[2] === star.fz : star.fx === undefined) continue;
      changed = true;
      Object.assign(star, { fx: at?.[0], fy: at?.[1], fz: at?.[2] }, at && { x: at[0], y: at[1], z: at[2] });
      if (at && !star.ring) star.mesh.add((star.ring = new Mesh(ringShape, new MeshBasicMaterial({ transparent: true, opacity: RING.opacity, color: star.hue }))));
      if (!at) star.ring?.material.dispose(), star.ring?.removeFromParent(), (star.ring = undefined);
    }
    return changed;
  }

  /**
   * The map as stars and lines (`constellation`). A node seen before keeps its star, so a refresh (or a new style) goes on from the
   * layout it had. A new graph, or a style with other physics, lays out again.
   */
  function load(next: MapState) {
    const { palette, nodes: starStyle, recency, physics } = style;
    const { nodes, links } = constellation(next, recency.halfLifeDays);
    const clusters = next.nodes[next.rootId]!.children.filter((id) => next.nodes[id]!.kind === 'cluster');
    // Size by metric: min + (max − min) × √(metric / biggest). The root holds every item: measured against it, every cluster
    // would be a dot. It is drawn at the largest size.
    const metric = (n: StarNode) => (starStyle.metric === 'recency' ? n.warmth : starStyle.metric === 'weight' ? n.weight : n.items);
    const biggest = Math.max(0, ...nodes.filter((n) => n.kind !== 'root').map(metric)) || 1;
    const laid = layoutForces({ nodes, links }, physics);
    for (const node of nodes) {
      const own = next.nodes[node.cluster]?.color, ring = palette.clusters[clusters.indexOf(node.cluster) % palette.clusters.length]!;
      const hue = node.cluster === CORE ? palette.core : own ?? ring;
      const star = Object.assign(stars.get(node.id) ?? newStar(node, recall?.places[node.id] ?? laid.start(node.id)), node, { hue });
      star.mesh.scale.setScalar(starStyle.minSize + (starStyle.maxSize - starStyle.minSize) * Math.sqrt(Math.min(1, metric(node) / biggest)));
      star.ring?.material.color.set(hue);
      const { material } = star.mesh, sprite = starStyle.shape === 'sprite';
      star.mesh.geometry = SHAPES[starStyle.shape as keyof typeof SHAPES];
      if (sprite !== !!material.map) Object.assign(material, { map: sprite ? soft : null, depthWrite: !sprite, needsUpdate: true });
    }
    const key = links.map((l) => `${l.source}>${l.target}`).join('\n') + nodes.map((n) => n.id).join() + JSON.stringify(physics);
    if (key === shape) return void lines.forEach(tint); // the same graph: no new layout
    shape = key;
    // Back (from a `recall`) to the graph it had settled, each pin where its star was: it starts cold, so nothing moves.
    const was = recall;
    recall = undefined;
    const still = key === was?.settled && [...pinned].every(([id, at]) => !stars.has(id) || `${at}` === `${was.places[id]}`);
    for (const [id, star] of stars) if (!next.nodes[id]) star.mesh.material.dispose(), star.ring?.material.dispose(), stars.delete(id);
    lines.forEach((l) => l.material.dispose()); // the new graph gets new lines
    lines = links.map((l) => ({ ...l, material: new LineBasicMaterial({ transparent: true }) }));
    lines.forEach(tint);
    forces = laid;
    graph.d3Force('cluster', laid.cluster).d3Force('anchor', laid.anchor);
    graph.d3Force('link')!.distance(restOf).strength(laid.linkStrength);
    graph.d3Force('charge')!.strength(physics.charge);
    hold(); // a new star that is pinned starts at its pin, so its cloud settles around it
    graph.d3AlphaDecay(still ? 1 : decay).graphData({ nodes: nodes.map((n) => stars.get(n.id)!), links: lines });
  }

  /**
   * The picked style at the ladder's rung, when it is not the one drawn: dressed anew, then re-hued, re-shaped and re-sized; laid
   * out again only when its physics differ.
   */
  function restyle() {
    const next = slowed(picked, ladder.rung);
    if (JSON.stringify(next) === JSON.stringify(style)) return;
    style = next;
    dress();
    resize(); // the bloom's resolution
    if (state) load(state);
    paint();
  }

  /** A tree link in its child's hue, a cross-link in the style's cross colour. */
  const tint = (l: Line) => l.material.color.set(l.kind === 'tree' ? stars.get(ends(l)[1]!)!.hue : style.palette.cross);

  /** A link's rest length: the layout's, but `EXPAND.spread` times as long from an opened node to its children. */
  const restOf = (l: Line) => forces!.linkDistance(l) * (l.kind === 'tree' && ends(l)[0] === expanded ? EXPAND.spread : 1);

  /** A node new to the view starts where the layout seeds it (`start`), so the same map settles the same way. */
  function newStar(node: StarNode, [x, y, z]: Vec3): Star {
    const star = { ...node, hue: '', mesh: new Mesh(SHAPES.sphere, new MeshBasicMaterial({ transparent: true })), x, y, z };
    stars.set(node.id, star);
    return star;
  }

  /**
   * Hues by cloud, burning by warmth. A hover lights the node, its neighbours and its links and dims the rest; else a search
   * lights its matches (amber) and fades the rest, and the highlight's node (a search's selected match) burns
   * warm, pulsing (each frame), with its links and neighbours lit, as a hover's; else an opened node and its children stand
   * out and the rest dims a little. Names: the hover, the highlight and the focus always show; an opened node's children and the
   * focus's children come next, where they have room; every other star's name shows when it has room and is near enough
   * (`labels.choose`). Each is sized by its weight (`labelSize`). Particles flow on the cross-links and the focus's links.
   */
  function paint() {
    const hits = new Set(search?.matches);
    const lead = hover ?? search?.selected ?? undefined; // whose links light
    const near = lead ? new Set([lead, ...lines.filter((l) => ends(l).includes(lead)).flatMap(ends)]) : null;
    const opened = expanded ? new Set([expanded, ...(state?.nodes[expanded]?.children ?? [])]) : null;
    const lit = (id: string) => (hover ? near!.has(id) : search ? hits.has(id) || !!near?.has(id) : !opened || opened.has(id));
    for (const star of stars.values()) {
      if (star.id === search?.selected) star.mesh.material.color.copy(warm);
      else if (hits.has(star.id)) star.mesh.material.color.set(style.palette.glow);
      else burn(star.mesh.material.color, star.hue, star.warmth, style);
      star.mesh.material.opacity = lit(star.id) ? 1 : hover || search ? style.dim : EXPAND.dim;
    }
    const { links: linkStyle } = style;
    for (const l of lines) {
      const rest = l.kind === 'tree' ? linkStyle.tree : linkStyle.cross;
      l.material.opacity = lead && ends(l).includes(lead) ? linkStyle.lit : hover || search ? linkStyle.dim : opened && !ends(l).includes(expanded!) ? rest * EXPAND.dim : rest;
    }
    if (flowing !== focus) graph.linkDirectionalParticles((l: Line) => (l.kind !== 'tree' || ends(l).includes(focus ?? '') ? linkStyle.particles : 0));
    flowing = focus;
    // The names that must show, then the children's (each group's biggest first), then every other star's.
    const childrenOf = (id: string | null) => (state?.nodes[id ?? '']?.children ?? []).map((c) => stars.get(c)!).filter(Boolean).sort((a, b) => b.items - a.items);
    const ranked = new Map<string, Name['priority']>();
    [stars.get(hover ?? ''), stars.get(search?.selected ?? ''), stars.get(focus ?? '')].forEach((s) => s && ranked.set(s.id, 'must'));
    [...childrenOf(expanded), ...childrenOf(focus)].forEach((s) => ranked.has(s.id) || ranked.set(s.id, 'first'));
    named = [...[...ranked.keys()].map((id) => stars.get(id)!), ...[...stars.values()].filter((s) => !ranked.has(s.id))]
      .map((s) => ({ id: s.id, text: s.label, size: labelSize(s), kind: s.kind, priority: ranked.get(s.id) }));
    rechoose = true;
    wake();
  }

  /**
   * While the highlight's node is off screen (outside the view, or behind the camera), the arrow stands at the screen's edge on
   * the line from the middle toward it (behind the camera: toward the side it lies on) and points at it.
   */
  function pointAt() {
    const id = search?.selected;
    const eye = id && stars.has(id) ? where(id).applyMatrix4(camera.matrixWorldInverse) : null; // in front of the camera is -z
    const ahead = eye && eye.z < 0 ? where(id!).project(camera) : null;
    if (!eye || (ahead && Math.abs(ahead.x) <= 1 && Math.abs(ahead.y) <= 1)) return void (arrow.style.display = 'none');
    const w = host.clientWidth / 2, h = host.clientHeight / 2;
    const [dx, dy] = ahead ? [ahead.x * w, -ahead.y * h] : eye.x || eye.y ? [eye.x, -eye.y] : [0, 1];
    const k = Math.min((w - ARROW.inset) / Math.abs(dx), (h - ARROW.inset) / Math.abs(dy));
    arrow.style.display = '';
    arrow.style.transform = `translate(${w + dx * k - ARROW.long / 2}px, ${h + dy * k - ARROW.wide / 2}px) rotate(${Math.atan2(dy, dx)}rad)`;
  }

  const where = (id: string) => {
    const star = stars.get(id);
    return new Vector3(star?.x ?? 0, star?.y ?? 0, star?.z ?? 0);
  };
  /** A star's name stands on its top edge, as the camera sees it (`up`), so its glow never covers it. */
  const anchor: Anchor = (id) => (stars.has(id) ? where(id).addScaledVector(up, stars.get(id)!.mesh.scale.x) : undefined);
  /**
   * The spot the camera looks at (`center`'s star) and how far back it stands to hold every one of `ids` in view: across the
   * narrower of the view's two angles, so a tall window holds the map as well as a wide one.
   */
  const framing = (center: string, ids: string[]) => {
    const spot = where(center);
    const reach = Math.max(MIN_REACH, ...ids.map((id) => where(id).distanceTo(spot)));
    const up = (camera.fov * Math.PI) / 360; // half the vertical angle
    return { spot, distance: reach / Math.sin(Math.min(up, Math.atan(Math.tan(up) * camera.aspect))) };
  };

  /** Flies the camera to a framing, read again each frame so it lands on stars the layout still moves. */
  function fly(to: () => { spot: Vector3; distance: number }) {
    flight?.cancel();
    const from = { eye: camera.position.clone(), spot: controls.target.clone() };
    const away = from.eye.clone().sub(from.spot).normalize();
    flight = tween(FLY_S, (t) => {
      const { spot, distance } = to();
      controls.target.lerpVectors(from.spot, spot, t);
      camera.position.lerpVectors(from.eye, spot.clone().addScaledVector(away, distance), t);
      invalidate();
    });
  }

  return {
    show(next, focusId) {
      state = next;
      load(next);
      const moved = focusId !== focus;
      focus = focusId;
      if (moved) hover = undefined; // the camera flies off: what was under the pointer is not, until it moves again
      paint();
      if (moved) fly(() => framing(focusId, [focusId, ...(state?.nodes[focusId]?.children ?? [])]));
    },
    highlight(h) {
      search = h;
      paint();
    },
    home() {
      if (state) fly(() => framing(state!.rootId, [...stars.keys()]));
    },
    /** Opens `id` (`null` closes it): its child links take their new length as the layout runs again, once, as after a refresh. */
    expand(id) {
      if (id === expanded) return;
      expanded = id;
      if (forces) graph.d3Force('link')!.distance(restOf), reheat();
      paint();
    },
    /** New pins (a key, a reload, the other style): a star let go or moved takes its place as the layout runs again, as after a refresh. */
    pins(at) {
      pinned = new Map(Object.entries(at));
      if (hold()) reheat();
    },
    unpinHovered() {
      if (!hover || !pinned.has(hover)) return;
      const id = hover;
      pinned = new Map(pinned);
      pinned.delete(id);
      if (hold()) reheat();
      onPin(id, null);
    },
    /** The same map in `next`, at the page's `rung`: a step for speed holds through a new pick, but for the switch to minimal. */
    setStyle(next, rung) {
      picked = next;
      if (rung !== ladder.rung) ladder = createLadder(rung);
      restyle();
    },
    remember() {
      flight?.finish(); // a flight under way lands first: the next view starts where this one was going
      const places = Object.fromEntries([...stars.values()].map((s): [string, Vec3] => [s.id, [s.x ?? 0, s.y ?? 0, s.z ?? 0]]));
      return { eye: camera.position.toArray(), target: controls.target.toArray(), focus, expanded, places, settled: settling ? null : shape };
    },
    destroy() {
      flight?.cancel();
      detach();
      frames.dispose();
      sizer.disconnect();
      controls.dispose();
      for (const star of stars.values()) star.mesh.material.dispose(), star.ring?.material.dispose();
      for (const { material } of lines) material.dispose();
      ringShape.dispose();
      labels.dispose();
      cursorMesh?.dispose();
      INPUT.forEach((type) => window.removeEventListener(type, wake));
      bloom.dispose();
      composer.dispose();
      background?.dispose();
      soft.dispose();
      renderer.dispose();
      renderer.forceContextLoss(); // one WebGL context at a time: the view that mounts next gets it
      canvas.remove();
      arrow.remove();
    },
  };
}
