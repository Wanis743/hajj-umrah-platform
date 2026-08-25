import { reportError } from '@/lib/logger';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useI18n } from '@/i18n/I18nProvider';
import type { DashboardFilters } from '@/types/dashboard';
import { Area, AreaChart } from '@/components/charts/area-chart';
import { Line, LineChart } from '@/components/charts/line-chart';
import { Bar } from '@/components/charts/bar';
import { BarChart } from '@/components/charts/bar-chart';
import { BarXAxis } from '@/components/charts/bar-x-axis';
import { BarYAxis } from '@/components/charts/bar-y-axis';
import { Grid } from '@/components/charts/grid';
import { ChartTooltip, TooltipContent } from '@/components/charts/tooltip';
import { XAxis } from '@/components/charts/x-axis';
import { YAxis } from '@/components/charts/y-axis';
import { PieChart } from '@/components/charts/pie-chart';
import { PieSlice } from '@/components/charts/pie-slice';
import { PieCenter } from '@/components/charts/pie-center';
import {
  Activity, RefreshCw, AlertCircle, Clock, CalendarDays, BarChart2,
  TrendingUp, TrendingDown, DollarSign, Users, CreditCard, Percent,
  BookOpen, AlertTriangle,
} from 'lucide-react';
import ProAccountingWorkspace from './ProAccountingWorkspace';

const PIE_PAL = ['#6366f1','#06b6d4','#10b981','#f59e0b','#f43f5e','#8b5cf6','#d4af37'];
const AGING_COLORS = ['#10b981','#6366f1','#f59e0b','#f97316','#f43f5e'];
const GOLD='#d4af37', BLUE='#6366f1', PURPLE='#8b5cf6', CYAN='#06b6d4', GREEN='#10b981';

const f1=(x:unknown)=> (typeof x==='number' && Number.isFinite(x) ? x : 0).toFixed(1);

const glass: React.CSSProperties = {
  background: 'var(--surface)',
  backdropFilter: 'blur(20px) saturate(165%)',
  WebkitBackdropFilter: 'blur(20px) saturate(165%)',
  border: '1px solid var(--border)',
  borderRadius: '20px',
  boxShadow: 'var(--g-shadow), inset 0 1px 0 var(--g-sheen)',
};

type Scope='period'|'stock';
import type { DashboardSnapshot, DashboardAnalyticsSnapshot } from "@/types/dashboard";
interface Props { filters: DashboardFilters; snapshot: DashboardSnapshot | null; }
interface AData {
  totalRevDzd:number; totalRevSar:number; collectedDzd:number; pendingAmount:number;
  avgPerPilgrim:number; collectionRate:number; visaClearance:number; confirmationRate:number;
  avgAge:number; pilgrimCount:number; monthlyGrowth:number;
  revenueOverTime:{date:Date;amount:number}[];
  dailyRegs:{date:Date;count:number}[];
  packageDist:{name:string;count:number}[];
  payMethods:{method:string;count:number}[];
  ageDist:{range:string;count:number}[];
  visaStatus:{status:string;count:number}[];
  bkgStatus:{status:string;count:number}[];
  arAging:{label:string;dzd:number}[];
}

/** RPC series serialize dates as ISO `YYYY-MM-DD` — parse to a local-midnight Date. */
function parseISODate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y || 1970, (m || 1) - 1, d || 1);
}

