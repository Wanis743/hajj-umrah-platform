import { reportError, reportWarning } from '@/lib/logger';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useI18n } from '@/i18n/I18nProvider';
import { useTheme } from '@/theme/ThemeProvider';
import type { DashboardFilters } from '@/types/dashboard';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer,
} from 'recharts';
import {
  Activity, RefreshCw, AlertCircle, Clock, CalendarDays, BarChart2,
  TrendingUp, TrendingDown, DollarSign, Users, CreditCard, Percent,
  Calculator, BookOpen, Scale, PiggyBank, Receipt, Building2, AlertTriangle,
} from 'lucide-react';
import ProAccountingWorkspace from './ProAccountingWorkspace';

const PIE_PAL = ['#6366f1','#06b6d4','#10b981','#f59e0b','#f43f5e','#8b5cf6','#d4af37'];
const GOLD='#d4af37', BLUE='#6366f1', PURPLE='#8b5cf6', CYAN='#06b6d4', GREEN='#10b981';

const f1=(x:unknown)=> (typeof x==='number' && Number.isFinite(x) ? x : 0).toFixed(1);
const f2=(x:unknown)=> (typeof x==='number' && Number.isFinite(x) ? x : 0).toFixed(2);

const glass: React.CSSProperties = {
  background: 'var(--surface)',
  backdropFilter: 'blur(20px) saturate(165%)',
  WebkitBackdropFilter: 'blur(20px) saturate(165%)',
  border: '1px solid var(--border)',
  borderRadius: '20px',
  boxShadow: 'var(--g-shadow), inset 0 1px 0 var(--g-sheen)',
};

const mkTT = (dark: boolean): React.CSSProperties => ({
  background: dark ? 'rgba(8,11,20,0.90)' : 'rgba(255,255,255,0.92)',
  backdropFilter: 'blur(20px)',
  WebkitBackdropFilter: 'blur(20px)',
  border: '1px solid '+(dark?'rgba(255,255,255,0.13)':'rgba(99,102,241,0.15)'),
  borderRadius: '16px',
  boxShadow: dark?'0 20px 48px rgba(0,0,0,0.55)':'0 12px 32px rgba(15,23,42,0.12)',
  color: dark?'#f8fafc':'#0f172a',
  fontSize: 12, padding: '10px 14px',
});

type Scope='period'|'stock';
import type { DashboardSnapshot, DashboardAnalyticsSnapshot } from "@/types/dashboard";
interface Props { filters: DashboardFilters; snapshot: DashboardSnapshot | null; }
interface AData {
  totalRevDzd:number; totalRevSar:number; collectedDzd:number; pendingAmount:number;
  avgPerPilgrim:number; collectionRate:number; visaClearance:number; confirmationRate:number;
  avgAge:number; pilgrimCount:number; monthlyGrowth:number;
  revenueOverTime:{date:string;amount:number}[];
  dailyRegs:{date:string;count:number}[];
  packageDist:{name:string;count:number}[];
  payMethods:{method:string;count:number}[];
  ageDist:{range:string;count:number}[];
  visaStatus:{status:string;count:number}[];
  bkgStatus:{status:string;count:number}[];
  arAging:{label:string;dzd:number}[];
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
    revenueOverTime: snap.series.cash_collections,
    dailyRegs: snap.series.daily_registrations,
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
        :<div className='h-64 lg:h-72'>{children}</div>}
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

function RR({label,value,color}:{label:string;value:string;color?:string}){
  return(
    <div className='flex items-center justify-between gap-2'>
      <span className='text-xs text-[var(--text-muted)]'>{label}</span>
      <span className={`text-sm font-bold tabular-nums ${color??'text-[var(--text-primary)]'}`}>{value}</span>
    </div>
  );
}

