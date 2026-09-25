/**
 * `.docx`, written by hand.
 *
 * Word wants three parts at minimum — the content-type map, the package
 * relationship, and the document — and this writes exactly those. No styles
 * part, no settings, no theme: every run carries its own formatting inline, so
 * the file is self-describing and Word applies its defaults to the rest.
 *
 * The table repeats its header on every page and switches the page to
 * landscape once the report is wider than six columns, because a sixteen-column
 * treasury statement squeezed into portrait is a document nobody can read. The
 * text is UTF-8 and Word does its own shaping, so Arabic arrives intact here
 * without any help from this file — the one thing the PDF writer cannot say.
 */
import { isNumeric, type TableDocument } from './document';
import { part, writeZip, xml, type ZipEntry } from './zip';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/** Columns past this and the page turns on its side. */
const LANDSCAPE_FROM = 7;

/** A4 in twentieths of a point, the unit Word measures pages in. */
const A4 = { short: 11906, long: 16838 };
const MARGIN = 1134; // 2 cm

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

interface RunStyle {
  readonly bold?: boolean;
  /** Half-points, as Word counts them: 22 is 11pt. */
  readonly size: number;
  readonly rtl?: boolean;
}

function run(text: string, style: RunStyle): string {
  const props = [
    style.bold === true ? '<w:b/><w:bCs/>' : '',
    `<w:sz w:val="${style.size}"/><w:szCs w:val="${style.size}"/>`,
    style.rtl === true ? '<w:rtl/>' : '',
  ].join('');
  return `<w:r><w:rPr>${props}</w:rPr><w:t xml:space="preserve">${xml(text)}</w:t></w:r>`;
}

interface ParagraphStyle extends RunStyle {
  readonly align?: 'left' | 'right';
  /** Twentieths of a point below the paragraph. */
  readonly after?: number;
}

function paragraph(text: string, style: ParagraphStyle): string {
  const props = [
    style.rtl === true ? '<w:bidi/>' : '',
    `<w:spacing w:after="${style.after ?? 0}"/>`,
    style.align !== undefined ? `<w:jc w:val="${style.align}"/>` : '',
  ].join('');
  return `<w:p><w:pPr>${props}</w:pPr>${text === '' ? '' : run(text, style)}</w:p>`;
}

const BORDER = '<w:top w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>'
  + '<w:left w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>'
  + '<w:bottom w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>'
  + '<w:right w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>'
  + '<w:insideH w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>'
  + '<w:insideV w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>';

function cell(value: string, header: boolean, size: number, rtl: boolean): string {
  // Numbers sit against the right edge so a column of amounts lines up on its
  // decimal point; everything else follows the reading direction of the page.
  const align = !header && isNumeric(value) ? 'right' : undefined;
  const shading = header ? '<w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/>' : '';
  return `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/>${shading}</w:tcPr>${
    paragraph(value, { bold: header, size, rtl, align })
  }</w:tc>`;
}

function tableRow(cells: readonly string[], width: number, header: boolean, size: number, rtl: boolean): string {
  const padded = cells.length < width ? [...cells, ...Array<string>(width - cells.length).fill('')] : cells;
  const props = header ? '<w:trPr><w:tblHeader/><w:cantSplit/></w:trPr>' : '<w:trPr><w:cantSplit/></w:trPr>';
  return `<w:tr>${props}${padded.map((value) => cell(value, header, size, rtl)).join('')}</w:tr>`;
}

export function writeDocx(doc: TableDocument, at: Date): Uint8Array {
  const rtl = doc.rtl === true;
  const width = Math.max(doc.header.length, ...doc.rows.map((row) => row.length));
  const landscape = width >= LANDSCAPE_FROM;
  // Dense tables shrink the type a step: 9pt past six columns, 11pt otherwise.
  const size = landscape ? 18 : 22;

  const blocks: string[] = [paragraph(doc.title, { size: 32, bold: true, rtl, after: 120 })];
  for (const meta of doc.meta ?? []) {
    blocks.push(paragraph(`${meta.label}: ${meta.value}`, { size: 18, rtl }));
  }
  blocks.push(paragraph('', { size: 22, after: 120 }));

  const tableProps = [
    '<w:tblW w:w="5000" w:type="pct"/>',
    rtl ? '<w:bidiVisual/>' : '',
    `<w:tblBorders>${BORDER}</w:tblBorders>`,
    '<w:tblLayout w:type="autofit"/>',
    '<w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar>',
  ].join('');
  const rows = [
    tableRow(doc.header, width, true, size, rtl),
    ...doc.rows.map((row) => tableRow(row, width, false, size, rtl)),
  ];
  blocks.push(`<w:tbl><w:tblPr>${tableProps}</w:tblPr>${rows.join('')}</w:tbl>`);

  const page = landscape
    ? `<w:pgSz w:w="${A4.long}" w:h="${A4.short}" w:orient="landscape"/>`
    : `<w:pgSz w:w="${A4.short}" w:h="${A4.long}"/>`;
  const section = `<w:sectPr>${page}<w:pgMar w:top="${MARGIN}" w:right="${MARGIN}" w:bottom="${MARGIN}" w:left="${MARGIN}" w:header="708" w:footer="708" w:gutter="0"/>${
    rtl ? '<w:bidi/>' : ''
  }</w:sectPr>`;

  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W}"><w:body>${blocks.join('')}${section}</w:body></w:document>`;

  const entries: ZipEntry[] = [
    part('[Content_Types].xml', CONTENT_TYPES),
    part('_rels/.rels', ROOT_RELS),
    part('word/document.xml', document),
  ];
  return writeZip(entries, at);
}
