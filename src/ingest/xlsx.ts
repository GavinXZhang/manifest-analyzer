import ExcelJS from 'exceljs';

const MAX_ROWS = 20000;
const MAX_COLS = 100;

function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if ('richText' in value) return value.richText.map((rt) => rt.text).join('');
    if ('text' in value) return typeof value.text === 'string' ? value.text : cellToString(value.text);
    if ('result' in value && value.result !== undefined) return cellToString(value.result as ExcelJS.CellValue);
    if ('error' in value) return '';
  }
  return String(value);
}

/**
 * Reads the first non-empty worksheet into a string grid. Merged cells resolve
 * to their master cell's value via exceljs.
 */
export async function parseXlsx(buf: Buffer): Promise<string[][]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const ws = wb.worksheets.find((w) => w.rowCount > 0);
  if (!ws) return [];

  const rows: string[][] = [];
  const rowCount = Math.min(ws.rowCount, MAX_ROWS);
  const colCount = Math.min(Math.max(ws.columnCount, 1), MAX_COLS);
  for (let r = 1; r <= rowCount; r++) {
    const row = ws.getRow(r);
    const cells: string[] = [];
    for (let c = 1; c <= colCount; c++) {
      cells.push(cellToString(row.getCell(c).value).trim());
    }
    if (cells.some((c) => c !== '')) rows.push(cells);
  }
  return rows;
}
