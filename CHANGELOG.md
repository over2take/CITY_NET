# Changelog

All notable changes to CITY_NET are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

---

## [1.8.1] - 2026-08-02

### Added

- **An optional development channel.** Off by default — `DEV=false` in `backend/.env`, and stable releases are all anyone sees unless they ask otherwise. Setting `DEV=true` makes the update check consider `X.Y.Z-dev` builds alongside releases, with a counter accepted but not required, so `1.9.0-dev` and `1.9.0-dev.7` both work and adding counters later is a build-workflow change rather than a code one. A dev build of a newer release is offered to someone on an older release, the release itself supersedes its own dev builds when it lands, and a release user is never dragged back onto a dev build of the same version.

  It takes two settings, not one, because they do different jobs: `DEV` decides what is *offered*, and `IMAGE_TAG=dev` decides what is *pulled* — `docker-compose.yml` now reads `${IMAGE_TAG:-latest}` instead of hardcoding `latest`. Setting only `DEV` would offer a dev version and then install the stable one, and would never settle: the next check sees the same dev version as newer and offers it again. So the two are checked against each other, and the two directions fail differently. `DEV=true` with a stable tag suppresses dev offers only, since a stable offer still installs correctly. The reverse — `IMAGE_TAG=dev` with `DEV=false` — is quieter and worse: dev tags are filtered out of the check, so a *release* is offered and whatever `:dev` points at is installed under its name, with the version and boot id both changing so the update reports success. Nothing can be offered honestly there, so updates are suspended until the two agree.

  Either way the reason is logged at startup and shown in the modal even when there is no update, since a suppressed channel is usually why there isn't one.

  `IMAGE_TAG` has to reach the `.env` beside `docker-compose.yml` as well as `backend/.env`: compose interpolates from the project file, not from `env_file`, so setting it in only one place silently falls back to `latest`. That is a second route into the same contradiction, and the warning names it.

### Fixed

- **One dev tag on the registry would have silenced update notices for everyone.** The tag filter was `/^\d+\.\d+\.\d+/`, unanchored, so `1.9.0-dev` passed it and then parsed to `NaN` — which made the sort comparator return `NaN`, leaving the ordering undefined and letting a prerelease surface as the newest tag, whereupon the version check correctly refused it and reported no update at all. Version tags are matched strictly now, and sorted by a comparator that understands them.
- **The in-app updater could sit on `WAITING FOR SERVER` indefinitely.** Every step failed silently — both child processes discarded their output, the route answered "Update started" before checking anything could work, and a non-zero exit from `docker compose pull` simply returned — so a stack that *could not* update was indistinguishable from one still working, and the client polled every three seconds forever with no deadline.

  The likeliest cause on a long-running instance is the compose file's own self-mount at `/tmp/docker-compose.yml`, which the update reads. A container started before that line existed does not have it, the pull fails, and everything above turns that into an endless wait — so the instances least able to update in place are exactly the ones that have been running longest.

  `POST /api/update` now checks the mount, the Docker socket and the compose project labels *before* answering, and returns `409` naming what is missing and what to do about it. Both steps append to `backend/data/update.log`, which lives on the data volume and so survives the container being replaced. `GET /api/update/status` reports phase and error, and the modal shows them, reassures at 45 seconds that a pull legitimately takes minutes, and gives up after six with the host command to fall back to.
- **A container too old to update itself now says so immediately.** Such a container answers `POST /api/update` with "Update started" and then does nothing, so the client used to wait out the full deadline to learn what could be known at once. It is asked for `GET /api/update/status` first — a route that only exists in the self-checking build — and if that is missing the modal says the container predates it and shows the command to run on the host. The response shape is checked rather than just the status code, since a setup serving `index.html` for unknown paths answers `200` with a page. Nothing is POSTed to a server that cannot act on it.
- **A successful update could hang too.** The client waited for the reported version to change, but a build without `APP_VERSION` reports `dev` before and after. `/api/version` now carries a boot id and the client waits for the restart itself.
- **The update check offered downgrades.** `hasUpdate` was `latest !== current`, so a published tag trailing the running one counted as an update — a 1.8.0 instance was offered 1.7.4. It is a numeric version comparison now, and anything unparseable (`dev`, `latest`) is never offered.

### Technical

- The update logic moved out of the admin route into `backend/updater.js`. None of it was reachable from a test where it was, which is a large part of why three separate faults sat in it unnoticed.

---

## [1.8.0] - 2026-08-01

### Added

- **Drawn generation bounds** — the city generator gains a `DRAG_RECT` / `DRAW_AREA` toggle. `DRAW_AREA` traces a boundary the way water is drawn, and generation is confined to that shape: blocks centred outside it are dropped, road seams are clipped to it, and a footprint straddling its edge is rejected. A concave shape generates nothing in its notch, so an L or a crescent works as drawn. The traced outline stays on screen until GENERATE, unlike water, which saves immediately.
- **Street layouts** — a `LAYOUT` selector offering six distinct city types. Everything downstream of the block list is layout-agnostic, so a layout only has to produce blocks and the roads between them.
  - **`GRID`** — two perpendicular families of streets with avenues every fourth line. Reads as Manhattan or Chicago, and is genuinely distinct from the default, which always produces *irregular* rectangles however it is tuned. That road hierarchy is most of what makes a grid look designed rather than generated.
  - **`SUPERBLOCK`** — the same recursive split with a much larger floor: fewer roads, larger plots, open ground between them. Soviet microdistrict or corporate arcology.
  - **`RING`** — a beltway city, San Antonio being the reference: concentric loop roads with elevated arterials running out from downtown. The corners of a square selection are left empty on purpose, because a ring city is round.
  - **`ORGANIC_CELLS`** — a Voronoi diagram with streets along the cell boundaries. The only layout with no right angles in it: streets meet at odd angles and blocks are wedges and pentagons, which reads as a town that grew around footpaths rather than one a surveyor set out. Long cell boundaries become avenues, so the network gets a hierarchy without one being invented — the long runs across the diagram are the ones that would carry traffic anyway.
  - **`DOWNTOWN`** — an elongated street grid whose blocks are cut into lots around their rim, facing the street, with the middle of the block left as back lots. Every other layout hands the generator one block per city block, so a block gets one structure — right for a tower in a park, wrong for a downtown, where what makes a dense city look dense is many narrow buildings shouldering together along the street. Roughly four times the buildings of `GRID` over the same ground. Block sizes vary rather than repeating one cell — short blocks, long ones, and the occasional enormous one where a street was never cut through, Washington Square being the obvious example — and the depth of the built-up rim varies with them, since a constant depth reads as a machine even when the frontages differ. A large block is ringed inward more than once so it reads as built out rather than hollow, stopping while there is still a back lot behind the buildings; a block too thin to have a rim and a middle becomes a terrace rather than one monolith the length of the block. `SUPERBLOCK` is deliberately left alone as the opposite idea rather than being turned into this.
  - **`BSP`** stays the default and an unrecognised layout falls back to it, so existing generation is untouched and a stale saved option cannot produce an empty city.
- **Generated water** — a `WATER` selector offering a `RIVER` across the region, a `COAST` cutting one edge off, or a `LAKE` inside it. Rivers and coastlines are most of why real cities look like themselves: they force asymmetry, cut districts apart, and give bridges a reason to exist, which until now only happened if a GM had drawn water first. `NONE` is the default and doubles as the off switch, so generation produces water only when asked and a GM who wants to draw their own is never overruled.
- **Park ponds** — a `PARK_PONDS` toggle gives some parks water as well as trees, with the trees standing back from the edge. Separate from `WATER` because they are different scales of decision — a river reshapes the whole city, a pond is scenery in one plot — and either is wanted without the other. Off by default.
- **Roundabouts** — a `ROUNDABOUTS` selector (`OFF` / `SPARSE` / `NORMAL`) putting a circus where major roads meet. It is an overlay on the finished road network rather than another layout, so one implementation serves all five: approaches are cut back to the ring, the ring is laid, and the island gets a monument where there is room for one or a stand of trees otherwise. An empty disc reads as a hole in the network rather than a junction, so every island gets something.
- **Seeded generation** — an optional `SEED` field. The same seed over the same area with the same options rebuilds the same city, so a map can be recreated or shared as a short string. Leaving it blank rolls a fresh seed, and the seed actually used is reported back beneath the field rather than written into it.
- **`REGENERATE`** — clears the previous generation in the selected area and builds afresh, for iterating on a district without hand-deleting it first. It keeps anything the GM authored: named structures, tokens, battle-map content and hand-drawn water all survive. Plain `GENERATE` still adds to what is there.
- **`UNDO` on the generator panel** — the same server-side undo as the admin header, reachable without leaving the panel.
- The panel now stays open after generating, instead of dropping back to the main admin list — generation is something you do repeatedly while tuning.

