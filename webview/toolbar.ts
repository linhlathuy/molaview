import { element, iconButton } from './dom';

export type MeasurementMode = 'none' | 'distance' | 'angle' | 'dihedral';

export interface ToolbarActions {
  fit(): void;
  align(axis: 0 | 1 | 2): void;
  orthographic(enabled: boolean): void;
  labels(enabled: boolean): void;
  measurement(mode: MeasurementMode): void;
  background(): void;
  screenshot(): void;
  reset(): void;
}

export interface Toolbar {
  element: HTMLElement;
  reset(): void;
}

export function createToolbar(actions: ToolbarActions): Toolbar {
  const toolbar = element('header', 'toolbar');
  toolbar.dataset.testid = 'toolbar';
  const title = element('div', 'toolbar-title', 'MoLaView');
  const controls = element('div', 'toolbar-controls');
  controls.append(iconButton('screen-full', 'Fit structure to view', actions.fit));
  let orthographic = false;
  const projection = iconButton('eye', 'Toggle orthographic projection', () => {
    orthographic = !orthographic;
    projection.classList.toggle('active', orthographic);
    actions.orthographic(orthographic);
  });
  controls.append(projection);
  for (const [axis, label] of ['a', 'b', 'c'].entries()) controls.append(iconButton('symbol-constant', `View along ${label} axis`, () => actions.align(axis as 0 | 1 | 2), label));
  let labels = false;
  const labelButton = iconButton('symbol-text', 'Toggle atom labels', () => {
    labels = !labels;
    labelButton.classList.toggle('active', labels);
    actions.labels(labels);
  });
  controls.append(labelButton);
  const modes: Array<[MeasurementMode, string, string]> = [
    ['distance', 'symbol-ruler', 'Measure distance'],
    ['angle', 'triangle-right', 'Measure angle'],
    ['dihedral', 'type-hierarchy-sub', 'Measure dihedral']
  ];
  for (const [mode, icon, label] of modes) {
    const button = iconButton(icon, label, () => {
      controls.querySelectorAll('.measure.active').forEach(node => node.classList.remove('active'));
      button.classList.add('active');
      actions.measurement(mode);
    });
    button.classList.add('measure');
    controls.append(button);
  }
  controls.append(iconButton('color-mode', 'Switch canvas background', actions.background));
  controls.append(iconButton('device-camera', 'Save PNG screenshot', actions.screenshot));
  controls.append(iconButton('discard', 'Reset viewer settings', actions.reset));
  toolbar.append(title, controls);
  // The fade cue only applies while the strip actually overflows.
  const trackOverflow = (): void => { controls.classList.toggle('scrollable', controls.scrollWidth > controls.clientWidth + 1); };
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(trackOverflow).observe(controls);
  trackOverflow();
  return {
    element: toolbar,
    reset: () => {
      orthographic = false;
      labels = false;
      projection.classList.remove('active');
      labelButton.classList.remove('active');
      controls.querySelectorAll('.measure.active').forEach(node => node.classList.remove('active'));
    }
  };
}
