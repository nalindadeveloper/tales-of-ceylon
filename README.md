# Island Journal — Interactive 3D Sri Lanka

A scroll-driven travel experience built around a miniature, three-dimensional
Sri Lanka generated from **real geographic data**: an OpenStreetMap-derived
coastline and SRTM elevation, with bathymetry-tinted seas. Five destinations —
Colombo, Kandy, Jaffna, Nuwara Eliya and Galle — are explored by scrolling; the
camera flies across the island, markers and landmark models activate, and
editorial cards tell each place's story.

Stack: Vite · vanilla JavaScript (ES modules) · Three.js · GSAP + ScrollTrigger ·
Lenis · Howler.js · Sass · Lucide.

---

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production build → dist/
npm run preview    # serve the production build
```

The preprocessed terrain, images and audio are committed in `public/assets/`,
so the site runs without re-running any data scripts.

### Deployment

Live site: **https://nalindadeveloper.github.io/tales-of-ceylon/**

Every push to `main` builds and publishes the site through
`.github/workflows/deploy.yml` (GitHub Pages, "GitHub Actions" source). The
workflow sets `BASE_PATH=/<repository>/`; Vite's `base` and
`src/utils/asset-url.js` make every asset path follow it. To host at a domain
root instead (own server, Netlify, a custom domain), build without
`BASE_PATH` and upload `dist/`.

### Asset scripts (optional)

| Command                 | What it does                                                                    |
| ----------------------- | ------------------------------------------------------------------------------- |
| `npm run geo:fetch`     | Downloads the coastline and elevation tiles into `.geo-cache/raw` (~15 MB).     |
| `npm run geo:build`     | Rebuilds every terrain asset from the cache (≈ 1.5–3 min), then the shore field. |
| `npm run geo:map-texture` | Registers an island image against the coastline and bakes `terrain-map.webp` (see "Surface texture"). |
| `npm run geo:shore`     | Rebuilds only the distance-to-coast field used by the surf (≈ 5 s).             |
| `npm run geo`           | Both of the above.                                                              |
| `npm run assets:images` | Downloads the Commons photographs, converts them to WebP, writes credits.json. |
| `npm run assets:audio`  | Re-synthesises the ambient ocean loop.                                          |
| `node scripts/geo/preview-terrain.mjs out.png` | Flat preview of the baked terrain with destinations overlaid (QA). |

### QA flags

* `?static` — forces the no-WebGL fallback (static map + card list).
* `?reduced-motion` — simulates `prefers-reduced-motion: reduce`.
* In development, `window.__island` exposes the scene, camera rig, placements and
  terrain sampler for inspection.

---

## Data sources and licensing

| Asset | Source | License / obligations |
| ----- | ------ | --------------------- |
| Coastline (`public/assets/geo/sri-lanka-boundary.geojson`, terrain mesh outline) | [geoBoundaries](https://www.geoboundaries.org) gbOpen LKA ADM0 (Runfola et al. 2020), derived from OpenStreetMap | **ODbL 1.0** — attribute "© OpenStreetMap contributors"; the simplified boundary is a derived database and stays under ODbL. |
| Elevation (land) | [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (Terrarium, zoom 10) — SRTM | SRTM is public domain (NASA); attribute the Terrain Tiles sources. |
| Bathymetry (sea colour) | AWS Terrain Tiles (zoom 8) — ETOPO1 (NOAA), GMTED2010 (USGS) | Public domain / attribution as listed by Terrain Tiles. |
| Photographs | Wikimedia Commons — see `public/assets/images/credits.json` | CC BY, CC BY-SA, CC0 and Free Art License; each image's author, license and source page are listed there and in the footer ("Data & image credits"). CC BY-SA images must be credited and shared alike if modified. |
| Ambient audio | Original synthesis (`scripts/assets/generate-ambient-audio.mjs`) | No third-party rights. |
| Fonts | Cormorant Garamond, Manrope via Fontsource | SIL Open Font License 1.1. |

The attribution line on the map itself ("Elevation: SRTM … Coastline ©
OpenStreetMap contributors") satisfies the on-map attribution requirement —
keep it if you restyle the section.

**What is real and what is art-directed.** The outline, the elevation surface,
the river network (derived from the DEM by flow accumulation) and the
sea-depth colours come from the datasets above. Vegetation colours are painted
from elevation, slope, distance to the coast and an *approximate* wet/dry
climate zoning (`CLIMATE_ZONES` in `src/terrain/terrain-palette.js`) — they are
stylised, not land-cover data.

---

## How the island is built

### Coordinate system — `src/geography/projection.js`

Geographic coordinates are projected with a **local equirectangular projection**
centred on 7.85° N, 80.70° E:

```
x =  R · (λ − λ0) · cos φ0     east  → +x
z = −R · (φ − φ0)              north → −z
```

1 scene unit = 1 km. Over Sri Lanka's ~4° of latitude the scale error stays
below ±0.6%. Longitude is explicitly scaled by cos φ0 — latitude and longitude
are never treated as interchangeable distances. The **same module** is
imported by the Node bake scripts and by the browser, so the mesh, the
coastline wall, the textures, the markers and the camera share one space.

### Terrain pipeline — `scripts/geo/build-terrain.mjs`

1. **Coastline.** Outer rings of the geoBoundaries polygons are projected;
   islets under 4 km² are dropped. Rings are simplified with Douglas–Peucker
   (0.16 km) in a *topology-preserving* way: wherever simplified segments
   would cross, original vertices are re-inserted until no crossings remain.
2. **Elevation raster.** Terrarium tiles are decoded
   (`(R·256 + G + B/256) − 32768` m) and resampled onto a 1163 × 2048 raster
   (≈ 215 m/px) in the scene projection. A light 3×3 smoothing (two passes,
   ≈ 300 m) removes SRTM speckle that would look spiky once exaggerated.
3. **Land mask and coast distance.** The rings are rasterised and a Euclidean
   distance transform gives every pixel its distance to the sea.
4. **Mesh.** Interior points are placed on a 1.5 km grid, refined to 0.75 km or
   0.5 km where the relief inside a cell exceeds 110 m / 420 m, and kept away
   from the coast to avoid slivers. Together with the coastline vertices
   (constrained edges) they are triangulated with a **constrained Delaunay
   triangulation** (`cdt2d`); triangles are kept by an exact point-in-polygon
   test. The mesh edge therefore *is* the coastline. Vertex heights are sampled
   from the raster; coastline vertices sit at sea level. Result: ~51 k vertices,
   ~100 k triangles, stored quantised (uint16) in `terrain-mesh.bin` (≈ 0.9 MB).
5. **Textures.**
   * `terrain-normal.webp` — an *object-space* normal map baked from the DEM at
     `BAKE_EXAGGERATION`.
   * `terrain-albedo.webp` — colour from elevation bands, slope (rock), coastal
     sand, climate zoning, rivers (D8 flow accumulation after Priority-Flood
     depression filling, upstream area ≥ 320 km²) and a mild valley occlusion.
   * `ocean.webp` — sea colour from real depth on a log scale, a soft surf band,
     India shown as muted context. Isolated bathymetry spikes are removed.
6. `terrain.json` records bounds, offsets, statistics and provenance;
   `src/data/island-outline.js` is generated for the loader and fallback map.

Validation: the highest raster cell lands at 7.00° N, 80.77° E — Pidurutalagala
(2,524 m), Sri Lanka's highest peak (2,456 m after the light smoothing).

### Vertical exaggeration

Real relief (2.5 km over a 435 km island) would be nearly invisible, so heights
are multiplied by **4.5×** (`BAKE_EXAGGERATION` in `terrain-palette.js`,
`TERRAIN_CONFIG.elevationMultiplier` in `scene-config.js`). Vertices are
created at the bake exaggeration and the surface mesh is scaled vertically by
`multiplier / BAKE_EXAGGERATION`; Three.js's normal matrix keeps the baked
object-space normals correct for any multiplier. To change the look, set both
values and re-run `npm run geo:build` (for the sharpest normals the two should
match).

### Edge and ocean

`terrain-builder.js` extrudes a wall down from every coastline ring
(`coastLift` above sea level to `wallDepth` below), so the island reads as a
landmass rather than a paper cut-out.

`ocean.js` animates the sea entirely in one shader on a single plane (no
simulation, no render targets). From tens of kilometres up, real waves are
read through light, so the shader focuses on that:

* **GPU FFT simulation** (`ocean-simulation.js`, `ocean-spectrum.js`), the
  Tessendorf technique used by high-end ocean renderers. A wind-driven Phillips
  spectrum is generated once on the CPU for three tiling cascades (12 km,
  3.5 km, 1 km, each owning its own wavelength band). Every frame the GPU
  advances it with the deep-water dispersion relation ω = √(g·k) — long
  swells overtake short chop — and an inverse FFT (Stockham radix-2,
  2·log₂N passes per cascade, N = 128, or 64 on low-power devices) produces
  wave slopes and the choppy-wave Jacobian. Where the Jacobian folds, crests
  break: foam is written to a persistent buffer that decays over a few
  seconds, so it lingers behind the crest. The amplitude is normalised to a
  configured RMS slope. GPUs without float render targets fall back to eight
  analytic directional waves with the same dispersion.
* **Anti-aliasing that becomes glitter.** Waves too small for the current
  pixel size are faded out and their slope energy is added to the GGX
  specular roughness. Up close you see individual waves; far away the same
  energy spreads the sun into a broad, shimmering glint path.
* **Light.** Schlick Fresnel sky reflection with a zenith-to-horizon
  gradient, crest brightening, and drifting wind patches ("cat's paws") that
  keep wide shots alive. Rare whitecaps appear on crests at close range.
* **Surf.** `shore-distance.png` (exact distance to the coastline,
  baked by `scripts/geo/build-shore-field.mjs`) drives swell lines that roll
  towards the beach, sharpen and break into foam in sets, plus a pulsing wash
  at the shoreline. An *openness* test (six samples of the field 6 km away)
  keeps sheltered water such as the Jaffna lagoon and Palk Bay calm. When the
  camera is too far to resolve single lines, surf becomes a soft white rim.
* With reduced motion the sea is shown as a still frame.

### Surface texture — `scripts/geo/build-map-texture.mjs`

The land is coloured by `terrain-map.webp` (`TERRAIN_CONFIG.surfaceTexture`),
generated from an island image such as a satellite mosaic. To change it:

1. Put the new image in `source-assets/textures/` (git-ignored; large source
   images must stay out of `/public`, which is published and committed). It
   must be **north-up with a transparent sea** — only the land opaque. No
   georeferencing is needed.
2. Run `npm run geo:map-texture -- source-assets/textures/<file>.png`
   (optional second argument: output height in pixels, default 4096).

The script compares the image's opaque area with the coastline polygon, tries
plain longitude/latitude and Web Mercator layouts, and tunes the four image
edges to maximise the overlap (the current image fits at 99.1 % IoU). It then
resamples the image onto the terrain texture grid and pads colour outwards
across the coastline so no seams show. The fit and source are recorded in
`terrain.json` (`textures.map`).

Set `surfaceTexture: 'terrain-albedo.webp'` to return to the procedural,
elevation-painted colours. `riverOverlay` draws the DEM-derived rivers as
glossy water; it is off for photographic textures, which already show the real
rivers.

### Clouds and rivers

* **Camera-following shadows** — the sun's shadow map follows the camera
  focus and tightens as you zoom in, so landmarks and relief get crisp
  shadows at destination views.
* **Clouds** — `src/three/clouds.js`. One procedural density field drives a
  drifting cloud layer above the peaks *and* cloud shadows on the terrain
  and ocean (each surface point looks up along the sun direction). The
  focused destination is kept clear. Drift speed scales with the camera
  distance, so clouds glide visibly in the wide opening view and stay gentle
  up close.
* **Flying through the clouds** — `src/three/cloud-veil.js`. The initial
  zoom (scrolling from the opening view to the island overview) passes
  through cloud: a full-screen layer of three procedural cloud sheets streams
  outward with parallax, thickens to a white-out and parts from the centre to
  reveal the island. It is scrubbed by the same scroll as the camera, so
  scrolling back up to the top zooms out through the clouds again. Moving
  between destinations has no cloud effect. Marker labels fade while inside
  the cloud; the effect is disabled for reduced motion. Tune it with
  `CLOUD_VEIL_CONFIG`.
* **Rivers** — the river channel of `terrain-vegetation.webp` (baked with the
  terrain) turns DEM-derived rivers into dark, glossy water that reflects the
  sky.

### Height sampling — `src/terrain/terrain-sampling.js`

Heights are interpolated from the **rendered triangles** (a 2 km uniform grid
indexes the triangles; a barycentric test finds the one under a point), so
markers and objects sit exactly on the visible surface:
`worldY = coastLift + heightKm × multiplier`.

### Placement — `src/geography/destination-placement.js`

Each destination's lon/lat is projected, its surface height sampled (Nuwara
Eliya therefore sits high in the hills), and per-destination offsets applied.
Objects rest on the lowest point of their footprint so they never float on
slopes. These placement records are the *only* positions used by markers,
landmarks and the camera.

### Camera — `src/three/camera.js`, `src/animation/camera-animation.js`

Poses are expressed relative to a focus target (target, distance, azimuth,
tilt, on-screen framing). The camera position is
`target + distance · (sin t · sin a, cos t, sin t · cos a)`, and
`setViewOffset` shifts the target beside the card without rotating the view.
`focusDestination()` flies there with a GSAP timeline and a temporary "hop"
proportional to the distance travelled. New flights start from the current
mid-flight pose, so rapid scrolling or clicking never jumps. Hero → overview
is a scroll-driven blend followed with exponential damping.

---

## Architecture

```
index.html                     semantic page shell (loader, header, hero, island, editorial, footer)
scripts/geo/                   data download + terrain bake (Node)
scripts/assets/                image download, audio synthesis
src/main.js                    wires modules together through the transition manager
src/data/                      destinations.js (content), scene-config.js (tunables), island-outline.js (generated)
src/geography/                 projection, GeoJSON helpers, destination placement
src/terrain/                   loaders, mesh/wall builder, materials, palette, height sampler
src/three/                     renderer, scene/fog, camera rig, lights, ocean, markers,
                               model loader, procedural landmarks, landmark manager, island-world (3D root)
