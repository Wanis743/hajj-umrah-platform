/**
 * The table as a printable page, for the browser to turn into a PDF.
 *
 * This is the route a document takes when the hand-written PDF writer cannot
 * set it — in practice, when it contains Arabic. The browser's own text stack
 * shapes joined letters and orders bidirectional runs correctly, which no
 * fourteen-font PDF can, and every browser's print dialog offers "Save as PDF".
 * The user gets a PDF; the OS just did not build it byte by byte.
 *
 * Styled for paper, not the screen: the header row repeats across page breaks,
 * rows refuse to split, and the sheet turns landscape past six columns exactly
 * as the DOCX and PDF writers do, so the three page formats agree on the shape
 * of a wide report.
 */
import { isNumeric, type TableDocument } from './document';
import { xml as escape } from './zip';

const LANDSCAPE_FROM = 7;

const STYLE = `
  @page { margin: 14mm; }
  html { font: 10pt/1.35 system-ui, "Segoe UI", sans-serif; color: #111; }
  body { margin: 0; }
  h1 { font-size: 16pt; margin: 0 0 4pt; }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: 1pt 8pt; margin: 0 0 10pt; font-size: 8.5pt; color: #444; }
  dt { font-weight: 600; } dd { margin: 0; }
  table { border-collapse: collapse; width: 100%; font-size: 8.5pt; }
  thead { display: table-header-group; }
  th, td { border: 0.5pt solid #bbb; padding: 2.5pt 4pt; vertical-align: top; text-align: start; }
  th { background: #f0f0f0; font-weight: 600; }
  td.n { text-align: end; font-variant-numeric: tabular-nums; white-space: nowrap; }
  tr { break-inside: avoid; }
`;

const cell = (value: string, header: boolean): string => {
  if (header) return `<th>${escape(value)}</th>`;
  return isNumeric(value) ? `<td class="n">${value}</td>` : `<td>${escape(value)}</td>`;
};

export function tableHtml(doc: TableDocument): string {
  const columns = Math.max(doc.header.length, ...doc.rows.map((row) => row.length));
  const dir = doc.rtl === true ? 'rtl' : 'ltr';
  const lang = doc.rtl === true ? 'ar' : '';
  const size = columns >= LANDSCAPE_FROM ? 'A4 landscape' : 'A4';
  const meta = (doc.meta ?? [])
    .map((m) => `<dt>${escape(m.label)}</dt><dd>${escape(m.value)}</dd>`)
    .join('');
  const head = `<tr>${doc.header.map((h) => cell(h, true)).join('')}</tr>`;
  const body = doc.rows
    .map((row) => `<tr>${row.map((value) => cell(value, false)).join('')}</tr>`)
    .join('');

  return `<!doctype html>
<html dir="${dir}"${lang === '' ? '' : ` lang="${lang}"`}>
<head>
<meta charset="utf-8">
<title>${escape(doc.title)}</title>
<style>@page { size: ${size}; }${STYLE}</style>
</head>
<body>
<h1>${escape(doc.title)}</h1>
${meta === '' ? '' : `<dl>${meta}</dl>`}
<table><thead>${head}</thead><tbody>${body}</tbody></table>
</body>
</html>`;
}
