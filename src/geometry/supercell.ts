import type { Atom, Bond, Structure, Vec3 } from '../model';

function positiveInteger(value: number, axis: string): number {
  if (!Number.isInteger(value) || value < 1 || value > 20) throw new Error(`Supercell ${axis} repetition must be an integer from 1 to 20`);
  return value;
}

export function makeSupercell(structure: Structure, repetitions: Vec3): Structure {
  if (!structure.cell) {
    if (repetitions.some(value => value !== 1)) throw new Error('A periodic cell is required to create a supercell');
    return structure;
  }
  const [nx, ny, nz] = [
    positiveInteger(repetitions[0], 'a'),
    positiveInteger(repetitions[1], 'b'),
    positiveInteger(repetitions[2], 'c')
  ];
  const atoms: Atom[] = [];
  const bonds: Bond[] = [];
  const atomCount = structure.atoms.length;
  for (let i = 0; i < nx; i += 1) for (let j = 0; j < ny; j += 1) for (let k = 0; k < nz; k += 1) {
    const shift: Vec3 = [
      i * structure.cell.vectors[0][0] + j * structure.cell.vectors[1][0] + k * structure.cell.vectors[2][0],
      i * structure.cell.vectors[0][1] + j * structure.cell.vectors[1][1] + k * structure.cell.vectors[2][1],
      i * structure.cell.vectors[0][2] + j * structure.cell.vectors[1][2] + k * structure.cell.vectors[2][2]
    ];
    for (const atom of structure.atoms) {
      atoms.push({
        ...atom,
        id: atoms.length,
        sourceId: atom.sourceId ?? atom.id,
        position: [atom.position[0] + shift[0], atom.position[1] + shift[1], atom.position[2] + shift[2]]
      });
    }
  }

  const localIndex = new Map(structure.atoms.map((atom, index) => [atom.id, index]));
  const replicaIndex = (i: number, j: number, k: number): number => (i * ny + j) * nz + k;
  const wrappedReplica = (value: number, count: number): [number, number] => {
    const wrapped = ((value % count) + count) % count;
    return [wrapped, (value - wrapped) / count];
  };
  for (let i = 0; i < nx; i += 1) for (let j = 0; j < ny; j += 1) for (let k = 0; k < nz; k += 1) {
    const sourceReplica = replicaIndex(i, j, k);
    for (const bond of structure.bonds) {
      const sourceA = localIndex.get(bond.a);
      const sourceB = localIndex.get(bond.b);
      if (sourceA === undefined || sourceB === undefined) throw new Error(`Bond ${bond.a}-${bond.b} references an unknown atom`);
      const primitiveOffset = bond.offset ?? [0, 0, 0];
      const [targetI, imageI] = wrappedReplica(i + primitiveOffset[0], nx);
      const [targetJ, imageJ] = wrappedReplica(j + primitiveOffset[1], ny);
      const [targetK, imageK] = wrappedReplica(k + primitiveOffset[2], nz);
      const offset: Vec3 = [imageI, imageJ, imageK];
      const replicated: Bond = {
        a: sourceReplica * atomCount + sourceA,
        b: replicaIndex(targetI, targetJ, targetK) * atomCount + sourceB,
        ...(bond.order !== undefined ? { order: bond.order } : {}),
        ...(offset.some(value => value !== 0) ? { offset } : {})
      };
      bonds.push(replicated);
    }
  }
  return {
    ...structure,
    atoms,
    bonds,
    cell: {
      periodic: structure.cell.periodic,
      vectors: [
        structure.cell.vectors[0].map(value => value * nx) as Vec3,
        structure.cell.vectors[1].map(value => value * ny) as Vec3,
        structure.cell.vectors[2].map(value => value * nz) as Vec3
      ]
    }
  };
}