### Changed

- **Road hierarchy, skyline taper and per-zone setbacks.** Road width is graded by split depth, so arterials read as arterials and side streets as side streets. Building height now blends continuously with distance from the centre instead of stepping in bands, which turned the skyline from flat plateaus with hard seams into a taper. Corporate plots leave forecourts and slums and markets build to the lot line, via a per-zone lot coverage applied after the aspect clamp.

### Fixed

- **Water bridges no longer pierce the buildings they pass over.** Placement deliberately ignores overpasses so the ground beneath a deck stays buildable — that is what stops an elevated road sterilising every block it crosses — but nothing then stopped a tower rising straight through one. Anything under a deck is now capped just below it, and where the deck is too low to build under at all, near its ramps, the building is dropped rather than squashed to nothing.

### Technical

- **A drawn boundary is a water polygon with the sign flipped** — water keeps what falls outside, a boundary keeps what falls inside. `clipSegmentToLand` was generalised into `clipSegmentToPolygons(seg, polys, keepInside)` so the two share one implementation and cannot drift; there is a test asserting they are exact inverses. `footprintOutsidePolygon` mirrors `footprintInWater` but is stricter: water asks whether a footprint touches water at all, a boundary asks whether all of it is inside.
- A boundary of fewer than three points cannot enclose an area and is treated as absent, falling back to the plain bounds rather than generating nothing and looking like a broken button.
- Skipping a block draws no randomness, so generation without a boundary splits byte-identically to before. Tests pin that at both the split and the whole-city level.
- **`RING` fills the disc with a single sub-layout and lays its arterials over the top.** A first version partitioned the disc into annular sectors and sub-laid each one, which produced a sparse, fragmented city — a sector's bounding box is far larger than the sector, so most of what each run generated fell outside its own region and was discarded. Density is now on par with the default over the same area.
- **`RING` elevates its spokes but leaves its loops on the ground.** A closed loop has no ends to ramp down at, so an elevated ring either never meets the street network or does so at one arbitrary point. Spoke ramps are sized as a fraction of the spoke rather than a fixed length, so both ends reach the ground however large the city is — a fixed ramp longer than half the deck leaves it ending in mid-air.
- Spokes run from the innermost loop outward rather than converging on a point, which removes a starburst of dead ground at the centre and is closer to how highways meet a downtown loop.
- `LayoutFn` may return overpasses alongside blocks and roads, and `generateCity` merges them with whatever bridges the water needed. `splitCity` gained an optional minimum block size rather than `SUPERBLOCK` being a parallel implementation.
- **`Block.lot` lets a layout subdivide a block itself.** The generator trims road padding off a block, clamps its aspect toward square and applies a per-zone setback — three rules that exist to turn a whole city block into one sensible plot. Applied to lots inside a subdivided block they pad the neighbours apart, square up the narrow frontages and pull the row back off the street, which is every ingredient of a street wall undone. A block flagged `lot` skips all three, its footprint being already decided. No existing layout sets it, so all five are untouched, and there is a test asserting that.
- **Three app-wide conventions a generator must not override.** None is what its name suggests, each is asserted in a test, and getting any of them wrong produces a structure that does not look like it belongs to the same city. `color: '#00ff00'` is not green, it is the sentinel meaning "inherit the theme" — the renderer resolves anything else verbatim, so naming a real colour opts a structure out of theming entirely. `polyCount: 5` is not a quality setting: everything is drawn as a wireframe, so the segment count *is* the look, and a 16-segment cylinder reads as a bright striped cage beside a city of pentagonal prisms. And `shape: 'rhombus'` is not an octahedron, it is a player or NPC token — `TOKEN_SHAPES` treats it as one on the server, a purge spares it as player content, and `OverlapChecker` publishes it in `activeRhombuses`, so a structure using one as a finial publishes a fake token inside itself.
- **A roundabout island is a tiny lake, as far as roads are concerned.** `clipSegmentToLand` already cuts a segment out of a polygon and leaves the approaches stopping at its edge, which is exactly what a junction does to the roads meeting it — so trimming reuses the water clipper rather than a second implementation, and the ring reuses the arc sampling `RING` uses for its beltways. Siting has to handle two kinds of junction: a BSP or Voronoi network joins at shared endpoints, but `GRID` lays each street as one full-length span, so its crossings share no endpoint and are found only by intersecting segments — `segmentCrossing` was promoted out of the water clipper for that. The whole pass runs *after* `consolidateRoads`, which snaps nearby endpoints together and would otherwise snap a ring of short segments into a blob.
- **A Voronoi cell is reduced to the largest rectangle that fits it.** `Block` is `{x, z, w, d}`, and the plot filler lays buildings out along a rectangle's axes — a pentagon has no axes to work with. Fitting a rectangle inside each cell keeps that 1180-line generator completely untouched while still delivering the irregular *street pattern*, which is where nearly all of the look comes from. The rectangle rarely fills its cell, so setbacks vary from plot to plot for free. Cells are built by half-plane clipping rather than a sweepline: for the hundred or so seeds a city needs it is fast enough, and Fortune's algorithm would be several hundred lines of beach line and event queue to save milliseconds nobody is waiting on. Seeds sit on a jittered lattice — a perfect lattice gives a honeycomb as machine-made as the grid, and fully random seeds clump into slivers too thin to build on.
- **Water is generated before the split; ponds after it.** The split is already water-aware, so generating a river first means the road grid stops at the banks of its own accord and bridges are sited from the stubs left there — generating it afterwards would mean cutting finished roads, which is a different and worse problem. A park pond is the opposite case: the park only exists once the split has produced the block it sits in. That is safe because a pond is contained by its plot and never reaches a road, and ponds are kept out of the water array the split, the shoreline roads and the bridge siting were built from. A test pins it: a ponded and an unponded run of one seed give identical roads and overpasses.
- **`water_bodies` gains a `generated` column**, so a regenerate can clear its own river without destroying a lake the GM drew. Existing rows default to `0`, so everything already on a map counts as hand-drawn. The migration runs on startup — a server on older code will accept generated water but store it as hand-drawn.
- **Seeding reached the buildings, not just the layout.** `cityGen/` had a single `Math.random` (the injected default), but `generateThemedBuildingsForPlot` had forty of its own, so a seed reproduced the street layout while the buildings on it changed every run. The rng is threaded through to the plot filler. It is deliberately not crypto-backed: 1.7.1 moved outcome-deciding rolls to OS entropy, and city layout is cosmetic.
- **`POST /purge-region`** clears a region's generated content in one transaction and emits a single update, rather than the panel issuing a delete per object. It distinguishes generated content from authored content by `isUserDefinedName`, token classification, battle-map membership and the new water flag.
- Region membership and counting moved out of `AdminPanel` into `cityGen/region.ts`, and seeding into `cityGen/rng.ts`, so both are testable without rendering the panel.

---

## [1.7.4] - 2026-07-28

### Added

