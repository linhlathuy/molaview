import { open, type FileHandle } from 'node:fs/promises';
import { elementSymbols } from '../elements';
import type { Atom, Mat3, Structure, Vec3 } from '../model';

interface ArrayDescriptor { ndarray: [number[], string, number] }
type UlmRecord = Record<string, unknown>;

interface RandomAccessSource {
  readonly size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
  close(): Promise<void>;
}

class MemorySource implements RandomAccessSource {
  readonly size: number;

  constructor(private readonly bytes: Uint8Array) {
    this.size = bytes.byteLength;
  }

  async read(offset: number, length: number): Promise<Uint8Array> {
    return this.bytes.subarray(offset, offset + length);
  }

  async close(): Promise<void> {}
}

class FileSource implements RandomAccessSource {
  private constructor(private readonly handle: FileHandle, readonly size: number) {}

  static async open(path: string): Promise<FileSource> {
    const handle = await open(path, 'r');
    try {
      const stat = await handle.stat();
      if (!Number.isSafeInteger(stat.size)) throw new Error('Trajectory is too large to address safely');
      return new FileSource(handle, stat.size);
    } catch (error) {
      await handle.close();
      throw error;
    }
  }

  async read(offset: number, length: number): Promise<Uint8Array> {
    const bytes = new Uint8Array(length);
    const { bytesRead } = await this.handle.read(bytes, 0, length, offset);
    if (bytesRead !== length) throw new Error('Unexpected end of ASE trajectory');
    return bytes;
  }

  async close(): Promise<void> {
    await this.handle.close();
  }
}

function sampleFrameIndices(frameCount: number, maxFrames = 0): number[] {
  if (!Number.isInteger(frameCount) || frameCount < 0) throw new Error('Trajectory frame count must be a non-negative integer');
  if (frameCount === 0) return [];
  const limit = Number.isInteger(maxFrames) && maxFrames > 0 ? maxFrames : 0;
  if (limit === 0 || frameCount <= limit) return Array.from({ length: frameCount }, (_, index) => index);
  const last = frameCount - 1;
  // A limit of one would divide by zero below; show the first frame alone.
  if (limit === 1) return [0];
  return [...new Set(Array.from({ length: limit }, (_, index) => Math.round(last * index / (limit - 1))))];
}

function isArrayDescriptor(value: unknown): value is ArrayDescriptor {
  return Boolean(value && typeof value === 'object' && 'ndarray' in value && Array.isArray((value as ArrayDescriptor).ndarray));
}

function matrix3(value: unknown, description: string): Mat3 {
  if (!Array.isArray(value) || value.length !== 3) throw new Error(`${description} must contain three vectors`);
  const vectors = value.map((row, index) => {
    if (!Array.isArray(row) || row.length !== 3 || row.some(component => !Number.isFinite(Number(component)))) {
      throw new Error(`${description} vector ${index + 1} must contain three finite values`);
    }
    return row.map(Number) as Vec3;
  });
  return vectors as Mat3;
}

function int64(bytes: Uint8Array, offset = 0): number {
  const value = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getBigInt64(offset, true);
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error('ULM integer exceeds the supported range');
  return number;
}

export class AseTrajectorySource {
  frameCount = 0;
  sampledIndices: number[] = [];
  private readonly offsets = new Map<number, number>();
  private header: UlmRecord = {};

  private constructor(private readonly source: RandomAccessSource, private readonly name: string, private readonly maxFrames: number) {}

  static async open(bytes: Uint8Array, name: string, maxFrames = 0): Promise<AseTrajectorySource> {
    return AseTrajectorySource.fromSource(new MemorySource(bytes), name, maxFrames);
  }

  static async openFile(path: string, name: string, maxFrames = 0): Promise<AseTrajectorySource> {
    return AseTrajectorySource.fromSource(await FileSource.open(path), name, maxFrames);
  }

  private static async fromSource(source: RandomAccessSource, name: string, maxFrames: number): Promise<AseTrajectorySource> {
    const trajectory = new AseTrajectorySource(source, name, maxFrames);
    try {
      await trajectory.initialize();
      return trajectory;
    } catch (error) {
      await source.close();
      throw error;
    }
  }

