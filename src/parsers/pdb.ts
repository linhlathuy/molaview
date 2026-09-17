import type { Atom, Bond, Cell, ParsedDocument, Structure, Vec3 } from '../model';
import { normalizedElement, numberAt } from './common';

function crystalCell(line: string): Cell | undefined {
  const a = Number(line.slice(6, 15));
  const b = Number(line.slice(15, 24));
  const c = Number(line.slice(24, 33));
  const alpha = Number(line.slice(33, 40));
  const beta = Number(line.slice(40, 47));
  const gamma = Number(line.slice(47, 54));
  if ([a, b, c, alpha, beta, gamma].some(value => !Number.isFinite(value))) return undefined;
  const radians = [alpha, beta, gamma].map(value => value * Math.PI / 180);
  const [ar, br, gr] = radians as [number, number, number];
  const vectorA: Vec3 = [a, 0, 0];
  const vectorB: Vec3 = [b * Math.cos(gr), b * Math.sin(gr), 0];
  const cx = c * Math.cos(br);
  const cy = c * (Math.cos(ar) - Math.cos(br) * Math.cos(gr)) / Math.sin(gr);
  const vectorC: Vec3 = [cx, cy, Math.sqrt(Math.max(0, c * c - cx * cx - cy * cy))];
  return { vectors: [vectorA, vectorB, vectorC], periodic: [true, true, true] };
}

export function parsePdb(text: string, name: string): ParsedDocument {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const frames: Structure[] = [];
  let atoms: Atom[] = [];
  let serials = new Map<number, number>();
  let globalCell: Cell | undefined;
  const connections: Array<[number, number]> = [];

  const finish = (): void => {
    if (atoms.length === 0) return;
    const bonds: Bond[] = [];
    const seen = new Set<string>();
    for (const [from, to] of connections) {
      const a = serials.get(from);
      const b = serials.get(to);
      if (a === undefined || b === undefined || a === b) continue;
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (!seen.has(key)) {
        seen.add(key);
        bonds.push({ a: Math.min(a, b), b: Math.max(a, b), order: 1 });
      }
    }
    frames.push({ name, atoms, bonds, ...(globalCell ? { cell: globalCell } : {}) });
    atoms = [];
    serials = new Map();
  };

  for (const line of lines) {
    const record = line.slice(0, 6).trim().toUpperCase();
    if (record === 'CRYST1') globalCell = crystalCell(line);
    if (record === 'MODEL' && atoms.length > 0) finish();
    if (record === 'ENDMDL') { finish(); continue; }
    if (record === 'ATOM' || record === 'HETATM') {
      const id = atoms.length;
      const serial = Number(line.slice(6, 11));
      const explicitElement = line.slice(76, 78).trim();
      const atomName = line.slice(12, 16).trim().replace(/^\d+/, '');
      atoms.push({
        id,
        element: normalizedElement(explicitElement || atomName),
        ...(atomName ? { label: atomName } : {}),
        position: [
          numberAt(line.slice(30, 38).trim(), `PDB x coordinate on atom ${id + 1}`),
          numberAt(line.slice(38, 46).trim(), `PDB y coordinate on atom ${id + 1}`),
          numberAt(line.slice(46, 54).trim(), `PDB z coordinate on atom ${id + 1}`)
        ]
      });
      if (Number.isInteger(serial)) serials.set(serial, id);
    }
    if (record === 'CONECT') {
      const values = line.slice(6).trim().split(/\s+/).map(Number).filter(Number.isFinite);
      const from = values[0];
      if (from !== undefined) for (const to of values.slice(1)) connections.push([from, to]);
    }
  }
  finish();
  if (frames.length === 0) throw new Error('PDB file contains no atoms');
  return { format: 'pdb', frames, frameCount: frames.length, originalIndices: frames.map((_, index) => index) };
}
