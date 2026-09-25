/**
 * `.xlsx`, written by hand.
 *
 * A workbook Excel will open is five XML parts in a zip, and this is the
 * smallest set that satisfies it: the content-type map, the package
 * relationship pointing at the workbook, the workbook naming one sheet, the
 * workbook's relationship pointing at that sheet, and the sheet itself.
 *
 * Strings are inline rather than pooled through `sharedStrings.xml`. The pool
 * exists to shrink files with heavy repetition, which a report of distinct
 * invoices is not, and it costs a sixth part plus an index every cell has to
 * agree with — one more thing to get subtly wrong for a saving measured in bytes.
 *
 * Numbers are the one place formatting happens. A cell that is a plain decimal
 * is written as a number so a treasurer can sum the column; everything else
 * stays a string, so an account code keeps its leading zero and a date stays the
 * ISO text the report chose deliberately.
 */
import { isNumeric, type TableDocument } from './document';
import { part, writeZip, xml, type ZipEntry } from './zip';

/** `A`, `B`, ... `Z`, `AA` — spreadsheet column names are base-26 with no zero. */
export function columnName(index: number): string {
  let name = '';
  let n = index;
  while (n >= 0) {
    name = String.fromCharCode(65 + (n % 26)) + name;
    n = Math.floor(n / 26) - 1;
  }
  return name;
}

/** Excel limits a sheet name to 31 characters and forbids six of them. */
const sheetName = (title: string): string => {
  const clean = title.replace(/[[\]:*?/\\]/g, ' ').trim();
  return clean === '' ? 'Sheet1' : clean.slice(0, 31);
};

function cell(reference: string, value: string, bold: boolean): string {
  const style = bold ? ' s="1"' : '';
  if (value === '') return `<c r="${reference}"${style}/>`;
  if (isNumeric(value)) return `<c r="${reference}"${style}><v>${value}</v></c>`;
  return `<c r="${reference}"${style} t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
}

const row = (cells: readonly string[], index: number, bold: boolean): string =>
  `<row r="${index}">${cells.map((value, column) => cell(`${columnName(column)}${index}`, value, bold)).join('')}</row>`;

/**
 * Two fonts and two cell formats, which is the whole of the styling.
 *
 * `s="1"` is the bold one, used for the header row and nothing else. A minimal
 * `styles.xml` is still mandatory the moment a cell references a style, and the
 * counts in every `count=` attribute have to match the children exactly or Excel
 * reports the file as needing repair.
 */
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="1"><fill><patternFill patternType="none"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>
</styleSheet>`;

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

export function writeXlsx(doc: TableDocument, at: Date): Uint8Array {
  // Provenance first, as label/value pairs, then a blank line, then the table.
  // A reader who sorts the table will detach it from its caveats otherwise.
  const preamble: string[][] = [];
  for (const meta of doc.meta ?? []) preamble.push([meta.label, meta.value]);
  if (preamble.length > 0) preamble.push([]);

  const lines: string[] = [];
  let index = 1;
  for (const pair of preamble) lines.push(row(pair, index++, false));
  lines.push(row(doc.header, index++, true));
  for (const body of doc.rows) lines.push(row(body, index++, false));

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${xml(sheetName(doc.title))}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;

  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
${doc.rtl === true ? '<sheetViews><sheetView rightToLeft="1" workbookViewId="0"/></sheetViews>' : ''}
<sheetData>${lines.join('')}</sheetData>
</worksheet>`;

  const entries: ZipEntry[] = [
    part('[Content_Types].xml', CONTENT_TYPES),
    part('_rels/.rels', ROOT_RELS),
    part('xl/workbook.xml', workbook),
    part('xl/_rels/workbook.xml.rels', WORKBOOK_RELS),
    part('xl/styles.xml', STYLES),
    part('xl/worksheets/sheet1.xml', sheet),
  ];
  return writeZip(entries, at);
}
