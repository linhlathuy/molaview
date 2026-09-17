import type { Structure, TrajectorySummary, Vec3 } from './model';

export interface ViewerState {
  structure: Structure;
  trajectory?: TrajectorySummary;
  sampleIndex: number;
  originalFrameIndex: number;
}

export type HostMessage =
  | { type: 'load'; state: ViewerState }
  | { type: 'frame'; structure: Structure; sampleIndex: number; originalFrameIndex: number }
  | { type: 'error'; message: string; detail?: string };

export type ViewMessage =
  | { type: 'ready' }
  | { type: 'requestFrame'; sampleIndex: number }
  | { type: 'reopenAsText' }
  | { type: 'saveScreenshot'; bytes: number[]; suggestedName: string }
  | { type: 'setBondOverrides'; tolerance: number; hiddenPairs: string[]; cutoffs: Record<string, number> }
  | { type: 'setSupercell'; repetitions: Vec3 };

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function isViewMessage(value: unknown): value is ViewMessage {
  const message = record(value);
  if (!message || typeof message.type !== 'string') return false;
  switch (message.type) {
    case 'ready':
    case 'reopenAsText':
      return true;
    case 'requestFrame':
      return Number.isInteger(message.sampleIndex) && (message.sampleIndex as number) >= 0;
    case 'saveScreenshot':
      return Array.isArray(message.bytes)
        && message.bytes.length <= 100_000_000
        && message.bytes.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255)
        && typeof message.suggestedName === 'string'
        && /^[^/\\]+\.png$/i.test(message.suggestedName);
    case 'setBondOverrides': {
      const cutoffs = record(message.cutoffs);
      return finiteNumber(message.tolerance)
        && message.tolerance >= 0
        && Array.isArray(message.hiddenPairs)
        && message.hiddenPairs.every(pair => typeof pair === 'string')
        && cutoffs !== undefined
        && Object.values(cutoffs).every(cutoff => finiteNumber(cutoff) && cutoff > 0);
    }
    case 'setSupercell':
      return Array.isArray(message.repetitions)
        && message.repetitions.length === 3
        && message.repetitions.every(repetition => Number.isInteger(repetition) && repetition >= 1 && repetition <= 20);
    default:
      return false;
  }
}
