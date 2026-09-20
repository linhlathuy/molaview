import { angle, dihedral, distance } from '../src/geometry/measurements';
import { pairKey } from '../src/geometry/bonds';
import type { Atom, Structure, Vec3 } from '../src/model';
import type { DisplayMode, DisplayOptions } from './renderer';
import { clear, element } from './dom';
import type { MeasurementMode } from './toolbar';

export interface BondUiState {
  tolerance: number;
  hiddenPairs: Set<string>;
  cutoffs: Record<string, number>;
}

export interface InspectorActions {
  display(options: Partial<DisplayOptions>): void;
  supercell(repetitions: Vec3): void;
  bonds(state: BondUiState): void;
}

/**
 * True when two frames would produce the same inspector controls. The element
 * set drives both the element toggles and the per-pair bond rows, and the space
 * group and cell presence drive whole sections, so any change there needs a
 * full rebuild rather than a value refresh.
 */
function sameShape(a: Structure, b: Structure): boolean {
  if (a.atoms.length !== b.atoms.length) return false;
  if (Boolean(a.cell) !== Boolean(b.cell)) return false;
  if (a.metadata?.spaceGroup !== b.metadata?.spaceGroup) return false;
  const left = new Set<string>();
  for (const atom of a.atoms) left.add(atom.element);
  const right = new Set<string>();
  for (const atom of b.atoms) right.add(atom.element);
  if (left.size !== right.size) return false;
  for (const element of left) if (!right.has(element)) return false;
  return true;
}

function formula(structure: Structure): string {
  const counts = new Map<string, number>();
  structure.atoms.forEach(atom => counts.set(atom.element, (counts.get(atom.element) ?? 0) + 1));
  return [...counts.entries()].map(([symbol, count]) => `${symbol}${count === 1 ? '' : count}`).join('');
}

function vectorLength(vector: Vec3): number {
  return Math.hypot(...vector);
}

function cellSummary(structure: Structure): string {
  if (!structure.cell) return 'Non-periodic';
  return structure.cell.vectors.map(vector => `${vectorLength(vector).toFixed(3)} A`).join(' · ');
}

function measurementText(mode: MeasurementMode, atoms: Atom[]): string | undefined {
  const points = atoms.map(atom => atom.position);
  if (mode === 'distance' && points.length >= 2) return `${distance(points[0]!, points[1]!).toFixed(4)} A`;
  if (mode === 'angle' && points.length >= 3) return `${angle(points[0]!, points[1]!, points[2]!).toFixed(3)} deg`;
  if (mode === 'dihedral' && points.length >= 4) return `${dihedral(points[0]!, points[1]!, points[2]!, points[3]!).toFixed(3)} deg`;
  return undefined;
}

export class Inspector {
  private active: 'structure' | 'display' | 'selection' = 'structure';
  private structure?: Structure;
  /** Structure-tab value nodes, for per-frame updates that skip a full rebuild. */
  private readonly values = new Map<string, HTMLElement>();
  private heading: HTMLElement | undefined;
  private selection: Atom[] = [];
  private measurement: MeasurementMode = 'none';
  private displayState: DisplayOptions;
  private repetitions: Vec3 = [1, 1, 1];
  private bondState: BondUiState = { tolerance: 0.45, hiddenPairs: new Set(), cutoffs: {} };

  constructor(private readonly root: HTMLElement, display: DisplayOptions, private readonly actions: InspectorActions) {
    this.displayState = { ...display, hiddenElements: new Set(display.hiddenElements) };
  }

  setStructure(structure: Structure): void {
    const previous = this.structure;
    this.structure = structure;
    // During playback only the per-frame values change. Rebuilding the whole
    // inspector on every frame - tabs, element rows and one row per element pair -
    // was pure churn, so refresh the values in place when the shape is unchanged.
    if (previous && this.active !== 'structure' && sameShape(previous, structure)) return;
    if (previous && this.active === 'structure' && sameShape(previous, structure) && this.updateStructureValues()) return;
    this.render();
  }

  /** Updates the Structure tab's per-frame values without rebuilding the DOM. */
  private updateStructureValues(): boolean {
    const structure = this.structure;
    if (!structure || !this.values.size) return false;
    this.values.get('Atoms')!.textContent = String(structure.atoms.length);
    this.values.get('Bonds')!.textContent = String(structure.bonds.length);
    const cell = this.values.get('Cell');
    if (cell) cell.textContent = cellSummary(structure);
    const heading = this.heading;
    if (heading) heading.textContent = structure.name.split('/').at(-1) ?? structure.name;
    return true;
  }
  setSelection(selection: Atom[], mode: MeasurementMode): void { this.selection = selection; this.measurement = mode; this.active = 'selection'; this.render(); }

