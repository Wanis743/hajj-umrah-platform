import React, { useState, useCallback } from 'react';
import { useI18n } from '@/i18n/I18nProvider';
import { supabase } from '@/lib/supabase';
import { useEffect } from 'react';
import {
  Users, TrendingUp, AlertTriangle, Download, CheckCircle2,
  RefreshCw, ChevronDown, ChevronUp, Plane, Hotel,
  CreditCard, BadgeCheck, Truck,
} from 'lucide-react';
import { Spinner } from '@/components/admin/ui';

// ── Types ──────────────────────────────────────────────────────────────────

interface GroupOpsRow {
  group_id: string;
  code: string | null;
  group_status: string | null;
  departure_date: string | null;
  total_members: number;
  visa_done: number;
  payment_done: number;
  ext_ops_completed: number;
  ext_ops_total: number;
  hotel_allocated: number;
  transport_assigned: number;
  readiness_score: number | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function ProgressBar({
  value,
  total,
  color = 'bg-[var(--accent)]',
}: {
  value: number;
  total: number;
  color?: string;
}) {
  const pct = total === 0 ? 0 : Math.min(100, Math.round((value / total) * 100));
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-[var(--bg-hover)]">
        <div className={`h-1.5 rounded-full transition-all duration-500 ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-[10px] font-semibold w-8 text-end ${
        pct === 100 ? 'text-emerald-600' : pct >= 75 ? 'text-amber-600' : 'text-rose-600'
      }`}>{pct}%</span>
    </div>
  );
}