// ProAccountingWorkspace is imported from ./ProAccountingWorkspace.tsx
export default function AdvancedAnalytics({ filters, snapshot }: Props){
  const{lang}=useI18n(); const{theme}=useTheme();
  const dark=theme==='dark';
  const tooltip=mkTT(dark);
  const axisC=dark?'#6b7280':'#94a3b8';
  const gridC=dark?'rgba(255,255,255,0.06)':'rgba(99,102,241,0.08)';
  const isAr=lang==='ar'||lang==='dz';
  const fmt=(x:number)=>new Intl.NumberFormat('fr-FR').format(Math.round(x));
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
          <ResponsiveContainer width='100%' height='100%'>
            <AreaChart data={data?.revenueOverTime??[]}>
              <defs><linearGradient id='gG' x1='0' y1='0' x2='0' y2='1'><stop offset='5%' stopColor={GOLD} stopOpacity={0.7}/><stop offset='95%' stopColor={GOLD} stopOpacity={0}/></linearGradient></defs>
              <CartesianGrid strokeDasharray='3 3' stroke={gridC} vertical={false}/>
              <XAxis dataKey='date' stroke={axisC} fontSize={10} tickLine={false} axisLine={false}/>
              <YAxis stroke={axisC} fontSize={10} tickLine={false} axisLine={false} tickFormatter={(v:number)=>`${Math.round(v/1000)}k`}/>
              <Tooltip contentStyle={tooltip} formatter={(v:unknown)=>[fmt(Number(v))+' DZD','إيرادات']}/>
              <Area type='monotone' dataKey='amount' stroke={GOLD} strokeWidth={2.5} fill='url(#gG)'/>
            </AreaChart>
          </ResponsiveContainer>
        </CC>
        <CC title='التسجيلات اليومية' scope='period' empty={!data||!data.dailyRegs?.length} emptyLabel='لا توجد تسجيلات في هذه الفترة'>
          <ResponsiveContainer width='100%' height='100%'>
            <LineChart data={data?.dailyRegs??[]}>
              <CartesianGrid strokeDasharray='3 3' stroke={gridC} vertical={false}/>
              <XAxis dataKey='date' stroke={axisC} fontSize={10} tickLine={false} axisLine={false}/>
              <YAxis stroke={axisC} fontSize={10} tickLine={false} axisLine={false}/>
              <Tooltip contentStyle={tooltip}/>
              <Line type='monotone' dataKey='count' stroke={BLUE} strokeWidth={2.5} dot={false}/>
            </LineChart>
          </ResponsiveContainer>
        </CC>
        <CC title='توزيع الباقات' scope='stock' empty={!data||!data.packageDist?.length} emptyLabel='لا توجد بيانات باقات'>
          <ResponsiveContainer width='100%' height='100%'>
            <PieChart>
              <Pie data={data?.packageDist??[]} cx='50%' cy='50%' innerRadius={55} outerRadius={90} paddingAngle={4} dataKey='count'>
                {(data?.packageDist??[]).map((_,i)=><Cell key={i} fill={PIE_PAL[i%PIE_PAL.length]}/>)}
              </Pie>
              <Tooltip contentStyle={tooltip}/><Legend wrapperStyle={{fontSize:11}}/>
            </PieChart>
          </ResponsiveContainer>
        </CC>
        <CC title='طرق الدفع' scope='period' empty={!data||!data.payMethods?.length} emptyLabel='لا توجد مدفوعات في هذه الفترة'>
          <ResponsiveContainer width='100%' height='100%'>
            <BarChart data={data?.payMethods??[]}>
              <CartesianGrid strokeDasharray='3 3' stroke={gridC} vertical={false}/>
              <XAxis dataKey='method' stroke={axisC} fontSize={10} tickLine={false} axisLine={false}/>
              <YAxis stroke={axisC} fontSize={10} tickLine={false} axisLine={false}/>
              <Tooltip contentStyle={tooltip}/>
              <Bar dataKey='count' radius={[6,6,0,0]}>{(data?.payMethods??[]).map((_,i)=><Cell key={i} fill={PIE_PAL[i%PIE_PAL.length]}/>)}</Bar>
            </BarChart>
          </ResponsiveContainer>
        </CC>
        <CC title='التوزيع العمري للمعتمرين' scope='stock' empty={!data||(data.ageDist??[]).every(x=>x.count===0)} emptyLabel='لا توجد بيانات عمرية'>
          <ResponsiveContainer width='100%' height='100%'>
            <BarChart data={data?.ageDist??[]}>
              <CartesianGrid strokeDasharray='3 3' stroke={gridC} vertical={false}/>
              <XAxis dataKey='range' stroke={axisC} fontSize={10} tickLine={false} axisLine={false}/>
              <YAxis stroke={axisC} fontSize={10} tickLine={false} axisLine={false}/>
              <Tooltip contentStyle={tooltip}/>
              <Bar dataKey='count' fill={PURPLE} radius={[6,6,0,0]}/>
            </BarChart>
          </ResponsiveContainer>
        </CC>
        <CC title='حالة التأشيرات' scope='stock' empty={!data||!data.visaStatus?.length} emptyLabel='لا توجد بيانات تأشيرات'>
          <ResponsiveContainer width='100%' height='100%'>
            <BarChart data={data?.visaStatus??[]} layout='vertical'>
              <CartesianGrid strokeDasharray='3 3' stroke={gridC} horizontal={false}/>
              <XAxis type='number' stroke={axisC} fontSize={10} tickLine={false} axisLine={false}/>
              <YAxis dataKey='status' type='category' stroke={axisC} fontSize={10} tickLine={false} axisLine={false} width={110}/>
              <Tooltip contentStyle={tooltip}/>
              <Bar dataKey='count' fill={CYAN} radius={[0,6,6,0]}/>
            </BarChart>
          </ResponsiveContainer>
        </CC>
        <CC title='حالة الحجوزات' scope='stock' empty={!data||!data.bkgStatus?.length} emptyLabel='لا توجد بيانات حجوزات'>
          <ResponsiveContainer width='100%' height='100%'>
            <BarChart data={data?.bkgStatus??[]}>
              <CartesianGrid strokeDasharray='3 3' stroke={gridC} vertical={false}/>
              <XAxis dataKey='status' stroke={axisC} fontSize={10} tickLine={false} axisLine={false}/>
              <YAxis stroke={axisC} fontSize={10} tickLine={false} axisLine={false}/>
              <Tooltip contentStyle={tooltip}/>
              <Bar dataKey='count' fill={GREEN} radius={[6,6,0,0]}/>
            </BarChart>
          </ResponsiveContainer>
        </CC>
        <CC title='تقادم الذمم المدينة — بالأيام' scope='period' empty={!data||(data.arAging??[]).every(b=>b.dzd===0)} emptyLabel='لا توجد مستحقات معلقة'>
          <ResponsiveContainer width='100%' height='100%'>
            <BarChart data={data?.arAging??[]}>
              <CartesianGrid strokeDasharray='3 3' stroke={gridC} vertical={false}/>
              <XAxis dataKey='label' stroke={axisC} fontSize={10} tickLine={false} axisLine={false}/>
              <YAxis stroke={axisC} fontSize={10} tickLine={false} axisLine={false} tickFormatter={(v:number)=>`${Math.round(v/1000)}k`}/>
              <Tooltip contentStyle={tooltip} formatter={(v:unknown)=>[fmt(Number(v))+' DZD','مستحق']}/>
              <Bar dataKey='dzd' radius={[6,6,0,0]}>{(data?.arAging??[]).map((_,i)=><Cell key={i} fill={['#10b981','#6366f1','#f59e0b','#f97316','#f43f5e'][i]}/>)}</Bar>
            </BarChart>
          </ResponsiveContainer>
        </CC>
      </div>
      <ProAccountingWorkspace filters={filters} snapshot={snapshot} analyticsSnapshot={anSnap} />
    </div>
  );
}
