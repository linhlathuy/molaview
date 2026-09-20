import { expect, test, type Page } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const harness = pathToFileURL(join(process.cwd(), 'playwright', 'harness.html')).toString();

const state = {
  structure: {
    name: 'Mo2N3_preview.cif',
    atoms: [
      { id: 0, element: 'Mo', position: [0, 0, 0] },
      { id: 1, element: 'N', position: [1.8, 0, 0] },
      { id: 2, element: 'N', position: [0.9, 1.55, 0] },
      { id: 3, element: 'Mo', position: [0.9, 0.52, 1.8] },
      { id: 4, element: 'N', position: [2.7, 1.55, 1.8] }
    ],
    bonds: [
      { a: 0, b: 1 }, { a: 0, b: 2 }, { a: 1, b: 3 }, { a: 2, b: 3 }, { a: 3, b: 4 }
    ],
    cell: { vectors: [[5, 0, 0], [0, 5, 0], [0, 0, 5]], periodic: [true, true, true] },
    metadata: { spaceGroup: 'P6/mmm' }
  },
  trajectory: { frameCount: 21, sampleCount: 11, sampled: true },
  sampleIndex: 0,
  originalFrameIndex: 0
};

async function openViewer(page: Page): Promise<void> {
  await page.addInitScript(initialState => {
    const sent: unknown[] = [];
    (window as unknown as { __viewerMessages: unknown[] }).__viewerMessages = sent;
    (window as unknown as { acquireVsCodeApi: () => unknown }).acquireVsCodeApi = () => ({
      getState: () => undefined,
      setState: () => undefined,
      postMessage: (message: { type: string; sampleIndex?: number }) => {
        sent.push(message);
        if (message.type === 'ready') queueMicrotask(() => window.postMessage({ type: 'load', state: initialState }, '*'));
        if (message.type === 'requestFrame' && message.sampleIndex !== undefined) {
          const last = initialState.trajectory.frameCount - 1;
          const originalFrameIndex = Math.round(last * message.sampleIndex / (initialState.trajectory.sampleCount - 1));
          const structure = structuredClone(initialState.structure);
          const atom = structure.atoms[4]!;
          atom.position = [atom.position[0]!, atom.position[1]!, atom.position[2]! + message.sampleIndex * 0.05];
          queueMicrotask(() => window.postMessage({ type: 'frame', structure, sampleIndex: message.sampleIndex, originalFrameIndex }, '*'));
        }
      }
    });
  }, state);
  await page.goto(harness);
  await expect(page.locator('.property-row', { hasText: 'Atoms' })).toContainText('5');
}

async function nonBackgroundPixels(page: Page): Promise<number> {
  return page.locator('canvas').evaluate(canvas => {
    const context = (canvas as HTMLCanvasElement).getContext('webgl2') ?? (canvas as HTMLCanvasElement).getContext('webgl');
    if (!context) return 0;
    const gl = context as WebGLRenderingContext;
    const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
    gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let count = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index]! > 45 || pixels[index + 1]! > 45 || pixels[index + 2]! > 50) count += 1;
    }
    return count;
  });
}

test('renders and rotates a structure on desktop', async ({ page }) => {
  await openViewer(page);
  await expect(page.locator('[data-testid="toolbar"]')).toBeInViewport();
  await expect(page.locator('[data-testid="inspector"]')).toBeInViewport();
  await expect(page.locator('[data-testid="trajectory"]')).toBeInViewport();
  expect(await nonBackgroundPixels(page)).toBeGreaterThan(1000);

  const canvas = page.locator('canvas');
  const before = await canvas.screenshot();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas has no bounds');
  await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.45);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.62, box.y + box.height * 0.55, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  expect((await canvas.screenshot()).equals(before)).toBe(false);

  await page.getByRole('button', { name: 'Display' }).click();
  await page.getByLabel('Show Mo-N bonds').uncheck();
  await expect.poll(() => page.evaluate(() => {
    const messages = (window as unknown as { __viewerMessages: Array<{ type?: string; hiddenPairs?: string[] }> }).__viewerMessages;
    return messages.filter(message => message.type === 'setBondOverrides').at(-1)?.hiddenPairs;
  })).toContain('Mo-N');
  await page.getByTitle('Reset viewer settings').click();
  await expect.poll(() => page.evaluate(() => {
    const messages = (window as unknown as { __viewerMessages: Array<{ type?: string; hiddenPairs?: string[] }> }).__viewerMessages;
    return messages.filter(message => message.type === 'setBondOverrides').at(-1)?.hiddenPairs;
  })).toEqual([]);

  await page.locator('.trajectory-scrubber').fill('10');
  await expect(page.locator('.frame-label')).toHaveText('Sample 11/11 - Frame 21/21');
  await expect(page.locator('.speed-select option')).toHaveText(['1 fps', '2 fps', '5 fps', '10 fps', '20 fps', '30 fps', '50 fps']);
  // The controls persist across frame updates instead of being rebuilt, so the
  // scrubber the test grabbed above must still be the live element.
  await page.locator('.speed-select').selectOption('50');
  await expect(page.locator('.trajectory-scrubber')).toHaveValue('10');
  // GIF export walks every sample and posts one saveGif message with the encoded
  // bytes. Verify it reaches the host and starts with the GIF89a signature.
  await page.getByTitle('Save animated GIF of the trajectory').click();
  await expect.poll(() => page.evaluate(() => {
    const messages = (window as unknown as { __viewerMessages: Array<{ type?: string; bytes?: number[]; suggestedName?: string }> }).__viewerMessages;
    const gif = messages.filter(message => message.type === 'saveGif').at(-1);
    return gif ? { head: gif.bytes?.slice(0, 6), name: gif.suggestedName } : undefined;
  }), { timeout: 30000 }).toEqual({ head: [71, 73, 70, 56, 57, 97], name: 'Mo2N3_preview.gif' });
  await expect(page.locator('.export-progress')).toHaveCount(0);

  await page.getByTitle('Save PNG screenshot').click();
  await expect.poll(() => page.evaluate(() => {
    const messages = (window as unknown as { __viewerMessages: Array<{ type?: string; bytes?: number[] }> }).__viewerMessages;
    return messages.filter(message => message.type === 'saveScreenshot').at(-1)?.bytes?.slice(0, 4);
  })).toEqual([137, 80, 78, 71]);
  await page.screenshot({ path: 'test-results/viewer-desktop.png' });
});