- **Map export** — a new **EXPORT** tab in the admin panel writes the city out as a top-down PNG or a WebM video. Both frame the whole map from actual content bounds, so everything lands in one shot however far the city sprawls, and both carry a translucent `CITY_NET` watermark with the repo URL beneath it.
  - **Resolution** — `1080P` / `2K` / `4K` / `8K`. The names describe width; height follows the city's aspect ratio, and the pixel count is shown beside each label so the mapping is unambiguous. Video is capped at 2K.
  - **Record length** — 5 / 10 / 30 seconds, with a `● REC` indicator and seconds-remaining readout while capturing.
  - **`INCLUDE_GRID`** (on) puts the ground grid in the shot, where it reads as map paper. **`INCLUDE_HIDDEN`** and **`INCLUDE_TOKENS`** (both off) keep GM-only structures and player tokens out, so a shared export cannot leak secrets and is a clean map rather than a snapshot of where everyone stood. Tokens never affect framing in either state, being mobile.
  - **`TRANSPARENT_BG`** renders the PNG without the theme background, for compositing over paper texture in an image editor. PNG only — WebM has no dependable alpha channel.
  - Files are named after the live map: `nightcity-2026-07-28.png` rather than `city-map-1753718400000.png`.
- **Export framing from real city bounds** — bounds account for building rotation (via circumradius, correct for all three rotation axes), road width rather than just centrelines, water bodies, and overpasses. The camera centres on the city centroid, so a city generated off-origin is no longer cropped.
- **Sign rotation on all three axes** — signs gain `rotation_x` and `rotation_z` alongside the existing yaw, with sliders and `LAY_FLAT` / `STAND_UP` presets. `LAY_FLAT` pitches a sign face-up with its text running north, so signs work as ground labels read from a top-down view.
- **`UNDO` in the DRAW_WATER panel** — the same server-side undo as the admin header, so a mistraced body can be reverted without leaving the panel.
- **The live map is remembered** — `active_map_name` is recorded in `global_settings` when a map is saved or loaded and cleared when the world is wiped. Nothing tracked this before: loading a map replaced the world and forgot where it came from.

### Fixed

- **Signs no longer lose their rotation on save** — a sign pitched flat sprang back upright on reload. Nothing in the stack handled pitch: the save path read only `rotation.y`, the schema stored only `rotation_y`, and the renderer hardcoded the other two axes to zero. All three now persist end to end. Existing signs are unaffected — the migration defaults to 0 and the renderer coalesces nulls.

### Technical

- **Recording renders off-screen rather than mirroring the live canvas.** Mirroring pinned the video to the window size and meant the resolution choice could not reach it. Rendering through its own camera also means recording never touches the live view — no camera fly-to, no locked controls — and it can reuse the PNG's orthographic camera, so the video is square-on rather than a perspective view leaning at the edges. `makeExportCamera` is shared by both paths so they cannot drift apart.
- **One off-screen `WebGLRenderer` is reused for the session.** Building one per export exhausted the browser's WebGL context budget, at which point it evicted the live city canvas and the scene went black. `forceContextLoss()` was the cause of the loss it was meant to prevent.
- **PNG size is clamped to what the GPU can render**, read from `MAX_RENDERBUFFER_SIZE` and `MAX_TEXTURE_SIZE`. The clamp considers both axes: a tall narrow city at 4096 wide implies a height several times that, and breaching the limit fails the render outright or returns a blank image. Aspect ratio is preserved when scaling down, and the reduction is logged rather than silent.
- **The recording countdown derives from a wall-clock deadline** rather than decrementing per tick. Rendering the scene twice per frame starves timers, and a decrementing counter loses every dropped tick permanently — the display fell behind and then snapped from a few seconds straight to zero when auto-stop fired.
- **Frames are throttled to 30fps.** `requestAnimationFrame` fires at the display rate, and anything above what the recorder samples is GPU work thrown away.
- Recorder codec falls back vp9 → vp8 → webm → browser default, with `onerror` handling so a failed capture cannot wedge the button on `STOP_RECORDING`.
- The grid's fade radius is widened for the duration of an export. `fadeDistance` is tuned for the interactive camera, and both paths frame the city from far above it, so the grid faded to nothing exactly when `INCLUDE_GRID` asked for it.
- Hidden structures are baked into shared `InstancedMesh` draw calls and cannot be switched off by scene traversal, so the export suppresses them through `renderLists` and waits for the commit before capturing.
- **`preserveDrawingBuffer` removed from the main `<Canvas>`.** It was required while recording read the live canvas; now that recording renders its own frames, it was a permanent cost to every player for nothing. `overheadFlyHeight` and the canvas-mirroring composite loop went with it.

---

## [1.7.3] - 2026-07-27

### Added

- **Custom dice** — the GM can define dice with any number of sides and any face values, and every connected player can roll them.
  - **CUSTOM_DIE.EXE** — draggable build window opened from the dice roller. Name is required and must not collide with a standard die or an existing custom die; the side count is typed and confirmed with SET, which generates one input per face (20 visible before the list scrolls).
  - Faces accept anything — numbers, words, symbols. A roll is summed only when every face is numeric; otherwise the result lists the faces with no total. Signed values like `+1` count as numeric, so ladder-style dice still total correctly.
  - Dice are stored server-side and shared with the table. `GET /api/custom_dice` is public so players see the GM's dice; create, edit and delete are admin-only. Each change broadcasts `customDiceUpdated` with the full list, so players already online pick up a new die without reloading.
  - Only admins see the create button, the edit cog and the delete control.
- **System dice** — `GET /api/system_dice/:system` serves read-only dice that ship with a game system, merged into the roller ahead of the GM's own. They are defined in code rather than seeded into the database, so an app update changes the definitions with no migration and there is no row for an admin to edit or delete — the route exposes no write verbs at all. Seeded with the Fate ladder die (`dF`), dormant until a Fate system is added.

### Changed

- **Roll definitions are resolved server-side.** `requestCustomDiceRoll` now takes only a die id and reads the definition from the database (or the built-in manifest); it previously accepted a die object from the client, which meant face values could be forged.

### Fixed

- **Custom dice rendered nothing in the tray.** `DiceScene` infers the die shape from the results key parsed as a number, but custom rolls key by die name — `parseInt('Fate')` is `NaN`, which built a sphere with `NaN` segments and drew no dice. Rolls now carry a `diceSides` map and a `sidesForKey` helper resolves the shape, so a 4-sided die renders a tetrahedron. The helper falls back to a d6 rather than `NaN` for any unrecognised key, and sphere segments are capped so a 999-sided die cannot stall the tab.
- **Editing a die with the window already open left the form blank.** The builder seeds its fields from `useState` initializers, which only run on mount, so clicking the cog changed the prop without reloading the form. App now keys the component on the die being edited; the window position moved up to App so it no longer jumps back to centre on the remount.

### Tests

- 585 backend / 844 frontend — new suites: `custom_dice` (API validation, auth, duplicate-name conflicts), `system_dice` (manifest integrity, absence of write routes), `sockets.customdice` (built-in vs database resolution, summing rules, count clamping, forged-payload rejection), `CustomDieBuilder` (create/edit modes, name-clash rules, reload-on-target-switch), `useCustomDice` (merge order, locked flag, broadcast handling, mutation errors), plus `sidesForKey` coverage in the dice tray suite.
- Fixed a latent hook bug in `useApi.test.ts`: `beforeEach(() => mockFetch.mockReset())` implicitly returns the mock, which Vitest then calls as a teardown function — invoking `fetch()` with no arguments.

---

## [1.7.2] - 2026-07-27

### Added

- **Basement floors in battle maps** — floor designation now supports `B#` (Basement N) in addition to Penthouse, Level, and Lobby. The elevator button order is PH → L# (descending) → LBY → B# (descending), matching physical building layout top-to-bottom.
- **Hide / reveal structures** — admin selection panel gains a HIDE_STRUCTURE / REVEAL_STRUCTURE toggle. Hidden structures are invisible to players; admins see them as a gray wireframe overlay with a `[HIDDEN]` label. State is persisted in the database and synced to all clients in real time.

### Changed

- **Parks generated by city gen no longer show signage** — holotree trunks are now created with `has_signage: 0`, and the location POST handler correctly stores the field so the setting survives a server restart.
- **Signage checkbox removed from the per-structure edit modal** — the sidewalk option is no longer relevant per building and has been removed from the UI.

### Fixed

