import { element } from './dom';

const minInspectorWidth = 200;
const maxInspectorWidth = 640;
/** Preferred room for the canvas; given up before the panel overhangs the edge. */
const minCanvasWidth = 220;
/** Matches the CSS cap: the panel never takes the last of the workspace. */
const reservedCanvasWidth = 120;
const handleWidth = 5;
const keyboardStep = 16;

function clampInspectorWidth(width: number, workspaceWidth: number): number {
  // On a narrow editor the preferred canvas floor cannot be honoured. Falling
  // back to the hard reserve keeps the panel inside the workspace rather than
  // letting the grid overflow and clip it off the right edge.
  const available = workspaceWidth - handleWidth - minCanvasWidth;
  const hardLimit = Math.max(0, workspaceWidth - handleWidth - reservedCanvasWidth);
  const upper = Math.min(maxInspectorWidth, Math.max(minInspectorWidth, available), hardLimit);
  return Math.round(Math.max(Math.min(minInspectorWidth, hardLimit), Math.min(upper, width)));
}

export interface ResizerOptions {
  /** Persisted width from a previous session, if any. */
  initialWidth?: number | undefined;
  onChange?(width: number): void;
}

/**
 * Splitter between the canvas and the inspector. Drives the workspace's
 * --inspector-width; the renderer's ResizeObserver picks up the canvas change.
 */
export class InspectorResizer {
  readonly element = element('div', 'resize-handle');
  private width: number | undefined;

  constructor(private readonly workspace: HTMLElement, private readonly options: ResizerOptions = {}) {
    this.element.setAttribute('role', 'separator');
    this.element.setAttribute('aria-orientation', 'vertical');
    this.element.setAttribute('aria-label', 'Resize inspector panel');
    this.element.tabIndex = 0;
    if (options.initialWidth !== undefined) this.setWidth(options.initialWidth);
    this.element.addEventListener('pointerdown', event => this.startDrag(event));
    this.element.addEventListener('dblclick', () => this.reset());
    this.element.addEventListener('keydown', event => this.onKeyDown(event));
  }

  private currentWidth(): number {
    return this.width ?? this.workspace.querySelector('.inspector')?.getBoundingClientRect().width ?? minInspectorWidth;
  }

  private setWidth(width: number): void {
    const next = clampInspectorWidth(width, this.workspace.getBoundingClientRect().width);
    this.width = next;
    this.workspace.style.setProperty('--inspector-width', `${next}px`);
    this.element.setAttribute('aria-valuenow', String(next));
    this.options.onChange?.(next);
  }

  /** Double-click restores the responsive default. */
  private reset(): void {
    this.width = undefined;
    this.workspace.style.removeProperty('--inspector-width');
    this.element.removeAttribute('aria-valuenow');
    this.options.onChange?.(0);
  }

  private startDrag(event: PointerEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    this.element.setPointerCapture(event.pointerId);
    this.element.classList.add('dragging');
    this.workspace.classList.add('resizing');
    const startX = event.clientX;
    const startWidth = this.currentWidth();
    // Dragging left widens the inspector, so the delta is inverted.
    const move = (moveEvent: PointerEvent): void => this.setWidth(startWidth - (moveEvent.clientX - startX));
    const end = (): void => {
      this.element.releasePointerCapture(event.pointerId);
      this.element.classList.remove('dragging');
      this.workspace.classList.remove('resizing');
      this.element.removeEventListener('pointermove', move);
      this.element.removeEventListener('pointerup', end);
      this.element.removeEventListener('pointercancel', end);
    };
    this.element.addEventListener('pointermove', move);
    this.element.addEventListener('pointerup', end);
    this.element.addEventListener('pointercancel', end);
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'ArrowLeft') this.setWidth(this.currentWidth() + keyboardStep);
    else if (event.key === 'ArrowRight') this.setWidth(this.currentWidth() - keyboardStep);
    else if (event.key === 'Home' || event.key === 'End') this.reset();
    else return;
    event.preventDefault();
  }
}
