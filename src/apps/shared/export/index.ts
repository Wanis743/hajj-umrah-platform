/**
 * The export package: one table in, one of four files out.
 *
 * Every finance app builds a `TableDocument` and hands it to `writeTable` with
 * the format the user picked. CSV is a straight encode and stays in the main
 * bundle. The three page formats are loaded on first use — a user who only ever
 * exports CSV never downloads a PDF writer, and none of the three weigh on the
 * shell's start-up.
 *
 * PDF has one extra step. The hand-written writer sets Latin script only, so
 * `pdfNeedsBrowser` is asked first; when it says yes the caller prints the
 * `printableTable` through the shell instead, and the browser does the shaping
 * and the saving. See `pdf.ts` for why that trade was made.
 */
import { csvDocument, writeCsv } from './csv';
import {
  contentTypeOf,
  everyCell,
  isWinAnsi,
  type ExportedFile,
  type ExportFormat,
  type TableDocument,
} from './document';

export type { ExportedFile, ExportFormat, TableDocument, TableMeta } from './document';
export { EXPORT_FORMATS, contentTypeOf, fileNameFor, tableDocument } from './document';
export { csvCell, csvDocument, csvRow } from './csv';

const file = (format: ExportFormat, bytes: Uint8Array): ExportedFile => ({
  bytes,
  contentType: contentTypeOf(format),
  extension: `.${format}`,
});

/** True when the document has text the built-in PDF writer cannot draw. */
export function pdfNeedsBrowser(doc: TableDocument): boolean {
  for (const cell of everyCell(doc)) if (!isWinAnsi(cell)) return true;
  return false;
}

/**
 * The document as bytes in the requested format.
 *
 * `at` stamps the file — the zip entries and the PDF's creation date — and is
 * passed in rather than read here so the writers stay pure and a test can pin
 * the output byte for byte.
 */
export async function writeTable(doc: TableDocument, format: ExportFormat, at: Date): Promise<ExportedFile> {
  switch (format) {
    case 'csv':
      return file('csv', writeCsv(doc));
    case 'xlsx': {
      const { writeXlsx } = await import('./xlsx');
      return file('xlsx', writeXlsx(doc, at));
    }
    case 'docx': {
      const { writeDocx } = await import('./docx');
      return file('docx', writeDocx(doc, at));
    }
    case 'pdf': {
      const { writePdf } = await import('./pdf');
      return file('pdf', writePdf(doc, at));
    }
  }
}

/** The document as a print-ready HTML page, for `shell.print`. */
export async function printableTable(doc: TableDocument): Promise<string> {
  const { tableHtml } = await import('./html');
  return tableHtml(doc);
}

/** The CSV text alone, for the callers that still want a string. */
export const csvOf = (doc: TableDocument): string => csvDocument(doc.header, doc.rows);
