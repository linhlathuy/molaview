# Changelog

## 1.0.4 - 2026-09-20

### Changed

- Renamed the bond-detection **Tolerance** slider to **Extra bond range** and gave
  it an angstrom unit and a tooltip. The value is slack added to the sum of two
  covalent radii, so `0.00` still bonds atoms at covalent contact - the old label
  read as though it switched bonding off.

## 1.0.3 - 2026-09-20

### Added

- 30 fps and 50 fps playback rates. The playback delay was clamped to 30 fps, so
  the clamp moved to 60 fps for the new rates to take effect.

### Fixed

- Scrubbing during playback no longer lags. Three causes: the whole control strip
  was rebuilt on every frame, which tore the slider out from under an in-progress
  drag; the playback timer kept requesting its own frames while the pointer held
  the scrubber; and the timer rescheduled itself immediately after posting a
  request rather than waiting for the frame, so requests outpaced the host.
- Trajectory controls are now built once and updated in place, and the scrubber
  value is left alone while the pointer holds it.
- Playback now paces itself to frame arrival, so a structure that takes longer to
  build than the frame interval slows playback instead of queueing requests. Only
  one frame request is in flight at a time; newer targets replace the queued one.
  A fast drag previously posted a request per pointer event, each costing a full
  bond inference on the host.
- Playback no longer hangs when there is nothing to advance to.

## 1.0.2 - 2026-09-20

### Changed

- ASE trajectories now load every frame by default instead of at most 11 evenly
  spaced samples. Frames are still read on demand and the frame cache is
  unchanged, so memory use does not grow with trajectory length.
- Added `molaview.trajectory.maxFrames`. `0` (the default) loads every frame; a
  positive value loads at most that many, spread evenly, for very long runs.
- The playback label drops the redundant sample position when every frame is
  loaded, showing `Frame 250/2500` instead of `Sample 250/2500 - Frame 250/2500`.
- The ULM frame offset table is read in one contiguous read rather than one
  8-byte read per sampled frame, which matters once every frame is mapped.
- The host now sends the trajectory sample count rather than the full array of
  sampled indices, which kept a per-frame array out of every state message.

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
