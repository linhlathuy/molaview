import type { Vec3 } from '../model';

const subtract = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (value: Vec3): number => Math.sqrt(dot(value, value));
const scale = (value: Vec3, factor: number): Vec3 => [value[0] * factor, value[1] * factor, value[2] * factor];

function normalized(value: Vec3): Vec3 {
  const length = norm(value);
  if (length < 1e-12) throw new Error('Measurement contains coincident points');
  return scale(value, 1 / length);
}

export function distance(a: Vec3, b: Vec3): number {
  return norm(subtract(a, b));
}

export function angle(a: Vec3, vertex: Vec3, c: Vec3): number {
  const left = normalized(subtract(a, vertex));
  const right = normalized(subtract(c, vertex));
  return Math.acos(Math.max(-1, Math.min(1, dot(left, right)))) * 180 / Math.PI;
}

export function dihedral(a: Vec3, b: Vec3, c: Vec3, d: Vec3): number {
  const b0 = subtract(a, b);
  const b1 = normalized(subtract(c, b));
  const b2 = subtract(d, c);
  const v = subtract(b0, scale(b1, dot(b0, b1)));
  const w = subtract(b2, scale(b1, dot(b2, b1)));
  const vn = normalized(v);
  const wn = normalized(w);
  return Math.atan2(dot(cross(b1, vn), wn), dot(vn, wn)) * 180 / Math.PI;
}
