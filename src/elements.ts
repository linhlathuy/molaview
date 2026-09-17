export interface ElementStyle {
  symbol: string;
  covalentRadius: number;
  vanDerWaalsRadius: number;
  color: number;
}

const symbols = [
  'H', 'He', 'Li', 'Be', 'B', 'C', 'N', 'O', 'F', 'Ne', 'Na', 'Mg', 'Al', 'Si', 'P', 'S', 'Cl', 'Ar',
  'K', 'Ca', 'Sc', 'Ti', 'V', 'Cr', 'Mn', 'Fe', 'Co', 'Ni', 'Cu', 'Zn', 'Ga', 'Ge', 'As', 'Se', 'Br', 'Kr',
  'Rb', 'Sr', 'Y', 'Zr', 'Nb', 'Mo', 'Tc', 'Ru', 'Rh', 'Pd', 'Ag', 'Cd', 'In', 'Sn', 'Sb', 'Te', 'I', 'Xe',
  'Cs', 'Ba', 'La', 'Ce', 'Pr', 'Nd', 'Pm', 'Sm', 'Eu', 'Gd', 'Tb', 'Dy', 'Ho', 'Er', 'Tm', 'Yb', 'Lu',
  'Hf', 'Ta', 'W', 'Re', 'Os', 'Ir', 'Pt', 'Au', 'Hg', 'Tl', 'Pb', 'Bi', 'Po', 'At', 'Rn', 'Fr', 'Ra',
  'Ac', 'Th', 'Pa', 'U', 'Np', 'Pu', 'Am', 'Cm', 'Bk', 'Cf', 'Es', 'Fm', 'Md', 'No', 'Lr', 'Rf', 'Db',
  'Sg', 'Bh', 'Hs', 'Mt', 'Ds', 'Rg', 'Cn', 'Nh', 'Fl', 'Mc', 'Lv', 'Ts', 'Og'
] as const;

const common: Record<string, Omit<ElementStyle, 'symbol'>> = {
  H: { covalentRadius: 0.31, vanDerWaalsRadius: 1.2, color: 0xf2f2f2 },
  He: { covalentRadius: 0.28, vanDerWaalsRadius: 1.4, color: 0xd9ffff },
  Li: { covalentRadius: 1.28, vanDerWaalsRadius: 1.82, color: 0xcc80ff },
  Be: { covalentRadius: 0.96, vanDerWaalsRadius: 1.53, color: 0xc2ff00 },
  B: { covalentRadius: 0.84, vanDerWaalsRadius: 1.92, color: 0xffb5b5 },
  C: { covalentRadius: 0.76, vanDerWaalsRadius: 1.7, color: 0x555b63 },
  N: { covalentRadius: 0.71, vanDerWaalsRadius: 1.55, color: 0x4666e5 },
  O: { covalentRadius: 0.66, vanDerWaalsRadius: 1.52, color: 0xe83d3d },
  F: { covalentRadius: 0.57, vanDerWaalsRadius: 1.47, color: 0x80e050 },
  Ne: { covalentRadius: 0.58, vanDerWaalsRadius: 1.54, color: 0xb3e3f5 },
  Na: { covalentRadius: 1.66, vanDerWaalsRadius: 2.27, color: 0xab5cf2 },
  Mg: { covalentRadius: 1.41, vanDerWaalsRadius: 1.73, color: 0x8aff00 },
  Al: { covalentRadius: 1.21, vanDerWaalsRadius: 1.84, color: 0xbfa6a6 },
  Si: { covalentRadius: 1.11, vanDerWaalsRadius: 2.1, color: 0xf0c8a0 },
  P: { covalentRadius: 1.07, vanDerWaalsRadius: 1.8, color: 0xff8000 },
  S: { covalentRadius: 1.05, vanDerWaalsRadius: 1.8, color: 0xffd632 },
  Cl: { covalentRadius: 1.02, vanDerWaalsRadius: 1.75, color: 0x32d13d },
  K: { covalentRadius: 2.03, vanDerWaalsRadius: 2.75, color: 0x8f40d4 },
  Ca: { covalentRadius: 1.76, vanDerWaalsRadius: 2.31, color: 0x3dff00 },
  Ti: { covalentRadius: 1.6, vanDerWaalsRadius: 2.11, color: 0xbfc2c7 },
  V: { covalentRadius: 1.53, vanDerWaalsRadius: 2.07, color: 0xa6a6ab },
  Cr: { covalentRadius: 1.39, vanDerWaalsRadius: 2.06, color: 0x8a99c7 },
  Mn: { covalentRadius: 1.39, vanDerWaalsRadius: 2.05, color: 0x9c7ac7 },
  Fe: { covalentRadius: 1.32, vanDerWaalsRadius: 2.04, color: 0xe06633 },
  Co: { covalentRadius: 1.26, vanDerWaalsRadius: 2.0, color: 0xf08fa0 },
  Ni: { covalentRadius: 1.24, vanDerWaalsRadius: 1.97, color: 0x50d050 },
  Cu: { covalentRadius: 1.32, vanDerWaalsRadius: 1.96, color: 0xc88033 },
  Zn: { covalentRadius: 1.22, vanDerWaalsRadius: 2.01, color: 0x7d80b0 },
  Br: { covalentRadius: 1.2, vanDerWaalsRadius: 1.85, color: 0xa62929 },
  Mo: { covalentRadius: 1.54, vanDerWaalsRadius: 2.09, color: 0x54b5b5 },
  Ag: { covalentRadius: 1.45, vanDerWaalsRadius: 2.11, color: 0xbfc0c0 },
  Sn: { covalentRadius: 1.39, vanDerWaalsRadius: 2.17, color: 0x668080 },
  I: { covalentRadius: 1.39, vanDerWaalsRadius: 1.98, color: 0x940094 },
  Cs: { covalentRadius: 2.44, vanDerWaalsRadius: 3.43, color: 0x57178f },
  W: { covalentRadius: 1.62, vanDerWaalsRadius: 2.1, color: 0x2194d6 },
  Pt: { covalentRadius: 1.36, vanDerWaalsRadius: 2.13, color: 0xd0d0e0 },
  Au: { covalentRadius: 1.36, vanDerWaalsRadius: 2.14, color: 0xffd123 },
  Pb: { covalentRadius: 1.46, vanDerWaalsRadius: 2.02, color: 0x575961 },
  U: { covalentRadius: 1.96, vanDerWaalsRadius: 2.3, color: 0x008fff }
};

function fallbackColor(symbol: string): number {
  let hash = 0;
  for (const char of symbol) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const hue = hash % 360;
  const saturation = 0.55;
  const lightness = 0.58;
  const c = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = c * (1 - Math.abs((hue / 60) % 2 - 1));
  const m = lightness - c / 2;
  const sectors: Array<[number, number, number]> = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]];
  const [r, g, b] = sectors[Math.floor(hue / 60)] ?? sectors[0]!;
  return (Math.round((r + m) * 255) << 16) | (Math.round((g + m) * 255) << 8) | Math.round((b + m) * 255);
}

const styles = new Map<string, ElementStyle>(symbols.map(symbol => {
  const data = common[symbol] ?? { covalentRadius: 1.45, vanDerWaalsRadius: 2, color: fallbackColor(symbol) };
  return [symbol, { symbol, ...data }];
}));

export function elementStyle(symbol: string): ElementStyle {
  return styles.get(symbol) ?? { symbol, covalentRadius: 0.77, vanDerWaalsRadius: 1.8, color: fallbackColor(symbol) };
}

export const elementSymbols = [...symbols];
