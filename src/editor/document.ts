import * as vscode from 'vscode';
import { inferBonds, type BondOptions } from '../geometry/bonds';
import { validateStructure, type ParsedDocument, type Structure, type StructureFormat } from '../model';
import { AseTrajectorySource } from '../parsers/aseTraj';
import { detectFormat, parseTextDocument } from '../parsers';
import type { ViewerState } from '../protocol';

interface FrameSource {
  frameCount: number;
  sampledIndices: number[];
  getFrame(sampleIndex: number): Promise<Structure>;
  dispose?(): void | Promise<void>;
}

class ParsedFrameSource implements FrameSource {
  readonly frameCount: number;
  readonly sampledIndices: number[];

  constructor(private readonly parsed: ParsedDocument) {
    this.frameCount = parsed.frameCount;
    this.sampledIndices = parsed.originalIndices;
  }

  async getFrame(sampleIndex: number): Promise<Structure> {
    const frame = this.parsed.frames[sampleIndex];
    if (!frame) throw new Error(`Structure frame ${sampleIndex + 1} does not exist`);
    return frame;
  }
}

async function sourceFromUri(uri: vscode.Uri): Promise<FrameSource> {
  const name = uri.path.split('/').at(-1) ?? uri.path;
  let pathFormat: StructureFormat | undefined;
  try { pathFormat = detectFormat(uri.path, ''); } catch { /* Fall back to content probing. */ }
  if (pathFormat === 'ase-traj' && (uri.scheme === 'file' || uri.scheme === 'vscode-remote')) {
    return AseTrajectorySource.openFile(uri.fsPath, name);
  }
  const bytes = await vscode.workspace.fs.readFile(uri);
  const preview = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 8192)));
  const format = pathFormat ?? detectFormat(uri.path, preview);
  if (format === 'ase-traj') return AseTrajectorySource.open(bytes, name);
  return new ParsedFrameSource(parseTextDocument(new TextDecoder().decode(bytes), name, format));
}

export class StructureDocument implements vscode.CustomDocument {
  private source: FrameSource | undefined;
  private loadError: Error | undefined;
  private sampleIndex = 0;
  private bondOptions: BondOptions = { tolerance: 0.45 };
  private readonly frameCache = new Map<number, Structure>();

  private constructor(readonly uri: vscode.Uri) {}

  static async open(uri: vscode.Uri): Promise<StructureDocument> {
    const document = new StructureDocument(uri);
    try {
      await document.reload();
    } catch {
      // The custom editor must still resolve so it can show the parse error.
    }
    return document;
  }

  async reload(): Promise<void> {
    try {
      const source = await sourceFromUri(this.uri);
      const previous = this.source;
      this.source = source;
      this.loadError = undefined;
      this.frameCache.clear();
      this.sampleIndex = Math.min(this.sampleIndex, source.sampledIndices.length - 1);
      void previous?.dispose?.();
    } catch (error) {
      this.loadError = error instanceof Error ? error : new Error(String(error));
      throw this.loadError;
    }
  }

  setBondOptions(options: BondOptions): void {
    this.bondOptions = options;
    this.frameCache.clear();
  }

  async state(sampleIndex = this.sampleIndex): Promise<ViewerState> {
    if (this.loadError) throw this.loadError;
    const source = this.source;
    if (!source) throw new Error('Structure data is unavailable');
    if (!Number.isInteger(sampleIndex) || sampleIndex < 0 || sampleIndex >= source.sampledIndices.length) {
      throw new Error(`Trajectory sample ${sampleIndex + 1} does not exist`);
    }
    this.sampleIndex = sampleIndex;
    let structure = this.frameCache.get(sampleIndex);
    if (structure) {
      this.frameCache.delete(sampleIndex);
      this.frameCache.set(sampleIndex, structure);
    } else {
      const raw = validateStructure(await source.getFrame(sampleIndex));
      structure = raw.bonds.length > 0 ? raw : { ...raw, bonds: inferBonds(raw, this.bondOptions) };
      this.frameCache.set(sampleIndex, structure);
      if (this.frameCache.size > 4) this.frameCache.delete(this.frameCache.keys().next().value!);
    }
    const originalFrameIndex = source.sampledIndices[sampleIndex]!;
    return {
      structure,
      ...(source.frameCount > 1 ? { trajectory: { frameCount: source.frameCount, sampledIndices: source.sampledIndices } } : {}),
      sampleIndex,
      originalFrameIndex
    };
  }

  dispose(): void {
    void this.source?.dispose?.();
  }
}