function ReadinessBadge({ score }: { score: number }) {
  const cls =
    score >= 90 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' :
    score >= 75 ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' :
    'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400';
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold ${cls}`}>
      {score >= 90 ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
      {score}%
    </span>
  );
}

// ── Export Manifest ────────────────────────────────────────────────────────

function exportGroupManifest(group: GroupOpsRow, lang: string) {
  const isAr = lang === 'ar' || lang === 'dz';
  const rows = [
    ['Group Code', group.code ?? group.group_id],
    ['Departure Date', group.departure_date ?? '—'],
    ['Status', group.group_status ?? '—'],
    ['Total Members', String(group.total_members)],
    ['Visa Complete', `${group.visa_done}/${group.total_members}`],
    ['Payment Complete', `${group.payment_done}/${group.total_members}`],
    ['Hotel Allocated', `${group.hotel_allocated}/${group.total_members}`],
    ['Transport Assigned', `${group.transport_assigned}/${group.total_members}`],
    ['Ext. Ops Completed', `${group.ext_ops_completed}/${group.ext_ops_total || group.total_members}`],
    ['Overall Readiness', `${group.readiness_score ?? 0}%`],
  ];

  const csv = rows.map(r => `"${r[0]}","${r[1]}"`).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `group-manifest-${group.code ?? group.group_id}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ── Main Component ─────────────────────────────────────────────────────────

export function GroupOperationsCenter() {
  const { lang } = useI18n();
  const isAr = lang === 'ar' || lang === 'dz';
  const isFr = lang === 'fr';
  const t = (ar: string, fr: string, en: string) => (isAr ? ar : isFr ? fr : en);

  const [groups, setGroups] = useState<GroupOpsRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [sortBy, setSortBy] = useState<'readiness' | 'departure' | 'size'>('readiness');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('group_operations_summary' as never)
        .select('*');
      if (!error && data) {
        setGroups(data as GroupOpsRow[]);
      } else {
        // Fallback to groups table when view doesn't exist
        const { data: fallback } = await supabase
          .from('groups' as never)
          .select('id,code,name,name_ar,departure_date,return_date,max_capacity,current_capacity,readiness_score,status,readiness_details,guide_id')
          .order('departure_date', { ascending: true });
        if (fallback) setGroups(fallback as GroupOpsRow[]);
      }
    } catch {
      // Non-fatal — component shows empty state
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const sorted = [...groups].sort((a, b) => {
    if (sortBy === 'readiness') return (a.readiness_score ?? 0) - (b.readiness_score ?? 0);
    if (sortBy === 'departure') return (a.departure_date ?? '').localeCompare(b.departure_date ?? '');
    return b.total_members - a.total_members;
  });

  const atRisk = groups.filter(g => (g.readiness_score ?? 0) < 75).length;
  const ready = groups.filter(g => (g.readiness_score ?? 0) >= 90).length;

  if (loading) return <Spinner className="p-10" />;

  return (
    <div className={`space-y-5 ${isAr ? 'rtl' : 'ltr'}`}>

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <TrendingUp className="w-5 h-5 text-[var(--accent)]" />
          <h2 className="text-xl font-bold text-[var(--text-primary)]">
            {t('مركز تحكم المجموعات', 'Centre de contrôle groupes', 'Group Operations Control')}
          </h2>
        </div>
        <button
          onClick={() => void load()}
          className="btn btn-sm inline-flex items-center gap-1.5"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          {t('تحديث', 'Actualiser', 'Refresh')}
        </button>
      </div>

      {/* ── Summary Cards ── */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: t('إجمالي الأفواج', 'Total groupes', 'Total Groups'), value: groups.length, color: 'text-[var(--text-primary)]' },
          { label: t('جاهزة ≥90%', 'Prêts ≥90%', 'Ready ≥90%'), value: ready, color: 'text-emerald-600' },
          { label: t('معرضة للخطر <75%', 'À risque <75%', 'At Risk <75%'), value: atRisk, color: 'text-rose-600' },
        ].map(item => (
          <div key={item.label} className="card p-4 text-center">
            <p className={`text-2xl font-bold ${item.color}`}>{item.value}</p>
            <p className="text-xs text-[var(--text-muted)] mt-1">{item.label}</p>
          </div>
        ))}
      </div>

      {/* ── Sort Controls ── */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-[var(--text-muted)]">{t('ترتيب حسب', 'Trier par', 'Sort by')}:</span>
        {[
          { id: 'readiness' as const, label: t('الجاهزية', 'Préparation', 'Readiness') },
          { id: 'departure' as const, label: t('المغادرة', 'Départ', 'Departure') },
          { id: 'size' as const, label: t('الحجم', 'Taille', 'Size') },
        ].map(opt => (
          <button
            key={opt.id}
            onClick={() => setSortBy(opt.id)}
            className={`px-3 py-1 rounded-full text-xs transition-colors ${
              sortBy === opt.id
                ? 'bg-[var(--accent)] text-white'
                : 'bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* ── Groups List ── */}
      {groups.length === 0 ? (
        <div className="card p-10 text-center text-[var(--text-secondary)]">
          <Users className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p>{t('لا توجد مجموعات', 'Aucun groupe', 'No groups found')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sorted.map(g => {
            const total = g.total_members;
            const score = g.readiness_score ?? 0;
            const isExpanded = expanded.has(g.group_id);

            const dimensions = [
              { icon: BadgeCheck, label: t('تأشيرة', 'Visa', 'Visa'), done: g.visa_done, total },
              { icon: CreditCard, label: t('الدفع', 'Paiement', 'Payment'), done: g.payment_done, total },
              { icon: Hotel, label: t('فندق', 'Hôtel', 'Hotel'), done: g.hotel_allocated, total },
              { icon: Truck, label: t('نقل', 'Transport', 'Transport'), done: g.transport_assigned, total },
              { icon: Plane, label: t('عمليات خارجية', 'Op. ext.', 'Ext. Ops'), done: g.ext_ops_completed, total: g.ext_ops_total || total },
            ];

            return (
              <div
                key={g.group_id}
                className={`card overflow-hidden transition-all ${score < 75 ? 'border-amber-200 dark:border-amber-800' : ''}`}
              >
                {/* Group header — always visible */}
                <div className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-3 min-w-0">
                    {score < 75 && <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-[var(--text-primary)]">
                          {g.code ?? g.group_id.slice(0, 8)}
                        </span>
                        {g.departure_date && (
                          <span className="text-xs text-[var(--text-muted)]">
                            ✈ {g.departure_date}
                          </span>
                        )}
                        <span className="text-xs bg-[var(--bg-hover)] px-2 py-0.5 rounded-full text-[var(--text-muted)]">
                          {total} {t('حاج', 'pèlerin', 'pilgrim')}{total !== 1 ? (isAr ? 'اً' : 's') : ''}
                        </span>
                        {g.group_status && (
                          <span className="text-xs bg-[var(--bg-hover)] px-2 py-0.5 rounded-full text-[var(--text-muted)]">
                            {g.group_status}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <ReadinessBadge score={score} />
                    <button
                      onClick={() => exportGroupManifest(g, lang)}
                      className="btn btn-sm p-1.5"
                      title={t('تصدير بيان', 'Exporter manifeste', 'Export Manifest')}
                    >
                      <Download className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => toggleExpand(g.group_id)}
                      className="btn btn-sm p-1.5"
                    >
                      {isExpanded
                        ? <ChevronUp className="h-3.5 w-3.5" />
                        : <ChevronDown className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>

                {/* Quick progress bars — always visible */}
                <div className="px-4 pb-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
                  {dimensions.map(dim => (
                    <div key={dim.label} className="space-y-0.5">
                      <div className="flex justify-between items-center text-[11px]">
                        <div className="flex items-center gap-1 text-[var(--text-muted)]">
                          <dim.icon className="h-3 w-3" />
                          {dim.label}
                        </div>
                        <span className="text-[var(--text-primary)] font-medium">{dim.done}/{dim.total}</span>
                      </div>
                      <ProgressBar
                        value={dim.done}
                        total={dim.total}
                        color={
                          dim.done === dim.total ? 'bg-emerald-500' :
                          (dim.done / (dim.total || 1)) >= 0.75 ? 'bg-amber-500' :
                          'bg-rose-500'
                        }
                      />
                    </div>
                  ))}
                </div>

                {/* Expanded detail — checklist view */}
                {isExpanded && (
                  <div className="border-t border-[var(--border)] bg-[var(--bg-hover)]/50 px-4 py-4 space-y-3">
                    <h4 className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider">
                      {t('تفاصيل الجاهزية', 'Détails préparation', 'Readiness Detail')}
                    </h4>
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                      {dimensions.map(dim => {
                        const pct = dim.total === 0 ? 0 : Math.round((dim.done / dim.total) * 100);
                        return (
                          <div key={dim.label} className="rounded-lg bg-[var(--surface)] p-3 text-center">
                            <dim.icon className={`h-5 w-5 mx-auto mb-1 ${pct === 100 ? 'text-emerald-500' : pct >= 75 ? 'text-amber-500' : 'text-rose-500'}`} />
                            <p className="text-xs font-medium text-[var(--text-primary)]">{dim.label}</p>
                            <p className={`text-lg font-bold mt-1 ${pct === 100 ? 'text-emerald-600' : pct >= 75 ? 'text-amber-600' : 'text-rose-600'}`}>
                              {pct}%
                            </p>
                            <p className="text-[10px] text-[var(--text-muted)]">{dim.done}/{dim.total}</p>
                          </div>
                        );
                      })}
                    </div>

                    {/* Export button in expanded view */}
                    <div className="flex justify-end">
                      <button
                        onClick={() => exportGroupManifest(g, lang)}
                        className="btn btn-sm inline-flex items-center gap-1.5"
                      >
                        <Download className="h-3.5 w-3.5" />
                        {t('تصدير بيان الفوج (CSV)', 'Exporter manifeste (CSV)', 'Export Group Manifest (CSV)')}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
