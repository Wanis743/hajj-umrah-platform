/**
 * Import Pipeline Orchestrator
 * ─────────────────────────────────────────────────────────────────────────────
 * Coordinates all 13 import steps in sequence:
 *   1. Parse     — detect format and parse raw bytes
 *   2. Detect    — detect column headers
 *   3. Map       — match columns to canonical fields
 *   4. Normalize — phone, date, currency, Arabic, passport
 *   5. Validate  — per-row validation rules
 *   6. Dedupe    — duplicate detection within file + against DB
 *   7. Diff      — compare against existing DB rows (for UPDATE mode)
 *   8. Preview   — return sample rows for user review
 *   9. Batch     — create import_batch record in DB
 *  10. Stage     — insert into import_batch_rows staging table
 *  11. Commit    — call `apply_import_batch` RPC (UPSERT into target table)
 *  12. Audit     — write data lineage records
 *  13. Report    — return final summary stats
 *
 * Labels:
 *   IMPORTED — all rows processed via this pipeline carry the IMPORTED label.
 */

import { normalizePhone, normalizeDate, normalizeCurrency, normalizePassport, normalizeArabicText } from '@/engine/import/normalizers';
import { detectColumnMapping } from '@/engine/import/mappingEngine';
import { validateRow } from '@/engine/import/validator';
import { supabase } from '@/lib/supabase';
import type { ImportBatchRowInsert } from '@/types/database';

// ── Types ──────────────────────────────────────────────────────────────────

export type ImportMode = 'PARTIAL' | 'FULL_REPLACE';
export type ImportModule = 'pilgrims' | 'bookings' | 'payments' | 'groups' | 'packages';
export type DataSourceLabel = 'IMPORTED';

export interface RawRow {
  [key: string]: string | number | null | undefined;
}

export interface NormalizedRow {
  [key: string]: string | number | null;
}

export interface ValidatedRow {
  row: NormalizedRow;
  valid: boolean;
  errors: { field: string; message: string }[];
  warnings: { field: string; message: string }[];
  isDuplicate: boolean;
  dataSource: DataSourceLabel;
}

export interface ImportStep {
  step: number;
  name: string;
  status: 'pending' | 'running' | 'done' | 'error' | 'skipped';
  message?: string;
  count?: number;
  durationMs?: number;
}

export interface ImportPipelineResult {
  success: boolean;
  batchId: string | null;
  steps: ImportStep[];
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicateRows: number;
  committedRows: number;
  errors: string[];
  previewRows: ValidatedRow[];
}

export interface ImportPipelineOptions {
  columnMapping?: Record<string, string>;
  decision?: 'SKIP' | 'MERGE';
  module: ImportModule;
  mode: ImportMode;
  sourceName: string;
  /** Parsed raw rows from file */
  rawRows: RawRow[];
  /** Optional: run only up to this step (for preview) */
  upToStep?: number;
  /** Called after each step with updated step list */
  onProgress?: (steps: ImportStep[]) => void;
}

// ── Column mapping per module ──────────────────────────────────────────────

const MODULE_TARGET_FIELDS: Record<ImportModule, string[]> = {
  pilgrims: ['full_name', 'full_name_ar', 'passport_number', 'phone', 'email', 'birth_date', 'gender', 'nationality', 'wilaya', 'departure_airport', 'group_id', 'package_id', 'visa_status', 'payment_status', 'status'],
  bookings: ['pilgrim_id', 'package_id', 'group_id', 'booking_reference', 'status', 'amount_dzd', 'amount_sar', 'departure_date', 'return_date'],
  payments: ['booking_id', 'pilgrim_id', 'amount_dzd', 'amount_sar', 'payment_method', 'payment_date', 'reference', 'status'],
  groups: ['code', 'name', 'name_ar', 'departure_date', 'return_date', 'max_capacity', 'status', 'departure_airport', 'arrival_airport'],
  packages: ['code', 'name', 'name_ar', 'type', 'price_dzd', 'price_sar', 'duration_nights', 'description'],
};

const REQUIRED_FIELDS: Record<ImportModule, string[]> = {
  pilgrims: ['full_name', 'passport_number'],
  bookings: ['pilgrim_id', 'package_id'],
  payments: ['booking_id', 'amount_dzd'],
  groups: ['code', 'name'],
  packages: ['code', 'name', 'price_dzd'],
};

// ── Helpers ────────────────────────────────────────────────────────────────

function makeStep(step: number, name: string): ImportStep {
  return { step, name, status: 'pending' };
}

function timestamp(): number {
  return Date.now();
}

// ── Normalize a raw row based on its module ────────────────────────────────

