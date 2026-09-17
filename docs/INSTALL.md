# MoLaView — Install Guide

View molecular and crystal structures (CIF, VASP POSCAR/CONTCAR/XDATCAR, XYZ/extXYZ,
PDB/ENT, MOL/SDF, ASE `.traj`) in an interactive 3D VS Code editor tab.

No Python, no server, no network access. Everything runs inside VS Code.

**Requires:** VS Code 1.90 or newer.

---

## Get the source and build the package

The `.vsix` is a build artifact and is not committed to the repository, so clone
the repository and build it from source before installing:

```bash
git clone https://github.com/linhlathuy/molaview
cd molaview/
npm install
npm run build
npx @vscode/vsce package
```

This produces `molaview-1.0.0.vsix` in the project root.

To install a specific release instead of the default branch, check it out before
building — for example `git checkout v1.0.0`.

---

## Install (pick one)

### A. From the VS Code UI

1. Open VS Code.
2. Open the Extensions view — `Ctrl+Shift+X` (macOS: `Cmd+Shift+X`).
3. Click the `...` menu at the top of the Extensions panel.
4. Choose **Install from VSIX...**
5. Select the `molaview-1.0.0.vsix` you just built.
6. Reload VS Code if prompted.

### B. From the command line

```bash
code --install-extension molaview-1.0.0.vsix
```

If `code` is not on your PATH: open VS Code, press `Ctrl+Shift+P`
(macOS: `Cmd+Shift+P`), and run **Shell Command: Install 'code' command in PATH**.

### Verify it installed

```bash
code --list-extensions | grep molecular
# expected: local-research-tools.molaview
```

---

## Use it

Open any supported file — `structure.cif`, `POSCAR`, `md.traj`, `protein.pdb` —
and it opens in the 3D viewer automatically.

To see the raw text instead, run **Molecular Viewer: Reopen as Text** from the
Command Palette, or right-click the file → **Open With...** → **Text Editor**.

### Controls

| Action | Input |
|---|---|
| Rotate | Left-drag |
| Pan | Right-drag or middle-drag |
| Zoom | Scroll wheel |
| Select an atom | Click it |
| Measure | Select two atoms (distance), three (angle), four (dihedral) |
| Reset view | **Fit** button in the toolbar |

The toolbar also has display modes (ball-and-stick, spacefill, wireframe),
unit-cell and axis toggles, supercell repetition, element labels, a screenshot
button, and trajectory playback for multi-frame files.

---

## Uninstall

```bash
code --uninstall-extension local-research-tools.molaview
```

Or: Extensions view → find it → gear icon → **Uninstall**.

---

## License

MIT. See [`LICENSE`](../LICENSE). The extension bundles no third-party runtime
components — see [`ThirdPartyNotices.txt`](ThirdPartyNotices.txt).