- **Grid snap jump on enable** — enabling GRID_SNAP no longer teleports the selected object. The object's position is rounded to the nearest integer when snap is turned on, so the first dragged frame starts from an already-aligned position.
- **Road traffic flicker** — `GhostTraffic` cars were teleporting on every render because the `weights` array reference changed each tick, causing the `packets` memo to regenerate all car positions and speeds simultaneously. Route data is now held in a ref so `packets` only regenerates when the route count or car count actually changes.
- **Building flicker on hide/reveal** — toggling hidden state no longer causes a visual pop. Both `selectedLocation` and the `locations` array are updated atomically in a single render, so the building never momentarily switches between the instanced and interactive render paths.
- **Auto-signage z-fighting** — signs on building faces are pushed 0.04 units outward from the wall surface, eliminating the blink caused by coplanar geometry.
- **Signs one-sided** — signs were invisible when viewed from behind. Each sign is now rendered as two `FrontSide` planes back-to-back (via a `TwoFacedSign` helper with a render-prop material), so text reads correctly from both directions without mirroring.

---

## [1.7.1] - 2026-07-26

### Added

- **Water-aware city generation** — the generator predated water bodies entirely and built straight through lakes.
  - The BSP split clips each road seam to land as it lays it, so the grid stops at the shore rather than being drawn across the water and trimmed back.
  - Buildings, parks and landmarks all avoid water through a single check in the placement test. Plots centred in water are skipped; plots that merely touch a shoreline still build on their dry side.
  - **Shoreline roads** — each water body gets a road just inland of its edge, so approaches meet a waterfront junction instead of dead-ending at the water.
- **Generated bridges** — roads that meet water can be carried across by an overpass, the first time generation has produced one.
  - Crossings are sited deliberately: a road end at the shore is probed across the water and kept only when it reaches a far bank in range, comes down on dry ground, and lands on a road facing back — so every bridge joins two pieces of the network.
  - Ramps run the full length of their approach road (capped at 120), touching down at that road's junction rather than part way along a block. The two approaches differ, so runs are set per end.
  - Deck levels are 6/9/12/15, assigned by graph colouring over which decks cross. A bridge takes the lowest level none of its crossing neighbours hold, and levels beyond what its approaches can reach at a fixed 1:3 grade are excluded — height is bought with ramp length, never steepness.
  - **House rule: OVERPASS_DENSITY** — new control in CITY_GENERATOR (off / sparse / normal / heavy) scaling both how many crossings are bridged and how far a span will reach (120 / 200 / 300 units).
- **Crypto-backed dice** — every roll that decides an outcome now draws from OS entropy instead of `Math.random`. Backend rolls (roll engine, CP:R/CWN/SR6 attacks, dice tray, initiative) use `crypto.randomInt`; frontend initiative systems use `crypto.getRandomValues`. Visual and cosmetic randomness is unchanged.

### Changed

- **City generation extracted to `frontend/src/cityGen/`** — roughly 420 lines moved out of a JSX click handler in AdminPanel into a pure module that takes bounds, options and world state and returns blocks, roads, buildings and overpasses. Persistence and UI state stay in the component. The random source is an injected parameter, which is what makes the module testable; behaviour is unchanged on a dry map.

### Fixed

- **Buildings could sit inside existing structures** — the collision grid filed each obstacle under the single cell holding its centre while lookups scan a 3×3 neighbourhood, so anything wider than one 20-unit cell was only detected near its middle. Obstacles are now registered across every cell their footprint covers, with an always-checked list for degenerate sizes.
- **Buildings could sit on roads** — two causes. The road test compared a road's nearest point to a building's *centre*, which reads as clear whenever a road clips a corner; it is now an exact segment-versus-box clip. And the themed generators emit most of a structure relative to a cleared root without testing each piece, so wings and annexes escaped the check entirely — finished plots are now re-checked and rolled back whole if any piece landed badly.
- **Roads crossed under the waterfront road without joining it** — approaches overshot it and stopped just past it with no shared point, so consolidation could not link them. Road ends near the waterfront are now pulled onto it.
- **Pillars speared overpasses passing beneath them** — pillar placement checked roads only. It now also skips a column that would pass through a lower deck, while leaving pillars that merely stand under a higher one. Applies to hand-drawn overpasses too.

---

## [1.7.0] - 2026-07-23

### Added

- **Initiative tracker** — full real-time initiative system across all supported TTRPG systems. Start/end initiative per scene, roll and re-roll, drag-to-reorder, admin remove, late-join flow, and multi-scene combats that share a single turn counter.
  - **Generic** — 1d20 roll; TURN counter; order held for entire combat.
  - **Shadowrun 6e** — REA + INT + Nd6 roll (Wired Reflexes extra dice selector); PASS counter; end-of-pass −10 score decay; survivors carry decayed scores into the next pass; new-round banner when all scores drop to zero.
  - **Cyberpunk RED** — REF + 1d10 roll; ROUND counter; order held for entire combat (RAW). Exploding d10 available as an opt-in house rule (rolling 10 adds 10 and triggers another roll, chaining while 10s keep coming).
  - **Cities Without Number** — side-based initiative (RAW default) and individual initiative (opt-in house rule). 1d8 + DEX mod per combatant; ROUND counter; PCs win ties. PLAYERS side score auto-derived from the best individual PC roll; NPC side auto-created on the first enemy roll with its own 1d8; friendly NPCs slot into the PLAYERS side. Sub-ordering within sides is drag-to-reorder. Individual initiative available as an opt-in house rule in AdminPanel.
- **Initiative sidebar panel** — admin sees the tracker inline in the sidebar; players see it as a floating window or sidebar panel depending on layout.
- **Initiative nav button blink** — the initiative button pulses green (matching the unread-chat animation) when the admin starts initiative or a new SR6 round begins, prompting players to roll.
- **Sheetless NPC manual roll** — admin can type a score directly into the token context menu and add a sheetless NPC to the initiative order without a linked sheet.
- **Floor-aware NPC display** — in building battle maps, the tracker only shows NPCs on the current floor; players and city-map combatants are always shown.
- **Roll breakdown in dice tray** — initiative rolls appear in DICE_TRAY.EXE history with full breakdown: `REA(5) + INT(2) + 1d6(4) = 11` for SR6, `REF(6) + 1d10(8) = 14` for CP:R.
- **EXPLOD animation** — when the CP:R exploding-die house rule is active and a 10 fires, the combatant row flashes white→green and displays an EXPLOD badge; the dice tray history appends 💥EXPLOD.
- **SR6 NPC sheet stats** — bulk NPC rolls read REA/INT from the linked character sheet (`sheet_data` joined on location GET) rather than falling back to 3+3.
- **Player sheet stats** — player JOIN rolls fetch the player's own sheet via `GET /api/sheets/own` so REA/INT/REF are used instead of defaults.
- **House rule: Exploding Initiative Die (CP:R)** — added to the CP:R section of the House Rules panel in AdminPanel.

### Changed

- **Initiative system registry** — `InitiativeSystem` interface and `getInitiativeSystem(key)` registry extracted to `frontend/src/modules/initiative/systems/`; each system is an isolated module (`generic.ts`, `sr6.ts`, `cpr.ts`).
- **`RollOptions` interface** — shared options bag (`extraDice`, `explodingInitiative`) replaces positional args; each system reads only its own fields.
- **`diceResults` keys** — changed from `Record<number, number[]>` to `Record<string, number[]>` to match JSON serialization (object keys are always strings after a round-trip through SQLite).
- **Initiative system registry** now includes `cwn.ts`; `InitiativeSystem` interface gains `defaultMode?: 'individual' | 'side'`.

### Fixed

- **Combatant row drag** — browser was intercepting the avatar portrait as a native image drag instead of triggering the row's drag handler. Fixed by adding `draggable={false}` to portrait `<img>` elements and setting a transparent ghost image on drag start.
- **Side-view drag-and-drop** — `dragSideId` was stored as React state, causing it to be stale (`null`) when the first `dragOver` event fired immediately after `dragStart`. Converted to a ref so handlers are always synchronously current; visual indicator state (`dragOverSideId`) kept separate. Also tightened `onDragLeave` to only reset on genuine container exit (via `relatedTarget` check) rather than on every child-element transition.

