import React from 'react';
import { Spinner } from '@/components/admin/ui';
import { FileBarChart, ChevronUp, ChevronDown, ChevronsLeft, ChevronsRight, ChevronLeft, ChevronRight } from 'lucide-react';

/** Column contract shared with ReportBuilder/index.tsx (badge renders CSS classes for a cell value). */
export interface ReportColumn {
  id: string;
  label: string;
  numeric?: boolean;
  badge?: (value: string) => string;
}

type ReportTableProps = {
  t: (ar: string, fr: string, en: string) => string;
  colLabel: (c: { id: string; label: string }) => string;
  loading: boolean;
  rows: Record<string, unknown>[];
  cols: ReportColumn[];
  pageRows: Record<string, unknown>[];
  handleSort: (k: string) => void;
  sortKey: string | null;
  sortDir: 'asc' | 'desc';
  measures: { id: string; label: string }[];
  page: number;
  setPage: (v: number) => void;
  totalPages: number;
};
export const ReportTable = React.memo(function ReportTable({
  t, colLabel, loading, rows, cols, pageRows, handleSort, sortKey, sortDir, measures, page, setPage, totalPages
}: ReportTableProps) {
  const SortIcon = ({ k }: { k: string }) =>
    sortKey === k
      ? (sortDir === 'asc' ? <ChevronUp className="h-3 w-3 inline" /> : <ChevronDown className="h-3 w-3 inline" />)
      : <span className="h-3 w-3 inline-block opacity-0 group-hover:opacity-40"><ChevronUp className="h-3 w-3" /></span>;

  return (
    <div className="card overflow-hidden">
      {loading ? (
        <div className="p-10 flex justify-center"><Spinner /></div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-[var(--text-muted)]">
          <FileBarChart className="w-12 h-12 mb-3 opacity-20" />
          <p>{t('لا توجد بيانات', 'Aucune donnée', 'No data in range')}</p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[var(--bg-hover)] text-[var(--text-muted)] border-b border-[var(--border)]">
                <tr>
                  {cols.map((c: ReportColumn) => (
                    <th
                      key={c.id}
                      className="group px-4 py-3 font-semibold text-start whitespace-nowrap cursor-pointer hover:text-[var(--text-primary)] select-none"
                      onClick={() => handleSort(c.id)}
                    >
                      {colLabel(c)} <SortIcon k={c.id} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {pageRows.map((r: Record<string, unknown>, idx: number) => (
                  <tr key={String(r['id'] ?? idx)} className="hover:bg-[var(--bg-hover)]/50 transition-colors">
                    {cols.map((c: ReportColumn) => {
                      const val = (r[c.id] as string | number);
                      const display = typeof val === 'number' ? val.toLocaleString() : String(val ?? '—');
                      return (
                        <td key={c.id} className="px-4 py-2.5 whitespace-nowrap text-[var(--text-secondary)]">
                          {c.badge ? (
                            <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${c.badge(String(val))}`}>
                              {display}
                            </span>
                          ) : (
                            <span className={c.numeric ? 'font-mono tabular-nums' : ''}>{display}</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-[var(--bg-hover)]/50 border-t border-[var(--border)] text-xs text-[var(--text-muted)]">
            <div className="flex gap-4 font-medium">
              <span>{t('السجلات:', 'Enregistrements:', 'Records:')} <strong>{rows.length.toLocaleString()}</strong></span>
              {(measures as unknown as Record<string, number>).sumDzd > 0 && <span>DZD: <strong>{(measures as unknown as Record<string, number>).sumDzd.toLocaleString()}</strong></span>}
              {(measures as unknown as Record<string, number>).sumSar > 0 && <span>SAR: <strong>{(measures as unknown as Record<string, number>).sumSar.toLocaleString()}</strong></span>}
              {(measures as unknown as Record<string, number>).travelers > 0 && <span>{t('مسافرون:', 'Voyageurs:', 'Travelers:')} <strong>{(measures as unknown as Record<string, number>).travelers.toLocaleString()}</strong></span>}
            </div>
            {totalPages > 1 && (
              <div className="flex items-center gap-1">
                <button onClick={() => setPage(1)} disabled={page === 1} className="p-1 rounded hover:bg-[var(--bg-hover)] disabled:opacity-30" title={t('الأولى', 'Première', 'First')} aria-label={t('الصفحة الأولى', 'Première page', 'First page')}><ChevronsLeft className="h-4 w-4" /></button>
                <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1} className="p-1 rounded hover:bg-[var(--bg-hover)] disabled:opacity-30" title={t('السابقة', 'Précédente', 'Previous')} aria-label={t('الصفحة السابقة', 'Page précédente', 'Previous page')}><ChevronLeft className="h-4 w-4" /></button>
                <span className="px-2">{page} / {totalPages}</span>
                <button onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page === totalPages} className="p-1 rounded hover:bg-[var(--bg-hover)] disabled:opacity-30" title={t('التالية', 'Suivante', 'Next')} aria-label={t('الصفحة التالية', 'Page suivante', 'Next page')}><ChevronRight className="h-4 w-4" /></button>
                <button onClick={() => setPage(totalPages)} disabled={page === totalPages} className="p-1 rounded hover:bg-[var(--bg-hover)] disabled:opacity-30" title={t('الأخيرة', 'Dernière', 'Last')} aria-label={t('الصفحة الأخيرة', 'Dernière page', 'Last page')}><ChevronsRight className="h-4 w-4" /></button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
});
