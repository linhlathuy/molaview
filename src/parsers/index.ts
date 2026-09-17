import type { ParsedDocument, StructureFormat } from '../model';
import { parseCif } from './cif';
import { detectFormat } from './detect';
import { parseMol } from './mol';
import { parsePdb } from './pdb';
import { parsePoscar, parseXdatcar } from './vasp';
import { parseXyz } from './xyz';

export function parseTextDocument(text: string, path: string, format: StructureFormat = detectFormat(path, text)): ParsedDocument {
  switch (format) {
    case 'xyz': return parseXyz(text, path);
    case 'pdb': return parsePdb(text, path);
    case 'mol': return parseMol(text, path);
    case 'poscar': return parsePoscar(text, path);
    case 'xdatcar': return parseXdatcar(text, path);
    case 'cif': return parseCif(text, path);
    case 'ase-traj': throw new Error('ASE trajectory parser requires binary input');
  }
}

export { detectFormat } from './detect';
