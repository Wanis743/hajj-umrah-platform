/**
 * CSV, for every app in the suite that exports one.
 *
 * Nine finance apps offer "export what is on screen", and RFC 4180 has exactly
 * one rule worth getting wrong: a value containing a comma, a quote or a newline
 * has to be quoted, and an embedded quote is doubled. Written once per app that is
 * nine chances to ship a file that opens with the columns shifted by one.
 *
 * Rows are raw values on purpose — ISO dates and unformatted decimals, never
 * `1 250,00 DA`. A CSV is read by a spreadsheet, and a spreadsheet asked to guess
 * whether `1.250` is one thousand or one and a quarter will guess wrong in one of
 * the two languages this OS runs in.
 */

/** Quotes a value when leaving it bare could break the row. */
export function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** One row, already escaped. */
export const csvRow = (cells: readonly string[]): string => cells.map(csvCell).join(',');

/**
 * A whole document: a header line, then the rows, CRLF-separated.
 *
 * CRLF rather than LF because Excel on Windows is the reader that matters here,
 * and it is the one reader that treats a lone LF as part of the cell.
 */
export function csvDocument(header: readonly string[], rows: readonly (readonly string[])[]): string {
  return [csvRow(header), ...rows.map(csvRow)].join('\r\n');
}
