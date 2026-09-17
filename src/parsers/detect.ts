import { basename, extname } from 'node:path';
import type { StructureFormat } from '../model';

const extensions: Record<string, StructureFormat> = {
  '.cif': 'cif',
  '.xyz': 'xyz',
  '.extxyz': 'xyz',
  '.pdb': 'pdb',
  '.ent': 'pdb',
  '.mol': 'mol',
  '.sdf': 'mol',
  '.traj': 'ase-traj',
  '.vasp': 'poscar'
};

export function detectFormat(path: string, content = ''): StructureFormat {
  const name = basename(path).toUpperCase();
  if (/^(POSCAR|CONTCAR)([._-].*)?$/.test(name)) return 'poscar';
  if (/^XDATCAR([._-].*)?$/.test(name)) return 'xdatcar';

  const extension = extname(path).toLowerCase();
  const known = extensions[extension];
  if (known) return known;

  const probe = content.slice(0, 8192);
  if (/^\s*data_/im.test(probe) && /_cell_length_[abc]/i.test(probe)) return 'cif';
  if (/^(ATOM  |HETATM|HEADER|CRYST1)/m.test(probe)) return 'pdb';
  if (/V2000|V3000/.test(probe)) return 'mol';
  if (/^\s*\d+\s*\n/m.test(probe)) return 'xyz';
  throw new Error(`Unsupported structure format for ${basename(path)}`);
}
