import type { Atom, Bond, ParsedDocument, Structure } from '../model';
import { normalizedElement, numberAt } from './common';

function parseRecord(record: string, fallbackName: string): Structure {
  const lines = record.replace(/\r\n?/g, '\n').split('\n');
  const counts = lines[3];
  if (!counts || !/V2000/i.test(counts)) throw new Error('Only V2000 MOL/SDF records are supported');
  const atomCount = Number(counts.slice(0, 3));
  const bondCount = Number(counts.slice(3, 6));
  if (!Number.isInteger(atomCount) || !Number.isInteger(bondCount)) throw new Error('Invalid V2000 counts line');
  const atoms: Atom[] = [];
  for (let id = 0; id < atomCount; id += 1) {
    const line = lines[4 + id];
    if (!line) throw new Error('Truncated V2000 atom block');
    atoms.push({
      id,
      element: normalizedElement(line.slice(31, 34).trim()),
      position: [
        numberAt(line.slice(0, 10).trim(), `MOL x coordinate on atom ${id + 1}`),
        numberAt(line.slice(10, 20).trim(), `MOL y coordinate on atom ${id + 1}`),
        numberAt(line.slice(20, 30).trim(), `MOL z coordinate on atom ${id + 1}`)
      ]
    });
  }
  const bonds: Bond[] = [];
  for (let index = 0; index < bondCount; index += 1) {
    const line = lines[4 + atomCount + index];
    if (!line) throw new Error('Truncated V2000 bond block');
    const a = Number(line.slice(0, 3)) - 1;
    const b = Number(line.slice(3, 6)) - 1;
    const order = Number(line.slice(6, 9));
    if (![a, b, order].every(Number.isInteger)) throw new Error('Invalid V2000 bond');
    bonds.push({ a, b, order });
  }
  return { name: lines[0]?.trim() || fallbackName, atoms, bonds };
}

export function parseMol(text: string, name: string): ParsedDocument {
  const frames = text.split(/^\$\$\$\$\s*$/m).map(record => record.trimEnd()).filter(record => record.trim()).map(record => parseRecord(record, name));
  if (frames.length === 0) throw new Error('MOL/SDF file contains no records');
  return { format: 'mol', frames, frameCount: frames.length, originalIndices: frames.map((_, index) => index) };
}
