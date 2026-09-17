import type { Cell, Mat3, Vec3 } from '../model';

export function cellFromParameters(a: number, b: number, c: number, alpha: number, beta: number, gamma: number): Cell {
  if (![a, b, c].every(value => Number.isFinite(value) && value > 0)) throw new Error('Cell lengths must be positive');
  if (![alpha, beta, gamma].every(value => Number.isFinite(value) && value > 0 && value < 180)) throw new Error('Cell angles must be between 0 and 180 degrees');
  const [ar, br, gr] = [alpha, beta, gamma].map(value => value * Math.PI / 180) as [number, number, number];
  const vectorA: Vec3 = [a, 0, 0];
  const vectorB: Vec3 = [b * Math.cos(gr), b * Math.sin(gr), 0];
  const cx = c * Math.cos(br);
  const cy = c * (Math.cos(ar) - Math.cos(br) * Math.cos(gr)) / Math.sin(gr);
  const czSquared = c * c - cx * cx - cy * cy;
  if (czSquared < -1e-8) throw new Error('Cell parameters do not form a valid lattice');
  const vectorC: Vec3 = [cx, cy, Math.sqrt(Math.max(0, czSquared))];
  return { vectors: [vectorA, vectorB, vectorC], periodic: [true, true, true] };
}

export function wrapFractional(value: Vec3): Vec3 {
  return value.map(component => ((component % 1) + 1) % 1) as Vec3;
}

export function fractionalToCartesian(value: Vec3, vectors: Mat3): Vec3 {
  return [
    value[0] * vectors[0][0] + value[1] * vectors[1][0] + value[2] * vectors[2][0],
    value[0] * vectors[0][1] + value[1] * vectors[1][1] + value[2] * vectors[2][1],
    value[0] * vectors[0][2] + value[1] * vectors[1][2] + value[2] * vectors[2][2]
  ];
}

export function determinant(vectors: Mat3): number {
  const [a, b, c] = vectors;
  return a[0] * (b[1] * c[2] - b[2] * c[1]) - b[0] * (a[1] * c[2] - a[2] * c[1]) + c[0] * (a[1] * b[2] - a[2] * b[1]);
}

export function cartesianToFractional(value: Vec3, vectors: Mat3): Vec3 {
  const det = determinant(vectors);
  if (Math.abs(det) < 1e-12) throw new Error('Cell vectors are singular');
  const [a, b, c] = vectors;
  return [
    (value[0] * (b[1] * c[2] - b[2] * c[1]) + value[1] * (b[2] * c[0] - b[0] * c[2]) + value[2] * (b[0] * c[1] - b[1] * c[0])) / det,
    (value[0] * (c[1] * a[2] - c[2] * a[1]) + value[1] * (c[2] * a[0] - c[0] * a[2]) + value[2] * (c[0] * a[1] - c[1] * a[0])) / det,
    (value[0] * (a[1] * b[2] - a[2] * b[1]) + value[1] * (a[2] * b[0] - a[0] * b[2]) + value[2] * (a[0] * b[1] - a[1] * b[0])) / det
  ];
}
