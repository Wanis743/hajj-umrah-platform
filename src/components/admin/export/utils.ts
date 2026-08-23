export function generateCSV(data: Record<string, unknown>[], fields: { key: string; labelEn: string }[]): string {
  const headers = fields.map(f => f.labelEn).join(',');
  const rows = data.map(row =>
    fields.map(f => {
      const val = row[f.key];
      if (val == null) return '';
      const str = String(val);
      return str.includes(',') || str.includes('"') || str.includes('\n')
        ? `"${str.replace(/"/g, '""')}"` : str;
    }).join(',')
  );
  return [headers, ...rows].join('\n');
}

export function generateJSON(data: Record<string, unknown>[], fields: { key: string }[]): string {
  return JSON.stringify(
    data.map(row => Object.fromEntries(fields.map(f => [f.key, row[f.key]]))),
    null, 2,
  );
}

export function downloadBlob(content: string, filename: string, mimeType: string): void {
  const bom = mimeType.includes('csv') ? '\uFEFF' : ''; // UTF-8 BOM for Excel Arabic support
  const blob = new Blob([bom + content], { type: `${mimeType};charset=utf-8;` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