  reset(display: DisplayOptions): void {
    this.displayState = { ...display, hiddenElements: new Set(display.hiddenElements) };
    this.repetitions = [1, 1, 1];
    this.bondState = { tolerance: 0.45, hiddenPairs: new Set(), cutoffs: {} };
    this.selection = [];
    this.active = 'structure';
    this.render();
  }

  private render(): void {
    clear(this.root);
    this.values.clear();
    this.heading = undefined;
    const tabs = element('div', 'inspector-tabs');
    for (const tab of ['structure', 'display', 'selection'] as const) {
      const button = element('button', tab === this.active ? 'tab active' : 'tab', tab[0]!.toUpperCase() + tab.slice(1));
      button.type = 'button';
      button.addEventListener('click', () => { this.active = tab; this.render(); });
      tabs.append(button);
    }
    const body = element('div', 'inspector-body');
    if (this.active === 'structure') this.renderStructure(body);
    if (this.active === 'display') this.renderDisplay(body);
    if (this.active === 'selection') this.renderSelection(body);
    this.root.append(tabs, body);
  }

  private row(label: string, value: string): HTMLElement {
    const row = element('div', 'property-row');
    const node = element('span', 'property-value', value);
    this.values.set(label, node);
    row.append(element('span', 'property-label', label), node);
    return row;
  }

  private renderStructure(body: HTMLElement): void {
    if (!this.structure) return;
    const heading = element('h2', undefined, this.structure.name.split('/').at(-1) ?? this.structure.name);
    this.heading = heading;
    body.append(heading, this.row('Formula', formula(this.structure)), this.row('Atoms', String(this.structure.atoms.length)), this.row('Bonds', String(this.structure.bonds.length)), this.row('Cell', cellSummary(this.structure)));
    const spaceGroup = this.structure.metadata?.spaceGroup;
    if (spaceGroup !== undefined) body.append(this.row('Space group', String(spaceGroup)));
    if (this.structure.cell) {
      body.append(element('h3', undefined, 'Supercell'));
      const steppers = element('div', 'steppers');
      (['a', 'b', 'c'] as const).forEach((axis, index) => {
        const label = element('label', 'stepper');
        label.append(element('span', undefined, axis));
        const input = element('input');
        input.type = 'number'; input.min = '1'; input.max = '20'; input.step = '1'; input.value = String(this.repetitions[index]);
        input.addEventListener('change', () => {
          this.repetitions[index] = Math.max(1, Math.min(20, Math.round(Number(input.value) || 1)));
          input.value = String(this.repetitions[index]);
          this.actions.supercell(this.repetitions);
        });
        label.append(input); steppers.append(label);
      });
      body.append(steppers);
    }
  }

  private checkbox(labelText: string, checked: boolean, change: (checked: boolean) => void): HTMLLabelElement {
    const label = element('label', 'check-row');
    const input = element('input'); input.type = 'checkbox'; input.checked = checked;
    input.addEventListener('change', () => change(input.checked));
    label.append(input, element('span', undefined, labelText));
    return label;
  }

