/**
 * ImportCenter — types, constants, parsers, and pure utilities
 * Separated to keep the main ImportCenter component below 600 lines.
 */
export type ImportStep =
  | 'UPLOAD' | 'DETECT' | 'MAP' | 'VALIDATE'
  | 'PREVIEW' | 'DECISION' | 'EXECUTE' | 'REPORT';

export type ImportFormat = 'CSV' | 'XLSX' | 'JSON' | 'CLIPBOARD';
export type ImportMode = 'STRICT' | 'PARTIAL' | 'REVIEW';
export type ImportDecision = 'MERGE' | 'SEPARATE_DATASET' | null;
export type TargetModule = 'pilgrims' | 'bookings' | 'payments' | 'groups' | 'suppliers' | 'other';

export interface ImportState {
  step: ImportStep;
  format: ImportFormat | null;
  targetModule: TargetModule;
  mode: ImportMode;
  rawText: string;
  parsedRows: Record<string, unknown>[];
  sourceColumns: string[];
  columnMappings: import('@/engine/import/mappingEngine').ColumnMapping[];
  validationResults: import('@/engine/import/validator').ValidationResult[];
  decision: ImportDecision;
  datasetName: string;
  batchId: string | null;
  summary: {
    total: number; valid: number; warnings: number;
    errors: number; duplicates: number; conflicts: number;
  };
  executing: boolean;
  executed: boolean;
  executionReport: { created: number; updated: number; skipped: number; errors: number; } | null;
  error: string | null;
}

export const IMPORT_STEPS: { id: ImportStep; labelAr: string; labelFr: string; labelEn: string }[] = [
  { id: 'UPLOAD',  labelAr: 'رفع',    labelFr: 'Chargement', labelEn: 'Upload' },
  { id: 'DETECT',  labelAr: 'اكتشاف', labelFr: 'Détection',  labelEn: 'Detect' },
  { id: 'MAP',     labelAr: 'تطابق',  labelFr: 'Mapping',    labelEn: 'Map' },
  { id: 'VALIDATE',labelAr: 'تحقق',   labelFr: 'Validation', labelEn: 'Validate' },
  { id: 'PREVIEW', labelAr: 'معاينة', labelFr: 'Aperçu',     labelEn: 'Preview' },
  { id: 'DECISION',labelAr: 'قرار',   labelFr: 'Décision',   labelEn: 'Decision' },
  { id: 'EXECUTE', labelAr: 'تنفيذ',  labelFr: 'Exécution',  labelEn: 'Execute' },
  { id: 'REPORT',  labelAr: 'تقرير',  labelFr: 'Rapport',    labelEn: 'Report' },
];

export const MODULE_OPTIONS: { id: TargetModule; ar: string; fr: string; en: string }[] = [
  { id: 'pilgrims', ar: 'الحجاج',    fr: 'Pèlerins',      en: 'Pilgrims' },
  { id: 'bookings', ar: 'الحجوزات',  fr: 'Réservations',  en: 'Bookings' },
  { id: 'payments', ar: 'المدفوعات', fr: 'Paiements',     en: 'Payments' },
  { id: 'groups',   ar: 'المجموعات', fr: 'Groupes',       en: 'Groups' },
  { id: 'suppliers',ar: 'الموردون',  fr: 'Fournisseurs',  en: 'Suppliers' },
];

export const INITIAL_IMPORT_STATE: ImportState = {
  step: 'UPLOAD', format: null, targetModule: 'pilgrims', mode: 'PARTIAL',
  rawText: '', parsedRows: [], sourceColumns: [], columnMappings: [],
  validationResults: [], decision: null, datasetName: '', batchId: null,
  summary: { total: 0, valid: 0, warnings: 0, errors: 0, duplicates: 0, conflicts: 0 },
  executing: false, executed: false, executionReport: null, error: null,
};

// CSV / JSON parsers

export function parseCSV(text: string): { headers: string[]; rows: Record<string, unknown>[] } {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return { headers: [], rows: [] };
  const firstLine = lines[0];
  const delimiters = [',', ';', '\t', '|'];
  const delimiter = delimiters.reduce((best, d) =>
    (firstLine.split(d).length > firstLine.split(best).length) ? d : best, ',');
  const headers = firstLine.split(delimiter).map(h => h.trim().replace(/^"|"$/g, ''));
  const rows = lines.slice(1)
    .filter(line => line.trim())
    .map(line => {
      const values = line.split(delimiter).map(v => v.trim().replace(/^"|"$/g, ''));
      return Object.fromEntries(headers.map((h, i) => [h, values[i] ?? null]));
    });
  return { headers, rows };
}

export function parseJSON(text: string): { headers: string[]; rows: Record<string, unknown>[] } {
  try {
    const data = JSON.parse(text);
    const arr = Array.isArray(data) ? data : [data];
    const headers = arr.length > 0 ? Object.keys(arr[0]) : [];
    return { headers, rows: arr };
  } catch {
    return { headers: [], rows: [] };
  }
}

// Error report CSV generator
export function buildErrorReportCsv(validationResults: ImportState['validationResults']): string {
  const errors = validationResults
    .filter(r => r.errors.length > 0 || r.warnings.length > 0)
    .map(r => ({
      row: r.rowIndex + 2,
      status: r.status,
      errors: r.errors.map(e => `${e.field}: ${e.message}`).join(' | '),
      warnings: r.warnings.map(w => `${w.field}: ${w.message}`).join(' | '),
    }));
  return ['Row,Status,Errors,Warnings', ...errors.map(e => `${e.row},${e.status},"${e.errors}","${e.warnings}"`)].join('\n');
}

// Template CSV builder
export function buildTemplateCsv(fields: { labelEn: string; type: string }[]): string {
  const headers = fields.map(f => f.labelEn).join(',');
  const example = fields.map(f => {
    switch (f.type) {
      case 'date':     return '01/08/1985';
      case 'phone':    return '0555123456';
      case 'passport': return 'AA123456';
      case 'currency': return '150000';
      case 'email':    return 'example@email.com';
      default:         return 'Example Value';
    }
  }).join(',');
  return `${headers}\n${example}\n`;
}

// Download helper
export function triggerDownload(content: string, filename: string, mimeType = 'text/csv;charset=utf-8;'): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
