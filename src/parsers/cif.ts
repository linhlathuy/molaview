import type { Atom, ParsedDocument, Structure, Vec3 } from '../model';
import { cellFromParameters, fractionalToCartesian, wrapFractional } from '../geometry/cell';
import { applySymmetry, equivalentFractional } from '../geometry/symmetry';
import { normalizedElement } from './common';

interface CifLoop { tags: string[]; rows: string[][] }
interface CifBlock { name: string; values: Map<string, string>; loops: CifLoop[] }

function tokenize(text: string): string[] {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const tokens: string[] = [];
  let index = 0;
  while (index < normalized.length) {
    if (normalized[index] === ';' && (index === 0 || normalized[index - 1] === '\n')) {
      const end = normalized.indexOf('\n;', index + 1);
      if (end < 0) throw new Error('Unterminated CIF semicolon text field');
      tokens.push(normalized.slice(index + 1, end).replace(/^\n/, ''));
      index = end + 2;
      continue;
    }
    const char = normalized[index]!;
    if (/\s/.test(char)) { index += 1; continue; }
    if (char === '#') {
      const newline = normalized.indexOf('\n', index);
      index = newline < 0 ? normalized.length : newline + 1;
      continue;
    }
    if (char === "'" || char === '"') {
      const quote = char;
      let end = index + 1;
      while (end < normalized.length && normalized[end] !== quote) end += 1;
      if (end >= normalized.length) throw new Error('Unterminated CIF quoted value');
      tokens.push(normalized.slice(index + 1, end));
      index = end + 1;
      continue;
    }
    let end = index + 1;
    while (end < normalized.length && !/\s/.test(normalized[end]!) && normalized[end] !== '#') end += 1;
    tokens.push(normalized.slice(index, end));
    index = end;
  }
  return tokens;
}

function parseBlock(text: string): CifBlock {
  const tokens = tokenize(text);
  const dataIndex = tokens.findIndex(token => token.toLowerCase().startsWith('data_'));
  if (dataIndex < 0) throw new Error('CIF contains no data block');
  const block: CifBlock = { name: tokens[dataIndex]!.slice(5) || 'CIF structure', values: new Map(), loops: [] };
  let cursor = dataIndex + 1;
  while (cursor < tokens.length) {
    const token = tokens[cursor]!;
    if (token.toLowerCase() === 'loop_') {
      cursor += 1;
      const tags: string[] = [];
      while (tokens[cursor]?.startsWith('_')) { tags.push(tokens[cursor]!.toLowerCase()); cursor += 1; }
      if (tags.length === 0) throw new Error('CIF loop has no tags');
      const rows: string[][] = [];
      while (cursor < tokens.length && !tokens[cursor]!.startsWith('_') && tokens[cursor]!.toLowerCase() !== 'loop_' && !tokens[cursor]!.toLowerCase().startsWith('data_')) {
        const row = tokens.slice(cursor, cursor + tags.length);
        if (row.length !== tags.length) throw new Error('CIF loop has an incomplete row');
        rows.push(row);
        cursor += tags.length;
      }
      block.loops.push({ tags, rows });
      continue;
    }
    if (token.startsWith('_')) {
      const value = tokens[cursor + 1];
      if (value === undefined) throw new Error(`CIF tag ${token} has no value`);
      block.values.set(token.toLowerCase(), value);
      cursor += 2;
      continue;
    }
    if (token.toLowerCase().startsWith('data_')) break;
    cursor += 1;
  }
  return block;
}

function cifNumber(value: string | undefined, tag: string): number {
  if (!value || value === '.' || value === '?') throw new Error(`CIF is missing ${tag}`);
  const parsed = Number(value.replace(/\([^)]*\)$/, ''));
  if (!Number.isFinite(parsed)) throw new Error(`Invalid CIF number for ${tag}: ${value}`);
  return parsed;
}