---

## [1.6.4] - 2026-07-20

### Changed

- **Admin panel tabs** — reorganized the admin panel into three tabs: `CITY` (map and structure tools), `GAME` (TTRPG system, currency, pay players, bank sounds, purge chat/rolls), and `PLAYERS` (online/offline player lists with grant/revoke admin, edit requests, active editor).

---

## [1.6.3] - 2026-07-20

### Fixed

- **Docker data persistence** — all map and character data was lost on container
  restart or image update because `DB_PATH` was only set in `docker-compose.yml`.
  Running the container without compose fell back to the ephemeral `/app/city.db`
  inside the container. `ENV DB_PATH=/app/data/city.db` is now baked into
  `Dockerfile.backend` so the correct mounted path is always used.
- **Dirty image builds** — `backend/data/` was missing from `.dockerignore`,
  meaning a locally-built image could accidentally bundle the developer's database
  into the published artifact. Both `backend/data/` and `backend/uploads/` are
  now explicitly excluded.
- **DB path startup log** — the resolved database path is now printed on boot
  (`[db] opening database at: …`) for easier deployment debugging.
- **In-app update wipes data** — the self-update route mounted the host project
  directory at `/project` inside the helper container, so compose resolved
  `./backend/data` to `/project/backend/data` and passed that to the host Docker
  daemon. The daemon found no such path and created a new empty bind mount,
  wiping all map data on every in-app update. Fixed by mounting at the host's
  own absolute path so the daemon receives paths it can actually resolve.

### Added

- **Docker config regression tests** — `backend/__tests__/docker_config.test.js`
  asserts that `Dockerfile.backend` contains the required `ENV DB_PATH` and
  `mkdir` directives and that `.dockerignore` excludes the data and uploads
  directories; failures block CI before any image is built.
- **CI Docker validation job** — `validate-docker-config` job in `ci.yml` runs
  shell-level grep checks against `Dockerfile.backend` and `.dockerignore` on
  every PR and push to main, catching regressions before the release workflow runs.

---

## [1.6.2] - 2026-07-19

### Fixed

- **Docker build** — extend `npcSheetGenerated` socket type in `useSocket.ts` to include `system`, `portrait_url`, `sheet_name`, and `sheet_description`; TypeScript was rejecting the fields added in 1.6.1 and failing the production build

---

## [1.6.1] - 2026-07-19

SR6 polish: drain resistance, glitch feedback, Edge management, NPC sheet fixes, and name/description sync.

### Added

