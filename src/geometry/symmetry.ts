import type { Vec3 } from '../model';
import { wrapFractional } from './cell';

function rational(value: string): number {
  const slash = value.indexOf('/');
  if (slash >= 0) {
    const numerator = Number(value.slice(0, slash));
    const denominator = Number(value.slice(slash + 1));
    if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) throw new Error(`Invalid symmetry fraction ${value}`);
    return numerator / denominator;
  }
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Invalid symmetry value ${value}`);
  return number;
}

function coordinate(expression: string, position: Vec3): number {
  const compact = expression.replace(/\s+/g, '').toLowerCase();
  if (!compact || /[^xyz0-9+\-./]/.test(compact)) throw new Error(`Unsupported symmetry expression ${expression}`);
  const terms = compact.match(/[+-]?[^+-]+/g) ?? [];
  let result = 0;
  for (const signed of terms) {
    const sign = signed.startsWith('-') ? -1 : 1;
    const term = signed.replace(/^[+-]/, '');
    const variable = /[xyz]/.exec(term)?.[0];
    if (variable) {
      const coefficientText = term.replace(variable, '').replace(/\*$/, '');
      const coefficient = coefficientText ? rational(coefficientText) : 1;
      const index = variable === 'x' ? 0 : variable === 'y' ? 1 : 2;
      result += sign * coefficient * position[index];
    } else {
      result += sign * rational(term);
    }
  }
  return result;
}

export function applySymmetry(operation: string, position: Vec3): Vec3 {
  const expressions = operation.replace(/^['"]|['"]$/g, '').split(',');
  if (expressions.length !== 3) throw new Error(`Symmetry operation requires three coordinates: ${operation}`);
  return wrapFractional([
    coordinate(expressions[0]!, position),
    coordinate(expressions[1]!, position),
    coordinate(expressions[2]!, position)
  ]);
}

export function equivalentFractional(a: Vec3, b: Vec3, tolerance = 1e-5): boolean {
  return a.every((value, index) => {
    const delta = Math.abs(value - b[index]!);
    return Math.min(delta, Math.abs(delta - 1)) <= tolerance;
  });
}
