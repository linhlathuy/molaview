import { defineConfig } from '@playwright/test';

export default defineConfig({
  // Paths are relative to this config file in config/, so step up to the project root.
  testDir: '../playwright',
  outputDir: '../test-results',
  timeout: 30_000,
  use: {
    headless: true,
    viewport: { width: 1280, height: 800 },
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] }
  }
});
