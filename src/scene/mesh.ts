import { seeded } from '../model/constellation';
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, LineBasicMaterial, LineSegments, Points, PointsMaterial, Vector3, type Ray, type Scene } from 'three';
import type { Style } from './style';

/** Room for this many lines a point between points; past that, the nearest pairs found first are drawn. Then one a point to the cursor. */
const LINES_PER_POINT = 6;

/** `v` set to a direction spread evenly over the sphere (as three's `randomDirection`), from two of `random`'s numbers. */
function direction(v: Vector3, random: () => number) {
  const y = random() * 2 - 1, turn = random() * 2 * Math.PI, r = Math.sqrt(1 - y * y);
  return v.set(r * Math.cos(turn), y, r * Math.sin(turn));
}

/** The cursor mesh, in the map's own scene: it gets the same bloom and moves with the camera. */
export interface CursorMesh {
  /** One frame: each point drifts; points near the cursor's ray (`null`: no cursor on the page) react to it; near pairs join. */
  step(cursor: Ray | null): void;
  dispose(): void;
}

/**
 * A field of `look.count` points (the style caps it at `MESH_MAX`) drifting in a wide shell around the map, laid out the same
 * way each time it is built (half the points: the first half of the same field). Two points closer
 * than `linkDistance` are joined by a line that fades with distance. Points within `reach` of the cursor's ray part around it
 * (`repel`), or reach for it with lines of their own (`grab`, as particles.js does). The mesh is never picked: a click goes
 * through it to the nodes (the scene ray-tests only its stars).
 */
export function createCursorMesh(scene: Scene, look: Style['mesh']): CursorMesh {
  const n = look.count;
  const [inner = 0, outer = 0] = look.shell;
  const at = new Float32Array(n * 3);
  const drift = new Float32Array(n * 3);
  const p = new Vector3();
  /** Scratch: a point's drift, then its foot on the cursor's ray. */
  const move = new Vector3();
  const foot = new Vector3();
  const random = seeded('mesh'); // the same field each time: a rebuild (a speed step, a new style) never jumps
  for (let i = 0; i < n; i++) {
    direction(p, random).multiplyScalar(inner + random() * (outer - inner)).toArray(at, i * 3);
    direction(p, random).multiplyScalar(look.drift).toArray(drift, i * 3);
  }
  const dots = new BufferGeometry().setAttribute('position', new BufferAttribute(at, 3));
  const points = new Points(dots, new PointsMaterial({ color: look.color, size: look.size, transparent: true, opacity: 0.8, depthWrite: false }));
  const room = n * (LINES_PER_POINT + 1);
  const ends = new Float32Array(room * 6);
  const shades = new Float32Array(room * 6);
  const web = new BufferGeometry().setAttribute('position', new BufferAttribute(ends, 3)).setAttribute('color', new BufferAttribute(shades, 3));
  const lines = new LineSegments(web, new LineBasicMaterial({ vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false }));
  scene.add(points, lines);
  const tint = new Color(look.color);
  let count = 0;
  /** A line from `a` to `b` (each three floats), as bright as `fade` of the style's line opacity. */
  const line = (a: ArrayLike<number>, b: ArrayLike<number>, fade: number) => {
    ends.set(a, count * 6);
    ends.set(b, count * 6 + 3);
    const shade = fade * look.lineOpacity;
    for (let k = count * 6; k < count * 6 + 6; k += 3) (shades[k] = tint.r * shade), (shades[k + 1] = tint.g * shade), (shades[k + 2] = tint.b * shade);
    count++;
  };

  return {
    step(cursor) {
      count = 0;
      for (let i = 0; i < n * 3; i += 3) {
        p.fromArray(at, i).add(move.fromArray(drift, i));
        const r = p.length();
        if (r > outer || r < inner) { // bounce off the shell's walls: turn the outward part of the drift around
          const out = move.dot(p) / r;
          if ((r > outer) === out > 0) move.addScaledVector(p, (-2 * out) / r).toArray(drift, i);
        }
        if (cursor && cursor.distanceSqToPoint(p) < look.reach ** 2) {
          const off = p.distanceTo(cursor.closestPointToPoint(p, foot));
          if (look.cursor === 'grab') line(p.toArray(), foot.toArray(), 1 - off / look.reach);
          else p.addScaledVector(foot.subVectors(p, foot).normalize(), (look.reach - off) * 0.1);
        }
        p.toArray(at, i);
      }
      for (let i = 0; i < n && count < room; i++) {
        for (let j = i + 1; j < n && count < room; j++) {
          const d = Math.hypot(at[i * 3]! - at[j * 3]!, at[i * 3 + 1]! - at[j * 3 + 1]!, at[i * 3 + 2]! - at[j * 3 + 2]!);
          if (d < look.linkDistance) line(at.subarray(i * 3, i * 3 + 3), at.subarray(j * 3, j * 3 + 3), 1 - d / look.linkDistance);
        }
      }
      web.setDrawRange(0, count * 2);
      for (const geometry of [dots, web]) for (const name of Object.keys(geometry.attributes)) geometry.attributes[name]!.needsUpdate = true;
    },
    dispose() {
      scene.remove(points, lines);
      [dots, web, points.material, lines.material].forEach((x) => x.dispose());
    },
  };
}
