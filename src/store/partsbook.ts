import type { Db } from './db.ts';
import type { PartValue } from '../calc/salvage.ts';

export interface Family {
  id: number;
  family: string;
  keywords: string[];
  parts: PartValue[];
  estimated: boolean;
  updatedAt: string;
}

interface Row { id: number; family: string; match_json: string; parts_json: string; estimated: number; updated_at: string }

const toFamily = (r: Row): Family => ({
  id: r.id,
  family: r.family,
  keywords: (JSON.parse(r.match_json) as { keywords?: string[] }).keywords ?? [],
  parts: JSON.parse(r.parts_json) as PartValue[],
  estimated: r.estimated === 1,
  updatedAt: r.updated_at,
});

function validate(input: { family: string; keywords: string[]; parts: PartValue[] }): void {
  if (!input.family.trim()) throw new Error('family name is required');
  if (!Array.isArray(input.keywords) || input.keywords.length === 0 || input.keywords.some((k) => !k.trim())) {
    throw new Error('at least one non-empty keyword is required');
  }
  if (!Array.isArray(input.parts)) throw new Error('parts must be a list');
  for (const p of input.parts) {
    if (!p.name?.trim()) throw new Error('every part needs a name');
    if (!Number.isFinite(p.low) || !Number.isFinite(p.high) || p.low < 0 || p.high < p.low) {
      throw new Error(`part "${p.name}": low must be ≥ 0 and high ≥ low`);
    }
  }
}

export async function listFamilies(db: Db): Promise<Family[]> {
  const rows = await db.all<Row>('SELECT * FROM parts_book ORDER BY id');
  return rows.map(toFamily);
}

export async function getFamily(db: Db, id: number): Promise<Family | null> {
  const r = await db.get<Row>('SELECT * FROM parts_book WHERE id = ?', [id]);
  return r ? toFamily(r) : null;
}

export async function addFamily(
  db: Db,
  input: { family: string; keywords: string[]; parts: PartValue[]; estimated?: boolean },
): Promise<Family> {
  validate(input);
  const r = await db.run(
    'INSERT INTO parts_book (family, match_json, parts_json, estimated, updated_at) VALUES (?, ?, ?, ?, ?)',
    [
      input.family.trim(),
      JSON.stringify({ keywords: input.keywords.map((k) => k.trim()) }),
      JSON.stringify(input.parts),
      input.estimated === false ? 0 : 1,
      new Date().toISOString(),
    ],
  );
  return (await getFamily(db, r.lastInsertRowid))!;
}

export async function updateFamily(
  db: Db,
  id: number,
  patch: Partial<{ family: string; keywords: string[]; parts: PartValue[]; estimated: boolean }>,
): Promise<Family> {
  const existing = await getFamily(db, id);
  if (!existing) throw new Error(`No family ${id}`);
  const merged = { ...existing, ...patch };
  validate(merged);
  await db.run(
    'UPDATE parts_book SET family = ?, match_json = ?, parts_json = ?, estimated = ?, updated_at = ? WHERE id = ?',
    [
      merged.family.trim(),
      JSON.stringify({ keywords: merged.keywords.map((k) => k.trim()) }),
      JSON.stringify(merged.parts),
      merged.estimated ? 1 : 0,
      new Date().toISOString(),
      id,
    ],
  );
  return (await getFamily(db, id))!;
}

export async function deleteFamily(db: Db, id: number): Promise<void> {
  await db.run('DELETE FROM parts_book WHERE id = ?', [id]);
}