test('keeps controls visible in a narrow editor', async ({ page }) => {
  await page.setViewportSize({ width: 620, height: 700 });
  await openViewer(page);
  await expect(page.locator('[data-testid="toolbar"]')).toBeInViewport();
  await expect(page.locator('[data-testid="inspector"]')).toBeInViewport();
  await expect(page.locator('[data-testid="trajectory"]')).toBeInViewport();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBe(0);
  await page.screenshot({ path: 'test-results/viewer-narrow.png' });
});

/*
 * Fixed track widths used to make the workspace grid wider than the editor, so
 * the inspector hung past the right edge and was clipped by the non-scrolling
 * body - values and the 'c' supercell stepper were cut off. toBeInViewport()
 * does not catch this (a partly visible panel still passes), so compare the
 * panel's right edge against the window and check every row fits inside it.
 */
for (const width of [460, 380, 320]) {
  test(`keeps the inspector inside the editor at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 700 });
    await openViewer(page);
    for (const tab of ['Structure', 'Display', 'Selection']) {
      await page.click(`.tab:has-text("${tab}")`);
      const clipped = await page.evaluate(() => {
        const panel = document.querySelector('[data-testid="inspector"]')!.getBoundingClientRect();
        const escaping = [...document.querySelectorAll('.inspector-body *')]
          .filter(node => node.getBoundingClientRect().right - panel.right > 0.5)
          .map(node => (node as HTMLElement).className || node.tagName);
        return { overhang: panel.right - document.documentElement.clientWidth, escaping };
      });
      expect(clipped.escaping, `${tab} tab has content past the panel edge`).toEqual([]);
      expect(clipped.overhang, `${tab} tab panel hangs past the window`).toBeLessThanOrEqual(0.5);
    }
    await page.screenshot({ path: `test-results/viewer-inspector-${width}.png` });
  });
}

/*
 * The axes gizmo was drawn in world space in a single white, so it sat inside
 * the cell where atoms hid it. It is now a fixed corner gizmo with red/green/
 * blue arms - assert the corner actually carries all three hues.
 */
test('draws a coloured axes gizmo in the corner', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 800 });
  await openViewer(page);
  const corner = () => page.locator('canvas').evaluate(node => {
    const canvas = node as HTMLCanvasElement;
    const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGLRenderingContext;
    const size = 150;
    const pixels = new Uint8Array(size * size * 4);
    // readPixels origin is bottom-left, which is where the gizmo lives.
    gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let red = 0, green = 0, blue = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i]!, g = pixels[i + 1]!, b = pixels[i + 2]!;
      if (Math.max(r, g, b) - Math.min(r, g, b) < 28) continue;
      if (r === Math.max(r, g, b)) red += 1;
      else if (g === Math.max(r, g, b)) green += 1;
      else blue += 1;
    }
    return { red, green, blue };
  });

  const on = await corner();
  expect(on.red, 'red a-axis arm').toBeGreaterThan(5);
  expect(on.green, 'green b-axis arm').toBeGreaterThan(5);
  expect(on.blue, 'blue c-axis arm').toBeGreaterThan(5);

  // Turning axes off must clear the corner entirely.
  await page.click('.tab:has-text("Display")');
  await page.click('.check-row:has-text("Axes")');
  await expect.poll(async () => {
    const off = await corner();
    return off.red + off.green + off.blue;
  }).toBe(0);
});