- **Drain resistance** — each spell row in the AWAKENED tab gains a yellow RES button (enabled when Drain Value and tradition attribute are set); clicking it rolls WIL + tradition attr, applies net drain to the Stun track, and overflows excess into Physical HP automatically
- **Glitch / Critical Glitch banner** — dice tray displays a pulsing yellow GLITCH or red CRITICAL GLITCH banner after any SR6 pool roll that qualifies; clears on the next roll
- **SR6 Edge management (admin)** — Admin Panel SR6 section adds REPLENISH ALL EDGE (resets every player's Edge to their max) and a per-player GIVE 1 EDGE button (online non-admin players only, capped at max)

### Fixed

- **NPC sheet system mismatch** — OPEN_SHEET now only shows when the linked sheet's system matches the active game system; a CWN sheet no longer surfaces under SR6 and vice versa
- **GENERATE_SHEET → OPEN_SHEET flip** — button switches immediately after generation without requiring the token window to be closed and reopened; `system` is now included in the `npcSheetGenerated` socket event
- **Edge pips not rendering** — pip display now uses the higher of current or max edge so pips appear even before `edge_max` has been explicitly saved
- **NPC sheet name/description sync** — editing name or description on an NPC sheet updates the linked map token label live (sheet → token); saving an enemy/friendly token with a changed name or description patches the linked sheet (token → sheet); generation already seeded both fields from the token

---

## [1.6.0] - 2026-07-18

Shadowrun 6E — third full game system, built entirely on the existing sheet/roll/attack architecture.

### Added

**Shadowrun 6E system**
- **SR6 character sheet** — 9 attributes (BOD–EDG), Essence/Magic/Resonance, 16 consolidated skills rolled as d6 pools, 4 weapon rows (DV / AR / mode / atk), Edge pips (spend-by-click, CP:R LUCK pattern), derived Physical/Stun monitors, initiative score and composure recomputed on every save
- **Pool dice engine** — new `pool` roll shape: pool size = attribute + skill (+mods), 5s and 6s are hits, glitch when half or more of the pool shows 1, critical glitch on a glitch with zero hits; results land in the dice tray as `N hits / M dice`
- **Two damage tracks** — Physical monitor lives on the token (HP bar as usual); Stun is a sheet track that clamps at the Stun Monitor and overflows the excess into Physical automatically, server-side
- **SR6 attacks** — one ATTACK button: attack pool, weapon Attack Rating compared to the target token's Armor Rating shifts DV ±1, damage applies to Physical with a "GM: soak BOD+ARMOR" prompt (soak stays manual per RAW-lite)
- **Auto-rolled defense** — defenders backed by a sheet dodge automatically (REA + INT pool, shown in the dice tray); net hits decide the hit and add to the DV; sheetless tokens don't defend
- **Stun bar in the health window** — SR6 health review shows the Stun track (cyan bar, red + overflow warning when full) under the Physical monitor, live-updating; served by a public two-number stun endpoint
- **AWAKENED / EMERGED tabs** — gated behind the new `sr6_awakened` and `sr6_emerged` house rules (spells/powers/tradition and complex forms/sprites)
- **SR6 NPC tiers** — Ganger / Street Tough / Shadowrunner / Prime Runner for GENERATE_SHEET, with consistent monitors, armor and weapon rows
- **SR6 sheet import** — attribute/skill aliases (BOD, AGI, cc, perc…), Edge max seeds current, plain-text stat block parser

### Changed

**Modularity pass**
- **Gated sheet tabs are data** — `GATED_TABS`/`hiddenTabsFor` config replaces per-system conditionals in the player sheet hook and the admin NPC window
- **One import mapper** — `makeMapFields` factory: CP:R / CWN / SR6 importers are now alias tables + numeric sets around a single shared loop
- **Shared attack scaffolding** — target lookup and `attackResult` emission extracted from the CWN and SR6 handlers; per-system attack code is rules only

---

## [1.5.1] - 2026-07-17

NPC portraits with a glitchy TV/CRT effect, stock headshot library, and token info window improvements.

### Added

**NPC portraits**
- **Stock headshot library** — 16 bundled NPC headshots (new art by **PaMuDA**) served from `frontend/public/npc-headshots/`; `GENERATE_SHEET` auto-assigns a random headshot to new NPC sheets
- **HEADSHOTS picker** — admin button on the NPC sheet window opens a `<  N/16  >` prev/next navigator to browse and assign any stock headshot; seeds to the current portrait when it's a stock image
- **`TvPortrait` component** — reusable, self-contained glitchy TV/CRT portrait effect (chromatic R/B fringe, scanlines, rolling refresh band, intermittent glitch jitter) usable on any portrait; `BracketPortrait` and the token info window both use it
- **FX toggle** — per-sheet `portrait_shadow_filter` field with an FX ■/□ button under the sheet portrait enables/disables the TV effect (on by default)
- **Public token identity route** — `GET /api/sheets/npcs/link-public/:location_id` returns sheet name + portrait only (no stats/description) for enemy and friendly tokens

### Changed

**Token info window**
- Title now reads `ID: {sheet name}` from the linked NPC sheet instead of `HOSTILE_NODE`
- Portrait from the linked sheet displays in the window with the TV effect
- `DATA_DESCRIPTION` pulls from the linked sheet's description (admin view); falls back to the data point's description
- All players (not just admin) now see a linked token's name and portrait; description and stats remain admin-only — the GM builds mystery manually by leaving a token unlinked or unnamed
- `EDIT_DATA_POINT` is hidden for tokens linked to a sheet — the sheet drives name/description
- `CHECK_HEALTH` now opens only the health window; the quick sheet card no longer auto-opens with it

---

## [1.5.0] - 2026-07-16

Cities Without Number (CWN) — second full game system, accessibility theme picker, and a major frontend deduplication pass.

### Added

**Cities Without Number system**
- **CWN character sheet** — 6 attributes with SWN modifier table (0/unset → neutral, not −2), 3 saving throws, 19 skills (2d6 plain sum), combat stats (BHB, AC as token-linked writable field), System Strain (current/max), conditions (Frail, auto-initiative), and a Deluxe tab (4 spell rows + summoning) gated behind the `cwn_deluxe` house rule
- **Armor section** — players enter BASE_AC + DEX_CAP + SHIELD_BONUS; `cwnEffectiveAc` computes and pushes the result to the token on every save; field stays hand-managed when armor is blank
- **CWN combat** — single ATTACK button (same UX as CP:R); 1d20 + BHB + skill + attr mod roll-to-hit vs target AC; damage roll + attr mod; trauma die checked against the defender's Trauma Target (default 6) — rating is the damage multiplier; shock damage on miss if target AC is low enough; all results land in the dice tray
- **Stabilize flow** — MORTALLY WOUNDED banner at 0 HP; clicking STABILIZE rolls the clicking user's 2d6 + Heal + INT mod vs DC 8 + rounds since downed (+ 2 without tools); on success: target becomes Frail and gains 1 HP after the dice animation completes; on failure: `rounds_since_downed` increments; allies see the STABILIZE button on the Health Review window (their Main Action per RAW)
- **FRAIL banner** — shown above 0 HP when the `frail` flag is set; CLEAR FRAIL button (GM-approved) clears it
- **STIM_HEAL** — field-healing shortcut adds +1 System Strain then heals; refuses with STRAIN MAXED (409) when at max
- **LONG REST** — admin panel button recovers 1 strain on every CWN sheet
- **Spell rows** — manual name/effect/damage/cost fields; per-row CAST button rolls damage if present, spends Effort, flags OVERCAST! if insufficient
- **CWN house rules** — `cwn_trauma` (default ON — gates trauma die and major-injury flow) and `cwn_deluxe` (default OFF — gates Deluxe tab); data-driven `HouseRulesPanel` component replaces both old bespoke IIFE blocks
- **CWN NPC tiers** — Warrior / Expert / Boss / Elite combat tiers + 3 Spirit tiers; each stamped with `trauma_target: 6`; NPC melee DV formula is system-specific (CP:R formula only for `cyberpunk_red`)
- **CWN sheet import** — alias mapping for all 19 skills, armor fields, spell rows, and `trauma_target`

**Accessibility — login theme picker**
- **Theme picker on login screen** — custom dropdown ("THEMES ∨") lets players change the UI theme before logging in; each option is styled in its own theme's primary colour
- Theme saved to `localStorage` immediately; written to `player_accounts.theme` on login
- Theme returned in the JWT payload and applied on every session without a re-login
- Logo scene glow, non-animated text, and version badge all follow the active theme
- Standalone sheet tab reads theme from the socket auth handshake (`currentTheme` prop) or `localStorage` fallback

### Changed

**Frontend deduplication**
- **`usePlayerSheet` hook** — extracted shared sheet state, debounced saves, house-rule fetches, and action emitters (roll / deathSave / stabilize / castSpell) from both `CharacterSheetWindow` and `SheetPage`; both surfaces now share one implementation and have full CWN feature parity
- **`SheetAttackPanel`** — unified component replaces the separate `CprAttackPanel` and `CwnAttackPanel`; driven by `ATTACK_PANEL_CONFIG` keyed by game system
- **`hasSheetCombat(system)`** — exported from `Sidebar.tsx`; all `gameSystem === 'cyberpunk_red' || gameSystem === 'cities_without_number'` checks in App and Sidebar replaced with a single capability predicate; adding ruleset N requires only one config entry
- **`HouseRulesPanel` component** — data-driven (accepts `HouseRuleDef[]`); CP:R and CWN house-rule panels are now one-liners

**Dice tray**
- Back-to-back broadcasts (e.g. to-hit + damage from a single attack) are now queued and played sequentially instead of overwriting each other; dice rolls play for 5 s, dice-less results (shock) for 0.8 s

### Fixed
- Unset stats (value 0) now map to modifier 0 under the SWN table — previously bucketed as ≤ 3 → −2
- AC on the character sheet now reads from and writes to the token's `melee_ac` / `ranged_ac` fields; unset token AC defaults to 10
- Health review window was resolving to the enemy's token when both the enemy and the player share the same owner; now prefers the `rhombus` shape
- Stabilize / death-save outcome (Frail flag, HP write, penalty) now applies after the dice animation completes (`DICE_ANIM_MS` delay), not before
- NPC tiers generated for non-CP:R systems no longer receive the CP:R melee-DV formula
- Trauma die now resolves against the defender's Trauma Target (default 6), not the weapon's rating; rating is the damage multiplier
- Version text on the login screen now uses the theme's `--green` colour with bold weight and glow

---

## [1.4.1] - 2026-07-14

### Fixed
- **App version fallback** — backend `/api/check-update` now reads the running version from `package.json` when the `APP_VERSION` env var is not set (manual installs and dev environments no longer show a false "update available" prompt)

---

## [1.4.0] - 2026-07-13

Cyberpunk RED character sheets: the full Phase 3-5 sheet system, making CP:R the first feature-complete game system.

### Added
- **Character sheet system** — template-driven sheets (one renderer, per-system templates); player window, admin view of any player/NPC sheet, standalone browser tab (`?sheet=true`), quick-sheet card, portrait upload with TV-glitch effect, segmented HP bar (green/yellow/red)
- **Server-authoritative rolls** — stat/skill rolls resolve against the stored sheet (exploding CP:R check die); results land in the dice tray and history
- **CP:R combat flow** — single ATTACK button; weapon picker from structured sheet weapon rows (name/DMG/skill/ROF); to-hit vs token DV; aimed shots (−8, head, ×2 damage through armor); damage auto-rolled, soaked by defender SP, armor ablation on penetration; damage writes through to token HP; attack animation follows the weapon type (melee/ranged)
- **SP SHIELD** — defender's shield intercepts damage first and breaks down point-for-point; overflow soaks against location SP
- **Critical injuries** — two+ max-face damage dice trigger +5 direct damage (ignores armor/shield) and prompt the GM to roll the book's injury table (table not embedded)
- **Death saves** — MORTALLY WOUNDED banner at 0 HP with DEATH SAVE button; 1d10 + escalating penalty vs BODY (natural 10 always fails); penalty resets on healing above 0
- **Seriously Wounded** — banner at ≤ threshold HP; −2 to all checks applied server-side (−4 while mortally wounded)
- **Armor penalty** — heavy-armor stat penalty applied to all REF/DEX-keyed checks and attacks
- **LUCK on rolls** — arm pips on the sheet (declared before the roll, per RAW) for a flat bonus on the next roll; spend is capped/decremented server-side; attack panel has its own LUCK selector
- **House rules panel** (ADMIN → TTRPG_SYSTEM, staged APPLY/REVERT) — `MELEE_DV TAKE-10` (10 + DEX + Evasion instead of 6 +) and `LUCK BONUS ALSO NEGATES NAT-1` (also unlocks a dedicated 1-LUCK fumble shield); rules apply live via settingsUpdated
- **LUCK pips + admin reset** — hexagonal pips on the sheet header; RESET_ALL_LUCK in the admin panel restores every player to max
- **Humanity → EMP** — editing Humanity recomputes current EMP (= Humanity ÷ 10) on every write path (template-declared derived fields)
- **NPC library** — create/delete NPC sheets, folders with MOVE control, ATTACH sheet to a token, OPEN full sheet editor; NPC sheets mirror their linked token's HP live
- **Leveled NPC generation** — GENERATE_SHEET takes a per-system tier (CP:R: MOOK/SKILLED/PRO/ELITE) seeding stats, skills, armor, weapons, token HP and DVs; melee DV computed from the sheet (6/10 + DEX + Evasion), GM can override via EDIT_DV
- **Sheet import** — IMPORT on every sheet window: fillable-PDF form extraction, JSON paste, or stat-block text; per-system alias mapping with preview before apply; linked fields (HP/cash) refused with explanation
- **Token defense per system** — MELEE_AC/RANGED_AC labels become MELEE_DV/RANGED_DV under CP:R; CP:R hides the two-button melee/ranged flow behind one ATTACK button
- **OPEN_SHEET on token windows** — players open their own sheet from their token; admins open any player's or NPC's sheet from any token
- **`npm run dev` (backend)** — nodemon auto-restart so backend code changes apply without manual restarts

### Changed
- **TTRPG_SYSTEM panel** moved above CURRENCY_ICON in the admin panel; SHEETS list removed
- **Sheet UX polish** — placeholders (ghost example text) on all free-form fields, upload hint bar attached under the portrait, weapon rows replace the free-text weapons area (notes field retained), CUR ≤ MAX clamping on paired fields (frontend + server)
- **CHECK_HEALTH window** — now resolves NPC tokens and tracks live HP by token id (was frozen at open and player-only)

### Fixed
- **NPC armor ignored in attacks** — defender sheet lookup branched on token owner instead of token type, so enemy tokens (which carry an owner) never found their linked NPC sheet; SP always read 0
- **DV edits not reflected** — EDIT_DV saved correctly but the token window showed the stale snapshot until reopen
- **Death save / FIRE appearing dead** — stale backend process; mitigated permanently by the new `npm run dev` watcher

### Tests
- 377 backend / 574 frontend — new suites: `cpr_attack` (to-hit, armor, shield, crits, LUCK, death saves), `sockets.deathsave` (socket integration: death saves, NPC SP, import apply, tiered generation, fumble-shield gating), `sheet_import` (PDF/JSON/text extraction + mapping), `npc_tiers`, plus renderer/library/import-dialog coverage

---

## [1.3.1] - 2026-07-08

### Added
- **Health in broadcast info card** — when the admin clicks a player/enemy/friendly token in broadcast mode, the spectator info card now shows the heart monitor (animated EKG, flatlines at 0 HP) and injury map (body silhouette with red zone overlays, BLIND/BLEEDING flags); injury map only appears when injuries are present
- **RETURN_TO_ORIGIN button** — added to the top of the Quick Access menu; smoothly flies the camera back to world center

### Fixed
- **Broadcast zoom direction** — spectator camera was zooming toward screen center instead of the admin's cursor; fixed by deriving `lookAt` from the camera's actual forward direction rather than the orbit pivot, which `dollyToCursor` does not update
- **Dice roll broadcast delay** — spectator overlay was showing roll results immediately; now waits the same 5-second animation delay as the roller's own DiceTray
- **AC hidden from non-admin players** — the attack banner in the DiceMenu and the rhombus info window no longer show AC value or roll threshold to non-admin players; admins still see full detail

---

## [1.3.0] - 2026-07-08

### Added
- **PLAYERS panel in admin dashboard** — primary admin can grant or revoke temporary admin access to online players directly from the admin panel; offline players are listed but cannot be granted access
- **Custom confirm modals** — replaced all browser `confirm()` dialogs (PURGE_ALL_WATER, PURGE_CHAT_HISTORY, PURGE_ROLL_HISTORY) with consistent in-app modals
- **CUSTOM_STRUCTURE dashboard** — renamed JOIN_STRUCTURE to CUSTOM_STRUCTURE with updated copy explaining prefab structure classification
- **Non-admin health view** — non-admin players see only the heartbeat monitor and injury map when reviewing a token's health; HP numbers are hidden

### Changed
- **UI label clarity pass** — ACCESS_CODE → PASSWORD (all forms), JOIN_STRUCTURE → CUSTOM_STRUCTURE, GEOMETRY_PROTOCOLS → TOKEN_PROTOCOLS, all rhombus/beacon labels updated to TOKEN_*, INITIALIZE_RHOMBUS → PLACE_MY_TOKEN, and many more across Sidebar, AdminPanel, BankWindows, and UpdateModal
- **CUSTOM_SIGNS button** — moved below all `+` placement buttons and prefixed with `+` for consistency
- **Admin panel section order** — SIDEWALKS/SIGNAGE/SIGN_DENSITY moved above CURRENCY_ICON; BANK_SOUNDS grouped with CURRENCY section
- **CURRENT_SELECTION panel** — repositioned above `+ ADD_NEW_STRUCTURE` with equal padding for better visibility

### Fixed
- **Stale `elevatedUsers` bug** — `revokeEditing` and `editingFinished` now remove the user from `elevatedUsers`; previously a grant→revoke→re-request cycle gave full admin instead of an edit window
- **Stale `pendingRequests` bug** — `editingApproved` and `editingDenied` now broadcast request removal to all clients; newly-promoted temp admins no longer inherit accumulated edit requests from earlier in the session

### Tests
- `backend/__tests__/sockets.editing.test.js` — 13 cases covering approveEditing, revokeEditing, editingFinished, grant/revoke elevated access, and regression scenarios
- `frontend/src/hooks/__tests__/useSocket.pendingRequests.test.ts` — 9 cases covering pendingRequests state transitions and the stale-request regression

---

## [1.2.4] - 2026-07-07

### Added
- **Animated 3D login logo** — `LogoScene` component renders a Three.js hex badge with wireframe skyline, spinning octahedron gem, and CITY_NET text label above the login panel
- **`LogoScene.tsx`** — standalone Three.js scene (no react-three-fiber) with auto-rotation, gem bob animation, and green glow drop-shadow matching the app's CSS variables

### Changed
- **Password field labels** — `ACCESS_CODE` / `CONFIRM_ACCESS_CODE` renamed to `PASSWORD` / `CONFIRM_PASSWORD` on login, register, and password reset screens for clarity

---

## [1.2.3] - 2026-07-07

### Added
- **Silent update notification modal** — admins see a draggable `SYSTEM_UPDATE` popup on login when a new version is available; supports UPDATE NOW, REMIND ME LATER (session), and SKIP VERSION (persistent)
- **Docker vs manual install detection** — update modal shows one-click update for Docker installs; manual install users are directed to install instructions instead
- **`GET /api/version` endpoint** — lightweight no-auth endpoint returning the running version; used for post-update polling without hitting Docker Hub

### Fixed
- **Post-update page reload** — frontend now polls `/api/version` after triggering an update and reloads only when the version changes, eliminating stuck "Update in progress" state
- **Nginx cache-busting** — `index.html` served with `Cache-Control: no-cache` so JS bundles always reload after an update
- **Helper container path resolution** — `docker compose` helper mounts `hostWorkingDir:/project` and uses `--project-directory /project`, fixing cross-OS path failures on Windows hosts
- **`WATCHTOWER_API_TOKEN` removed from required env vars** — no longer triggers missing env var warning banner on admin login

### Changed
- **Button hover/active states standardized** — global `button:hover` applies `filter: brightness(1.4)` across all buttons; colored variants (danger, enemy, friendly, deploy, map save/load) use CSS classes instead of inline style overrides
- Skip version and remind-later state is independent of the manual Check for Updates button in the nav panel — skipping the modal never blocks the sidebar update flow

---

## [1.2.2] - 2026-07-06

### Fixed
- **Update polling condition** — poll now compares running version against `originalCurrent` (captured before update), not against Docker Hub `latest`; fixes stale comparison when multiple versions exist on Docker Hub

---

## [1.2.1] - 2026-07-06

### Fixed
- **One-click in-app update** — admin panel now has a CLICK TO UPDATE button; no SSH required for future updates
- **APP_VERSION baked into Docker image** — version is now embedded at build time so all users see accurate version info regardless of their local docker-compose.yml

---

## [1.2.0] - 2026-07-06

### Fixed
- **APP_VERSION sync in release workflow** — Docker images now automatically deploy with APP_VERSION matching package.json version, eliminating false "update available" notifications

---

## [1.1.9] - 2026-07-06

### Added
- **Docker Hub version checking** — admin panel button queries Docker Hub for new versions
- **GitHub Actions auto-tagging** — release workflow now tags images with version numbers from package.json
- **PR template with checklists** — ensures version bumps and env var updates before merging

### Changed
- Watchtower removed in favor of manual Docker Hub pulling and GitHub Actions workflow
- README reorganized into Docker vs Manual setup paths with clear instructions
- Added Windows PowerShell command variants for cross-platform support

---

## [1.1.8] - 2026-07-05

### Added
- **UPGRADE.md** — comprehensive upgrade guide with step-by-step instructions for pulling new versions from Docker Hub
- **Env var status check** on admin login — admins get an in-app warning if critical environment variables are missing
- `GET /api/admin/env-status` endpoint — returns list of missing required env vars

### Fixed
- Backend startup now validates required env vars and logs helpful warnings if any are missing
- Removed stale root-level `.env.example` to eliminate confusion (canonical location is `backend/.env.example`)

---

## [1.1.7] - 2026-07-05

### Added
- Manual **Check for update** button in the CITY_NET system info panel (primary admin only) — triggers Watchtower on demand via its HTTP API
- **CHANGELOG.md** added to the repo
- Changelog link in the system info panel
- **DuckDNS** support — optional `duckdns` service in `docker-compose.yml` keeps your subdomain pointed at your current IP automatically
- **Configurable host port** via `APP_PORT` env var (default `80`) — change to `8080` or any port your ISP allows; players connect to `http://yourcity.duckdns.org:APP_PORT`
- **IPv6 LAN direct connect** documented — players on the same network can connect via `http://[ipv6-address]` with no port forwarding
- Let's Encrypt / Certbot HTTPS instructions added to README for DuckDNS setups
- `DUCKDNS_SUBDOMAINS`, `DUCKDNS_TOKEN`, `TZ`, and `APP_PORT` added to `.env.example`

### Fixed
- Build failure in Docker (`tsc -b` exit code 2) — `viewSettingsUpdated` socket type was missing `renderSidewalks`

---

## [1.0.7] - 2026-07-05

### Fixed
- Custom sign position now saves correctly after using the Move gizmo — replaced unreliable `dragging-changed` event detection with an explicit **UPDATE SIGN POSITION** button
- SAVE CHANGES on a sign now reads the mesh's actual position (not stale form values) so moving then saving no longer reverts on reload
- Signs are now scoped to saved maps — they save with the map and restore/clear on load/clear
- Signs no longer travel between maps on load
- Custom signs and auto-generated building signage now render in front of traffic (renderOrder fix)
- Cleared `signMesh` and `selectedSignId` on logout to prevent stale TransformControls state
- Removed X/Y/Z coordinate fields from the custom signs panel — position is managed via the Move gizmo

### Changed
- Sign transform controls now activate explicitly via MOVE / ROTATE buttons rather than auto-attaching on selection
- Added `signs_data` column to `saved_maps` table

---

## [1.0.6] - 2026-06

### Added
- Custom signs: CRT/TV shader filter with per-sign intensity control
- Custom signs: preset sign images and image URL rendering
- Custom signs: multi-line support with per-line font size
- Custom signs: free 3D transform gizmo — move and rotate selected sign in scene
- Custom signs: camera-center placement and real-time rotation slider
- Custom signs: font selector and remote font uploader
- Auto-signage on buildings with neon, billboard, and poster variants
- Sidewalk pavement rings around structures
- Road sidewalks toggle
- View settings (sidewalks, signage) broadcast to all connected clients

### Fixed
- Sign transform mode prop wiring
- Font upload now surfaces actual server errors
- Jitter sign positions along building face with overlap check

---

## [1.0.5] - 2026-05

### Added
- Watchtower automatic update checks at 4 AM daily
- Manual Docker Hub release workflow with image tags
- NAV_OS version driven from `package.json` via Vite define
- GitHub Actions CI pipeline

### Fixed
- Watchtower Docker socket path for Windows hosts (`//var/run/docker.sock`)
- Watchtower schedule corrected from every-30s to 4 AM cron

---

## [1.0.4] - 2026-04

### Added
- Ghost traffic drives overpasses with head/tail-light styling
- Road eraser dashboard with segment, path, and purge-all tools (purge-roads)
- Overpass split start/end ramp length controls
- WASD/arrow key camera pan while drawing roads or overpasses
- Continuous mitered ribbon road geometry with undo
- Ko-fi widget in sidebar

### Fixed
- Overpass-to-overpass connectivity, snap joins, and undo support
- Overpass ramp length persistence (`ramp_length_start`/`ramp_length_end`)
- Traffic car rendering above road surface; ramp length max 160
- Road segment chaining into full streets for smooth traffic fade
- Camera pan speed and WASD direction lerping
- `rampLength=0` holds full height at both ends

---

## [1.0.3] - 2026-03

### Added
- CRT scanline effects and per-theme gradients
- Themes palette with 7 themes wired to canvas, grid, buildings, and dice tray
- Water body persistence with map save/load/clear
- Overpass persistence with map save/load/clear
- Frontend hook extraction: `useMapData`, `useSocket`, `useApi`
- 52 frontend tests (threeHelpers, useApi, themes); 35 music tests; 28 battle map tests

### Fixed
- Theme colors applied to 3D components
- Camera dolly action for scroll-wheel zoom
- Overpass renderer preview and geometry core

---

## [1.0.2] - 2026-02

### Added
- Radio feed with volume mixer (separate BG and MUSIC sliders)
- Attack animations — Phase 1–5: AC fields, attack UI, socket wiring, hit/miss animations
- ARMOR_CLASS fields in GEOMETRY_PROTOCOLS menu
- Streamer mode: director panel, broadcast overlay, spectator socket role, camera sync
- Ping system with shadow outlines and Q-key shortcut
- Measurement tool with real-time drawing and `isFinal` relay
- Player name tags with hover/selection visibility and occlusion
- Secure Mode: player account auth with admin-approval registration flow
- Admin-approved password reset flow
- NPC impersonation in global chat
- Chat V2: context menus, PM tabs, NPC puppeting
- Admin temporary delegation via global chat
- `CHECK_HEALTH` button on player rhombus info window
- High roller notification persisted to DB (fires once only)

### Fixed
- Radio feed: master mute, stale socket closure, double-click to load track
- Attack: ARMOR_CLASS label rename, AC hidden from non-owners
- Streamer: battle map camera sync, zoom broadcast, active user roster on join
- Bank animations suppressed when closed; sounds suppressed over login chime
- HP clamp when max is lowered below current
- Socket reconnect with `playerToken` in Secure Mode
- Player info window status for online players with no beacon

---

## [1.0.1] - 2025-12

### Added
- CITY_NET // BANK and admin banking dashboards
- Player rhombus path animation and battle map dedup
- Injury tracking panel with body hit zones (major injuries)
- Health review window for other players (read-only)
- Battle map image upload (25 MB limit)
- Battle map active indicator (pulsating cross-swords)
- Friendly NPC rhombuses
- Custom structure cross-map library (`JOIN_STRUCTS`)
- District management UI and backend
- Admin approval workflow for temporary editing access
- Map Manager restricted to primary admin
- Custom cinematic modals replacing all `window.confirm`/`window.alert` calls

### Fixed
- Battle map floor sync, camera orientation, rhombus scaling
- Rhombus fade animation race condition
- Bank `-0.00` display and icon coloring
- Map load preserving `map_scale_multiplier`
- Structure deletion cleaning up associated battle maps and uploads
- NPC race condition on startup

---

## [1.0.0] - 2025-11

### Added
- Initial Docker containerized deployment (backend + frontend + Watchtower)
- Procedural city generation with themed building layouts (Corpo, Urban, Industrial, Slums)
- Interactive Draw a City mode
- Road network with instanced geometry and spatial grid
- Admin and player role system with JWT auth
- Saved maps (save / load / clear)
- Dice tray with physics
- Battle map system with floor support
- Player rhombuses with drag, overlap X-ray, and health tracking
- Enemy and friendly rhombus deployment
- Global and private chat
- Measurement tool
- Tree placer tool
- Custom structure editor and premade structure picker
- Water bodies with procedural shader
- FPS counter
