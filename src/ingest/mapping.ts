import {
  CANONICAL_FIELDS,
  REQUIRED_FIELDS,
  type CanonicalField,
  type ColumnMapping,
  type MappingProposal,
} from '../types.ts';

export const FIELD_ALIASES: Record<CanonicalField, string[]> = {
  description: [
    'item description',
    'description',
    'product description',
    'product name',
    'item name',
    'item',
    'product',
    'title',
    'desc',
  ],
  upc: ['upc', 'upc code', 'upc ean', 'ean', 'barcode', 'gtin', 'upc a'],
  asin: ['asin', 'amazon asin'],
  model: ['model', 'model number', 'model no', 'mpn', 'part number', 'part no', 'sku', 'item no', 'style'],
  quantity: ['qty', 'quantity', 'units', 'unit count', 'count', 'pieces', 'pcs', 'total units'],
  unit_msrp: [
    'unit retail',
    'unit msrp',
    'msrp',
    'retail',
    'retail price',
    'orig retail',
    'original retail',
    'unit price',
    'price',
    'ext retail unit',
  ],
  condition: ['condition', 'item condition', 'cond', 'grade', 'condition grade'],
  category: ['category', 'department', 'dept', 'cat', 'product category', 'subcategory', 'product group', 'product type'],
};

/** Lowercase, collapse punctuation/whitespace to single spaces. */
export function normalizeHeader(h: string): string {
  return h
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokenOverlap(a: string, b: string): number {
  const ta = new Set(a.split(' ').filter(Boolean));
  const tb = new Set(b.split(' ').filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let common = 0;
  for (const t of ta) if (tb.has(t)) common++;
  return common / Math.max(ta.size, tb.size);
}

/** Match score in [0,1] for one header against one canonical field. */
export function scoreHeaderAgainstField(header: string, field: CanonicalField): number {
  const h = normalizeHeader(header);
  if (h === '') return 0;
  let best = 0;
  for (const alias of FIELD_ALIASES[field]) {
    if (h === alias) return 1;
    if (h.length >= 3 && alias.length >= 3 && (h.includes(alias) || alias.includes(h))) {
      best = Math.max(best, 0.8);
    }
    const overlap = tokenOverlap(h, alias);
    if (overlap >= 0.5) best = Math.max(best, 0.5 + 0.2 * overlap);
  }
  return best;
}

/** True when a header row looks like a header at all (used by header detection). */
export function headerLikeScore(cells: string[]): number {
  let score = 0;
  for (const cell of cells) {
    let cellBest = 0;
    for (const field of CANONICAL_FIELDS) {
      cellBest = Math.max(cellBest, scoreHeaderAgainstField(cell, field));
    }
    score += cellBest;
    // Non-empty, non-numeric cells are weak evidence of a header row.
    if (cell.trim() !== '' && Number.isNaN(Number(cell.replace(/[$,]/g, '')))) score += 0.1;
  }
  return score;
}

/**
 * Exact alias matches score 1.0; substring/token matches top out at 0.8.
 * Anything short of an exact-alias match on every required field goes to the
 * user for confirmation.
 */
export const CONFIDENCE_THRESHOLD = 0.9;

/**
 * Greedy best-score assignment of headers to canonical fields. Overall
 * confidence is the minimum score across required fields (description,
 * quantity, unit_msrp); an unmapped required field scores 0.
 */
export function proposeMapping(headers: string[]): MappingProposal {
  const candidates: { field: CanonicalField; header: string; score: number }[] = [];
  for (const field of CANONICAL_FIELDS) {
    for (const header of headers) {
      const score = scoreHeaderAgainstField(header, field);
      if (score > 0) candidates.push({ field, header, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);

  const mapping: ColumnMapping = {};
  const fieldConfidence: MappingProposal['fieldConfidence'] = {};
  const usedHeaders = new Set<string>();
  for (const { field, header, score } of candidates) {
    if (mapping[field] !== undefined || usedHeaders.has(header)) continue;
    mapping[field] = header;
    fieldConfidence[field] = score;
    usedHeaders.add(header);
  }

  const confidence = Math.min(...REQUIRED_FIELDS.map((f) => fieldConfidence[f] ?? 0));
  return {
    mapping,
    fieldConfidence,
    confidence,
    needsConfirmation: confidence < CONFIDENCE_THRESHOLD,
    source: 'auto',
  };
}

/**
 * Applies a previously confirmed per-seller mapping when its source headers
 * are all present in this file; otherwise returns null so auto-mapping runs.
 */
export function applySavedMapping(headers: string[], saved: ColumnMapping): MappingProposal | null {
  const normalized = new Map(headers.map((h) => [normalizeHeader(h), h]));
  const mapping: ColumnMapping = {};
  const fieldConfidence: MappingProposal['fieldConfidence'] = {};
  for (const [field, savedHeader] of Object.entries(saved) as [CanonicalField, string][]) {
    const match = normalized.get(normalizeHeader(savedHeader));
    if (match === undefined) return null;
    mapping[field] = match;
    fieldConfidence[field] = 1;
  }
  for (const f of REQUIRED_FIELDS) {
    if (mapping[f] === undefined) return null;
  }
  return { mapping, fieldConfidence, confidence: 1, needsConfirmation: false, source: 'saved-seller-mapping' };
}
