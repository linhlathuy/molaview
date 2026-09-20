import type { Atom, Structure, Vec3 } from '../src/model';
import type { HostMessage, ViewMessage, ViewerState } from '../src/protocol';
import { element, iconButton } from './dom';
import { icon } from './icons';
import { Inspector, type BondUiState } from './inspector';
import { defaultDisplayOptions, MolecularScene, type DisplayOptions } from './renderer';
import { InspectorResizer } from './resizer';
import { createToolbar, type MeasurementMode, type Toolbar } from './toolbar';
import { formatFrameLabel, PlaybackController } from './trajectory';
import { applyPalette, GIFEncoder, quantize } from './vendor/gifenc';

interface VsCodeApi {
  postMessage(message: ViewMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

/** Largest trajectory a GIF export will attempt; beyond this the file is impractical. */
const gifFrameLimit = 600;

/** Selectable playback rates, in frames per second. */
const playbackRates = [1, 2, 5, 10, 20, 30, 50] as const;

/** Long-lived trajectory controls, updated in place rather than rebuilt per frame. */
interface TrajectoryControls {
  play: HTMLButtonElement;
  scrubber: HTMLInputElement;
  label: HTMLSpanElement;
  speed: HTMLSelectElement;
  loopInput: HTMLInputElement;
}

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
  /** Controls are built once and updated in place; rebuilding them each frame destroyed the slider mid-drag. */
  private controls?: TrajectoryControls;
  /** True while the pointer holds the scrubber, so playback does not fight the drag. */
  private scrubbing = false;
  /** Sample index requested from the host and not yet rendered. */
  private pending: number | undefined;
  /** Newer target chosen while a request was in flight; cleared when playback stops. */
  private queued: number | undefined;
  /** When the in-flight playback step was requested, so the next one can be paced from there. */
  private stepStartedAt = 0;
  /** Resolver awaiting the next frame message while exporting a GIF. */
  private awaitingFrame: ((sampleIndex: number) => void) | undefined;
  /** Set while a GIF export is running; cleared to cancel it. */
  private exporting = false;
  private exportProgress: HTMLElement | undefined;
  /** Playback is active; the timer may be momentarily unset while a frame is in flight. */
  private playing = false;

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
      exportGif: () => { void this.saveGif(); },
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
      this.playback.update({ sampleCount: message.state.trajectory?.sampleCount ?? 1 });
      this.scene.setStructure(message.state.structure, fit);
      this.inspector.setStructure(message.state.structure);
      this.renderTrajectory();
      return;
    }
    if (!this.state) return;
    this.state = { ...this.state, structure: message.structure, sampleIndex: message.sampleIndex, originalFrameIndex: message.originalFrameIndex };
    this.scene.setStructure(message.structure, false);
    this.inspector.setStructure(message.structure);
    this.pending = undefined;
    const target = this.queued;
    this.queued = undefined;
    this.renderTrajectory();
    // A GIF export drives the trajectory itself and waits for each frame.
    const awaiting = this.awaitingFrame;
    if (awaiting) { this.awaitingFrame = undefined; awaiting(message.sampleIndex); return; }
    // A newer target was chosen while this frame was in flight - go straight there.
    if (target !== undefined && target !== message.sampleIndex) { this.request(target); return; }
    // Pace from when the step was requested, not from now: the round trip is part
    // of the frame interval, not additional to it. Scheduling delay() after the
    // frame arrived made every rate slower than requested, and increasingly so at
    // higher rates. When the host cannot keep up the remainder is zero and
    // playback simply runs as fast as frames arrive.
    if (this.playing && this.timer === undefined && !this.scrubbing) {
      const elapsed = Date.now() - this.stepStartedAt;
      const remaining = Math.max(0, this.playback.delay() - elapsed);
      this.timer = setTimeout(() => this.advance(), remaining);
    }
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

  /** Requests one sample and resolves once the host has sent it back. */
  private async showFrame(sampleIndex: number): Promise<void> {
    if (this.state?.sampleIndex === sampleIndex) return;
    await new Promise<void>(resolve => {
      this.awaitingFrame = () => resolve();
      this.pending = sampleIndex;
      this.vscode.postMessage({ type: 'requestFrame', sampleIndex });
    });
  }

