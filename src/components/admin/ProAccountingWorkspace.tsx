import React, { useState } from 'react';
import { RefreshCw, Clock, Activity, AlertTriangle, Landmark } from 'lucide-react';
import type { DashboardSnapshot, DashboardFilters, DashboardAnalyticsSnapshot } from '@/types/dashboard';

import { useAccountingData } from './accounting/model/useAccountingData';
import { TABS, type TabId, glass } from './accounting/widgets/Shared';
import {
  OverviewTab, IncomeTab, CashFlowTab, AgingTab, RatiosTab,
  MarginTab, ProjectionTab, TaxTab, LoanTab, BepTab, BudgetTab, JournalTab
} from './accounting/widgets/Tabs';

export default function ProAccountingWorkspace({ snapshot, analyticsSnapshot }: { filters: DashboardFilters; snapshot: DashboardSnapshot | null; analyticsSnapshot: DashboardAnalyticsSnapshot | null }) {
  const [tab, setTab] = useState<TabId>('overview');

  const { data, loading, error, ready, updAt, load } = useAccountingData(snapshot, analyticsSnapshot);

  if (loading && !ready) {
    return (
      <div className='space-y-4 p-2'>
        <div className='grid grid-cols-2 lg:grid-cols-4 gap-4'>
          {[1,2,3,4].map(i => <div key={i} className='h-28 skeleton rounded-2xl'/>)}
        </div>
        <div className='h-64 skeleton rounded-2xl'/>
      </div>
    );
  }

  return (
    <div className='space-y-5' dir='rtl'>
      <div className='flex items-center justify-between flex-wrap gap-3'>
        <div className='flex items-center gap-3'>
          <div className='p-2.5 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-lg'>
            <Landmark className='h-5 w-5'/>
          </div>
          <div>
            <h1 className='text-xl font-bold text-[var(--text-primary)]'>مكتب المحاسب الخبير</h1>
            <p className='text-xs text-[var(--text-muted)]'>بيانات مباشرة من قاعدة البيانات — العمليات الحسابية آنية</p>
          </div>
        </div>
        <div className='flex items-center gap-3'>
          {updAt && <span style={{...glass,padding:'4px 12px'}} className='flex items-center gap-1.5 text-xs text-[var(--text-muted)]'><Clock className='h-3 w-3'/>{updAt.toLocaleTimeString()}</span>}
          {loading && ready && <span className='text-xs text-[var(--text-muted)] animate-pulse'>يُحدَّث...</span>}
          <button type='button' style={{...glass,padding:'6px 14px',cursor:'pointer'}} className='flex items-center gap-1.5 text-xs font-medium hover:shadow-xl transition-all' onClick={() => void load()}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`}/>تحديث
          </button>
        </div>
      </div>
      {error && (
        <div style={{...glass,borderColor:'rgba(245,158,11,0.4)'}} className='flex items-center justify-between gap-3 p-4'>
          <p className='text-sm text-amber-700 dark:text-amber-400 flex items-center gap-2'>
            <AlertTriangle className='h-4 w-4'/>{error === 'not_configured' ? 'قاعدة البيانات غير مربوطة' : 'تعذّر تحميل البيانات'}
          </p>
          <button type='button' className='btn btn-ghost text-xs' onClick={() => void load()}>إعادة المحاولة</button>
        </div>
      )}
      <div style={glass} className='p-2 flex flex-wrap gap-1.5'>
        {TABS.map(t => (
          <button key={t.id} type='button' onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${tab === t.id ? 'bg-gradient-to-r from-indigo-500 to-cyan-500 text-white shadow-lg' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'}`}>
            <t.Ic className='h-3.5 w-3.5'/>{t.lbl}
          </button>
        ))}
      </div>
      {data ? (
        <>
          {tab === 'overview'   && <OverviewTab    d={data}/>}
          {tab === 'income'     && <IncomeTab      d={data}/>}
          {tab === 'cashflow'   && <CashFlowTab    d={data}/>}
          {tab === 'aging'      && <AgingTab       d={data}/>}
          {tab === 'ratios'     && <RatiosTab      d={data}/>}
          {tab === 'margin'     && <MarginTab      d={data}/>}
          {tab === 'projection' && <ProjectionTab  d={data}/>}
          {tab === 'tax'        && <TaxTab         d={data}/>}
          {tab === 'loan'       && <LoanTab/>}
          {tab === 'bep'        && <BepTab         d={data}/>}
          {tab === 'budget'     && <BudgetTab      d={data}/>}
          {tab === 'journal'    && <JournalTab     d={data}/>}
        </>
      ) : (
        !loading && (
          <div style={glass} className='flex flex-col items-center justify-center gap-2 py-16 text-[var(--text-muted)]'>
            <Activity className='h-8 w-8 opacity-30'/>
            <p className='text-sm'>لا توجد بيانات متاحة</p>
          </div>
        )
      )}
    </div>
  );
}
