# Changelog

## 1.1.1 - 2026-09-20

### Fixed

- Rotation stopped working after aligning the view along the **b** axis. The
  orbit measured its polar angle against world Y regardless of where the camera's
  up vector pointed, and aligning along b flips up to Z because the view
  direction is parallel to Y - which left the camera sitting exactly on the
  orbit's pole. The polar angle clamped at its limit and a 20 px drag moved the
  camera about 0.02 units out of 20, so dragging appeared to do nothing. The
  orbit now builds its frame from the current up vector, so the poles stay where
  the viewer sees them whichever axis is up. Rotation with the default Y up is
  unchanged.

## 1.1.0 - 2026-09-20

### Added

- Animated GIF export of a whole trajectory. A toolbar button walks every frame
  at the current camera angle and display settings and writes an animated GIF,
  using the selected playback speed as the frame delay. Progress is shown while
  it runs and can be cancelled, and the viewer returns to the frame it started
  on. Exports are capped at 600 frames, because the encoded file crosses to the
  extension host as a JSON byte array under a 100 MB ceiling; use
  `molaview.trajectory.maxFrames` to sample a longer run down first.
- 30 fps and 50 fps playback rates. The playback delay had been clamped to
  30 fps, so the clamp moved to 60 fps for the new rates to take effect.
- `molaview.trajectory.maxFrames`. `0` (the default) loads every frame; a
  positive value loads at most that many, spread evenly, for very long runs.

### Changed

- ASE trajectories load every frame by default instead of at most 11 evenly
  spaced samples. Frames are still read on demand and the frame cache is
  unchanged, so memory use does not grow with trajectory length.
- Rewrote bond inference around integer-indexed linked-cell bins. The previous
  implementation keyed its spatial bins with a freshly built string on every
  insertion and lookup - roughly 54,000 string allocations per frame for a
  1000-atom cell - and inserted each atom once per periodic image. Bond output
  is unchanged; inference runs about ten times faster, which is what makes high
  frame rates usable on long trajectories.
- Renamed the bond-detection **Tolerance** slider to **Extra bond range** and
  gave it an angstrom unit and a tooltip. The value is slack added to the sum of
  two covalent radii, so `0.00` still bonds atoms at covalent contact - the old
  label read as though it switched bonding off.
- The playback label drops the redundant sample position when every frame is
  loaded, showing `Frame 250/2500` instead of `Sample 250/2500 - Frame 250/2500`.
- The ULM frame offset table is read in one contiguous read rather than one
  8-byte read per sampled frame, which matters once every frame is mapped.
- The host sends the trajectory sample count rather than the full array of
  sampled indices, keeping a per-frame array out of every state message.
- The webview bundle grows from about 48 KB to about 58 KB. GIF encoding uses
  gifenc (MIT), vendored at `webview/vendor/gifenc.js` and compiled into the
  webview script, so the extension still installs no runtime dependencies.
  `docs/ThirdPartyNotices.txt` records the license.

### Fixed

- Playback ran slower than the selected rate, and the shortfall grew with the
  rate. The next step was scheduled a full frame interval *after* the previous
  frame arrived, so each cycle took the interval plus the round trip rather than
  the interval alone. Steps are now paced from when the frame was requested.
  With a 3 ms round trip, 50 fps delivered about 43.5 and now delivers 50;
  20 fps delivered 18.9 and now delivers 20. When the host genuinely cannot
  produce frames fast enough, playback still runs as fast as they arrive.
- Pause takes effect immediately. A frame requested before the click still
  arrives, and the arrival handler chased the queued target and carried on
  playing, so a click that landed while a frame was in flight appeared to do
  nothing. Pausing now discards the queued target.
- Scrubbing during playback no longer lags. The whole control strip was rebuilt
  on every frame, tearing the slider out from under an in-progress drag; the
  playback timer kept requesting frames while the pointer held the scrubber; and
  the timer rescheduled itself immediately after posting a request rather than
  waiting for the frame, so requests outpaced the host. Controls are now built
  once and updated in place, only one request is in flight at a time, and newer
  targets replace the queued one.
