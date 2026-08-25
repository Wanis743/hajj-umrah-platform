import { useState, useCallback, useRef } from 'react';
import { Upload, Clipboard, ChevronRight, ChevronLeft, CheckCircle2, AlertCircle, AlertTriangle, XCircle, X, Download, RefreshCw, Play, Eye, RotateCcw, ArrowRight, Database, GitMerge, Layers } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';

import { runImportPipeline } from '@/engine/import/importPipeline';
import { detectColumnMapping, FIELD_SCHEMAS } from '@/engine/import/mappingEngine';
import { validateBatch } from '@/engine/import/validator';
import {
  type ImportState, type ImportFormat, type ImportMode, type TargetModule,
  IMPORT_STEPS, MODULE_OPTIONS, INITIAL_IMPORT_STATE,
  parseCSV, parseJSON, buildErrorReportCsv, buildTemplateCsv, triggerDownload,
} from './importCenter/importTypes';

// ── Status helpers ────────────────────────────────────────────────────────
const STATUS_COLORS: Record<string, string> = {
  VALID: 'text-green-600 bg-green-50', WARNING: 'text-yellow-700 bg-yellow-50',
  ERROR: 'text-red-600 bg-red-50', DUPLICATE: 'text-blue-600 bg-blue-50',
  CONFLICT: 'text-orange-600 bg-orange-50', SKIPPED: 'text-gray-500 bg-gray-50',
};
const STATUS_ICONS: Record<string, JSX.Element> = {
  VALID:     <CheckCircle2  className="h-3.5 w-3.5" />,
  WARNING:   <AlertTriangle className="h-3.5 w-3.5" />,
  ERROR:     <XCircle       className="h-3.5 w-3.5" />,
  DUPLICATE: <Eye           className="h-3.5 w-3.5" />,
  CONFLICT:  <AlertCircle   className="h-3.5 w-3.5" />,
  SKIPPED:   <X             className="h-3.5 w-3.5" />,
};