  private renderDisplay(body: HTMLElement): void {
    if (!this.structure) return;
    body.append(element('h2', undefined, 'Representation'));
    const modes = element('div', 'segmented');
    const labels: Record<DisplayMode, string> = { 'ball-and-stick': 'Ball & stick', sticks: 'Sticks', 'space-filling': 'Space fill' };
    (Object.keys(labels) as DisplayMode[]).forEach(mode => {
      const button = element('button', mode === this.displayState.mode ? 'active' : '', labels[mode]);
      button.type = 'button';
      button.addEventListener('click', () => { this.displayState = { ...this.displayState, mode }; this.actions.display({ mode }); this.render(); });
      modes.append(button);
    });
    body.append(modes, element('h3', undefined, 'Visible'));
    const toggles: Array<[keyof Pick<DisplayOptions, 'showAtoms' | 'showBonds' | 'showCell' | 'showAxes' | 'showLabels'>, string]> = [
      ['showAtoms', 'Atoms'], ['showBonds', 'Bonds'], ['showCell', 'Unit cell'], ['showAxes', 'Axes'], ['showLabels', 'Labels']
    ];
    toggles.forEach(([key, label]) => body.append(this.checkbox(label, this.displayState[key], checked => {
      this.displayState = { ...this.displayState, [key]: checked };
      this.actions.display({ [key]: checked });
    })));
    body.append(element('h3', undefined, 'Size'));
    body.append(this.slider('Atom size', this.displayState.atomScale, 0.4, 1.8, value => { this.displayState = { ...this.displayState, atomScale: value }; this.actions.display({ atomScale: value }); }));
    body.append(this.slider('Bond size', this.displayState.bondScale, 0.4, 2, value => { this.displayState = { ...this.displayState, bondScale: value }; this.actions.display({ bondScale: value }); }));
    body.append(element('h3', undefined, 'Elements'));
    for (const symbol of [...new Set(this.structure.atoms.map(atom => atom.element))].sort()) {
      body.append(this.checkbox(symbol, !this.displayState.hiddenElements.has(symbol), checked => {
        const hiddenElements = new Set(this.displayState.hiddenElements);
        checked ? hiddenElements.delete(symbol) : hiddenElements.add(symbol);
        this.displayState = { ...this.displayState, hiddenElements };
        this.actions.display({ hiddenElements });
      }));
    }
    body.append(element('h3', undefined, 'Bond detection'));
    // The value is slack added to the sum of covalent radii, so 0.00 still bonds
    // atoms at their covalent contact distance. Spell that out: a bare "0.00"
    // reads as "bonding off".
    const tolerance = this.slider('Extra bond range', this.bondState.tolerance, 0, 1.2, value => {
      this.bondState.tolerance = value;
      this.actions.bonds(this.bondState);
    }, 0.05, ' \u00c5');
    tolerance.title = 'Atoms bond when they are closer than the sum of their covalent radii plus this value. At 0.00 A only atoms within covalent contact are bonded.';
    body.append(tolerance);
    const symbols = [...new Set(this.structure.atoms.map(atom => atom.element))].sort();
    const pairs = symbols.flatMap((left, index) => symbols.slice(index).map(right => pairKey(left, right)));
    for (const pair of pairs) body.append(this.bondPairRow(pair));
  }

  private bondPairRow(pair: string): HTMLElement {
    const row = element('div', 'bond-pair-row');
    const visible = element('input');
    visible.type = 'checkbox';
    visible.checked = !this.bondState.hiddenPairs.has(pair);
    visible.setAttribute('aria-label', `Show ${pair} bonds`);
    visible.addEventListener('change', () => {
      visible.checked ? this.bondState.hiddenPairs.delete(pair) : this.bondState.hiddenPairs.add(pair);
      this.actions.bonds(this.bondState);
    });
    const cutoff = element('input');
    cutoff.type = 'number';
    cutoff.min = '0.1';
    cutoff.max = '20';
    cutoff.step = '0.05';
    cutoff.placeholder = 'Auto';
    cutoff.value = this.bondState.cutoffs[pair]?.toString() ?? '';
    cutoff.setAttribute('aria-label', `${pair} maximum bond distance`);
    cutoff.addEventListener('change', () => {
      const value = Number(cutoff.value);
      if (cutoff.value.trim() && Number.isFinite(value) && value > 0) this.bondState.cutoffs[pair] = value;
      else { delete this.bondState.cutoffs[pair]; cutoff.value = ''; }
      this.actions.bonds(this.bondState);
    });
    row.append(visible, element('span', 'bond-pair-name', pair), cutoff, element('span', 'bond-pair-unit', 'A'));
    return row;
  }

  private slider(labelText: string, value: number, min: number, max: number, change: (value: number) => void, step = 0.05, unit = ''): HTMLLabelElement {
    const label = element('label', 'slider-row');
    const header = element('span', 'slider-label');
    const output = element('output', undefined, `${value.toFixed(2)}${unit}`);
    header.append(element('span', undefined, labelText), output);
    const input = element('input'); input.type = 'range'; input.min = String(min); input.max = String(max); input.step = String(step); input.value = String(value);
    input.addEventListener('input', () => { const next = Number(input.value); output.value = `${next.toFixed(2)}${unit}`; change(next); });
    label.append(header, input); return label;
  }

  private renderSelection(body: HTMLElement): void {
    body.append(element('h2', undefined, this.measurement === 'none' ? 'Selected atom' : `${this.measurement[0]!.toUpperCase()}${this.measurement.slice(1)} measurement`));
    if (this.selection.length === 0) { body.append(element('p', 'empty-state', 'No atom selected')); return; }
    this.selection.forEach((atom, index) => {
      const item = element('div', 'selection-item');
      item.append(element('strong', undefined, `${index + 1}. ${atom.label ?? atom.element}`), element('span', undefined, atom.position.map(value => value.toFixed(4)).join(', ')));
      body.append(item);
    });
    const result = measurementText(this.measurement, this.selection);
    if (result) body.append(this.row('Result', result));
  }
}