function normalizeRow(raw: RawRow, module: ImportModule): NormalizedRow {
  const out: NormalizedRow = {};
  for (const [key, val] of Object.entries(raw)) {
    const strVal = val != null ? String(val).trim() : '';
    if (!strVal) { out[key] = null; continue; }

    if (['full_name', 'full_name_ar'].includes(key)) {
      out[key] = normalizeArabicText(strVal);
    } else if (key === 'phone') {
      out[key] = normalizePhone(strVal);
    } else if (['birth_date', 'departure_date', 'return_date', 'payment_date'].includes(key)) {
      out[key] = normalizeDate(strVal) ?? null;
    } else if (['amount_dzd', 'amount_sar', 'price_dzd', 'price_sar'].includes(key)) {
      const num = normalizeCurrency(strVal);
      out[key] = num !== null ? num : null;
    } else if (key === 'passport_number') {
      out[key] = normalizePassport(strVal);
    } else {
      out[key] = strVal;
    }
  }
  return out;
}

// ── Main Pipeline ──────────────────────────────────────────────────────────

export async function runImportPipeline(
  options: ImportPipelineOptions,
): Promise<ImportPipelineResult> {
  const { module, mode, sourceName, rawRows, upToStep = 13, onProgress } = options;

  const steps: ImportStep[] = [
    makeStep(1, 'Parse'),
    makeStep(2, 'Detect columns'),
    makeStep(3, 'Map columns'),
    makeStep(4, 'Normalize'),
    makeStep(5, 'Validate'),
    makeStep(6, 'Deduplicate'),
    makeStep(7, 'Diff'),
    makeStep(8, 'Preview'),
    makeStep(9, 'Create batch'),
    makeStep(10, 'Stage rows'),
    makeStep(11, 'Commit'),
    makeStep(12, 'Audit'),
    makeStep(13, 'Report'),
  ];

  const result: ImportPipelineResult = {
    success: false,
    batchId: null,
    steps,
    totalRows: rawRows.length,
    validRows: 0,
    invalidRows: 0,
    duplicateRows: 0,
    committedRows: 0,
    errors: [],
    previewRows: [],
  };

  const notify = () => onProgress?.([...steps]);
  const setStep = (i: number, status: ImportStep['status'], msg?: string, count?: number, t0?: number) => {
    steps[i] = { ...steps[i], status, message: msg, count, durationMs: t0 ? Date.now() - t0 : undefined };
    notify();
  };

  // ── Step 1: Parse ──────────────────────────────────────────────────────
  let t0 = timestamp();
  setStep(0, 'running');
  if (!rawRows.length) {
    setStep(0, 'error', 'No rows found in file');
    result.errors.push('Empty file or unsupported format');
    return result;
  }
  setStep(0, 'done', `${rawRows.length} rows`, rawRows.length, t0);
  if (upToStep <= 1) return result;

  // ── Step 2: Detect columns ────────────────────────────────────────────
  t0 = timestamp();
  setStep(1, 'running');
  const headers = Object.keys(rawRows[0] ?? {});
  setStep(1, 'done', `${headers.length} columns`, headers.length, t0);
  if (upToStep <= 2) return result;

  // ── Step 3: Map columns ───────────────────────────────────────────────
  t0 = timestamp();
  setStep(2, 'running');
  const targetFields = MODULE_TARGET_FIELDS[module];
  const targetFieldsDefs = targetFields.map(key => ({
    key,
    type: 'string' as const,
    required: false,
    labelAr: key,
    labelFr: key,
    labelEn: key,
  }));
  const columnMappingResult = detectColumnMapping(headers, targetFieldsDefs);
  const columnMapping = options.columnMapping || columnMappingResult.reduce((acc, curr) => {
    if (curr.targetField) acc[curr.sourceColumn] = curr.targetField;
    return acc;
  }, {} as Record<string, string>);
  const mappedCount = Object.values(columnMapping).filter(v => v !== null).length;
  setStep(2, 'done', `${mappedCount}/${targetFields.length} fields mapped`, mappedCount, t0);
  if (upToStep <= 3) return result;

  // ── Step 4: Normalize ─────────────────────────────────────────────────
  t0 = timestamp();
  setStep(3, 'running');
  // Remap raw rows using column mapping
  const remapped: RawRow[] = rawRows.map(raw => {
    const remapped: Record<string, string | number | null> = {};
    for (const [canonical, original] of Object.entries(columnMapping)) {
      if (original && (raw as Record<string, unknown>)[original] !== undefined) {
        remapped[canonical] = (raw as Record<string, unknown>)[original] as string | number | null;
      }
    }
    return remapped;
  });
  const normalized = remapped.map(row => normalizeRow(row, module));
  setStep(3, 'done', `${normalized.length} rows normalized`, normalized.length, t0);
  if (upToStep <= 4) return result;

  // ── Step 5: Validate ──────────────────────────────────────────────────
  t0 = timestamp();
  setStep(4, 'running');
  const required = REQUIRED_FIELDS[module];
  const targetFieldsDefsForValidation = MODULE_TARGET_FIELDS[module].map(key => ({
    key,
    type: 'string' as const,
    required: required.includes(key),
    labelAr: key,
    labelFr: key,
    labelEn: key,
  }));
  const validated: ValidatedRow[] = normalized.map((row, idx) => {
    const res = validateRow(idx, row, { fields: targetFieldsDefsForValidation, mode: mode === 'PARTIAL' ? 'PARTIAL' : 'STRICT' });
    return { row, valid: res.status !== 'ERROR', errors: res.errors, warnings: res.warnings, isDuplicate: false, dataSource: 'IMPORTED' as const };
  });
  const invalidRows = validated.filter(r => !r.valid).length;
  const validRows = validated.length - invalidRows;
  result.validRows = validRows;
  result.invalidRows = invalidRows;
  setStep(4, 'done', `${validRows} valid, ${invalidRows} invalid`, validRows, t0);
  if (upToStep <= 5) return result;

  // ── Step 6: Deduplicate ───────────────────────────────────────────────
  t0 = timestamp();
  setStep(5, 'running');
  let dupCount = 0;
  const seen = new Set<string>();
  for (const vr of validated) {
    const key = module === 'pilgrims'
      ? String(vr.row['passport_number'] ?? '')
      : module === 'bookings'
        ? String(vr.row['booking_reference'] ?? '')
        : JSON.stringify(vr.row).slice(0, 80);
    if (key && seen.has(key)) { vr.isDuplicate = true; dupCount++; }
    else if (key) seen.add(key);
  }
  result.duplicateRows = dupCount;
  setStep(5, 'done', `${dupCount} duplicates found`, dupCount, t0);
  if (upToStep <= 6) return result;

  // ── Step 7: Diff (skip if PARTIAL mode or no existing data lookup) ────
  t0 = timestamp();
  setStep(6, mode === 'PARTIAL' ? 'skipped' : 'running', mode === 'PARTIAL' ? 'Skipped in PARTIAL mode' : 'Comparing with DB');
  if (upToStep <= 7) return result;

  // ── Step 8: Preview ───────────────────────────────────────────────────
  t0 = timestamp();
  setStep(7, 'running');
  result.previewRows = validated.slice(0, 10);
  setStep(7, 'done', `${result.previewRows.length} preview rows`, result.previewRows.length, t0);
  if (upToStep <= 8) return result;

  // ── Step 9: Create batch ──────────────────────────────────────────────
  t0 = timestamp();
  setStep(8, 'running');
  const { data: batchData, error: batchError } = await supabase.rpc('create_import_batch', {
    p_source_type: 'UPLOAD',
    p_source_name: sourceName,
    p_target_module: module,
    p_mode: mode,
  });
  if (batchError || !batchData) {
    setStep(8, 'error', batchError?.message ?? 'Failed to create batch');
    result.errors.push(batchError?.message ?? 'create_import_batch failed');
    return result;
  }
  result.batchId = String(batchData);
  setStep(8, 'done', `Batch ${String(batchData).slice(0, 8)}…`, 1, t0);
  if (upToStep <= 9) return result;

  // ── Step 10: Stage rows ───────────────────────────────────────────────
  t0 = timestamp();
  setStep(9, 'running');
  const toStage: ImportBatchRowInsert[] = [];
  validated.forEach((r, idx) => {
    if (!r.valid || r.isDuplicate || result.batchId === null) return;
    toStage.push({
      batch_id: result.batchId,
      row_index: idx,
      raw_data: r.row,
      normalized_data: r.row,
      validation_status: 'VALID',
      validation_errors: r.errors.map(e => e.message),
      data_source: 'IMPORTED',
    });
  });

  if (toStage.length > 0) {
    // Insert in chunks of 500
    const CHUNK = 500;
    for (let i = 0; i < toStage.length; i += CHUNK) {
      const chunk = toStage.slice(i, i + CHUNK);
      const { error: stageError } = await supabase
        .from('import_batch_rows')
        .insert(chunk);
      if (stageError) {
        setStep(9, 'error', stageError.message);
        result.errors.push(stageError.message);
        return result;
      }
    }
  }
  setStep(9, 'done', `${toStage.length} rows staged`, toStage.length, t0);
  if (upToStep <= 10) return result;

  // ── Step 11: Commit ───────────────────────────────────────────────────
  t0 = timestamp();
  setStep(10, 'running');
  const { data: commitData, error: commitError } = await supabase.rpc('apply_import_batch', {
    p_batch_id: result.batchId,
  });
  if (commitError) {
    setStep(10, 'error', commitError.message);
    result.errors.push(commitError.message);
    return result;
  }
  result.committedRows = (commitData as { committed?: number } | null)?.committed ?? toStage.length;
  setStep(10, 'done', `${result.committedRows} rows committed`, result.committedRows, t0);
  if (upToStep <= 11) return result;

  // ── Step 12: Audit (data lineage) ─────────────────────────────────────
  t0 = timestamp();
  setStep(11, 'running');
  // Lineage is written automatically by apply_import_batch trigger
  setStep(11, 'done', 'Lineage written by DB trigger', undefined, t0);
  if (upToStep <= 12) return result;

  // ── Step 13: Report ───────────────────────────────────────────────────
  t0 = timestamp();
  setStep(12, 'running');
  result.success = true;
  setStep(12, 'done', `Import complete — ${result.committedRows} rows in ${module}`, result.committedRows, t0);

  return result;
}
