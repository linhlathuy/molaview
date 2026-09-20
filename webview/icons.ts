// Inline 16x16 icon paths, replacing the @vscode/codicons webfont (~110 KB for 14 glyphs).
// Names match the codicon names previously used, so call sites are unchanged.
const PATHS: Record<string, string> = {
  'screen-full': 'M2 2h5v1.5H3.5V7H2V2zm7 0h5v5h-1.5V3.5H9V2zM2 9h1.5v3.5H7V14H2V9zm10.5 0H14v5H9v-1.5h3.5V9z',
  eye: 'M8 3C4.5 3 1.7 5.6 1 8c.7 2.4 3.5 5 7 5s6.3-2.6 7-5c-.7-2.4-3.5-5-7-5zm0 8.5A3.5 3.5 0 1 1 8 4.5a3.5 3.5 0 0 1 0 7zm0-1.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  'symbol-constant': 'M2 4.5A1.5 1.5 0 0 1 3.5 3h9A1.5 1.5 0 0 1 14 4.5v7a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5v-7zm1.5 0v7h9v-7h-9zM5 7h6v1.5H5V7z',
  'symbol-text': 'M3 3h10v2.5h-1.5V4.5H8.75v7H10V13H6v-1.5h1.25v-7H4.5v1H3V3z',
  'symbol-ruler': 'M1.5 6h13a.5.5 0 0 1 .5.5v3a.5.5 0 0 1-.5.5h-13a.5.5 0 0 1-.5-.5v-3a.5.5 0 0 1 .5-.5zm1 1.5V10h1V7.5h-1zm2.5 0V9h1V7.5H5zm2.5 0V10h1V7.5h-1zm2.5 0V9h1V7.5h-1zm2.5 0V10h1V7.5h-1z',
  'triangle-right': 'M5 2.5 12 8l-7 5.5v-11z',
  'type-hierarchy-sub': 'M6 2h4v3H6V2zM2 11h4v3H2v-3zm8 0h4v3h-4v-3zM7.25 5.5h1.5V8H12v3h-1.5V9.5h-5V11H4V8h3.25V5.5z',
  'color-mode': 'M8 1.5A6.5 6.5 0 1 0 8 14.5 6.5 6.5 0 0 0 8 1.5zm0 1.5v10a5 5 0 0 1 0-10z',
  'file-media': 'M2 2h12v12H2V2zm1.5 1.5v9h9v-9h-9zM5 5.5 9.5 8 5 10.5v-5z',
  'device-camera': 'M5.5 3 4.75 4.5H2.5A1.5 1.5 0 0 0 1 6v6a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 15 12V6a1.5 1.5 0 0 0-1.5-1.5h-2.25L10.5 3h-5zM8 11.5A2.75 2.75 0 1 1 8 6a2.75 2.75 0 0 1 0 5.5z',
  discard: 'M8 3a5 5 0 1 0 4.55 2.9l1.36-.63A6.5 6.5 0 1 1 8 1.5V0l3 2.5L8 5V3z',
  play: 'M4 2.5 13 8l-9 5.5v-11z',
  'debug-pause': 'M4.5 3h2.5v10H4.5V3zm4.5 0h2.5v10H9V3z',
  'debug-step-back': 'M11.5 2.5v11L4 8l7.5-5.5zM3 2.5h1.5v11H3v-11z',
  'debug-step-over': 'M4.5 2.5 12 8l-7.5 5.5v-11zM13 2.5V13.5h-1.5v-11H13z',
  error: 'M8 1.5A6.5 6.5 0 1 0 8 14.5 6.5 6.5 0 0 0 8 1.5zm.75 10h-1.5V10h1.5v1.5zm0-2.5h-1.5V4.5h1.5V9z'
};

export function icon(name: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('icon');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', PATHS[name] ?? '');
  path.setAttribute('fill', 'currentColor');
  svg.append(path);
  return svg;
}