async function fetchData(f: DashboardFilters, execSnap: DashboardSnapshot | null): Promise<{a: AData|null, raw: DashboardAnalyticsSnapshot|null}> {
  if (!isSupabaseConfigured) return {a:null, raw:null};
  const { data, error } = await supabase.rpc("get_dashboard_analytics_snapshot", {
    p_date_from: f.dateFrom || null,
    p_date_to: f.dateTo || null,
    p_filter_branch_id: f.branchId || null,
    p_filter_package_id: f.packageId || null,
  });
  if (error || !data) return {a:null, raw:null};
  const snap = data as DashboardAnalyticsSnapshot;

  const arAging = execSnap ? [
    { label: "الحالي", dzd: execSnap.ar_aging.current_dzd },
    { label: "1-7 أيام", dzd: execSnap.ar_aging["1_7_dzd"] },
    { label: "8-30 يوم", dzd: execSnap.ar_aging["8_30_dzd"] },
    { label: "31-60 يوم", dzd: execSnap.ar_aging["31_60_dzd"] },
    { label: "+60 يوم", dzd: execSnap.ar_aging["60_plus_dzd"] }
  ] : [];

  let calcAvgAge = 40;
  if (snap.series.age_distribution && snap.series.age_distribution.length > 0) {
    let totalCount = 0;
    let sumAge = 0;
    for (const bin of snap.series.age_distribution) {
      let mid = 40;
      if (bin.range === '0-18') mid = 9;
      else if (bin.range === '19-30') mid = 25;
      else if (bin.range === '31-50') mid = 40;
      else if (bin.range === '51-65') mid = 58;
      else if (bin.range === '65+') mid = 72;
      sumAge += mid * bin.count;
      totalCount += bin.count;
    }
    if (totalCount > 0) calcAvgAge = Math.round(sumAge / totalCount);
  }

  let cGrowth = 0;
  if (snap.series.cash_collections && snap.series.cash_collections.length >= 2) {
    const len = snap.series.cash_collections.length;
    const last = snap.series.cash_collections[len-1].amount;
    const prev = snap.series.cash_collections[len-2].amount;
    if (prev > 0) {
      cGrowth = Math.round(((last - prev) / prev) * 100);
    }
  }

  const a: AData = {
    totalRevDzd: snap.core.revenue_dzd,
    totalRevSar: snap.core.revenue_sar,
    collectedDzd: snap.core.collected_dzd,
    pendingAmount: snap.core.revenue_dzd - snap.core.collected_dzd,
    avgPerPilgrim: snap.core.pilgrims > 0 ? snap.core.collected_dzd / snap.core.pilgrims : 0,
    collectionRate: snap.core.revenue_dzd > 0 ? (snap.core.collected_dzd / snap.core.revenue_dzd) * 100 : 0,
    visaClearance: snap.core.visa_clearance_rate,
    confirmationRate: snap.core.booking_confirmation_rate,
    avgAge: calcAvgAge,
    pilgrimCount: snap.core.pilgrims,
    monthlyGrowth: cGrowth,
    revenueOverTime: snap.series.cash_collections.map(x => ({ date: parseISODate(x.date), amount: x.amount })),
    dailyRegs: snap.series.daily_registrations.map(x => ({ date: parseISODate(x.date), count: x.count })),
    packageDist: snap.series.package_distribution.map(x => ({ name: x.name, count: x.count })),
    payMethods: snap.series.payment_methods,
    ageDist: snap.series.age_distribution,
    visaStatus: snap.series.visa_status,
    bkgStatus: snap.series.booking_status,
    arAging
  };
  return { a, raw: snap };
}

function ScopeBadge({scope}:{scope:Scope}){
  const s={...glass,padding:'3px 10px',borderRadius:'99px'};
  return scope==='period'
    ?<span style={s} className='inline-flex items-center gap-1 text-[10px] font-bold text-blue-600 dark:text-blue-300'><CalendarDays className='h-2.5 w-2.5'/>خلال الفترة</span>
    :<span style={s} className='inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-300'><BarChart2 className='h-2.5 w-2.5'/>الحالة الراهنة</span>;
}

function CC({title,scope,empty,emptyLabel,children}:{title:string;scope:Scope;empty?:boolean;emptyLabel?:string;children:React.ReactNode}){
  return(
    <div style={glass} className='p-5 flex flex-col gap-4 transition-all duration-300 hover:shadow-2xl'>
      <div className='flex items-center justify-between gap-2 flex-wrap'>
        <h3 className='text-sm font-bold text-[var(--text-primary)]'>{title}</h3>
        <ScopeBadge scope={scope}/>
      </div>
      {empty
        ?<div className='h-64 flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-[var(--border)] text-[var(--text-muted)]'><Activity className='h-5 w-5 opacity-40'/><p className='text-xs'>{emptyLabel}</p></div>
        :<div>{children}</div>}
    </div>
  );
}