- The inspector no longer rebuilds its entire DOM on every trajectory frame. It
  tore down and recreated the tabs, every element toggle and one row per element
  pair - work that grows quadratically with the number of distinct elements -
  when only the atom, bond and cell values had changed. Those values are now
  updated in place, and a full rebuild happens only when the element set, atom
  count, cell presence or space group changes.
- Atom labels are no longer built in quadratic time. `buildLabels` called
  `indexOf` per atom, up to 125,000 comparisons per frame at the 500-atom limit.
- Playback no longer hangs when there is nothing to advance to.

## 1.0.1 - 2026-09-20

First Marketplace release.

### Changed

- Published to the Visual Studio Marketplace under the `ltlinh` publisher, and
  set the README's screenshot and install-guide links to absolute URLs so they
  resolve on the Marketplace listing page.
- Restored the `categories` and `keywords` manifest fields. They were dropped
  while the extension shipped only as a VSIX, where they have no effect; they
  drive search and filtering on the Marketplace listing.
- Moved `CHANGELOG.md` back to the project root. `vsce` only surfaces a
  changelog on the Marketplace listing when it sits at the package root.
- Excluded `test_structures/` from the VSIX. The sample trajectory alone is
  5.8 MB, and the fixtures are only useful from a Git clone.

- Moved the build and test configuration into `config/` (`esbuild.mjs`,
  `playwright.config.ts`) and the supporting documentation into `docs/`
  (`INSTALL.md`, `CHANGELOG.md`, `ThirdPartyNotices.txt`, `demo.png`), leaving
  the project root to the manifest, README, and license. The `npm run`
  scripts are unchanged, so building and installing from a Git clone works as
  documented in `docs/INSTALL.md`.
- Dropped the `categories` and `keywords` manifest fields, which only affect a
  Marketplace listing and have no effect on an extension installed from a VSIX.
- The VASP parser now shares `determinant` with `geometry/cell` instead of
  carrying its own copy; the two expansions agreed to floating-point noise.
- Narrowed `export` to module scope on helpers that nothing imports
  (`sampleFrameIndices`, `prepareRenderStructure`, the inspector width clamp).
- Dropped `.vscodeignore` entries for `test/` and `node_modules.trash/`, paths
  that no longer exist.

## 1.0.0 - 2026-09-16

First stable release.

### Changed

- Replaced Three.js with a purpose-built WebGL renderer covering the features the
  viewer actually uses. The webview bundle drops from 1249 KB to 43 KB and the
  packaged extension from 306 KB to 35 KB.
- Replaced the Codicons webfont with inline SVG icons, removing a 110 KB font and
  stylesheet along with the `font-src` content-security-policy entry.
- Removed all runtime dependencies; the extension bundles no third-party code.
- Enabled bundle minification and stopped shipping source maps.
- Declared support for untrusted and virtual workspaces: structure files are parsed
  as data and never executed.

### Fixed

- Structure framing now accounts for atom radii, the unit cell, and viewport aspect
  ratio, so wide or narrow editor panes no longer clip the structure.
- Rotating the camera no longer clears the current atom selection; only a
  near-stationary click changes it.

### Performance

- The canvas now redraws only when the scene or camera changes, instead of
  re-rendering a static structure continuously.
- Bond construction uses an index map rather than a linear scan per bond.

## 0.1.0 - 2026-09-14

- Added a default read-only custom editor for common molecular, crystallographic, VASP, and ASE trajectory files.
- Added interactive atoms, bonds, cells, labels, axis alignment, camera controls, screenshots, supercells, element visibility, and measurements.
- Added lazy multi-frame controls and representative 10% sampling for ASE ULM trajectories.
- Added local and Remote SSH operation without runtime network or process dependencies.