  /**
   * Walks the whole trajectory, capturing each frame into an animated GIF. The
   * host is asked for one frame at a time and the canvas is read back between
   * them, so the viewer stays responsive and memory holds one frame of pixels
   * plus the growing encoded output.
   */
  private async saveGif(): Promise<void> {
    const trajectory = this.state?.trajectory;
    const sampleCount = trajectory?.sampleCount ?? 0;
    if (!this.state || sampleCount < 2 || this.exporting) return;
    // The encoded GIF crosses to the host as a JSON number array, and the host
    // caps it at 100 MB. Roughly 20 KB per frame at viewer sizes, so refuse the
    // runs that would build a file nobody wants rather than freezing the webview.
    if (sampleCount > gifFrameLimit) {
      this.showError(
        `Too many frames to export as a GIF (${sampleCount}).`,
        `GIF export is limited to ${gifFrameLimit} frames. Set molaview.trajectory.maxFrames to ${gifFrameLimit} or fewer and reopen the file to export a shorter animation.`
      );
      return;
    }
    this.stop();
    this.exporting = true;
    const restore = this.state.sampleIndex;
    const delay = Math.round(this.playback.delay());
    const encoder = GIFEncoder();
    this.showExportProgress(0, sampleCount);
    try {
      for (let index = 0; index < sampleCount; index += 1) {
        if (!this.exporting) return;
        await this.showFrame(index);
        const { data, width, height } = this.scene.capturePixels();
        const palette = quantize(data, 256);
        const indexed = applyPalette(data, palette);
        encoder.writeFrame(indexed, width, height, { palette, delay });
        this.showExportProgress(index + 1, sampleCount);
        // Quantising a frame blocks the thread; yield so the cancel button and
        // the progress label actually get a chance to paint.
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      encoder.finish();
      const stem = this.state.structure.name.split('/').at(-1)?.replace(/\.[^.]+$/, '') ?? 'structure';
      this.vscode.postMessage({ type: 'saveGif', bytes: [...encoder.bytes()], suggestedName: `${stem}.gif` });
    } finally {
      this.exporting = false;
      this.awaitingFrame = undefined;
      this.hideExportProgress();
      await this.showFrame(restore);
    }
  }

  private showExportProgress(done: number, total: number): void {
    let bar = this.exportProgress;
    if (!bar) {
      bar = element('div', 'export-progress');
      const cancel = element('button', 'command-button', 'Cancel');
      cancel.type = 'button';
      cancel.addEventListener('click', () => { this.exporting = false; });
      bar.append(element('span', 'export-progress-label'), cancel);
      this.trajectory.parentElement?.append(bar);
      this.exportProgress = bar;
    }
    const label = bar.querySelector('.export-progress-label');
    if (label) label.textContent = `Exporting GIF - frame ${done}/${total}`;
  }

  private hideExportProgress(): void {
    this.exportProgress?.remove();
    this.exportProgress = undefined;
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

  /** Returns true when the caller can expect a frame message to follow. */
  private request(sampleIndex: number): boolean {
    if (!this.state) return false;
    if (sampleIndex === this.state.sampleIndex && this.pending === undefined) return false;
    // One frame in flight at a time. A fast drag posts far more requests than the
    // host can answer, and every stale one still costs a full bond inference.
    if (this.pending !== undefined) { this.queued = sampleIndex; return true; }
    this.pending = sampleIndex;
    this.vscode.postMessage({ type: 'requestFrame', sampleIndex });
    return true;
  }

  private buildTrajectoryControls(): TrajectoryControls {
    const play = iconButton('play', 'Play trajectory', () => this.playing ? this.stop() : this.start());
    const previous = iconButton('debug-step-back', 'Previous structure', () => this.request(this.playback.previous(this.state!.sampleIndex)));
    const next = iconButton('debug-step-over', 'Next structure', () => this.request(this.playback.next(this.state!.sampleIndex)));

    const scrubber = element('input', 'trajectory-scrubber');
    scrubber.type = 'range'; scrubber.min = '0'; scrubber.step = '1';
    scrubber.setAttribute('aria-label', 'Trajectory structure');
    // Hold playback while the pointer owns the slider, otherwise the timer keeps
    // requesting its own frames and the view fights the drag.
    const beginScrub = (): void => { this.scrubbing = true; };
    const endScrub = (): void => { this.scrubbing = false; };
    scrubber.addEventListener('pointerdown', beginScrub);
    scrubber.addEventListener('pointerup', endScrub);
    scrubber.addEventListener('pointercancel', endScrub);
    scrubber.addEventListener('keydown', beginScrub);
    scrubber.addEventListener('keyup', endScrub);
    scrubber.addEventListener('blur', endScrub);
    scrubber.addEventListener('input', () => this.request(Number(scrubber.value)));

    const label = element('span', 'frame-label');

    const speed = element('select', 'speed-select');
    speed.title = 'Playback speed'; speed.setAttribute('aria-label', 'Playback speed');
    for (const value of playbackRates) {
      const option = element('option', undefined, `${value} fps`);
      option.value = String(value);
      speed.append(option);
    }
    speed.addEventListener('change', () => {
      this.fps = Number(speed.value);
      this.playback.update({ fps: this.fps });
    });

    const loop = element('label', 'loop-toggle');
    const loopInput = element('input');
    loopInput.type = 'checkbox';
    loopInput.addEventListener('change', () => { this.loop = loopInput.checked; this.playback.update({ loop: this.loop }); });
    loop.append(loopInput, element('span', undefined, 'Loop'));

    this.trajectory.dataset.testid = 'trajectory';
    this.trajectory.append(previous, play, next, scrubber, label, speed, loop);
    return { play, scrubber, label, speed, loopInput };
  }

  private renderTrajectory(): void {
    const trajectory = this.state?.trajectory;
    const sampleCount = trajectory?.sampleCount ?? 0;
    if (!this.state || !trajectory || sampleCount < 2) {
      this.trajectory.classList.remove('visible');
      return;
    }
    this.trajectory.classList.add('visible');
    // Build once, then update in place. Replacing these nodes on every frame tore
    // the slider out from under an in-progress drag.
    const controls = this.controls ??= this.buildTrajectoryControls();

    const playing = this.playing;
    controls.play.replaceChildren(icon(playing ? 'debug-pause' : 'play'));
    controls.play.title = playing ? 'Pause trajectory' : 'Play trajectory';
    controls.play.setAttribute('aria-label', controls.play.title);

    controls.scrubber.max = String(sampleCount - 1);
    // Writing value mid-drag would snap the thumb back under the pointer.
    if (!this.scrubbing) controls.scrubber.value = String(this.state.sampleIndex);

    controls.label.textContent = formatFrameLabel(this.state.sampleIndex, sampleCount, this.state.originalFrameIndex, trajectory.frameCount);
    if (controls.speed.value !== String(this.fps)) controls.speed.value = String(this.fps);
    if (controls.loopInput.checked !== this.loop) controls.loopInput.checked = this.loop;
  }

  private start(): void {
    if (this.playing) return;
    this.playing = true;
    this.stepStartedAt = Date.now();
    this.timer = setTimeout(() => this.advance(), this.playback.delay());
    this.renderTrajectory();
  }

  /**
   * Advance one frame. Rescheduling happens when the frame arrives rather than
   * here, so a structure that takes longer to build than the frame interval
   * slows playback down instead of queueing requests without bound.
   */
  private advance(): void {
    this.timer = undefined;
    if (!this.state) return;
    if (this.scrubbing) { this.timer = setTimeout(() => this.advance(), this.playback.delay()); return; }
    const next = this.playback.next(this.state.sampleIndex);
    this.stepStartedAt = Date.now();
    // Nothing to advance to (single sample, or the end with loop off): rescheduling
    // happens on frame arrival, so without a request in flight playback would hang.
    if (!this.request(next)) { this.playing = false; this.renderTrajectory(); return; }
  }

  private stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.playing = false;
    // Drop any queued target. A frame requested before the pause still arrives,
    // and without this the arrival handler would chase it and resume playback.
    this.queued = undefined;
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
