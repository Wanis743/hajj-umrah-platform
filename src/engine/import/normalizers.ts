/**
 * Data Normalization Engine
 * Applied during import pipeline: PARSE → NORMALIZE step.
 * All functions return null for unrecoverable inputs.
 */

// Phone Normalization

/**
 * Normalize Algerian/international phone numbers.
 * Strips spaces, dashes, parentheses. Adds +213 for local numbers.
 */
export function normalizePhone(raw: unknown): string | null {
  if (raw == null || raw === '') return null;
  let s = String(raw).replace(/[\s-().+]/g, '');
  // Strip leading 00
  if (s.startsWith('00')) s = s.slice(2);
  // Strip country code 213
  if (s.startsWith('213') && s.length === 12) s = '0' + s.slice(3);
  // Local Algerian mobile: 0xxx (10 digits)
  if (/^0[5-7]\d{8}$/.test(s)) return s;
  // Already international without +
  if (/^\d{10,15}$/.test(s)) return s;
  return null; // Cannot normalize
}

// Date Normalization



/**
 * Parse and normalize a date string to ISO 8601 (YYYY-MM-DD).
 * Accepts common formats: DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD.
 */
export function normalizeDate(raw: unknown): string | null {
  if (raw == null || raw === '') return null;

  // If it's already a Date object (from XLSX parsing)
  if (raw instanceof Date) {
    if (isNaN(raw.getTime())) return null;
    return raw.toISOString().split('T')[0];
  }

  // Handle Excel serial date numbers
  if (typeof raw === 'number') {
    // Excel epoch: Dec 30, 1899
    const excelEpoch = new Date(1899, 11, 30);
    const d = new Date(excelEpoch.getTime() + raw * 86400000);
    if (isNaN(d.getTime())) return null;
    return d.toISOString().split('T')[0];
  }

  const s = String(raw).trim();

  // ISO already
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : s;
  }

  // DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
  const match = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (match) {
    const [, d, m, y] = match;
    const dateStr = `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
    const date = new Date(dateStr);
    return isNaN(date.getTime()) ? null : dateStr;
  }

  // Try native parse as last resort
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];

  return null;
}

// Currency / Amount Normalization

/**
 * Parse a currency amount from various formats.
 * Handles: '1,234.56', '1.234,56', '1 234', '1234 DZD', '١٢٣٤'
 */
export function normalizeCurrency(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number') return isFinite(raw) ? raw : null;

  let s = String(raw).trim();

  // Convert Arabic-Indic numerals to Latin
  s = s.replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));

  // Strip currency symbols and labels
  s = s.replace(/[DZDdzSAR sar\u062f\u062c\ufdfc$€£]/g, '').trim();

  // Detect decimal separator convention:
  // If format like 1.234,56 → European (comma = decimal)
  if (/\d{1,3}(.\d{3})+(,\d+)?$/.test(s)) {
    s = s.replace(/./g, '').replace(',', '.');
  } else if (/\d{1,3}(,\d{3})+(.\d+)?$/.test(s)) {
    // Format 1,234.56 → strip commas
    s = s.replace(/,/g, '');
  } else {
    // Ambiguous: treat comma as decimal if only one comma near end
    s = s.replace(/,/g, '.');
  }

  // Strip spaces used as thousands separator
  s = s.replace(/\s/g, '');

  const num = parseFloat(s);
  return isFinite(num) ? num : null;
}

// Arabic Text Normalization

/**
 * Normalize Arabic text:
 * - Strip diacritics (تشكيل)
 * - Normalize Alef variants → ا
 * - Normalize Yaa → ي
 * - Normalize Taa Marbuta → ة
 * - Trim and collapse whitespace
 */
export function normalizeArabicText(raw: unknown): string | null {
  if (raw == null || raw === '') return null;
  let s = String(raw).trim();

  // Remove Arabic diacritics (harakat)
  s = s.replace(/[\u064B-\u065F\u0670]/g, '');
  // Normalize Alef variants: أ إ آ ٱ → ا
  s = s.replace(/[أإآٱ]/g, 'ا');
  // Normalize Yaa: ى → ي
  s = s.replace(/ى/g, 'ي');
  // Normalize Taa Marbuta: ة → ه (optional: depends on context, keep as-is)
  // Collapse multiple spaces
  s = s.replace(/\s+/g, ' ').trim();

  return s || null;
}

// Passport Normalization

/**
 * Normalize passport number: uppercase, strip spaces and dashes.
 * Algerian passports: typically 9 alphanumeric chars.
 */
export function normalizePassport(raw: unknown): string | null {
  if (raw == null || raw === '') return null;
  const s = String(raw).toUpperCase().replace(/[\s-]/g, '');
  if (s.length < 5 || s.length > 20) return null;
  if (!/^[A-Z0-9]+$/.test(s)) return null;
  return s;
}

// String Normalization

/** General string: trim, collapse whitespace */
export function normalizeString(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).replace(/\s+/g, ' ').trim();
  return s || null;
}

/** Normalize email: lowercase, trim */
export function normalizeEmail(raw: unknown): string | null {
  if (raw == null || raw === '') return null;
  const s = String(raw).toLowerCase().trim();
  return /^[^\s@]+@[^\s@]+.[^\s@]+$/.test(s) ? s : null;
}

// Row Normalization

export type FieldType = 'string' | 'phone' | 'date' | 'currency' | 'arabic' | 'passport' | 'email' | 'integer' | 'boolean';

export interface FieldNormConfig {
  field: string;
  type: FieldType;
  required?: boolean;
}

export interface NormalizationResult {
  normalized: Record<string, unknown>;
  errors: { field: string; code: string; message: string }[];
  warnings: { field: string; code: string; message: string }[];
}

/** Apply normalization to a row based on field config */
export function normalizeRow(
  row: Record<string, unknown>,
  config: FieldNormConfig[],
): NormalizationResult {
  const normalized: Record<string, unknown> = {};
  const errors: NormalizationResult['errors'] = [];
  const warnings: NormalizationResult['warnings'] = [];

  for (const { field, type, required } of config) {
    const raw = row[field];
    let value: unknown = null;

    switch (type) {
      case 'phone':    value = normalizePhone(raw); break;
      case 'date':     value = normalizeDate(raw); break;
      case 'currency': value = normalizeCurrency(raw); break;
      case 'arabic':   value = normalizeArabicText(raw); break;
      case 'passport': value = normalizePassport(raw); break;
      case 'email':    value = normalizeEmail(raw); break;
      case 'integer':  value = raw != null ? parseInt(String(raw), 10) || null : null; break;
      case 'boolean':  value = ['true','1','yes','نعم','oui'].includes(String(raw).toLowerCase()); break;
      default:         value = normalizeString(raw); break;
    }

    if (required && (value == null || value === '')) {
      errors.push({ field, code: 'REQUIRED_MISSING', message: `الحقل "${field}" مطلوب` });
    } else if (raw != null && raw !== '' && value == null) {
      warnings.push({ field, code: 'NORMALIZATION_FAILED', message: `تعذّر تحويل قيمة الحقل "${field}": ${String(raw)}` });
    }

    normalized[field] = value;
  }

  return { normalized, errors, warnings };
}
