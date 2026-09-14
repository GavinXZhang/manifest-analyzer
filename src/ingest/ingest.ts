import { parseCsv } from './csv.ts';
import { parseXlsx } from './xlsx.ts';
import { detectTable, type RawTable } from './headers.ts';

const ZIP_MAGIC = Buffer.from('PK\x03\x04', 'latin1');
const OLE_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0]);

/**
 * Parses an uploaded manifest (.xlsx or .csv/.tsv) into a header-detected
 * table. Format is decided by content magic first, extension second.
 */
export async function parseManifest(filename: string, buf: Buffer): Promise<RawTable> {
  const isZip = buf.subarray(0, 4).equals(ZIP_MAGIC);
  if (buf.subarray(0, 4).equals(OLE_MAGIC)) {
    throw new Error('Legacy .xls format is not supported — re-save the manifest as .xlsx or .csv');
  }
  if (isZip || /\.xlsx$/i.test(filename)) {
    return detectTable(await parseXlsx(buf));
  }
  return detectTable(parseCsv(buf.toString('utf8')));
}