function KC({label,value,sub,icon,grad,scope,trend}:{label:string;value:string;sub?:string;icon:React.ReactNode;grad:string;scope:Scope;trend?:number}){
  return(
    <div style={glass} className='p-5 flex flex-col gap-3 transition-all duration-300 hover:shadow-2xl hover:-translate-y-0.5'>
      <div className='flex items-start justify-between'>
        <div className={`p-2.5 rounded-2xl text-white ${grad} shadow-lg`}>{icon}</div>
        <ScopeBadge scope={scope}/>
      </div>
      <div>
        <div className='text-xs font-medium text-[var(--text-muted)] mb-1'>{label}</div>
        <div className='text-2xl font-bold text-[var(--text-primary)] tabular-nums'>{value}</div>
        {sub&&<div className='text-xs text-[var(--text-secondary)] mt-0.5'>{sub}</div>}
        {trend!==undefined&&(
          <div className={`flex items-center gap-1 mt-1 text-xs font-semibold ${trend>=0?'text-emerald-500':'text-rose-500'}`}>
            {trend>=0?<TrendingUp className='h-3 w-3'/>:<TrendingDown className='h-3 w-3'/>}
            {f1(Math.abs(trend ?? 0))}% من الشهر الماضي
          </div>
        )}
      </div>
    </div>
  );
}