  private async initialize(): Promise<void> {
    const header = await this.read(0, 48, 'ULM header');
    if (new TextDecoder('ascii').decode(header.subarray(0, 8)) !== '- of Ulm') {
      throw new Error('File is not a supported ASE ULM trajectory');
    }
    const tag = new TextDecoder('ascii').decode(header.subarray(8, 24)).trimEnd();
    if (tag !== 'ASE-Trajectory') throw new Error(`ULM tag is ${tag || '<empty>'}, not ASE-Trajectory`);
    const version = int64(header, 24);
    if (version < 1 || version > 3) throw new Error(`Unsupported ULM version ${version}`);
    this.frameCount = int64(header, 32);
    if (this.frameCount < 1) throw new Error('ASE trajectory contains no structures');
    const offsetsPosition = int64(header, 40);
    const tableLength = this.frameCount * 8;
    this.bounds(offsetsPosition, tableLength, 'ULM frame offset table');
    this.sampledIndices = sampleFrameIndices(this.frameCount, this.maxFrames);
    // One contiguous read of the offset table: the per-frame entries are adjacent,
    // so a read per sampled frame would issue thousands of 8-byte reads when the
    // whole trajectory is loaded.
    const table = await this.read(offsetsPosition, tableLength, 'ULM frame offset table');
    for (const index of this.sampledIndices) {
      this.offsets.set(index, int64(table, index * 8));
    }
    this.header = await this.record(0);
  }

  private bounds(offset: number, length: number, description: string): void {
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > this.source.size) {
      throw new Error(`${description} points outside the ULM file`);
    }
  }

  private async read(offset: number, length: number, description: string): Promise<Uint8Array> {
    this.bounds(offset, length, description);
    return this.source.read(offset, length);
  }

  private async record(index: number): Promise<UlmRecord> {
    const offset = this.offsets.get(index);
    if (offset === undefined) throw new Error(`ASE frame ${index + 1} does not exist`);
    const length = int64(await this.read(offset, 8, `ASE frame ${index + 1} header`));
    const bytes = await this.read(offset + 8, length, `ASE frame ${index + 1}`);
    try {
      const value = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('record is not an object');
      return value as UlmRecord;
    } catch (error) {
      throw new Error(`Invalid JSON metadata in ASE frame ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async numericArray(record: UlmRecord, key: string): Promise<number[]> {
    const value = record[`${key}.`];
    if (!isArrayDescriptor(value)) throw new Error(`ASE frame has no ${key} array`);
    const [shape, dtype, offset] = value.ndarray;
    if (!Array.isArray(shape) || shape.some(size => !Number.isInteger(size) || size < 0)) throw new Error(`ASE ${key} has an invalid shape`);
    const count = shape.reduce((product, size) => product * size, 1);
    const littleEndian = record._little_endian !== false;
    const sizes: Record<string, number> = { float64: 8, float32: 4, int64: 8, int32: 4, int16: 2, int8: 1, uint8: 1, bool: 1 };
    const size = sizes[dtype];
    if (!size) throw new Error(`ASE ${key} uses unsupported dtype ${dtype}`);
    const bytes = await this.read(offset, count * size, `ASE ${key} array`);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const readers: Record<string, (position: number) => number> = {
      float64: position => view.getFloat64(position, littleEndian),
      float32: position => view.getFloat32(position, littleEndian),
      int64: position => Number(view.getBigInt64(position, littleEndian)),
      int32: position => view.getInt32(position, littleEndian),
      int16: position => view.getInt16(position, littleEndian),
      int8: position => view.getInt8(position),
      uint8: position => view.getUint8(position),
      bool: position => view.getUint8(position)
    };
    return Array.from({ length: count }, (_, index) => readers[dtype]!(index * size));
  }

  async getFrame(sampleIndex: number): Promise<Structure> {
    const originalFrame = this.sampledIndices[sampleIndex];
    if (originalFrame === undefined) throw new Error(`Trajectory sample ${sampleIndex + 1} does not exist`);
    const record = await this.record(originalFrame);
    const numbersRecord = record['numbers.'] ? record : this.header;
    const numbers = await this.numericArray(numbersRecord, 'numbers');
    const positions = await this.numericArray(record, 'positions');
    if (positions.length !== numbers.length * 3) throw new Error('ASE positions do not match the atom count');
    const atoms: Atom[] = numbers.map((atomicNumber, id) => {
      const element = elementSymbols[atomicNumber - 1];
      if (!element) throw new Error(`Unsupported atomic number ${atomicNumber} in ASE trajectory`);
      return { id, element, position: [positions[id * 3]!, positions[id * 3 + 1]!, positions[id * 3 + 2]!] };
    });
    const pbcValue = record.pbc ?? this.header.pbc ?? [false, false, false];
    if (!Array.isArray(pbcValue) || pbcValue.length !== 3) throw new Error('ASE pbc must contain three values');
    const cell = matrix3(record.cell, 'ASE cell');
    const metadata: Record<string, string | number | boolean> = { originalFrame };
    const info = record.info;
    if (info && typeof info === 'object' && !Array.isArray(info)) {
      for (const [key, value] of Object.entries(info)) {
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') metadata[key] = value;
      }
    }
    return {
      name: `${this.name} - frame ${originalFrame + 1}`,
      atoms,
      bonds: [],
      cell: { vectors: cell, periodic: pbcValue.map(Boolean) as [boolean, boolean, boolean] },
      metadata
    };
  }

  async dispose(): Promise<void> {
    await this.source.close();
  }
}
