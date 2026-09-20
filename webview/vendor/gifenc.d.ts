// Minimal typings for the vendored gifenc build (MIT, Matt DesLauriers).
export interface GifFrameOptions {
  palette: number[][];
  delay?: number;
}
export interface GifEncoderHandle {
  writeFrame(index: Uint8Array, width: number, height: number, options: GifFrameOptions): void;
  finish(): void;
  bytes(): Uint8Array;
}
export function GIFEncoder(): GifEncoderHandle;
export function quantize(rgba: Uint8Array, maxColors: number): number[][];
export function applyPalette(rgba: Uint8Array, palette: number[][]): Uint8Array;
