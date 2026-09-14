/**
 * Generates fixtures/amazon-returns.xlsx — an ASIN-keyed manifest with a junk
 * title row above the header and some rows missing identifiers, to exercise
 * header detection and unverifiable-row flagging.
 */
import ExcelJS from 'exceljs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const rows: (string | number)[][] = [
  ['Amazon Customer Returns — Lot #A-4471 — FOB Phoenix, AZ'],
  [],
  ['Description', 'ASIN', 'Quantity', 'MSRP', 'Item Condition', 'Product Group'],
  ['Echo Dot (5th Gen) Smart Speaker Charcoal', 'B09B8V1LZ3', 22, 49.99, 'Used - Good', 'Electronics'],
  ['Kindle Paperwhite 16GB Black', 'B08KTZ8249', 6, 149.99, 'Used - Good', 'Electronics'],
  ['Amazon Basics 6-Outlet Surge Protector 2-Pack', 'B00TP1C1UC', 35, 25.99, 'New', 'Electronics'],
  ['Crayola Inspiration Art Case 140 Pieces', 'B00J9EEMEQ', 18, 24.99, 'Used - Like New', 'Toys'],
  ['LEGO Classic Large Creative Brick Box', 'B00NHQF6MG', 9, 59.99, 'Used - Good', 'Toys'],
  ['Assorted apparel — mixed sizes', '', 40, 19.99, 'Used - Acceptable', 'Apparel'],
  ['Instant Pot Duo 7-in-1 6qt', 'B00FLYWNYQ', 7, 99.95, 'Used - Good', 'Kitchen'],
  ['Unbranded phone accessories bin', '', 55, 9.99, 'Salvage', 'Electronics'],
  ['Hydro Flask 32oz Wide Mouth Bottle', 'B083LSVRTL', 12, 44.95, 'Used - Like New', 'Sports'],
];

const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet('Manifest');
for (const r of rows) ws.addRow(r);

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'amazon-returns.xlsx');
await wb.xlsx.writeFile(out);
console.log(`wrote ${out}`);