function findLoop(block: CifBlock, required: string): CifLoop {
  const loop = block.loops.find(candidate => candidate.tags.includes(required));
  if (!loop) throw new Error(`CIF contains no ${required} loop`);
  return loop;
}

function valuesAt(loop: CifLoop, row: string[], tags: string[]): string | undefined {
  for (const tag of tags) {
    const index = loop.tags.indexOf(tag);
    if (index >= 0) return row[index];
  }
  return undefined;
}

export function parseCif(text: string, name: string): ParsedDocument {
  const block = parseBlock(text);
  const cell = cellFromParameters(
    cifNumber(block.values.get('_cell_length_a'), '_cell_length_a'),
    cifNumber(block.values.get('_cell_length_b'), '_cell_length_b'),
    cifNumber(block.values.get('_cell_length_c'), '_cell_length_c'),
    cifNumber(block.values.get('_cell_angle_alpha'), '_cell_angle_alpha'),
    cifNumber(block.values.get('_cell_angle_beta'), '_cell_angle_beta'),
    cifNumber(block.values.get('_cell_angle_gamma'), '_cell_angle_gamma')
  );
  const siteLoop = findLoop(block, '_atom_site_fract_x');
  const symmetryLoop = block.loops.find(loop => loop.tags.some(tag => tag === '_space_group_symop_operation_xyz' || tag === '_symmetry_equiv_pos_as_xyz'));
  const operations = symmetryLoop
    ? symmetryLoop.rows.map(row => valuesAt(symmetryLoop, row, ['_space_group_symop_operation_xyz', '_symmetry_equiv_pos_as_xyz']) ?? 'x,y,z')
    : ['x,y,z'];
  const generated: Array<{ element: string; label?: string; occupancy?: number; fractional: Vec3 }> = [];

  for (const row of siteLoop.rows) {
    const symbol = valuesAt(siteLoop, row, ['_atom_site_type_symbol', '_atom_site_label']) ?? 'X';
    const element = normalizedElement(symbol);
    const label = valuesAt(siteLoop, row, ['_atom_site_label']);
    const occupancyText = valuesAt(siteLoop, row, ['_atom_site_occupancy']);
    const fractional: Vec3 = [
      cifNumber(valuesAt(siteLoop, row, ['_atom_site_fract_x']), '_atom_site_fract_x'),
      cifNumber(valuesAt(siteLoop, row, ['_atom_site_fract_y']), '_atom_site_fract_y'),
      cifNumber(valuesAt(siteLoop, row, ['_atom_site_fract_z']), '_atom_site_fract_z')
    ];
    for (const operation of operations) {
      const transformed = wrapFractional(applySymmetry(operation, fractional));
      if (generated.some(atom => atom.element === element && equivalentFractional(atom.fractional, transformed))) continue;
      generated.push({
        element,
        ...(label && label !== '.' && label !== '?' ? { label } : {}),
        ...(occupancyText && occupancyText !== '.' && occupancyText !== '?' ? { occupancy: cifNumber(occupancyText, '_atom_site_occupancy') } : {}),
        fractional: transformed
      });
    }
  }
  const atoms: Atom[] = generated.map((atom, id) => ({
    id,
    element: atom.element,
    position: fractionalToCartesian(atom.fractional, cell.vectors),
    ...(atom.label ? { label: atom.label } : {}),
    ...(atom.occupancy !== undefined ? { occupancy: atom.occupancy } : {}),
    properties: { fractX: atom.fractional[0], fractY: atom.fractional[1], fractZ: atom.fractional[2] }
  }));
  const metadata: Record<string, string | number | boolean> = {};
  const spaceGroup = block.values.get('_space_group_name_h-m_alt') ?? block.values.get('_symmetry_space_group_name_h-m');
  if (spaceGroup) metadata.spaceGroup = spaceGroup;
  const structure: Structure = { name: block.name || name, atoms, bonds: [], cell, metadata };
  return { format: 'cif', frames: [structure], frameCount: 1, originalIndices: [0] };
}
