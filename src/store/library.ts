import type { Db } from './db.ts';

/**
 * Description library: a flat collection of Facebook Marketplace listing texts
 * — pasted-in past listings and saved drafts — kept as style references for
 * writing future ones.
 */

export interface LibraryEntry {
  id: number;
  title: string;
  text: string;
  createdAt: string;
}

interface Row {
  id: number;
  title: string;
  text: string;
  created_at: string;
}

const toEntry = (r: Row): LibraryEntry => ({
  id: r.id,
  title: r.title,
  text: r.text,
  createdAt: r.created_at,
});

export async function addLibraryEntry(db: Db, title: string, text: string): Promise<LibraryEntry> {
  if (!title.trim()) throw new Error('title is required');
  if (!text.trim()) throw new Error('text is required');
  const r = await db.run('INSERT INTO listing_library (title, text, created_at) VALUES (?, ?, ?)', [
    title.trim(),
    text,
    new Date().toISOString(),
  ]);
  const row = await db.get<Row>('SELECT * FROM listing_library WHERE id = ?', [r.lastInsertRowid]);
  return toEntry(row!);
}

export async function deleteLibraryEntry(db: Db, id: number): Promise<void> {
  await db.run('DELETE FROM listing_library WHERE id = ?', [id]);
}

export async function listLibraryEntries(db: Db): Promise<LibraryEntry[]> {
  const rows = await db.all<Row>('SELECT * FROM listing_library ORDER BY created_at DESC, id DESC');
  return rows.map(toEntry);
}