// ── Component ─────────────────────────────────────────────────────────────
export function ImportCenter() {
  const { lang } = useI18n();
  const isAr = lang === 'ar' || lang === 'dz';
  const isFr = lang === 'fr';
  const t = (ar: string, fr: string, en: string) => (isAr ? ar : isFr ? fr : en);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef  = useRef<HTMLTextAreaElement>(null);
  const [state, setState] = useState<ImportState>(INITIAL_IMPORT_STATE);
  const update = (patch: Partial<ImportState>) => setState(prev => ({ ...prev, ...patch }));
  const currentStepIndex = IMPORT_STEPS.findIndex(s => s.id === state.step);

  // CSS helpers
  const card = 'bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] p-5';
  const btn  = 'inline-flex items-center gap-2 px-4 py-2 rounded-[var(--radius)] text-sm font-medium transition-all';
  const btnPrimary   = `${btn} bg-[var(--accent)] text-white hover:opacity-90`;
  const btnSecondary = `${btn} border border-[var(--border)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]`;

  // ── Parsing ──────────────────────────────────────────────────────────────
  const parseFile = useCallback((text: string, format: ImportFormat) => {
    const parsed = format === 'JSON' ? parseJSON(text) : parseCSV(text);
    if (parsed.rows.length === 0) { update({ error: t('لا توجد بيانات في الملف', 'Fichier vide ou invalide', 'File is empty or invalid') }); return; }
    const fields   = FIELD_SCHEMAS[state.targetModule] ?? [];
    const mappings = detectColumnMapping(parsed.headers, fields);
    update({ rawText: text, parsedRows: parsed.rows, sourceColumns: parsed.headers, columnMappings: mappings, step: 'DETECT', error: null });
  }, [state.targetModule]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const format: ImportFormat = file.name.endsWith('.json') ? 'JSON' : 'CSV';
    const reader = new FileReader();
    reader.onload = ev => parseFile(String(ev.target?.result ?? ''), format);
    reader.readAsText(file, 'UTF-8');
    update({ format });
  };
  const handleClipboard = async () => {
    try { const text = await navigator.clipboard.readText(); update({ format: 'CLIPBOARD' }); parseFile(text, 'CSV'); }
    catch { update({ error: t('تعذّر القراءة من الحافظة', 'Impossible de lire le presse-papier', 'Cannot read clipboard') }); }
  };

  // ── Validation ────────────────────────────────────────────────────────────
  const runValidation = useCallback(() => {
    const fields    = FIELD_SCHEMAS[state.targetModule] ?? [];
    const mappedRows = state.parsedRows.map(row => {
      const mapped: Record<string, unknown> = {};
      for (const m of state.columnMappings) if (m.targetField && m.confidence >= 50) mapped[m.targetField] = row[m.sourceColumn];
      return mapped;
    });
    const { results, summary } = validateBatch(mappedRows, { fields, mode: state.mode, duplicateKeyFields: ['passport_number'] });
    update({ validationResults: results, summary, step: 'PREVIEW' });
  }, [state.parsedRows, state.columnMappings, state.targetModule, state.mode]);

  // ── Execute ───────────────────────────────────────────────────────────────
  const executeImport = async () => {
    update({ executing: true, error: null });
    try {
      const result = await runImportPipeline({
        module: state.targetModule as unknown as import('../../engine/import/importPipeline').ImportModule,
        mode: state.mode as unknown as import('../../engine/import/importPipeline').ImportMode,
        sourceName: 'import',
        rawRows: state.parsedRows as unknown as import('../../engine/import/importPipeline').RawRow[],
        columnMapping: state.columnMappings as unknown as Record<string, string>,
        decision: state.decision as unknown as ('SKIP' | 'MERGE' | undefined),
        upToStep: 13
      });

      if (!result.success) {
        throw new Error(result.errors.join(', ') || 'Pipeline failed');
      }

      update({
        batchId: String(result.batchId), executed: true, executing: false, step: 'REPORT',
        executionReport: {
          created: result.committedRows,
          updated: 0,
          skipped: result.invalidRows + result.duplicateRows,
          errors: result.errors.length,
        },
      });
    } catch (e) {
      update({ executing: false, error: e instanceof Error ? e.message : 'Import failed' });
    }
  };

  // ── Downloads ─────────────────────────────────────────────────────────────
  const downloadErrorReport = () => triggerDownload(buildErrorReportCsv(state.validationResults), `import-errors-${Date.now()}.csv`);
  const downloadTemplate    = () => {
    const fields = FIELD_SCHEMAS[state.targetModule] ?? [];
    triggerDownload(buildTemplateCsv(fields), `template-${state.targetModule}.csv`);
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className={`space-y-6 ${isAr ? 'rtl' : 'ltr'}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">{t('مركز الاستيراد', "Centre d'import", 'Import Center')}</h2>
          <p className="text-sm text-[var(--text-muted)] mt-0.5">{t('استيراد البيانات من ملفات CSV, JSON أو لصق من Excel', 'Importez depuis CSV, JSON ou collez depuis Excel', 'Import from CSV, JSON or paste from Excel')}</p>
        </div>
        <button onClick={downloadTemplate} className={btnSecondary}><Download className="h-4 w-4" />{t('تحميل القالب', 'Télécharger modèle', 'Download Template')}</button>
      </div>

      {/* Step Indicator */}
      <div className="flex items-center gap-0 overflow-x-auto pb-2">
        {IMPORT_STEPS.map((step, i) => {
          const isActive = step.id === state.step, isDone = i < currentStepIndex;
          return (
            <div key={step.id} className="flex items-center">
              <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all ${isActive ? 'bg-[var(--accent)] text-white' : isDone ? 'bg-green-100 text-green-700' : 'bg-[var(--surface)] text-[var(--text-muted)] border border-[var(--border)]'}`}>
                {isDone ? <CheckCircle2 className="h-3 w-3" /> : <span className="h-3 w-3 rounded-full border border-current flex items-center justify-center text-[10px]">{i+1}</span>}
                {t(step.labelAr, step.labelFr, step.labelEn)}
              </div>
              {i < IMPORT_STEPS.length - 1 && <ArrowRight className={`h-3.5 w-3.5 mx-1 ${isAr ? 'rotate-180' : ''} ${isDone ? 'text-green-400' : 'text-[var(--text-muted)]'}`} />}
            </div>
          );
        })}
      </div>

      {/* Error banner */}
      {state.error && <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-[var(--radius-lg)] text-red-700 text-sm"><XCircle className="h-4 w-4 mt-0.5 shrink-0" /><span>{state.error}</span></div>}

      {/* ── STEP: UPLOAD ── */}
      {state.step === 'UPLOAD' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className={card}>
            <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-4">{t('إعدادات الاستيراد', "Paramètres d'import", 'Import Settings')}</h3>
            <div className="space-y-4">
              <div>
                <label className="text-xs text-[var(--text-muted)] mb-1.5 block">{t('الوحدة المستهدفة', 'Module cible', 'Target Module')}</label>
                <select className="input w-full" value={state.targetModule} onChange={e => update({ targetModule: e.target.value as TargetModule })}>
                  {MODULE_OPTIONS.map(m => <option key={m.id} value={m.id}>{t(m.ar, m.fr, m.en)}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-[var(--text-muted)] mb-1.5 block">{t('وضع الاستيراد', "Mode d'import", 'Import Mode')}</label>
                <div className="space-y-2">
                  {(['STRICT', 'PARTIAL', 'REVIEW'] as ImportMode[]).map(mode => (
                    <label key={mode} className={`flex items-start gap-3 p-3 rounded-[var(--radius)] border cursor-pointer transition-all ${state.mode === mode ? 'border-[var(--accent)] bg-[var(--accent)]/5' : 'border-[var(--border)]'}`}>
                      <input type="radio" name="mode" value={mode} checked={state.mode === mode} onChange={() => update({ mode })} className="mt-0.5" />
                      <div>
                        <div className="text-sm font-medium text-[var(--text-primary)]">
                          {mode === 'STRICT' ? t('صارم', 'Strict', 'Strict') : mode === 'PARTIAL' ? t('جزئي', 'Partiel', 'Partial') : t('مراجعة', 'Révision', 'Review')}
                        </div>
                        <div className="text-xs text-[var(--text-muted)]">
                          {mode === 'STRICT' ? t('أي خطأ يمنع الاستيراد', "Toute erreur bloque l'import", 'Any error blocks import')
                          : mode === 'PARTIAL' ? t('يستورد السجلات الصحيحة فقط', 'Importe uniquement les lignes valides', 'Imports valid rows only')
                          : t('لا شيء يُدخل قبل مراجعة كل تعارض', 'Rien importé avant révision', 'Nothing imported before review')}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>
          <div className={card}>
            <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-4">{t('طريقة الاستيراد', "Méthode d'import", 'Import Method')}</h3>
            <div className="space-y-3">
              <button onClick={() => fileInputRef.current?.click()} className="w-full flex flex-col items-center justify-center gap-3 p-6 border-2 border-dashed border-[var(--border)] rounded-[var(--radius-lg)] hover:border-[var(--accent)] hover:bg-[var(--accent)]/5 transition-all text-[var(--text-muted)] hover:text-[var(--accent)]">
                <Upload className="h-8 w-8" />
                <div className="text-sm font-medium">{t('اسحب الملف هنا أو انقر للاختيار', 'Glissez un fichier ou cliquez', 'Drag file here or click to choose')}</div>
                <div className="text-xs">CSV · JSON</div>
              </button>
              <input ref={fileInputRef} type="file" accept=".csv,.json,.txt" className="hidden" onChange={handleFileUpload} />
              <button onClick={handleClipboard} className={`${btnSecondary} w-full justify-center py-3`}><Clipboard className="h-4 w-4" />{t('لصق من Excel / الحافظة', 'Coller depuis Excel', 'Paste from Excel / Clipboard')}</button>
              <details className="text-sm">
                <summary className="cursor-pointer text-[var(--text-muted)] hover:text-[var(--text-primary)]">{t('إدخال نص مباشر', 'Saisie directe', 'Direct text input')}</summary>
                <textarea ref={textareaRef} className="input w-full mt-2 h-28 font-mono text-xs" placeholder="Name,Passport,Phone&#10;Ahmed,AA123456,0555000000" />
                <div className="flex gap-2 mt-2">
                  <select className="input flex-1" onChange={e => update({ format: e.target.value as ImportFormat })} defaultValue="CSV">
                    <option value="CSV">CSV</option><option value="JSON">JSON</option>
                  </select>
                  <button className={btnPrimary} onClick={() => { const text = textareaRef.current?.value ?? ''; update({ format: state.format ?? 'CSV' }); parseFile(text, state.format ?? 'CSV'); }}>{t('تحليل', 'Analyser', 'Parse')}</button>
                </div>
              </details>
            </div>
          </div>
        </div>
      )}

      {/* ── STEP: DETECT ── */}
      {state.step === 'DETECT' && (
        <div className={`${card} space-y-4`}>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">{t('نتائج الاكتشاف', 'Résultats de détection', 'Detection Results')}</h3>
            <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]"><Database className="h-4 w-4" />{state.parsedRows.length.toLocaleString()} {t('صف', 'lignes', 'rows')} · {state.sourceColumns.length} {t('عمود', 'colonnes', 'columns')}</div>
          </div>
          <div className="overflow-x-auto rounded-[var(--radius)] border border-[var(--border)]">
            <table className="w-full text-xs">
              <thead className="bg-[var(--bg-hover)]"><tr>{state.sourceColumns.slice(0, 8).map(col => <th key={col} className="px-3 py-2 text-start text-[var(--text-muted)] font-medium whitespace-nowrap">{col}</th>)}</tr></thead>
              <tbody>{state.parsedRows.slice(0, 3).map((row, i) => <tr key={i} className="border-t border-[var(--border)]">{state.sourceColumns.slice(0, 8).map(col => <td key={col} className="px-3 py-2 text-[var(--text-primary)] whitespace-nowrap max-w-[150px] truncate">{String(row[col] ?? '—')}</td>)}</tr>)}</tbody>
            </table>
          </div>
          <div className="flex justify-end gap-3">
            <button onClick={() => update({ step: 'UPLOAD' })} className={btnSecondary}><ChevronLeft className="h-4 w-4" />{t('رجوع', 'Retour', 'Back')}</button>
            <button onClick={() => update({ step: 'MAP' })} className={btnPrimary}>{t('التالي: التطابق', 'Suivant: Mapping', 'Next: Mapping')}<ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>
      )}

      {/* ── STEP: MAP ── */}
      {state.step === 'MAP' && (
        <div className={`${card} space-y-4`}>
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">{t('تطابق الأعمدة', 'Mapping des colonnes', 'Column Mapping')}</h3>
          <p className="text-xs text-[var(--text-muted)]">{t('راجع التطابق التلقائي وعدّل ما يلزم.', 'Vérifiez le mapping automatique et ajustez si nécessaire.', 'Review auto-mapping and adjust as needed.')}</p>
          <div className="space-y-2">
            {state.columnMappings.map((m, i) => {
              const fields = FIELD_SCHEMAS[state.targetModule] ?? [];
              return (
                <div key={m.sourceColumn} className={`flex items-center gap-3 p-3 rounded-[var(--radius)] border ${m.confidence >= 90 ? 'border-green-200 bg-green-50/50' : m.confidence >= 60 ? 'border-yellow-200 bg-yellow-50/50' : 'border-[var(--border)]'}`}>
                  <div className="flex-1 text-sm font-medium text-[var(--text-primary)]">{m.sourceColumn}</div>
                  <ArrowRight className={`h-4 w-4 text-[var(--text-muted)] shrink-0 ${isAr ? 'rotate-180' : ''}`} />
                  <select className="input flex-1 text-sm" value={m.targetField ?? ''} onChange={e => { const updated = [...state.columnMappings]; updated[i] = { ...m, targetField: e.target.value || null, matchReason: 'manual', confidence: 100 }; update({ columnMappings: updated }); }}>
                    <option value="">{t('— تجاهل —', '— Ignorer —', '— Skip —')}</option>
                    {fields.map(f => <option key={f.key} value={f.key}>{f.labelEn} ({f.labelAr})</option>)}
                  </select>
                  <div className={`text-xs px-2 py-0.5 rounded-full ${m.confidence >= 90 ? 'bg-green-100 text-green-700' : m.confidence >= 60 ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100 text-gray-500'}`}>{m.confidence}%</div>
                </div>
              );
            })}
          </div>
          <div className="flex justify-between">
            <button onClick={() => update({ step: 'DETECT' })} className={btnSecondary}><ChevronLeft className="h-4 w-4" />{t('رجوع', 'Retour', 'Back')}</button>
            <button onClick={runValidation} className={btnPrimary}>{t('تحقق وعاين', 'Valider et aperçu', 'Validate & Preview')}<ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>
      )}

      {/* ── STEP: PREVIEW ── */}
      {state.step === 'PREVIEW' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
            {[{ label: t('الإجمالي','Total','Total'), value: state.summary.total, color: 'text-[var(--text-primary)]' },
              { label: t('صحيح','Valide','Valid'), value: state.summary.valid, color: 'text-green-600' },
              { label: t('تحذيرات','Avertissements','Warnings'), value: state.summary.warnings, color: 'text-yellow-600' },
              { label: t('أخطاء','Erreurs','Errors'), value: state.summary.errors, color: 'text-red-600' },
              { label: t('تكرار','Doublons','Duplicates'), value: state.summary.duplicates, color: 'text-blue-600' },
              { label: t('تعارض','Conflits','Conflicts'), value: state.summary.conflicts, color: 'text-orange-600' },
            ].map(c => <div key={c.label} className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] p-4 text-center"><div className={`text-2xl font-bold ${c.color}`}>{c.value}</div><div className="text-xs text-[var(--text-muted)] mt-1">{c.label}</div></div>)}
          </div>
          <div className={`${card} space-y-3`}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">{t('معاينة الصفوف (أول 50)', 'Aperçu (50 premières lignes)', 'Row Preview (first 50)')}</h3>
              {(state.summary.errors > 0 || state.summary.warnings > 0) && <button onClick={downloadErrorReport} className={`${btnSecondary} text-xs`}><Download className="h-3.5 w-3.5" />{t('تحميل تقرير الأخطاء', 'Télécharger rapport erreurs', 'Download Error Report')}</button>}
            </div>
            <div className="overflow-x-auto rounded-[var(--radius)] border border-[var(--border)]">
              <table className="w-full text-xs">
                <thead className="bg-[var(--bg-hover)]"><tr><th className="px-3 py-2 text-start text-[var(--text-muted)] font-medium">#</th><th className="px-3 py-2 text-start text-[var(--text-muted)] font-medium">{t('الحالة','Statut','Status')}</th>{Object.keys(state.parsedRows[0] ?? {}).slice(0, 4).map(col => <th key={col} className="px-3 py-2 text-start text-[var(--text-muted)] font-medium">{col}</th>)}<th className="px-3 py-2 text-start text-[var(--text-muted)] font-medium">{t('ملاحظات','Notes','Notes')}</th></tr></thead>
                <tbody>{state.validationResults.slice(0, 50).map(result => <tr key={result.rowIndex} className="border-t border-[var(--border)]"><td className="px-3 py-2 text-[var(--text-muted)]">{result.rowIndex + 2}</td><td className="px-3 py-2"><span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[result.status] ?? ''}`}>{STATUS_ICONS[result.status]}{result.status}</span></td>{Object.keys(state.parsedRows[0] ?? {}).slice(0, 4).map(col => <td key={col} className="px-3 py-2 text-[var(--text-primary)] max-w-[120px] truncate">{String(state.parsedRows[result.rowIndex]?.[col] ?? '—')}</td>)}<td className="px-3 py-2 text-[var(--text-muted)]">{result.errors[0]?.message ?? result.warnings[0]?.message ?? '—'}</td></tr>)}</tbody>
              </table>
            </div>
          </div>
          <div className="flex justify-between">
            <button onClick={() => update({ step: 'MAP' })} className={btnSecondary}><ChevronLeft className="h-4 w-4" />{t('رجوع', 'Retour', 'Back')}</button>
            <button onClick={() => update({ step: 'DECISION' })} disabled={state.mode === 'STRICT' && state.summary.errors > 0} className={btnPrimary}>{t('التالي: القرار', 'Suivant: Décision', 'Next: Decision')}<ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>
      )}

      {/* ── STEP: DECISION ── */}
      {state.step === 'DECISION' && (
        <div className={`${card} space-y-6`}>
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">{t('كيف تريد معالجة هذه البيانات؟', 'Comment traiter ces données?', 'How to process this data?')}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <button onClick={() => update({ decision: 'MERGE' })} className={`flex flex-col gap-3 p-5 rounded-[var(--radius-lg)] border-2 text-start transition-all ${state.decision === 'MERGE' ? 'border-[var(--accent)] bg-[var(--accent)]/5' : 'border-[var(--border)] hover:border-[var(--accent)]/50'}`}>
              <GitMerge className="h-8 w-8 text-[var(--accent)]" />
              <div><div className="text-sm font-semibold text-[var(--text-primary)]">{t('دمج مع البيانات الحالية', 'Fusionner avec les données', 'Merge with Existing Data')}</div><div className="text-xs text-[var(--text-muted)] mt-1">{t(`${state.summary.valid} سجل جديد، ${state.summary.duplicates} تكرار`, `${state.summary.valid} nouveaux, ${state.summary.duplicates} doublons`, `${state.summary.valid} new records, ${state.summary.duplicates} duplicates`)}</div></div>
            </button>
            <button onClick={() => update({ decision: 'SEPARATE_DATASET' })} className={`flex flex-col gap-3 p-5 rounded-[var(--radius-lg)] border-2 text-start transition-all ${state.decision === 'SEPARATE_DATASET' ? 'border-[var(--accent)] bg-[var(--accent)]/5' : 'border-[var(--border)] hover:border-[var(--accent)]/50'}`}>
              <Layers className="h-8 w-8 text-indigo-500" />
              <div><div className="text-sm font-semibold text-[var(--text-primary)]">{t('مجموعة بيانات منفصلة', 'Ensemble de données séparé', 'Separate Dataset')}</div><div className="text-xs text-[var(--text-muted)] mt-1">{t('تحليل مستقل دون تغيير البيانات التشغيلية', 'Analyse indépendante sans modifier les données', 'Independent analysis without affecting live data')}</div></div>
            </button>
          </div>
          {state.decision === 'SEPARATE_DATASET' && <input className="input w-full" placeholder={t('اسم مجموعة البيانات', 'Nom du jeu de données', 'Dataset name')} value={state.datasetName} onChange={e => update({ datasetName: e.target.value })} />}
          <div className="flex justify-between">
            <button onClick={() => update({ step: 'PREVIEW' })} className={btnSecondary}><ChevronLeft className="h-4 w-4" />{t('رجوع', 'Retour', 'Back')}</button>
            <button onClick={() => update({ step: 'EXECUTE' })} disabled={!state.decision} className={btnPrimary}>{t('التالي: تنفيذ', 'Suivant: Exécution', 'Next: Execute')}<ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>
      )}

      {/* ── STEP: EXECUTE ── */}
      {state.step === 'EXECUTE' && (
        <div className={`${card} space-y-6 text-center`}>
          <div className="max-w-md mx-auto space-y-4">
            <Database className="h-12 w-12 text-[var(--accent)] mx-auto" />
            <h3 className="text-base font-semibold text-[var(--text-primary)]">{t('جاهز للتنفيذ', 'Prêt à importer', 'Ready to Import')}</h3>
            <div className="text-sm text-[var(--text-muted)] space-y-1">
              <p>{t('الوحدة','Module','Module')}: <strong>{state.targetModule}</strong></p>
              <p>{t('الوضع','Mode','Mode')}: <strong>{state.mode}</strong></p>
              <p>{t('القرار','Décision','Decision')}: <strong>{state.decision}</strong></p>
              <p>{t('الصفوف المستهدفة','Lignes à importer','Target rows')}: <strong>{state.summary.valid + state.summary.warnings}</strong></p>
            </div>
            <div className="flex gap-3 justify-center pt-2">
              <button onClick={() => update({ step: 'DECISION' })} className={btnSecondary}><ChevronLeft className="h-4 w-4" />{t('رجوع', 'Retour', 'Back')}</button>
              <button onClick={executeImport} disabled={state.executing} className={`${btnPrimary} min-w-[140px] justify-center`}>
                {state.executing ? <><RefreshCw className="h-4 w-4 animate-spin" />{t('جاري الاستيراد...', 'Import en cours...', 'Importing...')}</> : <><Play className="h-4 w-4" />{t('تنفيذ الاستيراد', "Lancer l'import", 'Execute Import')}</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── STEP: REPORT ── */}
      {state.step === 'REPORT' && state.executionReport && (
        <div className={`${card} space-y-6`}>
          <div className="flex items-center gap-3">
            <CheckCircle2 className="h-8 w-8 text-green-500" />
            <div><h3 className="text-base font-semibold text-[var(--text-primary)]">{t('اكتمل الاستيراد بنجاح', 'Import terminé avec succès', 'Import Completed Successfully')}</h3><p className="text-xs text-[var(--text-muted)]">{t('معرف الدفعة','ID lot','Batch ID')}: {state.batchId}</p></div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[{ label: t('تم إنشاؤها','Créés','Created'), value: state.executionReport.created, color: 'text-green-600' },
              { label: t('تم تحديثها','Mis à jour','Updated'), value: state.executionReport.updated, color: 'text-blue-600' },
              { label: t('تم تخطيها','Ignorés','Skipped'), value: state.executionReport.skipped, color: 'text-gray-500' },
              { label: t('أخطاء','Erreurs','Errors'), value: state.executionReport.errors, color: 'text-red-500' },
            ].map(item => <div key={item.label} className="bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] p-4 text-center"><div className={`text-2xl font-bold ${item.color}`}>{item.value}</div><div className="text-xs text-[var(--text-muted)] mt-1">{item.label}</div></div>)}
          </div>
          {state.executionReport.errors > 0 && <button onClick={downloadErrorReport} className={`${btnSecondary} w-full justify-center`}><Download className="h-4 w-4" />{t('تحميل تقرير الأخطاء الكامل', 'Télécharger rapport complet', 'Download Full Error Report')}</button>}
          <button onClick={() => setState(prev => ({ ...prev, ...INITIAL_IMPORT_STATE, targetModule: prev.targetModule, mode: prev.mode }))} className={`${btnPrimary} w-full justify-center`}><RotateCcw className="h-4 w-4" />{t('استيراد جديد', 'Nouvel import', 'New Import')}</button>
        </div>
      )}
    </div>
  );
}

export default ImportCenter;
