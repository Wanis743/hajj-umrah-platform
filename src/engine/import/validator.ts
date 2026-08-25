/**
 * Import Pipeline Validator
 * Per-row validation: VALID | WARNING | ERROR | DUPLICATE | CONFLICT
 */

import { normalizePassport, normalizePhone, normalizeDate, normalizeCurrency } from './normalizers';
import type { FieldDefinition } from './mappingEngine';

export type RowStatus = 'VALID' | 'WARNING' | 'ERROR' | 'DUPLICATE' | 'CONFLICT' | 'SKIPPED';

export interface RowError {
  field: string;
  code: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface ConflictField {
  field: string;
  existing: unknown;
  imported: unknown;
  resolution: 'KEEP_EXISTING' | 'USE_IMPORTED' | 'MANUAL' | null;
}

export interface ValidationResult {
  rowIndex: number;
  status: RowStatus;
  errors: RowError[];
  warnings: RowError[];
  conflicts: ConflictField[];
  matchedRecordId: string | null;  // if duplicate detected
  confidence: number;               // 0-100 matching confidence
  normalized: Record<string, unknown>;
}

export interface ValidatorOptions {
  fields: FieldDefinition[];
  mode: 'STRICT' | 'PARTIAL' | 'REVIEW';
  /** Existing records to check for duplicates */
  existingRecords?: Record<string, unknown>[];
  /** Key fields for duplicate detection */
  duplicateKeyFields?: string[];
}

// Field-Level Validators

function validateField(
  field: FieldDefinition,
  value: unknown,
): RowError | null {
  if (value == null || value === '') {
    if (field.required) {
      return {
        field: field.key,
        code: 'REQUIRED_MISSING',
        message: `الحقل "${field.labelAr}" مطلوب ولا يمكن تركه فارغاً`,
        severity: 'error',
      };
    }
    return null;
  }

  switch (field.type) {
    case 'phone': {
      const normalized = normalizePhone(value);
      if (normalized === null) {
        return {
          field: field.key,
          code: 'INVALID_PHONE',
          message: `رقم الهاتف "${value}" غير صالح`,
          severity: 'warning',
        };
      }
      break;
    }
    case 'date': {
      const normalized = normalizeDate(value);
      if (normalized === null) {
        return {
          field: field.key,
          code: 'INVALID_DATE',
          message: `تنسيق التاريخ "${value}" غير مدعوم`,
          severity: 'error',
        };
      }
      break;
    }
    case 'currency': {
      const normalized = normalizeCurrency(value);
      if (normalized === null) {
        return {
          field: field.key,
          code: 'INVALID_AMOUNT',
          message: `المبلغ "${value}" غير صالح`,
          severity: 'error',
        };
      }
      if (normalized < 0) {
        return {
          field: field.key,
          code: 'NEGATIVE_AMOUNT',
          message: `المبلغ سالب: ${normalized}`,
          severity: 'warning',
        };
      }
      break;
    }
    case 'passport': {
      const normalized = normalizePassport(value);
      if (normalized === null) {
        return {
          field: field.key,
          code: 'INVALID_PASSPORT',
          message: `رقم الجواز "${value}" غير صالح`,
          severity: 'error',
        };
      }
      break;
    }
    case 'email': {
      const s = String(value).toLowerCase().trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) {
        return {
          field: field.key,
          code: 'INVALID_EMAIL',
          message: `البريد الإلكتروني "${value}" غير صالح`,
          severity: 'warning',
        };
      }
      break;
    }
  }

  return null;
}

// Duplicate Detection

function detectDuplicate(
  row: Record<string, unknown>,
  existingRecords: Record<string, unknown>[],
  keyFields: string[],
): { matchedId: string | null; confidence: number } {
  let bestMatch: string | null = null;
  let bestScore = 0;

  for (const existing of existingRecords) {
    let matchScore = 0;
    let matchedFields = 0;

    for (const key of keyFields) {
      const rowVal = String(row[key] ?? '').toUpperCase().trim();
      const existingVal = String(existing[key] ?? '').toUpperCase().trim();
      if (rowVal && existingVal && rowVal === existingVal) {
        matchScore += key === 'passport_number' ? 100 : 70;
        matchedFields++;
      }
    }

    const score = matchedFields > 0 ? matchScore / keyFields.length : 0;
    if (score > bestScore) {
      bestScore = score;
      bestMatch = String(existing['id'] ?? '');
    }
  }

  return {
    matchedId: bestScore >= 70 ? bestMatch : null,
    confidence: Math.min(100, bestScore),
  };
}

// Conflict Detection

function detectConflicts(
  imported: Record<string, unknown>,
  existing: Record<string, unknown>,
  fields: FieldDefinition[],
): ConflictField[] {
  return fields
    .filter(f => {
      const importedVal = imported[f.key];
      const existingVal = existing[f.key];
      return (
        importedVal != null &&
        importedVal !== '' &&
        existingVal != null &&
        existingVal !== '' &&
        String(importedVal) !== String(existingVal)
      );
    })
    .map(f => ({
      field: f.key,
      existing: existing[f.key],
      imported: imported[f.key],
      resolution: null,
    }));
}

// Main Validator

export function validateRow(
  rowIndex: number,
  row: Record<string, unknown>,
  options: ValidatorOptions,
): ValidationResult {
  const { fields, existingRecords = [], duplicateKeyFields = ['passport_number'] } = options;
  const errors: RowError[] = [];
  const warnings: RowError[] = [];

  // Validate each field
  for (const field of fields) {
    const error = validateField(field, row[field.key]);
    if (error) {
      if (error.severity === 'error') errors.push(error);
      else warnings.push(error);
    }
  }

  // Duplicate detection
  const { matchedId, confidence } = detectDuplicate(row, existingRecords, duplicateKeyFields);
  let conflicts: ConflictField[] = [];

  if (matchedId) {
    const existing = existingRecords.find(r => String(r['id']) === matchedId);
    if (existing) {
      conflicts = detectConflicts(row, existing, fields);
    }
  }

  // Determine status
  let status: RowStatus = 'VALID';
  if (errors.length > 0) status = 'ERROR';
  else if (matchedId && conflicts.length > 0) status = 'CONFLICT';
  else if (matchedId) status = 'DUPLICATE';
  else if (warnings.length > 0) status = 'WARNING';

  return {
    rowIndex,
    status,
    errors,
    warnings,
    conflicts,
    matchedRecordId: matchedId,
    confidence,
    normalized: row,
  };
}

/** Validate all rows, return summary */
export function validateBatch(
  rows: Record<string, unknown>[],
  options: ValidatorOptions,
): {
  results: ValidationResult[];
  summary: {
    total: number;
    valid: number;
    warnings: number;
    errors: number;
    duplicates: number;
    conflicts: number;
  };
} {
  const results = rows.map((row, i) => validateRow(i, row, options));
  return {
    results,
    summary: {
      total: results.length,
      valid: results.filter(r => r.status === 'VALID').length,
      warnings: results.filter(r => r.status === 'WARNING').length,
      errors: results.filter(r => r.status === 'ERROR').length,
      duplicates: results.filter(r => r.status === 'DUPLICATE').length,
      conflicts: results.filter(r => r.status === 'CONFLICT').length,
    },
  };
}
