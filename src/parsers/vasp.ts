import type { Atom, Mat3, ParsedDocument, Structure, Vec3 } from '../model';
import { determinant } from '../geometry/cell';
import { fractionalToCartesian, linesOf, normalizedElement, numberAt, vec3 } from './common';

interface VaspHeader {
  name: string;
  vectors: Mat3;
  species: string[];
  counts: number[];
  coordinateLine: number;
  scale: number;
}

function scaleVector(vector: Vec3, scale: number): Vec3 {
  return [vector[0] * scale, vector[1] * scale, vector[2] * scale];
}

function parseHeader(lines: string[]): VaspHeader {
  if (lines.length < 8) throw new Error('VASP file is too short');
  const declaredScale = numberAt(lines[1]?.trim(), 'VASP scale');
  if (declaredScale === 0) throw new Error('VASP scale must not be zero');
  const rawVectors: Mat3 = [
    vec3(lines[2]?.trim().split(/\s+/) ?? [], 'lattice vector a'),
    vec3(lines[3]?.trim().split(/\s+/) ?? [], 'lattice vector b'),
    vec3(lines[4]?.trim().split(/\s+/) ?? [], 'lattice vector c')
  ];
  const rawVolume = Math.abs(determinant(rawVectors));
  if (declaredScale < 0 && rawVolume === 0) throw new Error('VASP lattice must have non-zero volume');
  const scale = declaredScale > 0 ? declaredScale : Math.cbrt(Math.abs(declaredScale) / rawVolume);
  const vectors = rawVectors.map(vector => scaleVector(vector, scale)) as Mat3;
  const rowFive = lines[5]?.trim().split(/\s+/) ?? [];
  const vaspFour = rowFive.every(value => /^\d+$/.test(value));
  const species = vaspFour ? rowFive.map((_, index) => `X${index + 1}`) : rowFive.map(normalizedElement);
  const countLine = vaspFour ? 5 : 6;
  const counts = (lines[countLine]?.trim().split(/\s+/) ?? []).map(Number);
  if (counts.length !== species.length || counts.some(value => !Number.isInteger(value) || value < 0)) {
    throw new Error('VASP species and count rows do not match');
  }
  let coordinateLine = countLine + 1;
  if (/^s/i.test(lines[coordinateLine]?.trim() ?? '')) coordinateLine += 1;
  return { name: lines[0]?.trim() || 'VASP structure', vectors, species, counts, coordinateLine, scale };
}

function expandedElements(species: string[], counts: number[]): string[] {
  return species.flatMap((element, index) => Array.from({ length: counts[index] ?? 0 }, () => element));
}

function parseCoordinates(lines: string[], start: number, elements: string[], vectors: Mat3, direct: boolean, scale = 1): Atom[] {
  return elements.map((element, id) => {
    const raw = vec3(lines[start + id]?.trim().split(/\s+/) ?? [], `coordinates for atom ${id + 1}`);
    const position = direct ? fractionalToCartesian(raw, vectors) : scaleVector(raw, scale);
    return { id, element, position };
  });
}

export function parsePoscar(text: string, name: string): ParsedDocument {
  const lines = linesOf(text);
  const header = parseHeader(lines);
  const modeLine = lines[header.coordinateLine]?.trim() ?? '';
  const direct = /^d/i.test(modeLine);
  if (!direct && !/^[ck]/i.test(modeLine)) throw new Error('VASP coordinate mode must be Direct or Cartesian');
  const elements = expandedElements(header.species, header.counts);
  const atoms = parseCoordinates(lines, header.coordinateLine + 1, elements, header.vectors, direct, header.scale);
  const structure: Structure = { name: header.name || name, atoms, bonds: [], cell: { vectors: header.vectors, periodic: [true, true, true] } };
  return { format: 'poscar', frames: [structure], frameCount: 1, originalIndices: [0] };
}

export function parseXdatcar(text: string, name: string): ParsedDocument {
  const lines = linesOf(text);
  const header = parseHeader(lines);
  const elements = expandedElements(header.species, header.counts);
  const frames: Structure[] = [];
  let cursor = header.coordinateLine;
  while (cursor < lines.length) {
    while (cursor < lines.length && !lines[cursor]?.trim()) cursor += 1;
    if (cursor >= lines.length) break;
    const marker = lines[cursor]?.trim() ?? '';
    const direct = /^direct/i.test(marker);
    const cartesian = /^[ck]/i.test(marker);
    if (!direct && !cartesian) throw new Error(`Expected XDATCAR configuration marker on line ${cursor + 1}`);
    const atoms = parseCoordinates(lines, cursor + 1, elements, header.vectors, direct, header.scale);
    frames.push({
      name: `${header.name || name} - frame ${frames.length + 1}`,
      atoms,
      bonds: [],
      cell: { vectors: header.vectors, periodic: [true, true, true] },
      metadata: { originalFrame: frames.length }
    });
    cursor += elements.length + 1;
  }
  if (frames.length === 0) throw new Error('XDATCAR contains no configurations');
  return { format: 'xdatcar', frames, frameCount: frames.length, originalIndices: frames.map((_, index) => index) };
}
