# constellation-starter: guide for agents

A small demo of clusters of nodes in 3D: three.js and three-forcegraph lay out made-up data from `data/clusters.json`,
with bloom, link particles and an ambient mesh. Vanilla TypeScript and Vite; no framework. The person you help wants to
understand this stack. Explain in plain words, show the line of code you mean, and change one thing at a time.

## Rules

- No `sudo` and no global installs without asking first.
- Node.js 22.12 or newer (`.nvmrc` says 22; `nvm install` reads it). npm only, with `package-lock.json`.
- Versions are pinned exactly (no `^` or `~`). Every direct dependency is MIT (the lockfile also holds ISC, BSD, Apache and
  MPL sub-dependencies). Keep both true when you add one.
- Tests go through two seams only: the **model seam** (`data/clusters.json` through `loadClusters` and `constellation`)
  and the **render seam** (the tween, the panel, and a look in the browser). Never test private functions or call counts.
- `tests/model.test.ts` checks the starter's own data: after editing `data/clusters.json`, update its counts, names and
  positions, or `npm test` fails, and so does the Pages deploy, which runs it.

## Commands

```bash
npm ci            # install exactly what the lockfile says
npm run dev       # dev server with hot reload, http://localhost:5173
npm test          # vitest, once
npm run build     # static site in dist/ (PAGES_BASE=/<repo>/ for GitHub Pages)
npm run preview   # serve dist/
```

## Files

| File | What it does |
|---|---|
| `index.html` | the page: the map's host, the help line, the note box for problems |
| `src/main.ts` | mounts it all: loads the data, makes the scene and the panel, the keys, `?focus` and `?stats` |
| `src/data.ts` | reads and checks `data/clusters.json`; throws a `DataError` in plain words, naming the field |
| `src/model/types.ts` | the node and map types: kinds `root`, `cluster`, `group`, `item` |
| `src/model/constellation.ts` | the map as a graph (cloud, size, warmth per node; tree and cross links) and the layout's forces |
| `src/model/labels.ts` | which names show (room on screen, zoom band, priority) and how big |
| `src/model/d3-force-3d.d.ts` | lets TypeScript import `d3-force-3d` |
| `src/scene.ts` | the 3D scene: renderer, camera, bloom, stars, lines, particles, hover, click, drag, the camera's flight |
| `src/scene/style.ts` | the `Style` type (the shape of `styles/galaxy.json`), the presets, `burn` (a node's colour by warmth) |
| `src/scene/mesh.ts` | the ambient mesh: drifting points, the lines between near ones, the pointer's push or pull |
| `src/scene/labels.ts` | the name sprites: chosen, faded in and out, placed on each star every frame |
| `src/scene/press.ts` | the pointer: a click, a drag, a hover, apart from the orbit controls |
| `src/scene/ladder.ts` | the speed ladder: makes the look cheaper, one step at a time, when frames are slow |
| `src/scene/frames.ts` | draws on demand: one animation frame at most, nothing while the tab is hidden |
| `src/tween.ts` | the camera flight's tween: `requestAnimationFrame`, eased in and out |
| `src/panel.ts` | the Look panel (lil-gui): a style picker, a control for each setting in its folders (the palette, `recency`, `dim` and `mesh.shell` are edited in the JSON), Copy JSON |
| `src/stats.ts` | the `?stats` overlay: p95 frame time |
| `styles/galaxy.json`, `mesh.json`, `minimal.json` | the three looks |
| `data/clusters.json` | the clusters, groups, items and cross links |
| `tests/model.test.ts` | model seam: 7 clusters, about 130 nodes, 15 cross links; broken files give the right error |
| `tests/tween.test.ts`, `tests/panel.test.ts` | render seam: the tween starts, ends, cancels; each control changes its setting |
| `vite.config.ts` | the base path for Pages, and where the tests are |
| `.github/workflows/pages.yml` | on a push to `main`: test, build and put the site on GitHub Pages |

## The data (`data/clusters.json`)

```text
{ title?, clusters: [cluster], links?: [[name, name]] }
cluster: { name, color?, daysAgo?, note?, groups?: [group] }
group:   { name, daysAgo?, note?, items?: [item] }
item:    "name" | { name, daysAgo?, note? }
```

- `name`: text, different from every other name (links find nodes by name).
- `color`: a cluster's own colour, `#rgb` or `#rrggbb`; without it, the style's `palette.clusters` gives one, in order.
- `daysAgo`: how long ago it changed (0 is today). Warmth is 1 then and halves every `recency.halfLifeDays`; a parent
  takes its warmest child's. No `daysAgo` anywhere under a node: it is cold (0).
- `note`: a few words. A longer note makes its name a little bigger.
- A node's id is its place: `c0`, `c0g1`, `c0g1i2`. Any other key is an error, so a typo (`colour`) never hides.

## Style keys (`styles/*.json`)

| Key | What it sets |
|---|---|
| `palette.background` | the background's top and bottom colours |
| `palette.clusters` | one hue per cluster, in ring order (it repeats if there are more clusters) |
| `palette.core`, `warm`, `cross`, `glow` | the root's hue; what warm nodes lean to (and the highlight); cross links; search matches |
| `bloom.on`, `strength`, `radius`, `threshold` | `UnrealBloomPass`: how strong, how wide, how bright a pixel must be to glow |
| `bloom.resolution` | the share of the screen the glow is worked out at (cheaper when lower) |
| `exposure` | tone mapping brightness (1 is as drawn) |
| `nodes.shape` | `sphere`, `ring` or `sprite` (a soft dot) |
| `nodes.minSize`, `maxSize`, `metric` | radius from min to max by √(metric / biggest); metric `items`, `weight` or `recency` |
| `links.width` | 0 is a hairline; more draws tubes (dearer) |
| `links.tree`, `cross`, `lit`, `dim` | link opacity: tree, cross, a hovered node's, the rest while hovering |
| `links.particles`, `particleSpeed`, `particleWidth` | dots per link (0–8), the share of the link a dot moves a frame, their size |
| `mesh.on`, `count` | the ambient mesh, and its points (at most 400) |
| `mesh.shell`, `drift` | the points live between two radii, and drift this far a frame |
| `mesh.linkDistance`, `lineOpacity` | points closer than this join; the lines' brightness |
| `mesh.reach`, `cursor`, `color`, `size` | how near the pointer acts; `repel` or `grab`; the points' colour and size |
| `physics.charge` | how hard nodes push apart (negative) |
| `physics.linkDistance`, `cluster`, `anchor` | a tree link's rest length; a hub's pull on its cloud; the ring's hold on each hub |
| `recency.halfLifeDays`, `ember`, `peak`, `lean` | warmth's half-life; brightness cold and at its warmest; how far warm leans to `warm` |
| `dim` | what is not lit fades to this opacity while hovering or searching |

The panel's Copy JSON gives a whole style in this shape. A preset file must keep every key (the `Style` type is
`typeof galaxy.json`).

