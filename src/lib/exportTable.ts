// Table export helpers (CSV / Excel / print). Kept out of the component
// module so react-refresh only sees component exports there.

function escapeHtml(unsafe: string | number | null): string {
  if (unsafe === null || unsafe === undefined) return '';
  if (typeof unsafe === 'number') return String(unsafe);
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function neutralizeFormula(val: string | number | null): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'number') return String(val);
  const str = String(val);
  if (/^[=+\-@\t\r]/.test(str)) return "'" + str;
  return str;
}

export function exportTableToCSV(headers: string[], rows: (string | number | null)[][], filename: string) {
  const csv = [
    headers.join(','),
    ...rows.map(r => r.map(c => `"${neutralizeFormula(c).replace(/"/g, '""')}"`).join(','))
  ].join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  downloadBlob(blob, `${filename}.csv`);
}

export function exportTableToExcel(headers: string[], rows: (string | number | null)[][], filename: string) {
  const html = `<table border="1"><tr>${headers.map(h => `<th>${escapeHtml(h)}</th>`).join('')}</tr>${rows.map(r => `<tr>${r.map(c => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`).join('')}</table>`;
  const blob = new Blob([html], { type: 'application/vnd.ms-excel' });
  downloadBlob(blob, `${filename}.xls`);
}

export function printTable(headers: string[], rows: (string | number | null)[][], title: string) {
  const win = window.open('', '_blank');
  if (!win) return;
  win.document.write(`<html><head><title>${escapeHtml(title)}</title><style>body{font-family:Tajawal,sans-serif;padding:20px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #d4cfc6;padding:8px;text-align:left}th{background:#f3f1ed}</style></head><body><h2>${escapeHtml(title)}</h2><table><thead><tr>${headers.map(h => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></body></html>`);
  win.document.close();
  win.print();
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}