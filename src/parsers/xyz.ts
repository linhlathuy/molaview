import type { Atom, Cell, ParsedDocument, Structure, Vec3 } from '../model';
import { linesOf, normalizedElement, numberAt } from './common';

interface PropertyColumn { name: string; offset: number; count: number }

function propertyColumns(comment: string): PropertyColumn[] {
  const match = /(?:^|\s)Properties=([^\s]+)/i.exec(comment);
  if (!match?.[1]) return [];
  const fields = match[1].split(':');
  const columns: PropertyColumn[] = [];
  let offset = 0;
  for (let index = 0; index + 2 < fields.length; index += 3) {
    const count = Number(fields[index + 2]);
    if (!Number.isInteger(count) || count < 1) break;
    columns.push({ name: fields[index]!.toLowerCase(), offset, count });
    offset += count;
  }
  return columns;
}

function latticeFromComment(comment: string): Cell | undefined {
  const match = /Lattice=(?:"([^"]+)"|'([^']+)')/i.exec(comment);
  const raw = match?.[1] ?? match?.[2];
  if (!raw) return undefined;
  const values = raw.trim().split(/\s+/).map(Number);
  if (values.length !== 9 || values.some(value => !Number.isFinite(value))) {
    throw new Error('extXYZ Lattice must contain nine finite values');
  }
  const vectors: [Vec3, Vec3, Vec3] = [
    [values[0]!, values[1]!, values[2]!],
    [values[3]!, values[4]!, values[5]!],
    [values[6]!, values[7]!, values[8]!]
  ];
  return { vectors, periodic: [true, true, true] };
}

function atomFromLine(line: string, id: number, columns: PropertyColumn[]): Atom {
  const fields = line.trim().split(/\s+/);
  const species = columns.find(column => ['species', 'element', 'symbol'].includes(column.name));
  const position = columns.find(column => ['pos', 'position', 'positions'].includes(column.name));
  const elementIndex = species?.offset ?? 0;
  const positionIndex = position?.offset ?? 1;
  return {
    id,
    element: normalizedElement(fields[elementIndex] ?? ''),
    position: [
      numberAt(fields[positionIndex], `x coordinate on atom ${id + 1}`),
      numberAt(fields[positionIndex + 1], `y coordinate on atom ${id + 1}`),
      numberAt(fields[positionIndex + 2], `z coordinate on atom ${id + 1}`)
    ]
  };
}

export function parseXyz(text: string, name: string): ParsedDocument {
  const lines = linesOf(text);
  const frames: Structure[] = [];
  let cursor = 0;
  while (cursor < lines.length) {
    while (cursor < lines.length && !lines[cursor]?.trim()) cursor += 1;
    if (cursor >= lines.length) break;
    const atomCount = Number(lines[cursor]?.trim());
    if (!Number.isInteger(atomCount) || atomCount < 0) throw new Error(`Invalid XYZ atom count on line ${cursor + 1}`);
    const comment = lines[cursor + 1] ?? '';
    const columns = propertyColumns(comment);
    const atoms: Atom[] = [];
    for (let id = 0; id < atomCount; id += 1) {
      const line = lines[cursor + 2 + id];
      if (line === undefined) throw new Error(`XYZ frame ${frames.length + 1} is truncated`);
      atoms.push(atomFromLine(line, id, columns));
    }
    const cell = latticeFromComment(comment);
    const metadata: Record<string, string | number | boolean> = { comment };
    frames.push({ name, atoms, bonds: [], ...(cell ? { cell } : {}), metadata });
    cursor += atomCount + 2;
  }
  if (frames.length === 0) throw new Error('XYZ file contains no frames');
  return { format: 'xyz', frames, frameCount: frames.length, originalIndices: frames.map((_, index) => index) };
}
