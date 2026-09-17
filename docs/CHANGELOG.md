# Changelog

## Unreleased

### Changed

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