## The render pipeline

1. **Load** (`scene.ts` `load`): `constellation(state)` gives the stars and links. Each star is one `Mesh` (shared geometry
   by shape), sized by the metric, coloured by its cluster and its warmth (`burn`). Lines get a material each.
2. **Lay out**: three-forcegraph with its d3 engine in 3D, plus the starter's forces (`layoutForces`): charge, tree links
   as springs, each cloud pulled to its hub, each hub held on a tilted ring. Starts are seeded by id and the layout stops
   after 300 ticks, so the same data settles the same way every time.
3. **Each frame** (`frames.ts`, only when something moved): the speed ladder judges the frame; `graph.tickFrame()` moves
   the layout and the particles; the orbit controls damp; the mesh steps; names are chosen again every 6 frames while
   things move, and placed; then `composer.render()`:
   `RenderPass` (the scene) → `UnrealBloomPass` → `RenderPass` (the names, after bloom so they stay sharp) → `OutputPass`
   (`NeutralToneMapping` and sRGB).
4. **Idle**: 20 s after the last input it stops drawing; it never draws while the tab is hidden.
5. **Style change** (`setStyle`): cheap settings change in place (`dress`); a new shape, size or colour re-dresses the
   stars; new physics lay the map out again.

## Performance budget

- p95 frame time under 20 ms (check with `?stats`). The speed ladder watches 3 s windows: over budget, it steps down:
  bloom at a quarter of the screen → half the mesh → no particles → the `minimal` style. A note says each step.
- Pixel ratio at most 1.5; bloom at half resolution; at most 400 mesh points (80,000 pair checks a frame); names chosen
  again every 6 frames, not every frame; no drawing when idle or hidden.

## Troubleshooting

- **"No hardware-accelerated WebGL2 here"**: the scene refuses a software renderer. Turn on hardware acceleration in
  the browser's settings, or try another browser.
- **A message in the top left**: `data/clusters.json` has a mistake; the message names the field.
- **`npm ci` warns about the engine, or vitest will not start**: Node is older than 22.12. Install Node 22.12 or newer.
- **A blank page on GitHub Pages**: the base path. The workflow builds with `PAGES_BASE=/<repo>/`; Pages must use
  "GitHub Actions" as its source (Settings → Pages).
- **Port 5173 is busy**: Vite takes the next one. Use the URL it prints.
- **Slow, or the fans spin up**: open `?stats`, pick `minimal`, lower `mesh.count`, or turn bloom off.
