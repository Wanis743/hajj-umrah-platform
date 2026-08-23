import React from 'react';
import { BarChart2, FileText, Wallet, AlertTriangle, Scale, Percent, TrendingUp, Receipt, BookOpen, Building2, PiggyBank, Calculator, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { formatMoney } from '@/lib/money';

export const glass: React.CSSProperties = { background:'var(--surface)', backdropFilter:'blur(20px) saturate(165%)', WebkitBackdropFilter:'blur(20px) saturate(165%)', border:'1px solid var(--border)', borderRadius:'20px', boxShadow:'var(--g-shadow), inset 0 1px 0 var(--g-sheen)' };
export const glassInner: React.CSSProperties = { background:'var(--g-tint-raised,rgba(255,255,255,0.72))', backdropFilter:'blur(28px)', WebkitBackdropFilter:'blur(28px)', border:'1px solid var(--g-line-strong,rgba(148,163,184,0.42))', borderRadius:'16px', boxShadow:'var(--g-shadow)' };
export const mkTT=(dark:boolean):React.CSSProperties=>({ background:dark?'rgba(8,11,20,0.90)':'rgba(255,255,255,0.92)', backdropFilter:'blur(20px)', WebkitBackdropFilter:'blur(20px)', border:'1px solid '+(dark?'rgba(255,255,255,0.13)':'rgba(99,102,241,0.15)'), borderRadius:'16px', boxShadow:dark?'0 20px 48px rgba(0,0,0,0.55)':'0 12px 32px rgba(15,23,42,0.12)', color:dark?'#f8fafc':'#0f172a', fontSize:12, padding:'10px 14px' });
export const PAL=['#6366f1','#06b6d4','#10b981','#f59e0b','#f43f5e','#8b5cf6','#d4af37'];
export const fmt=(x:unknown)=> (typeof x==='number' && Number.isFinite(x)) ? formatMoney(Math.round(x), 'DZD') : '0.00';
export const f1=(x:unknown)=> (typeof x==='number' && Number.isFinite(x) ? x : 0).toFixed(1);
export const f2=(x:unknown)=> (typeof x==='number' && Number.isFinite(x) ? x : 0).toFixed(2);
export const pct=(x:unknown)=> f2(x) + '%';
export const pf=(s:string,fb=0)=>{ const v=parseFloat(s); return isNaN(v)?fb:v; };

export const TABS=[
  {id:'overview'   as const, lbl:'نظرة عامة',          Ic:BarChart2},
  {id:'income'     as const, lbl:'قائمة الدخل',         Ic:FileText},
  {id:'cashflow'   as const, lbl:'التدفق النقدي',        Ic:Wallet},
  {id:'aging'      as const, lbl:'تقادم الذمم',          Ic:AlertTriangle},
  {id:'ratios'     as const, lbl:'النسب المالية',        Ic:Scale},
  {id:'margin'     as const, lbl:'الهامش والربحية',      Ic:Percent},
  {id:'projection' as const, lbl:'التوقعات',             Ic:TrendingUp},
  {id:'tax'        as const, lbl:'الضرائب والرسوم',      Ic:Receipt},
  {id:'journal'    as const, lbl:'دفتر اليومية (الفعلي)',         Ic:BookOpen},
  {id:'loan'       as const, lbl:'محاكاة قروض',      Ic:Building2},
  {id:'bep'        as const, lbl:'محاكاة نقطة التعادل',         Ic:PiggyBank},
  {id:'budget'     as const, lbl:'محاكاة الميزانية',  Ic:Calculator},
];
export type TabId=typeof TABS[number]['id'];



export function KCard({label,value,sub,Ic,grad,trend}:{label:string;value:string;sub?:string;Ic:React.ElementType;grad:string;trend?:number}){
  return(
    <div style={glass} className='p-5 flex flex-col gap-3 hover:-translate-y-0.5 transition-all duration-300 hover:shadow-2xl'>
      <div className={`self-start p-2.5 rounded-2xl text-white ${grad} shadow-lg`}><Ic className='h-5 w-5'/></div>
      <div>
        <div className='text-xs font-medium text-[var(--text-muted)] mb-1'>{label}</div>
        <div className='text-2xl font-bold text-[var(--text-primary)] tabular-nums'>{value}</div>
        {sub&&<div className='text-xs text-[var(--text-secondary)] mt-0.5'>{sub}</div>}
        {trend!==undefined&&(<div className={`flex items-center gap-1 mt-1 text-xs font-semibold ${trend>=0?'text-emerald-500':'text-rose-500'}`}>{trend>=0?<ArrowUpRight className='h-3 w-3'/>:<ArrowDownRight className='h-3 w-3'/>}{f1(Math.abs(trend ?? 0))}% نمو شهري</div>)}
      </div>
    </div>
  );
}
export function RR({label,value,color,bold,border}:{label:string;value:string;color?:string;bold?:boolean;border?:boolean}){
  return(<div className={`flex items-center justify-between gap-2 ${border?'pt-3 mt-3 border-t border-[var(--border)]':''}`}><span className={`text-xs ${bold?'font-bold text-[var(--text-primary)]':'text-[var(--text-muted)]'}`}>{label}</span><span className={`text-sm tabular-nums ${bold?'font-bold':'font-medium'} ${color??'text-[var(--text-primary)]'}`}>{value}</span></div>);
}
export function Inp({label,value,onChange,placeholder,readOnly,step}:{label:string;value:string;onChange?:(v:string)=>void;placeholder?:string;readOnly?:boolean;step?:string}){
  return(<label className='block'><span className='text-xs font-medium text-[var(--text-muted)] block mb-1'>{label}</span><input type='number' className='input h-10 w-full' value={value} onChange={e=>onChange?.(e.target.value)} placeholder={placeholder} readOnly={readOnly} step={step}/></label>);
}


