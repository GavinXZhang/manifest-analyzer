import type {
  CanonicalField,
  CanonicalItem,
  ColumnMapping,
  ConditionGrade,
  IdentifierType,
} from '../types.ts';

export function parseMoney(raw: string): number | null {
  const cleaned = raw.replace(/[$,\s]/g, '');
  if (cleaned === '') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function parseQuantity(raw: string): number {
  const cleaned = raw.replace(/[,\s]/g, '');
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.round(n);
}

/** Order matters: more specific phrases first ('like new' before 'new'). */
export function normalizeCondition(raw: string): ConditionGrade {
  const c = raw.toLowerCase();
  if (c === '') return 'unknown';
  if (/salvage|as[\s-]?is|for parts|damag|scratch|dent/.test(c)) return 'salvage';
  if (/like[\s-]?new|open[\s-]?box|refurb|renewed|shelf[\s-]?pull/.test(c)) return 'like-new';
  if (/return|used|acceptable|good|fair|pre[\s-]?owned/.test(c)) return 'customer-returns';
  if (/new|overstock|sealed/.test(c)) return 'new';
  return 'unknown';
}

const ASIN_RE = /^B0[A-Z0-9]{8}$/i;

/**
 * GTIN (UPC-A / EAN-13 / GTIN-14) check-digit validation: from the right, the
 * digits before the check digit are weighted 3,1,3,1… A failing checksum means
 * the code cannot be a real retail barcode — a typo or a fabricated manifest row.
 */
export function isValidGtin(digits: string): boolean {
  if (!/^\d{8}$|^\d{12,14}$/.test(digits)) return false;
  let sum = 0;
  for (let i = digits.length - 2, w = 3; i >= 0; i--, w = 4 - w) {
    sum += Number(digits[i]) * w;
  }
  return (10 - (sum % 10)) % 10 === Number(digits[digits.length - 1]);
}

function pickIdentifier(
  values: Partial<Record<'upc' | 'asin' | 'model', string>>,
): { type: IdentifierType; value: string | null } {
  let upc = (values.upc ?? '').replace(/[\s-]/g, '');
  // Excel loves stripping the leading zero off UPC-A codes; try restoring it.
  if (upc.length === 11 && isValidGtin(`0${upc}`)) upc = `0${upc}`;
  if (isValidGtin(upc)) return { type: 'UPC', value: upc };
  const asin = (values.asin ?? '').trim();
  if (ASIN_RE.test(asin) || /^[A-Z0-9]{10}$/i.test(asin)) return { type: 'ASIN', value: asin.toUpperCase() };
  const model = (values.model ?? '').trim();
  if (model !== '') return { type: 'model', value: model };
  // A UPC column holding something non-standard still beats nothing — keep it as a model-ish id.
  if (upc !== '') return { type: 'model', value: upc };
  if (asin !== '') return { type: 'model', value: asin };
  return { type: 'none', value: null };
}

const TOTAL_ROW_RE = /^(grand\s+)?(sub)?total\b/i;

/**
 * Applies a confirmed column mapping to raw rows, producing canonical line
 * items. Rows with no usable identifier are flagged unverifiable (the analysis
 * still proceeds; valuation reports the unverified-value share).
 */
export function normalizeRows(
  headers: string[],
  rows: string[][],
  mapping: ColumnMapping,
): CanonicalItem[] {
  const colIndex = new Map<CanonicalField, number>();
  for (const [field, header] of Object.entries(mapping) as [CanonicalField, string][]) {
    const idx = headers.indexOf(header);
    if (idx >= 0) colIndex.set(field, idx);
  }
  const cell = (row: string[], field: CanonicalField): string => {
    const idx = colIndex.get(field);
    return idx === undefined ? '' : (row[idx] ?? '').trim();
  };

  const items: CanonicalItem[] = [];
  for (const row of rows) {
    const description = cell(row, 'description');
    const unitMsrp = parseMoney(cell(row, 'unit_msrp'));
    const id = pickIdentifier({
      upc: cell(row, 'upc'),
      asin: cell(row, 'asin'),
      model: cell(row, 'model'),
    });

    // Junk rows: no description and nothing identifying; summary/total rows.
    if (description === '' && id.type === 'none' && unitMsrp === null) continue;
    if (TOTAL_ROW_RE.test(description) && id.type === 'none') continue;

    const conditionRaw = cell(row, 'condition');
    items.push({
      description: description !== '' ? description : '(no description)',
      identifierType: id.type,
      identifier: id.value,
      quantity: parseQuantity(cell(row, 'quantity')),
      unitMsrp,
      conditionRaw,
      conditionGrade: normalizeCondition(conditionRaw),
      category: cell(row, 'category') !== '' ? cell(row, 'category') : null,
      unverifiable: id.type === 'none',
    });
  }
  return items;
}
