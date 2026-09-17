import { elementStyle } from '../elements';
import type { Bond, Structure, Vec3 } from '../model';
import { cartesianToFractional, fractionalToCartesian } from './cell';

export interface BondOptions {
  tolerance: number;
  hiddenPairs?: ReadonlySet<string>;
  cutoffs?: Readonly<Record<string, number>>;
}

export function pairKey(a: string, b: string): string {
  return a.localeCompare(b) <= 0 ? `${a}-${b}` : `${b}-${a}`;
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function minimumImage(structure: Structure, a: Vec3, b: Vec3): { displacement: Vec3; offset: Vec3 } {
  const cartesian = subtract(b, a);
  if (!structure.cell) return { displacement: cartesian, offset: [0, 0, 0] };
  const fractional = cartesianToFractional(cartesian, structure.cell.vectors);
  const offset: Vec3 = [0, 0, 0];
  for (const axis of [0, 1, 2] as const) {
    if (!structure.cell.periodic[axis]) continue;
    const image = Math.round(fractional[axis]);
    offset[axis] = image === 0 ? 0 : -image;
    fractional[axis] += offset[axis];
  }
  return { displacement: fractionalToCartesian(fractional, structure.cell.vectors), offset };
}

export function inferBonds(structure: Structure, options: BondOptions): Bond[] {
  if (!Number.isFinite(options.tolerance) || options.tolerance < 0) throw new Error('Bond tolerance must be non-negative');
  const customCutoffs = Object.values(options.cutoffs ?? {});
  if (customCutoffs.some(cutoff => !Number.isFinite(cutoff) || cutoff <= 0)) throw new Error('Bond cutoffs must be positive finite values');
  const bonds: Bond[] = [];
  const defaultCutoff = structure.atoms.reduce((maximum, atom) => Math.max(maximum, elementStyle(atom.element).covalentRadius), 0) * 2 + options.tolerance;
  const maximumCutoff = Math.max(defaultCutoff, ...customCutoffs);
  if (maximumCutoff <= 0 || structure.atoms.length < 2) return bonds;
  const bins = new Map<string, Set<number>>();
  const canonicalPosition = (position: Vec3): Vec3 => {
    if (!structure.cell) return position;
    const fractional = cartesianToFractional(position, structure.cell.vectors);
    for (const axis of [0, 1, 2] as const) if (structure.cell.periodic[axis]) fractional[axis] -= Math.floor(fractional[axis]);
    return fractionalToCartesian(fractional, structure.cell.vectors);
  };
  const shifts: Vec3[] = [[0, 0, 0]];
  if (structure.cell) {
    const axes = structure.cell.periodic.map(periodic => periodic ? [-1, 0, 1] : [0]);
    shifts.length = 0;
    for (const i of axes[0]!) for (const j of axes[1]!) for (const k of axes[2]!) shifts.push([i, j, k]);
  }
  const binKey = (position: Vec3): string => position.map(value => Math.floor(value / maximumCutoff)).join(',');
  structure.atoms.forEach((atom, index) => {
    const canonical = canonicalPosition(atom.position);
    for (const shift of shifts) {
      const position: Vec3 = structure.cell ? [
        canonical[0] + shift[0] * structure.cell.vectors[0][0] + shift[1] * structure.cell.vectors[1][0] + shift[2] * structure.cell.vectors[2][0],
        canonical[1] + shift[0] * structure.cell.vectors[0][1] + shift[1] * structure.cell.vectors[1][1] + shift[2] * structure.cell.vectors[2][1],
        canonical[2] + shift[0] * structure.cell.vectors[0][2] + shift[1] * structure.cell.vectors[1][2] + shift[2] * structure.cell.vectors[2][2]
      ] : canonical;
      const key = binKey(position);
      const members = bins.get(key) ?? new Set<number>();
      members.add(index);
      bins.set(key, members);
    }
  });
  for (let a = 0; a < structure.atoms.length; a += 1) {
    const atomA = structure.atoms[a]!;
    const origin = canonicalPosition(atomA.position).map(value => Math.floor(value / maximumCutoff)) as Vec3;
    const candidates = new Set<number>();
    for (let i = -1; i <= 1; i += 1) for (let j = -1; j <= 1; j += 1) for (let k = -1; k <= 1; k += 1) {
      for (const candidate of bins.get(`${origin[0] + i},${origin[1] + j},${origin[2] + k}`) ?? []) {
        if (candidate > a) candidates.add(candidate);
      }
    }
    for (const b of candidates) {
      const atomB = structure.atoms[b]!;
      const key = pairKey(atomA.element, atomB.element);
      if (options.hiddenPairs?.has(key)) continue;
      const { displacement, offset } = minimumImage(structure, atomA.position, atomB.position);
      const squared = displacement[0] ** 2 + displacement[1] ** 2 + displacement[2] ** 2;
      const cutoff = options.cutoffs?.[key] ?? elementStyle(atomA.element).covalentRadius + elementStyle(atomB.element).covalentRadius + options.tolerance;
      if (squared < 0.01 || squared > cutoff * cutoff) continue;
      bonds.push(offset.some(value => value !== 0) ? { a: atomA.id, b: atomB.id, offset } : { a: atomA.id, b: atomB.id });
    }
  }
  return bonds.sort((left, right) => left.a - right.a || left.b - right.b || (left.offset?.join(',') ?? '').localeCompare(right.offset?.join(',') ?? ''));
}
