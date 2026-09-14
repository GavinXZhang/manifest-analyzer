/**
 * Lenient RFC-4180-style CSV parser. Auto-detects comma/tab/semicolon
 * delimiters, tolerates BOMs, mixed line endings, and unterminated quotes —
 * manifest files in the wild are messy and a parse should degrade, not throw.
 */

function detectDelimiter(text: string): string {
  const firstLine = text.slice(0, text.search(/\r|\n|$/));
  let best = ',';
  let bestCount = -1;
  for (const d of [',', '\t', ';']) {
    const count = firstLine.split(d).length - 1;
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}

export function parseCsv(text: string): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const delim = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  const endField = (): void => {
    row.push(field);
    field = '';
  };
  const endRow = (): void => {
    endField();
    // Drop rows that are entirely empty.
    if (row.some((c) => c.trim() !== '')) rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i += 1;
        }
      } else {
        field += ch;
        i += 1;
      }
    } else if (ch === '"' && field === '') {
      inQuotes = true;
      i += 1;
    } else if (ch === delim) {
      endField();
      i += 1;
    } else if (ch === '\n') {
      endRow();
      i += 1;
    } else if (ch === '\r') {
      endRow();
      i += text[i + 1] === '\n' ? 2 : 1;
    } else {
      field += ch;
      i += 1;
    }
  }
  // Unterminated quote or missing trailing newline: flush what we have.
  if (field !== '' || row.length > 0) endRow();
  return rows;
}
