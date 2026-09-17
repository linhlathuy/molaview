import type { Mat3, Vec3 } from '../model';

export function linesOf(text: string): string[] {
  return text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
}

export function numberAt(value: string | undefined, description: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid ${description}: ${value ?? '<missing>'}`);
  return parsed;
}

export function vec3(values: string[], description: string): Vec3 {
  if (values.length < 3) throw new Error(`${description} requires three coordinates`);
  return [
    numberAt(values[0], description),
    numberAt(values[1], description),
    numberAt(values[2], description)
  ];
}

export function fractionalToCartesian(fractional: Vec3, vectors: Mat3): Vec3 {
  return [
    fractional[0] * vectors[0][0] + fractional[1] * vectors[1][0] + fractional[2] * vectors[2][0],
    fractional[0] * vectors[0][1] + fractional[1] * vectors[1][1] + fractional[2] * vectors[2][1],
    fractional[0] * vectors[0][2] + fractional[1] * vectors[1][2] + fractional[2] * vectors[2][2]
  ];
}

export function normalizedElement(value: string): string {
  const letters = value.replace(/[^A-Za-z]/g, '');
  if (!letters) return 'X';
  return `${letters[0]?.toUpperCase() ?? 'X'}${letters.slice(1, 2).toLowerCase()}`;
}