src/animation/                 transition-manager (state), camera director, scroll controller, page reveals
src/ui/                        loading screen, header, cards, destination nav, sound toggle, fallback map
src/audio/                     Howler ambient audio
src/utils/                     environment checks, asset loading, cleanup, smooth scroll
src/styles/                    abstracts / base / layout / components / utilities (SCSS)
```

**Single source of truth.** `transition-manager.js` holds the active
destination (−1 = overview). Only the scroll controller writes to it; the
camera, markers, landmarks, cards and nav subscribe. Marker clicks and the
destination list call `navigateTo()`, which sets the state and scrolls to the
matching step, so scroll position and state never disagree. Steps are detected
by ScrollTrigger crossings — never timers — so scrolling up reverses the story.

**One location per scroll.** `step-navigation.js` turns the destinations
section into discrete stops (overview → Colombo → … → Galle). Each wheel
flick, swipe or arrow / Page key moves exactly one stop; input is locked while
the camera pans and released only once it has settled, and trackpad momentum
is ignored until a new gesture starts, so one flick never skips a location.
Within the sticky section the page position jumps instantly (invisible — the
camera flight is the transition), which avoids races with scroll animations.
Free scrolling only applies at the edges: up from the overview zooms back out
through the clouds to the hero, down from Galle continues to the editorial.
A fast scroll that would carry past either edge is caught there, and scroll
triggers can never activate a destination on their own.

**Loading.** `asset-loader.js` tracks the *essential* assets (coastline, mesh,
terrain and ocean textures) through a Three.js `LoadingManager` with real file
and byte progress. Landmark models, audio and credits are *optional*: they load
later and can fail without affecting the page. If essential loading fails, or
WebGL 2 is unavailable, the static fallback is shown.

---

## Customisation

### Destination content — `src/data/destinations.js`

Edit names, provinces, coordinates, descriptions, images, alt text, links,
camera distance/azimuth/tilt/target offset, marker height and model settings
there. Nothing in the animation code is destination-specific; add or remove
entries and the steps, cards, nav, markers and landmarks follow.

### Replacing the 3D landmarks

Drop GLB/GLTF files into `public/assets/models/destinations/` using the names
in `destinations.js` (`colombo.glb`, `kandy.glb`, …) or change `model.path`.

* Author with +Y up, base at y = 0, 1 unit ≈ 1 km (6–8 units across reads well).
* Draco-compressed GLBs work out of the box (the decoder ships with three.js
  and is loaded only when needed).
* Tune `model.scale`, `model.rotationY` (degrees) and `model.offset`
  (`[east, up, south]` km).
* Missing or broken files fall back to the procedural placeholders in
  `src/three/procedural-landmarks.js` (`model.fallback` picks one:
  `skyline`, `pavilion`, `gopuram`, `tea-hills`, `lighthouse`). In development
  the browser logs a 404 per missing model; that is expected.

### Images

Replace the WebP files in `public/assets/images/destinations/` and
`public/assets/images/editorial/` (keep the names, or update the paths in
`destinations.js` / `index.html`), and update `credits.json`. Or change the
Commons titles in `scripts/assets/fetch-images.mjs` and run
`npm run assets:images`.

### Audio

Replace `public/assets/audio/ocean-ambience.mp3`, or pass another `src` to
`createAmbientAudio()` in `src/main.js`. Audio is muted until the visitor
presses the header toggle, fades in and out, pauses in background tabs and
disables the toggle if the file cannot load.

### Look and feel

* Clouds — `CLOUD_CONFIG` (coverage, altitude, scale, wind, drift scaling,
  shadow strength) and `CLOUD_VEIL_CONFIG` (when the fly-through happens in
  the intro scroll, colours) in `src/data/scene-config.js`.
* Scene tunables — `src/data/scene-config.js`: coast lift, ocean colours,
  wind direction, wavelengths, steepness and speed (`OCEAN_CONFIG.waves`),
  the FFT simulation — cascade sizes, peak wavelength, roughness, foam —
  (`OCEAN_CONFIG.fft`), surf strength, fog, sun direction and colour, camera FOV/overview/hero framing,
  flight duration and hop, marker size and colours, quality tiers.
* Terrain palette and climate zoning — `src/terrain/terrain-palette.js`
  (re-run `npm run geo:build` after editing).
* Design tokens — `src/styles/abstracts/_variables.scss`.

---

## Accessibility & performance notes

* Semantic HTML throughout; cards are real `<article>`s, inactive ones are
  `inert`. The destination list is the keyboard/screen-reader equivalent of
  the 3D markers (whose DOM labels are presentational). Visible focus rings,
  skip link, labelled sound and menu controls, Escape closes the mobile menu.
* `prefers-reduced-motion`: no smooth scrolling, instant camera cuts, no marker
  pulse or idle drift, no reveal animations; content stays fully visible.
* Pixel ratio capped (2 desktop / 1.5 low tier); phones and low-core machines
  render without shadow maps. Rendering pauses when the tab is hidden and once
  the editorial section covers the viewport. Three.js is split into a lazily
  imported chunk; the entry bundle is ~70 KB gzipped.
* Shipping data: ~1.3 MB of terrain assets in total instead of ~15 MB of raw DEM tiles.
