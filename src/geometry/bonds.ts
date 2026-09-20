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
  const atoms = structure.atoms;
  const count = atoms.length;
  const radii = atoms.map(atom => elementStyle(atom.element).covalentRadius);
  const defaultCutoff = radii.reduce((maximum, radius) => Math.max(maximum, radius), 0) * 2 + options.tolerance;
  const maximumCutoff = Math.max(defaultCutoff, ...customCutoffs);
  if (maximumCutoff <= 0 || count < 2) return bonds;

  const cell = structure.cell;
  const vectors = cell?.vectors;
  const periodic = cell?.periodic ?? [false, false, false];
  const anyPeriodic = periodic.some(Boolean);

  // Positions are held in flat typed arrays and bins are addressed by integer
  // index. The previous implementation keyed a Map with a freshly built string
  // per insertion and per lookup, which dominated the cost of a frame.
  const fractional = new Float64Array(count * 3);
  const cartesian = new Float64Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    const position = atoms[index]!.position;
    if (vectors && anyPeriodic) {
      const f = cartesianToFractional(position, vectors);
      for (const axis of [0, 1, 2] as const) if (periodic[axis]) f[axis] -= Math.floor(f[axis]);
      const c = fractionalToCartesian(f, vectors);
      fractional[index * 3] = f[0]; fractional[index * 3 + 1] = f[1]; fractional[index * 3 + 2] = f[2];
      cartesian[index * 3] = c[0]; cartesian[index * 3 + 1] = c[1]; cartesian[index * 3 + 2] = c[2];
    } else {
      cartesian[index * 3] = position[0]; cartesian[index * 3 + 1] = position[1]; cartesian[index * 3 + 2] = position[2];
    }
  }

  // Grid dimensions. Periodic axes are divided into whole bins so neighbours can
  // be reached by wrapping the index; open axes span the bounding box.
  const divisions: [number, number, number] = [1, 1, 1];
  const origin: [number, number, number] = [0, 0, 0];
  const extent: [number, number, number] = [1, 1, 1];
  for (const axis of [0, 1, 2] as const) {
    if (vectors && periodic[axis]) {
      const length = Math.hypot(vectors[axis][0], vectors[axis][1], vectors[axis][2]);
      divisions[axis] = Math.max(1, Math.floor(length / maximumCutoff));
    } else {
      let low = Infinity;
      let high = -Infinity;
      for (let index = 0; index < count; index += 1) {
        const value = cartesian[index * 3 + axis]!;
        if (value < low) low = value;
        if (value > high) high = value;
      }
      origin[axis] = low;
      extent[axis] = Math.max(high - low, 1e-9);
      divisions[axis] = Math.max(1, Math.min(128, Math.floor(extent[axis] / maximumCutoff)));
    }
  }

  const [nx, ny, nz] = divisions;
  const binOf = (index: number, axis: 0 | 1 | 2): number => {
    const size = divisions[axis];
    if (vectors && periodic[axis]) {
      const bin = Math.floor(fractional[index * 3 + axis]! * size);
      return bin < 0 ? 0 : bin >= size ? size - 1 : bin;
    }
    const bin = Math.floor((cartesian[index * 3 + axis]! - origin[axis]) / extent[axis] * size);
    return bin < 0 ? 0 : bin >= size ? size - 1 : bin;
  };

  // Linked-cell lists: head[bin] is the first atom, next[atom] the one after it.
  const head = new Int32Array(nx * ny * nz).fill(-1);
  const next = new Int32Array(count).fill(-1);
  for (let index = 0; index < count; index += 1) {
    const bin = (binOf(index, 0) * ny + binOf(index, 1)) * nz + binOf(index, 2);
    next[index] = head[bin]!;
    head[bin] = index;
  }

  // When the cell spans only a few bins, wrapping makes the same neighbour bin
  // reachable from more than one offset, so a pair can be visited repeatedly.
  // seen[b] records the source atom that last considered b.
  const seen = new Int32Array(count).fill(-1);
  for (let a = 0; a < count; a += 1) {
    const atomA = atoms[a]!;
    const bx = binOf(a, 0);
    const by = binOf(a, 1);
    const bz = binOf(a, 2);
    for (let i = -1; i <= 1; i += 1) {
      let cx = bx + i;
      if (vectors && periodic[0]) cx = ((cx % nx) + nx) % nx;
      else if (cx < 0 || cx >= nx) continue;
      for (let j = -1; j <= 1; j += 1) {
        let cy = by + j;
        if (vectors && periodic[1]) cy = ((cy % ny) + ny) % ny;
        else if (cy < 0 || cy >= ny) continue;
        for (let k = -1; k <= 1; k += 1) {
          let cz = bz + k;
          if (vectors && periodic[2]) cz = ((cz % nz) + nz) % nz;
          else if (cz < 0 || cz >= nz) continue;
          for (let b = head[(cx * ny + cy) * nz + cz]!; b !== -1; b = next[b]!) {
            if (b <= a) continue;
            if (seen[b] === a) continue;
            seen[b] = a;
            const atomB = atoms[b]!;
            const key = pairKey(atomA.element, atomB.element);
            if (options.hiddenPairs?.has(key)) continue;
            const { displacement, offset } = minimumImage(structure, atomA.position, atomB.position);
            const squared = displacement[0] ** 2 + displacement[1] ** 2 + displacement[2] ** 2;
            const cutoff = options.cutoffs?.[key] ?? radii[a]! + radii[b]! + options.tolerance;
            if (squared < 0.01 || squared > cutoff * cutoff) continue;
            bonds.push(offset.some(value => value !== 0) ? { a: atomA.id, b: atomB.id, offset } : { a: atomA.id, b: atomB.id });
          }
        }
      }
    }
  }
  return bonds.sort((left, right) => left.a - right.a || left.b - right.b || (left.offset?.join(',') ?? '').localeCompare(right.offset?.join(',') ?? ''));
}
