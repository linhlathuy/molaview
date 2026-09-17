import type { Atom, Structure, Vec3 } from '../src/model';
import type { HostMessage, ViewMessage, ViewerState } from '../src/protocol';
import { element, iconButton } from './dom';
import { icon } from './icons';
import { Inspector, type BondUiState } from './inspector';
import { defaultDisplayOptions, MolecularScene, type DisplayOptions } from './renderer';
import { InspectorResizer } from './resizer';
import { createToolbar, type MeasurementMode, type Toolbar } from './toolbar';
import { formatFrameLabel, PlaybackController } from './trajectory';

interface VsCodeApi {
  postMessage(message: ViewMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

export class ViewerApp {
  private readonly vscode = acquireVsCodeApi();
  private readonly canvas = element('canvas', 'structure-canvas');
  private readonly scene: MolecularScene;
  private readonly inspector: Inspector;
  private readonly toolbar: Toolbar;
  private readonly error = element('div', 'error-overlay');
  private readonly trajectory = element('div', 'trajectory-bar');
  private state?: ViewerState;
  private selection: Atom[] = [];
  private measurementMode: MeasurementMode = 'none';
  private display: DisplayOptions = { ...defaultDisplayOptions, hiddenElements: new Set<string>() };
  private backgroundLight = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private playback = new PlaybackController({ sampleCount: 1, fps: 5, loop: true });
  private fps = 5;
  private loop = true;

  constructor(root: HTMLElement) {
    const canvasWrap = element('main', 'canvas-wrap');
    canvasWrap.append(this.canvas, this.error, this.trajectory);
    const inspectorRoot = element('aside', 'inspector');
    inspectorRoot.dataset.testid = 'inspector';
    const workspace = element('div', 'viewer-workspace');
    const resizer = new InspectorResizer(workspace, {
      initialWidth: this.storedInspectorWidth(),
      onChange: width => this.vscode.setState({ inspectorWidth: width || undefined })
    });
    workspace.append(canvasWrap, resizer.element, inspectorRoot);
    this.toolbar = createToolbar({
      fit: () => this.scene.fit(),
      align: axis => this.scene.align(axis),
      orthographic: enabled => this.scene.setOrthographic(enabled),
      labels: enabled => { this.display.showLabels = enabled; this.scene.setDisplayOptions({ showLabels: enabled }); },
      measurement: mode => { this.measurementMode = mode; this.selection = []; this.inspector.setSelection([], mode); },
      background: () => this.toggleBackground(),
      screenshot: () => this.saveScreenshot(),
      reset: () => this.reset()
    });
    root.append(this.toolbar.element, workspace);
    this.scene = new MolecularScene(this.canvas, atom => this.select(atom));
    this.inspector = new Inspector(inspectorRoot, this.display, {
      display: options => { this.display = { ...this.display, ...options }; this.scene.setDisplayOptions(options); },
      supercell: repetitions => this.scene.setSupercell(repetitions),
      bonds: state => this.updateBonds(state)
    });
    window.addEventListener('message', event => this.receive(event.data as HostMessage));
    window.addEventListener('beforeunload', () => this.scene.dispose());
    this.vscode.postMessage({ type: 'ready' });
  }

  private storedInspectorWidth(): number | undefined {
    const state = this.vscode.getState();
    if (!state || typeof state !== 'object') return undefined;
    const width = (state as { inspectorWidth?: unknown }).inspectorWidth;
    return typeof width === 'number' && Number.isFinite(width) ? width : undefined;
  }

  private receive(message: HostMessage): void {
    if (message.type === 'error') { this.showError(message.message, message.detail); return; }
    this.hideError();
    if (message.type === 'load') {
      const fit = this.state === undefined;
      this.state = message.state;
      this.playback.update({ sampleCount: message.state.trajectory?.sampledIndices?.length ?? 1 });
      this.scene.setStructure(message.state.structure, fit);
      this.inspector.setStructure(message.state.structure);
      this.renderTrajectory();
      return;
    }
    if (!this.state) return;
    this.state = { ...this.state, structure: message.structure, sampleIndex: message.sampleIndex, originalFrameIndex: message.originalFrameIndex };
    this.scene.setStructure(message.structure, false);
    this.inspector.setStructure(message.structure);
    this.renderTrajectory();
  }

  private select(atom: Atom | undefined): void {
    if (!atom) { this.selection = []; this.inspector.setSelection([], this.measurementMode); return; }
    const required = this.measurementMode === 'distance' ? 2 : this.measurementMode === 'angle' ? 3 : this.measurementMode === 'dihedral' ? 4 : 1;
    if (required === 1) this.selection = [atom];
    else {
      if (this.selection.length >= required) this.selection = [];
      this.selection.push(atom);
    }
    this.inspector.setSelection(this.selection, this.measurementMode);
  }

  private updateBonds(state: BondUiState): void {
    this.vscode.postMessage({ type: 'setBondOverrides', tolerance: state.tolerance, hiddenPairs: [...state.hiddenPairs], cutoffs: state.cutoffs });
  }

  private toggleBackground(): void {
    this.backgroundLight = !this.backgroundLight;
    const background = this.backgroundLight ? 0xf4f6f8 : 0x17191d;
    this.display.background = background;
    this.scene.setDisplayOptions({ background });
  }

  private saveScreenshot(): void {
    const bytes = this.scene.screenshot();
    const stem = this.state?.structure.name.split('/').at(-1)?.replace(/\.[^.]+$/, '') ?? 'structure';
    this.vscode.postMessage({ type: 'saveScreenshot', bytes: [...bytes], suggestedName: `${stem}.png` });
  }

  private reset(): void {
    this.stop();
    this.display = { ...defaultDisplayOptions, hiddenElements: new Set() };
    this.backgroundLight = false;
    this.measurementMode = 'none';
    this.selection = [];
    this.toolbar.reset();
    this.scene.setOrthographic(false);
    this.scene.setDisplayOptions(this.display);
    this.scene.setSupercell([1, 1, 1]);
    this.inspector.reset(this.display);
    this.vscode.postMessage({ type: 'setBondOverrides', tolerance: 0.45, hiddenPairs: [], cutoffs: {} });
  }

  private request(sampleIndex: number): void {
    if (!this.state || sampleIndex === this.state.sampleIndex) return;
    this.vscode.postMessage({ type: 'requestFrame', sampleIndex });
  }

  private renderTrajectory(): void {
    this.trajectory.replaceChildren();
    const trajectory = this.state?.trajectory;
    const samples = trajectory?.sampledIndices;
    if (!this.state || !trajectory || !samples || samples.length < 2) {
      this.trajectory.classList.remove('visible');
      return;
    }
    this.trajectory.classList.add('visible');
    this.trajectory.dataset.testid = 'trajectory';
    const play = iconButton(this.timer ? 'debug-pause' : 'play', this.timer ? 'Pause trajectory' : 'Play trajectory', () => this.timer ? this.stop() : this.start());
    const previous = iconButton('debug-step-back', 'Previous structure', () => this.request(this.playback.previous(this.state!.sampleIndex)));
    const next = iconButton('debug-step-over', 'Next structure', () => this.request(this.playback.next(this.state!.sampleIndex)));
    const scrubber = element('input', 'trajectory-scrubber');
    scrubber.type = 'range'; scrubber.min = '0'; scrubber.max = String(samples.length - 1); scrubber.step = '1'; scrubber.value = String(this.state.sampleIndex);
    scrubber.setAttribute('aria-label', 'Trajectory structure');
    scrubber.addEventListener('input', () => this.request(Number(scrubber.value)));
    const label = element('span', 'frame-label', formatFrameLabel(this.state.sampleIndex, samples.length, this.state.originalFrameIndex, trajectory.frameCount));
    const speed = element('select', 'speed-select'); speed.title = 'Playback speed'; speed.setAttribute('aria-label', 'Playback speed');
    [1, 2, 5, 10, 20].forEach(value => { const option = element('option', undefined, `${value} fps`); option.value = String(value); option.selected = value === this.fps; speed.append(option); });
    speed.addEventListener('change', () => { this.fps = Number(speed.value); this.playback.update({ fps: this.fps }); if (this.timer) { this.stop(); this.start(); } });
    const loop = element('label', 'loop-toggle'); const loopInput = element('input'); loopInput.type = 'checkbox'; loopInput.checked = this.loop;
    loopInput.addEventListener('change', () => { this.loop = loopInput.checked; this.playback.update({ loop: this.loop }); }); loop.append(loopInput, element('span', undefined, 'Loop'));
    this.trajectory.append(previous, play, next, scrubber, label, speed, loop);
  }

  private start(): void {
    if (this.timer) return;
    const tick = (): void => {
      if (!this.state) return;
      const next = this.playback.next(this.state.sampleIndex);
      if (next === this.state.sampleIndex && !this.loop) { this.stop(); return; }
      this.request(next);
      this.timer = setTimeout(tick, this.playback.delay());
    };
    this.timer = setTimeout(tick, this.playback.delay());
    this.renderTrajectory();
  }

  private stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.renderTrajectory();
  }

  private showError(message: string, detail?: string): void {
    this.error.replaceChildren(icon('error'), element('strong', undefined, message));
    if (detail) this.error.append(element('pre', undefined, detail));
    const reopen = element('button', 'command-button', 'Reopen as Text'); reopen.type = 'button'; reopen.addEventListener('click', () => this.vscode.postMessage({ type: 'reopenAsText' }));
    this.error.append(reopen); this.error.classList.add('visible');
  }

  private hideError(): void { this.error.classList.remove('visible'); }
}

export function mountViewer(root: HTMLElement): ViewerApp {
  return new ViewerApp(root);
}
