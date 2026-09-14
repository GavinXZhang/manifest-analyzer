/**
 * Assigns a manifest line to a parts-book family by keyword match. Every
 * keyword of a family must appear as a whole token in the line's text; the
 * family matching the most keywords wins, ties going to the earlier entry,
 * so "Dyson V11" beats the catch-all "Dyson upright".
 */

export interface FamilyMatcher {
  family: string;
  keywords: string[];
}

export function normalizeText(text: string): string {
  return ` ${text.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()} `;
}

export function matchesFamily(text: string, matcher: FamilyMatcher): boolean {
  if (matcher.keywords.length === 0) return false;
  const norm = normalizeText(text);
  return matcher.keywords.every((kw) => norm.includes(` ${normalizeText(kw).trim()} `));
}

export function matchFamily<T extends FamilyMatcher>(text: string, families: T[]): T | null {
  let best: T | null = null;
  for (const f of families) {
    if (!matchesFamily(text, f)) continue;
    if (best === null || f.keywords.length > best.keywords.length) best = f;
  }
  return best;
}
