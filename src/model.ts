export type Vec3 = [number, number, number];
export type Mat3 = [Vec3, Vec3, Vec3];

export interface Atom {
  id: number;
  element: string;
  position: Vec3;
  label?: string;
  occupancy?: number;
  sourceId?: number;
  properties?: Record<string, string | number | boolean>;
}

export interface Bond {
  a: number;
  b: number;
  order?: number;
  offset?: Vec3;
}

export interface Cell {
  vectors: Mat3;
  periodic: [boolean, boolean, boolean];
}

export interface Structure {
  name: string;
  atoms: Atom[];
  bonds: Bond[];
  cell?: Cell;
  metadata?: Record<string, string | number | boolean>;
}

export type StructureFormat =
  | 'cif'
  | 'poscar'
  | 'xdatcar'
  | 'xyz'
  | 'pdb'
  | 'mol'
  | 'ase-traj';

export interface ParsedDocument {
  format: StructureFormat;
  frames: Structure[];
  frameCount: number;
  originalIndices: number[];
}

export interface TrajectorySummary {
  frameCount: number;
  sampledIndices?: number[];
}

function assertVec3(value: Vec3, description: string): void {
  if (value.length !== 3 || value.some(component => !Number.isFinite(component))) {
    throw new Error(`${description} requires a finite position`);
  }
}

export function validateStructure(structure: Structure): Structure {
  const ids = new Set<number>();
  for (const atom of structure.atoms) {
    if (ids.has(atom.id)) throw new Error(`Duplicate atom id ${atom.id}`);
    ids.add(atom.id);
    if (!atom.element.trim()) throw new Error(`Atom ${atom.id} requires an element`);
    assertVec3(atom.position, `Atom ${atom.id}`);
  }

  if (structure.cell) {
    structure.cell.vectors.forEach((vector, index) => assertVec3(vector, `Cell vector ${index}`));
  }

  for (const bond of structure.bonds) {
    if (!ids.has(bond.a) || !ids.has(bond.b)) {
      throw new Error(`Bond ${bond.a}-${bond.b} references an unknown atom`);
    }
  }

  return structure;
}
