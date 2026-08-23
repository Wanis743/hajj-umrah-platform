import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { reportError } from '@/lib/logger';
import type { DashboardSnapshot, DashboardAnalyticsSnapshot } from '@/types/dashboard';

export interface Fin {
  totalRevDzd:number; totalRevSar:number; collectedDzd:number;
  pendingDzd:number; expensesDzd:number; netProfitDzd:number;
  pilgrimCount:number; confirmedCount:number; pendingCount:number; cancelledCount:number;
  avgPerPilgrim:number; collectionRate:number; monthlyGrowth:number;
  revenueByMonth:{m:string;rev:number;exp:number;profit:number}[];
  payMethods:{method:string;dzd:number;count:number}[];
  arAging:{label:string;dzd:number}[];
  journalEntries:{date:string;ref:string;debit:string;credit:string;dzd:number;desc:string}[];
}

export async function fetchFin(snapshot: DashboardSnapshot | null, analyticsSnapshot: DashboardAnalyticsSnapshot | null): Promise<Fin> {
  const { data: jeData } = await supabase.rpc('get_recent_journal_entries', { limit_rows: 50 });
  const je = (jeData as Record<string, unknown>[] ?? []).map(r => {
    // Map new nested RPC structure to UI expectations
    const lines: Record<string, unknown>[] = (r.lines as Record<string, unknown>[]) || [];
    const debits = lines.filter(l => Number(l.debit) > 0).map(l => l.account_code).join(', ');
    const credits = lines.filter(l => Number(l.credit) > 0).map(l => l.account_code).join(', ');
    
    return {
      date: String(r.entry_date || (r.created_at ? new Date(String(r.created_at || '')).toISOString().split('T')[0] : '')),
      ref: String(r.reference || ''),
      debit: debits || '-',
      credit: credits || '-',
      dzd: Number(r.total_debit) || 0, // In balanced entry, total_debit == total_credit
      desc: String(r.description || '')
    };
  });

  if (!snapshot || !analyticsSnapshot) {
    return {
      totalRevDzd:0, totalRevSar:0, collectedDzd:0, pendingDzd:0, expensesDzd:0, netProfitDzd:0,
      pilgrimCount:0, confirmedCount:0, pendingCount:0, cancelledCount:0,
      avgPerPilgrim:0, collectionRate:0, monthlyGrowth:0,
      revenueByMonth:[], payMethods:[], arAging:[], journalEntries:je
    };
  }

  const m: Fin = {
    totalRevDzd: snapshot.executive.revenue_dzd,
    totalRevSar: snapshot.executive.revenue_sar,
    collectedDzd: snapshot.executive.collected_dzd,
    pendingDzd: snapshot.executive.revenue_dzd - snapshot.executive.collected_dzd,
    expensesDzd: snapshot.executive.expenses_dzd,
    netProfitDzd: snapshot.executive.net_profit_dzd,
    pilgrimCount: snapshot.executive.pilgrims,
    confirmedCount: snapshot.executive.bookings_confirmed,
    pendingCount: snapshot.executive.bookings_total - snapshot.executive.bookings_confirmed,
    cancelledCount: 0, // Not explicitly tracked in executive snapshot
    avgPerPilgrim: snapshot.executive.pilgrims > 0 ? snapshot.executive.collected_dzd / snapshot.executive.pilgrims : 0,
    collectionRate: snapshot.executive.revenue_dzd > 0 ? (snapshot.executive.collected_dzd / snapshot.executive.revenue_dzd) * 100 : 0,
    monthlyGrowth: (() => {
  if (analyticsSnapshot && analyticsSnapshot.series.cash_collections && analyticsSnapshot.series.cash_collections.length >= 2) {
    const len = analyticsSnapshot.series.cash_collections.length;
    const last = analyticsSnapshot.series.cash_collections[len-1].amount;
    const prev = analyticsSnapshot.series.cash_collections[len-2].amount;
    if (prev > 0) return Math.round(((last - prev) / prev) * 100);
  }
  return 0;
})(),
    revenueByMonth: [], // Populated below from authoritative source
    payMethods: analyticsSnapshot.series.payment_methods.map((p: Record<string, unknown>) => ({ method: String(p.method), dzd: Number(p.count), count: Number(p.count) })), // The series has count, not amount. But ok for chart.
    arAging: [
      { label: "الحالي", dzd: snapshot.ar_aging.current_dzd },
      { label: "1-7 أيام", dzd: snapshot.ar_aging["1_7_dzd"] },
      { label: "8-30 يوم", dzd: snapshot.ar_aging["8_30_dzd"] },
      { label: "31-60 يوم", dzd: snapshot.ar_aging["31_60_dzd"] },
      { label: "+60 يوم", dzd: snapshot.ar_aging["60_plus_dzd"] }
    ],
    journalEntries: je
  };

  const { data: accSeries } = await supabase.rpc('get_accounting_series', { p_currency_code: 'DZD' });
  if (accSeries) {
    m.revenueByMonth = accSeries as {m:string;rev:number;exp:number;profit:number}[];
  }

  const { data: paySeries } = await supabase.rpc('get_payment_methods_series', { p_currency_code: 'DZD' });
  if (paySeries) {
    m.payMethods = paySeries as {method:string;dzd:number;count:number}[];
  }

  return m;
}



export function useAccountingData(snapshot: DashboardSnapshot | null, analyticsSnapshot: DashboardAnalyticsSnapshot | null) {
  const [data, setData] = useState<Fin | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [updAt, setUpdAt] = useState<Date | null>(null);
  const abort = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setError('not_configured');
      setLoading(false);
      return;
    }
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setLoading(true);
    setError(null);
    try {
      const d = await fetchFin(snapshot, analyticsSnapshot);
      if (ctrl.signal.aborted) return;
      setData(d);
      setUpdAt(new Date());
      setReady(true);
    } catch (e) {
      if (ctrl.signal.aborted) return;
      setError('fetch_failed');
      reportError('UI_ERROR', { error: String(e) });
    } finally {
      if (!ctrl.signal.aborted) setLoading(false);
    }
  }, [snapshot, analyticsSnapshot]);

  useEffect(() => {
    void load();
    return () => { abort.current?.abort(); };
  }, [load]);

  return { data, loading, error, ready, updAt, load };
}
