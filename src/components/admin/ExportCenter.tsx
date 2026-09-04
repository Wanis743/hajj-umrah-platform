import { reportError, reportWarning } from '@/lib/logger';
import { useState } from 'react';
import { Download, FileSpreadsheet, FileJson, Printer, Table, Filter, Clock, CheckCircle2, RefreshCw } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { hasPermission, Role } from '@/lib/permissions';

import { ExportFormat, ExportScope, ExportModule } from './export/types';
import { EXPORT_MODULES } from './export/constants';


// ── Main Component ─────────────────────────────────────────────────────────

export function ExportCenter() {
  const { lang } = useI18n();
  const { staffProfile } = useAuth();
  const canExportPII = hasPermission(staffProfile?.role as Role, 'exports.pii');
  const canExport = hasPermission(staffProfile?.role as Role, 'exports.create');

  const isAr = lang === 'ar';
  const isFr = lang === 'fr';
  const t = (ar: string, fr: string, en: string) => (isAr ? ar : isFr ? fr : en);

  const [selectedModule, setSelectedModule] = useState<ExportModule>(EXPORT_MODULES[0]);
  const allowedFields = selectedModule.fields.filter(f => !f.sensitive || canExportPII);
  
  const [selectedFields, setSelectedFields] = useState<Set<string>>(
    new Set(allowedFields.map(f => f.key))
  );
  const [format, setFormat] = useState<ExportFormat>('CSV');
  const [scope] = useState<ExportScope>('ENTIRE_DATASET');
  const [exporting, setExporting] = useState(false);
  const [lastExport, setLastExport] = useState<{ filename: string; rows: number } | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  if (!canExport) return <div className="p-6">Unauthorized to access exports.</div>;

  const toggleField = (key: string) => {
    setSelectedFields(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        if (next.size > 1) next.delete(key); // keep at least 1
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const handleModuleChange = (mod: ExportModule) => {
    setSelectedModule(mod);
    const modAllowed = mod.fields.filter(f => !f.sensitive || canExportPII);
    setSelectedFields(new Set(modAllowed.map(f => f.key)));
  };

  const doExport = async () => {
    setExporting(true);
    setLastExport(null);
    try {
      const activeFields = allowedFields.filter(f => selectedFields.has(f.key));
      const timestamp = new Date().toISOString().slice(0, 10);
      const baseName = `${selectedModule.id}-${timestamp}`;

      if (format === 'CSV' || format === 'JSON') {
        const { data, error } = await supabase.functions.invoke('export-worker', {
          body: {
            module: selectedModule.table,
            dateFrom: dateFrom ? dateFrom : null,
            dateTo: dateTo ? dateTo : null,
            activeFields: activeFields,
            format: format,
          }
        });

        if (error) throw error;
        if (data?.error) throw new Error(data.error);

        const a = document.createElement('a');
        a.href = data.url;
        a.download = data.filename;
        a.click();
        
        setLastExport({ filename: data.filename, rows: data.rows });
      } else {
        let allRows: Record<string, unknown>[] = [];
        const { data, error } = await supabase.rpc('get_export_view', {
          p_module: selectedModule.table,
          p_date_from: dateFrom ? dateFrom : null,
          p_date_to: dateTo ? dateTo : null,
          p_limit: 1000,
          p_offset: 0
        });
        if (error) throw error;
        allRows = (data ?? []) as Record<string, unknown>[];

        if (format === 'PRINT') {
          handlePrint(allRows, activeFields);
        } else if (format === 'PDF') {
          reportWarning('PDF_NOT_IMPLEMENTED', { module: selectedModule.table });
        }

        const { error: auditError } = await supabase.rpc('log_export', {
          p_module: selectedModule.id,
          p_format: format,
          p_scope: scope,
          p_row_count: allRows.length,
          p_metadata: { source: 'client-fallback' },
        });

        if (auditError) {
          throw new Error('Audit logging failed. Export aborted.');
        }

        setLastExport({ filename: `${baseName}.${format.toLowerCase()}`, rows: allRows.length });
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      reportError('UI_ERROR', { error: String('Export failed: ' + msg) });
      const safeErrorMsg = isAr ? 'حدث خطأ أثناء التصدير. يرجى المحاولة لاحقاً.' : isFr ? 'Une erreur est survenue lors de l\'exportation. Veuillez réessayer.' : 'An error occurred during export. Please try again later.';
      alert(safeErrorMsg);
    } finally {
      setExporting(false);
    }
  };

  const escapeHtml = (unsafe: unknown): string => {
    if (unsafe == null) return '';
    return String(unsafe)
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
  };

  const handlePrint = (rows: Record<string, unknown>[], fields: { key: string; labelEn: string }[]) => {
    const html = `
      <!DOCTYPE html>
      <html dir="${isAr ? 'rtl' : 'ltr'}">
      <head>
        <meta charset="UTF-8">
        <title>${selectedModule.labelEn} Report</title>
        <style>
          body { font-family: Arial, sans-serif; font-size: 11px; direction: ${isAr ? 'rtl' : 'ltr'}; }
          h2 { text-align: center; margin-bottom: 8px; }
          .meta { text-align: center; color: #666; font-size: 10px; margin-bottom: 16px; }
          table { width: 100%; border-collapse: collapse; }
          th { background: #f0f0f0; border: 1px solid #ccc; padding: 6px 8px; font-weight: bold; }
          td { border: 1px solid #ddd; padding: 5px 8px; }
          tr:nth-child(even) { background: #f9f9f9; }
          @media print { body { margin: 0; } }
        </style>
      </head>
      <body>
        <h2>${t(selectedModule.labelAr, selectedModule.labelFr, selectedModule.labelEn)} — ${t('تقرير', 'Rapport', 'Report')}</h2>
        <div class="meta">${t('تاريخ الإنشاء', 'Généré le', 'Generated')}: ${new Date().toLocaleString()} | ${rows.length} ${t('سجل', 'enregistrements', 'records')}</div>
        <table>
          <thead><tr>${fields.map(f => `<th>${f.labelEn}</th>`).join('')}</tr></thead>
          <tbody>
            ${rows.map(row => `<tr>${fields.map(f => `<td>${escapeHtml(row[f.key]) || '—'}</td>`).join('')}</tr>`).join('\n')}
          </tbody>
        </table>
      </body>
      </html>
    `;
    const win = window.open('', '_blank');
    if (win) {
      win.document.write(html);
      win.document.close();
      win.print();
    }
  };

  // ── CSS helpers ────────────────────────────────────────────────────────
  const card = 'bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] p-5';
  const btn = 'inline-flex items-center gap-2 px-4 py-2 rounded-[var(--radius)] text-sm font-medium transition-all';
  const btnPrimary = `${btn} bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50`;
  const btnSecondary = `${btn} border border-[var(--border)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]`;

  return (
    <div className={`space-y-6 ${isAr ? 'rtl' : 'ltr'}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">
            {t('مركز التصدير', "Centre d'export", 'Export Center')}
          </h2>
          <p className="text-sm text-[var(--text-muted)] mt-0.5">
            {t('تصدير البيانات بصيغ متعددة مع فلاتر دقيقة', 'Exportez en CSV, JSON ou impression', 'Export data in multiple formats with precise filters')}
          </p>
        </div>
        <button onClick={() => setShowHistory(!showHistory)} className={btnSecondary}>
          <Clock className="h-4 w-4" />
          {t('سجل التصدير', "Historique d'export", 'Export History')}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Module + Format + Scope */}
        <div className="space-y-4">
          {/* Module */}
          <div className={card}>
            <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">
              {t('الوحدة', 'Module', 'Module')}
            </h3>
            <div className="space-y-1.5">
              {EXPORT_MODULES.map(mod => {
                const Icon = mod.icon;
                return (
                  <button
                    key={mod.id}
                    onClick={() => handleModuleChange(mod)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-[var(--radius)] text-sm transition-all ${
                      selectedModule.id === mod.id
                        ? 'bg-[var(--accent)] text-white'
                        : 'hover:bg-[var(--bg-hover)] text-[var(--text-primary)]'
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {t(mod.labelAr, mod.labelFr, mod.labelEn)}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Format */}
          <div className={card}>
            <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">
              {t('صيغة التصدير', "Format d'export", 'Export Format')}
            </h3>
            <div className="grid grid-cols-2 gap-2">
              {([
                { id: 'CSV', icon: Table, label: 'CSV' },
                { id: 'JSON', icon: FileJson, label: 'JSON' },
                { id: 'PRINT', icon: Printer, label: t('طباعة', 'Imprimer', 'Print') },
              ] as const).map(f => {
                const FIcon = f.icon;
                return (
                  <button
                    key={f.id}
                    onClick={() => setFormat(f.id as ExportFormat)}
                    className={`flex flex-col items-center gap-2 p-3 rounded-[var(--radius)] border-2 text-sm transition-all ${
                      format === f.id
                        ? 'border-[var(--accent)] bg-[var(--accent)]/5 text-[var(--accent)]'
                        : 'border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--accent)]/40'
                    }`}
                  >
                    <FIcon className="h-5 w-5" />
                    {f.label}
                  </button>
                );
              })}
              <div className="flex flex-col items-center gap-2 p-3 rounded-[var(--radius)] border-2 border-dashed border-[var(--border)] text-xs text-[var(--text-muted)] col-span-1">
                <FileSpreadsheet className="h-5 w-5 opacity-40" />
                <span>XLSX</span>
                <span className="text-[10px] opacity-60">{t('قريباً', 'Bientôt', 'Soon')}</span>
              </div>
            </div>
          </div>

          {/* Date filter */}
          <div className={card}>
            <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">
              <Filter className="h-4 w-4 inline mr-1" />
              {t('الفترة الزمنية', 'Période', 'Date Range')}
            </h3>
            <div className="space-y-2">
              <div>
                <label className="text-xs text-[var(--text-muted)] mb-1 block">{t('من', 'Du', 'From')}</label>
                <input type="date" className="input w-full" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-[var(--text-muted)] mb-1 block">{t('إلى', 'Au', 'To')}</label>
                <input type="date" className="input w-full" value={dateTo} onChange={e => setDateTo(e.target.value)} />
              </div>
            </div>
          </div>
        </div>

        {/* Right: Fields + Export */}
        <div className="lg:col-span-2 space-y-4">
          {/* Fields selection */}
          <div className={card}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                {t('الحقول المُصدَّرة', 'Champs à exporter', 'Fields to Export')}
              </h3>
              <div className="flex gap-2">
                <button
                  onClick={() => setSelectedFields(new Set(selectedModule.fields.map(f => f.key)))}
                  className="text-xs text-[var(--accent)] hover:underline"
                >
                  {t('تحديد الكل', 'Tout sélectionner', 'Select All')}
                </button>
                <button
                  onClick={() => setSelectedFields(new Set([selectedModule.fields[0].key]))}
                  className="text-xs text-[var(--text-muted)] hover:underline"
                >
                  {t('إلغاء الكل', 'Désélectionner', 'Clear All')}
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {selectedModule.fields.map(field => (
                <label
                  key={field.key}
                  className={`flex items-center gap-2 px-3 py-2 rounded-[var(--radius)] border cursor-pointer text-sm transition-all ${
                    selectedFields.has(field.key)
                      ? 'border-[var(--accent)] bg-[var(--accent)]/5 text-[var(--text-primary)]'
                      : 'border-[var(--border)] text-[var(--text-muted)]'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selectedFields.has(field.key)}
                    onChange={() => toggleField(field.key)}
                    className="accent-[var(--accent)]"
                  />
                  <span className="truncate">{t(field.labelAr, field.labelFr, field.labelEn)}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Export metadata preview */}
          <div className={`${card} border-dashed`}>
            <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">
              {t('معلومات ستُضاف إلى الملف', 'Métadonnées incluses', 'Metadata Included in Export')}
            </h3>
            <div className="text-xs text-[var(--text-muted)] font-mono space-y-1 bg-[var(--bg-hover)] rounded-[var(--radius)] p-3">
              <p>Module: {selectedModule.labelEn}</p>
              <p>Period: {dateFrom || 'All'} → {dateTo || 'Now'}</p>
              <p>Format: {format}</p>
              <p>Fields: {selectedFields.size} selected</p>
              <p>Generated: {new Date().toLocaleString()}</p>
            </div>
          </div>

          {/* Export button */}
          <button
            onClick={doExport}
            disabled={exporting}
            className={`${btnPrimary} w-full justify-center py-4 text-base`}
          >
            {exporting ? (
              <><RefreshCw className="h-5 w-5 animate-spin" />{t('جارٍ التصدير...', 'Export en cours...', 'Exporting...')}</>
            ) : (
              <><Download className="h-5 w-5" />{t(`تصدير ${selectedModule.labelAr}`, `Exporter ${selectedModule.labelFr}`, `Export ${selectedModule.labelEn}`)} ({format})</>
            )}
          </button>

          {/* Success message */}
          {lastExport && (
            <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-[var(--radius-lg)] text-green-700 text-sm">
              <CheckCircle2 className="h-5 w-5 shrink-0" />
              <div>
                <p className="font-medium">{t('تم التصدير بنجاح', 'Export réussi', 'Export Successful')}</p>
                <p className="text-xs text-green-600">{lastExport.filename} · {lastExport.rows.toLocaleString()} {t('سجل', 'enregistrements', 'records')}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Quick Export Shortcuts */}
      <div className={card}>
        <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">
          {t('تصدير سريع', 'Export rapide', 'Quick Export')}
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
          {EXPORT_MODULES.slice(0, 6).map(mod => {
            const Icon = mod.icon;
            return (
              <button
                key={mod.id}
                onClick={() => { handleModuleChange(mod); setFormat('CSV'); doExport(); }}
                disabled={exporting}
                className="flex flex-col items-center gap-2 p-3 rounded-[var(--radius)] border border-[var(--border)] hover:border-[var(--accent)]/50 hover:bg-[var(--bg-hover)] transition-all text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              >
                <Icon className="h-5 w-5" />
                <span className="text-xs">{t(mod.labelAr, mod.labelFr, mod.labelEn)}</span>
                <span className="text-[10px] text-[var(--accent)]">CSV</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default ExportCenter;


