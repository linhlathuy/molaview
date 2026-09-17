export interface PlaybackOptions {
  sampleCount: number;
  fps: number;
  loop: boolean;
}

export class PlaybackController {
  constructor(private options: PlaybackOptions) {}

  update(options: Partial<PlaybackOptions>): void {
    this.options = { ...this.options, ...options };
  }

  next(index: number): number {
    if (this.options.sampleCount < 1) return 0;
    if (index + 1 < this.options.sampleCount) return index + 1;
    return this.options.loop ? 0 : this.options.sampleCount - 1;
  }

  previous(index: number): number {
    if (this.options.sampleCount < 1) return 0;
    if (index > 0) return index - 1;
    return this.options.loop ? this.options.sampleCount - 1 : 0;
  }

  delay(): number {
    return 1000 / Math.max(0.25, Math.min(30, this.options.fps));
  }
}

export function formatFrameLabel(sampleIndex: number, sampleCount: number, originalIndex: number, frameCount: number): string {
  return `Sample ${sampleIndex + 1}/${sampleCount} - Frame ${originalIndex + 1}/${frameCount}`;
}