// ProAccountingWorkspace is imported from ./ProAccountingWorkspace.tsx
export default function AdvancedAnalytics({ filters, snapshot }: Props){
  const{lang}=useI18n();
  const isAr=lang==='ar'||lang==='dz';
  const fmt=(x:number)=>new Intl.NumberFormat('fr-FR').format(Math.round(x));
  const fmtDay=(d:Date)=>new Intl.DateTimeFormat(isAr?'ar-DZ':'fr-FR',{day:'numeric',month:'short'}).format(d);
  const[data,setData]=useState<AData|null>(null);
  const [anSnap, setAnSnap] = useState<DashboardAnalyticsSnapshot | null>(null);
  const[loading,setLoading]=useState(false);
  const[error,setError]=useState<string|null>(null);
  const[updatedAt,setUpdatedAt]=useState<Date|null>(null);
  const[ready,setReady]=useState(false);
  const abort=useRef<AbortController|null>(null);
  const load=useCallback(async()=>{
    if(!isSupabaseConfigured){setError('not_configured');setLoading(false);return;}
    abort.current?.abort();
    const ctrl=new AbortController(); abort.current=ctrl;
    setLoading(true); setError(null);
    try{
      const d = await fetchData(filters, snapshot);
      if(ctrl.signal.aborted)return;
      setData(d.a); setAnSnap(d.raw); setUpdatedAt(new Date()); setReady(true);
    }catch(e){
      if(ctrl.signal.aborted)return;
      setError('fetch_failed'); reportError('UI_ERROR', { error: String(e) });
    }finally{
      if(!ctrl.signal.aborted)setLoading(false);
    }
  },[filters.dateFrom,filters.dateTo]);
  useEffect(()=>{ void load(); return()=>{abort.current?.abort();}; },[load]);

  // bklit charts only mount once real rows exist (CC empty-gates below), so a
  // static "ready" status is honest — fetch-level loading shows page skeletons.
  const chartStatus = 'ready' as const;

  // Categorical rows reshaped so each bar renders in its own color:
  // one stacked series per category, only one non-zero segment per row.
  const payMethodBars = (data?.payMethods??[]).map((p,i)=>Object.assign(
    { method: p.method, count: p.count, color: PIE_PAL[i%PIE_PAL.length] },
    Object.fromEntries((data?.payMethods??[]).map((_,j)=>[`s${j}`, i===j?p.count:0]))
  ));
  const arAgingBars = (data?.arAging??[]).map((b,i)=>Object.assign(
    { label: b.label, dzd: b.dzd, color: AGING_COLORS[i%AGING_COLORS.length] },
    Object.fromEntries((data?.arAging??[]).map((_,j)=>[`a${j}`, i===j?b.dzd:0]))
  ));
  const pkgSlices=(data?.packageDist??[]).map((p,i)=>({label:p.name,value:p.count,color:PIE_PAL[i%PIE_PAL.length]}));

  if(loading&&!ready)return(
    <div className='space-y-6 p-2'>
      <div className='grid grid-cols-2 lg:grid-cols-4 gap-4'>{[1,2,3,4,5,6,7,8].map(i=><div key={i} className='h-32 skeleton rounded-2xl'/>)}</div>
      <div className='grid grid-cols-1 lg:grid-cols-2 gap-4'>{[1,2,3,4].map(i=><div key={i} className='h-80 skeleton rounded-2xl'/>)}</div>
    </div>
  );
  return(
    <div className='space-y-6' dir={isAr?'rtl':'ltr'}>
      <div className='flex items-center justify-between flex-wrap gap-3'>
        <h1 className='text-xl font-bold text-[var(--text-primary)] flex items-center gap-2.5'>
          <span className='p-2 rounded-2xl bg-gradient-to-br from-indigo-500 to-cyan-500 text-white shadow-lg'><Activity className='h-5 w-5'/></span>
          التحليلات والإحصائيات
        </h1>
        <div className='flex items-center gap-3'>
          {updatedAt&&<span style={{...glass,padding:'4px 12px'}} className='flex items-center gap-1.5 text-xs text-[var(--text-muted)]'><Clock className='h-3 w-3'/>{updatedAt.toLocaleTimeString()}</span>}
          {loading&&ready&&<span className='text-xs text-[var(--text-muted)] animate-pulse'>يُحدَّث...</span>}
          <button type='button' style={{...glass,padding:'6px 14px',cursor:'pointer'}} className='flex items-center gap-1.5 text-xs font-medium text-[var(--text-primary)] hover:shadow-xl transition-all' onClick={()=>void load()}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading?'animate-spin':''}`}/>تحديث
          </button>
        </div>
      </div>
      <div style={glass} className='flex flex-wrap gap-6 text-xs text-[var(--text-muted)] p-3.5'>
        <span className='flex items-center gap-1.5'><CalendarDays className='h-3 w-3 text-blue-500'/><strong className='text-[var(--text-secondary)]'>خلال الفترة</strong> — التدفقات داخل نطاق التاريخ المختار</span>
        <span className='flex items-center gap-1.5'><BarChart2 className='h-3 w-3 text-emerald-500'/><strong className='text-[var(--text-secondary)]'>الحالة الراهنة</strong> — المخزون الكلي بغض النظر عن الفترة</span>
      </div>
      {error&&(
        <div style={{...glass,borderColor:'rgba(245,158,11,0.4)'}} className='flex flex-wrap items-center justify-between gap-3 p-4'>
          <p className='text-sm text-amber-700 dark:text-amber-400 flex items-center gap-2'>
            <AlertCircle className='h-4 w-4 shrink-0'/>
            {error==='not_configured'?'قاعدة البيانات غير مربوطة':'تعذّر تحميل البيانات — يتم العرض بآخر بيانات متاحة'}
          </p>
          <button type='button' className='btn btn-ghost text-xs' onClick={()=>void load()}>إعادة المحاولة</button>
        </div>
      )}
      {data&&(
        <div className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4'>
          <KC label='إجمالي الإيرادات (فترة)'  value={`${fmt(data.totalRevDzd)} DZD`}          sub={`${fmt(data.totalRevSar)} SAR`}         icon={<DollarSign className='h-5 w-5'/>}   grad='bg-gradient-to-br from-emerald-500 to-teal-600'   scope='period' trend={data.monthlyGrowth}/>
          <KC label='المحصّل الفعلي (كلي)'       value={`${fmt(data.collectedDzd)} DZD`}         sub={`معدل ${f1(data.collectionRate)}%`} icon={<CreditCard className='h-5 w-5'/>} grad='bg-gradient-to-br from-blue-500 to-indigo-600'    scope='period'/>
          <KC label='المستحقات المعلقة'          value={`${fmt(data.pendingAmount)} DZD`}                                                         icon={<AlertTriangle className='h-5 w-5'/>} grad='bg-gradient-to-br from-amber-500 to-orange-600' scope='period'/>
          <KC label='متوسط إيراد المعتمر'        value={`${fmt(data.avgPerPilgrim)} DZD`}                                                         icon={<Users className='h-5 w-5'/>}        grad='bg-gradient-to-br from-purple-500 to-pink-600'    scope='period'/>
          <KC label='معدل التحصيل'              value={`${f1(data.collectionRate)}%`}                                                    icon={<Percent className='h-5 w-5'/>}      grad='bg-gradient-to-br from-cyan-500 to-blue-600'      scope='period'/>
          <KC label='صدور التأشيرات'            value={`${f1(data.visaClearance)}%`}                                                    icon={<BookOpen className='h-5 w-5'/>}     grad='bg-gradient-to-br from-rose-500 to-pink-600'      scope='stock'/>
          <KC label='تأكيد الحجوزات'            value={`${f1(data.confirmationRate)}%`}                                                 icon={<TrendingUp className='h-5 w-5'/>}   grad='bg-gradient-to-br from-violet-500 to-purple-600'  scope='stock'/>
          <KC label='متوسط العمر'               value={`${Math.round(data.avgAge)} سنة`}         sub={`${data.pilgrimCount} معتمر`}               icon={<Users className='h-5 w-5'/>}        grad='bg-gradient-to-br from-teal-500 to-emerald-600'   scope='stock'/>
        </div>
      )}
      <div className='grid grid-cols-1 lg:grid-cols-2 gap-4'>
        <CC title='الإيرادات عبر الزمن' scope='period' empty={!data||!data.revenueOverTime?.length} emptyLabel='لا توجد مدفوعات مؤكدة في هذه الفترة'>
          <div dir='ltr'>
            <AreaChart aspectRatio='2 / 1' data={data?.revenueOverTime??[]} margin={{top:16,right:12,bottom:28,left:48}} status={chartStatus}>
              <Grid numTicksRows={4}/>
              <Area dataKey='amount' fill={GOLD} fillOpacity={0.28} stroke={GOLD}/>
              <XAxis numTicks={6}/>
              <YAxis numTicks={4}/>
              <ChartTooltip showDatePill={false} content={({point})=>(
                <TooltipContent
                  rows={[{color:GOLD,label:'إيرادات',value:`${fmt(Number(point.amount??0))} DZD`}]}
                  title={point.date instanceof Date?fmtDay(point.date):undefined}/>
              )}/>
            </AreaChart>
          </div>
        </CC>
        <CC title='التسجيلات اليومية' scope='period' empty={!data||!data.dailyRegs?.length} emptyLabel='لا توجد تسجيلات في هذه الفترة'>
          <div dir='ltr'>
            <LineChart aspectRatio='2 / 1' data={data?.dailyRegs??[]} margin={{top:16,right:12,bottom:28,left:36}} status={chartStatus}>
              <Grid numTicksRows={4}/>
              <Line dataKey='count' stroke={BLUE}/>
              <XAxis numTicks={6}/>
              <YAxis numTicks={4} formatLargeNumbers={false}/>
              <ChartTooltip showDatePill={false} content={({point})=>(
                <TooltipContent
                  rows={[{color:BLUE,label:'تسجيلات',value:fmt(Number(point.count??0))}]}
                  title={point.date instanceof Date?fmtDay(point.date):undefined}/>
              )}/>
            </LineChart>
          </div>
        </CC>
        <CC title='توزيع الباقات' scope='stock' empty={!data||!data.packageDist?.length} emptyLabel='لا توجد بيانات باقات'>
          <div className='flex items-center gap-4' dir='ltr'>
            <div className='shrink-0'>
              <PieChart cornerRadius={4} data={pkgSlices} hoverOffset={8} innerRadius={58} padAngle={0.03} size={200}>
                {pkgSlices.map((s,i)=><PieSlice index={i} key={s.label}/>) }
                <PieCenter defaultLabel='باقة' formatOptions={{notation:'compact',maximumFractionDigits:1}}/>
              </PieChart>
            </div>
            <ul className='flex-1 min-w-0 space-y-1.5 max-h-56 overflow-y-auto' dir={isAr?'rtl':'ltr'}>
              {pkgSlices.map(s=>(
                <li key={s.label} className='flex items-center justify-between gap-2 text-xs'>
                  <span className='flex items-center gap-2 min-w-0 text-[var(--text-secondary)]'>
                    <span className='h-2.5 w-2.5 shrink-0 rounded-full' style={{background:s.color}}/>
                    <span className='truncate'>{s.label}</span>
                  </span>
                  <span className='font-bold tabular-nums text-[var(--text-primary)]'>{fmt(s.value)}</span>
                </li>
              ))}
            </ul>
          </div>
        </CC>
        <CC title='طرق الدفع' scope='period' empty={!data||!data.payMethods?.length} emptyLabel='لا توجد مدفوعات في هذه الفترة'>
          <div dir='ltr'>
            <BarChart aspectRatio='2 / 1' data={payMethodBars} margin={{top:16,right:8,bottom:28,left:40}} stacked stackGap={1} status={chartStatus} xDataKey='method'>
              <Grid numTicksRows={4}/>
              {(data?.payMethods??[]).map((_,i)=><Bar dataKey={`s${i}`} fill={PIE_PAL[i%PIE_PAL.length]} key={i}/>)}
              <BarXAxis showAllLabels/>
              <YAxis numTicks={4}/>
              <ChartTooltip showDatePill={false} content={({point})=>(
                <TooltipContent
                  rows={[{color:String(point.color),label:'مدفوعات',value:fmt(Number(point.count??0))}]}
                  title={String(point.method??'')}/>
              )}/>
            </BarChart>
          </div>
        </CC>
        <CC title='التوزيع العمري للمعتمرين' scope='stock' empty={!data||(data.ageDist??[]).every(x=>x.count===0)} emptyLabel='لا توجد بيانات عمرية'>
          <div dir='ltr'>
            <BarChart aspectRatio='2 / 1' data={data?.ageDist??[]} margin={{top:16,right:8,bottom:28,left:36}} status={chartStatus} xDataKey='range'>
              <Grid numTicksRows={4}/>
              <Bar dataKey='count' fill={PURPLE}/>
              <BarXAxis/>
              <YAxis numTicks={4} formatLargeNumbers={false}/>
              <ChartTooltip showDatePill={false} content={({point})=>(
                <TooltipContent
                  rows={[{color:PURPLE,label:'معتمرون',value:fmt(Number(point.count??0))}]}
                  title={String(point.range??'')}/>
              )}/>
            </BarChart>
          </div>
        </CC>
        <CC title='حالة التأشيرات' scope='stock' empty={!data||!data.visaStatus?.length} emptyLabel='لا توجد بيانات تأشيرات'>
          <div dir='ltr'>
            <BarChart aspectRatio='2 / 1' data={data?.visaStatus??[]} margin={{top:16,right:16,bottom:16,left:112}} orientation='horizontal' status={chartStatus} xDataKey='status'>
              <Grid horizontal={false} numTicksColumns={4} vertical/>
              <Bar dataKey='count' fill={CYAN}/>
              <BarYAxis/>
              <ChartTooltip showDatePill={false} content={({point})=>(
                <TooltipContent
                  rows={[{color:CYAN,label:'تأشيرات',value:fmt(Number(point.count??0))}]}
                  title={String(point.status??'')}/>
              )}/>
            </BarChart>
          </div>
        </CC>
        <CC title='حالة الحجوزات' scope='stock' empty={!data||!data.bkgStatus?.length} emptyLabel='لا توجد بيانات حجوزات'>
          <div dir='ltr'>
            <BarChart aspectRatio='2 / 1' data={data?.bkgStatus??[]} margin={{top:16,right:8,bottom:28,left:36}} status={chartStatus} xDataKey='status'>
              <Grid numTicksRows={4}/>
              <Bar dataKey='count' fill={GREEN}/>
              <BarXAxis maxLabels={8}/>
              <YAxis numTicks={4} formatLargeNumbers={false}/>
              <ChartTooltip showDatePill={false} content={({point})=>(
                <TooltipContent
                  rows={[{color:GREEN,label:'حجوزات',value:fmt(Number(point.count??0))}]}
                  title={String(point.status??'')}/>
              )}/>
            </BarChart>
          </div>
        </CC>
        <CC title='تقادم الذمم المدينة — بالأيام' scope='period' empty={!data||(data.arAging??[]).every(b=>b.dzd===0)} emptyLabel='لا توجد مستحقات معلقة'>
          <div dir='ltr'>
            <BarChart aspectRatio='2 / 1' data={arAgingBars} margin={{top:16,right:8,bottom:28,left:48}} stacked stackGap={1} status={chartStatus} xDataKey='label'>
              <Grid numTicksRows={4}/>
              {AGING_COLORS.slice(0,(data?.arAging??[]).length).map((c,i)=><Bar dataKey={`a${i}`} fill={c} key={c}/>)}
              <BarXAxis showAllLabels/>
              <YAxis numTicks={4}/>
              <ChartTooltip showDatePill={false} content={({point})=>(
                <TooltipContent
                  rows={[{color:String(point.color),label:'مستحق',value:`${fmt(Number(point.dzd??0))} DZD`}]}
                  title={String(point.label??'')}/>
              )}/>
            </BarChart>
          </div>
        </CC>
      </div>
      <ProAccountingWorkspace filters={filters} snapshot={snapshot} analyticsSnapshot={anSnap} />
    </div>
  );
}
