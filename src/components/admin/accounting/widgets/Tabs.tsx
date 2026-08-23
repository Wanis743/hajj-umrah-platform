import React, { useState } from 'react';
import { BarChart, Bar, PieChart, Pie, Cell, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import type { Fin } from '../model/useAccountingData';
import { KCard, RR, Inp, glass, glassInner, mkTT, PAL, fmt, f1, f2, pct, pf } from './Shared';
import { DollarSign, CreditCard, TrendingUp, AlertTriangle } from 'lucide-react';

export function OverviewTab({d,dark}:{d:Fin;dark:boolean}){
  const tt=mkTT(dark); const axC=dark?'#6b7280':'#94a3b8'; const grC=dark?'rgba(255,255,255,0.06)':'rgba(99,102,241,0.08)';
  return(<div className='space-y-5'>
    <div className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4'>
      <KCard label='إجمالي الإيرادات'    value={`${fmt(d.totalRevDzd)}`}    sub={`${fmt(d.totalRevSar)} SAR`}         Ic={DollarSign}   grad='bg-gradient-to-br from-emerald-500 to-teal-600'  trend={d.monthlyGrowth}/>
      <KCard label='المحصّل الفعلي'      value={`${fmt(d.collectedDzd)}`}    sub={`معدل ${f1(d.collectionRate)}%`} Ic={CreditCard}   grad='bg-gradient-to-br from-blue-500 to-indigo-600'/>
      <KCard label='صافي الربح المحاسبي' value={`${fmt(d.netProfitDzd)}`}    sub='مبني على الدفتر المحاسبي'                           Ic={TrendingUp}   grad='bg-gradient-to-br from-violet-500 to-purple-600'/>
      <KCard label='المستحقات المعلقة'   value={`${fmt(d.pendingDzd)}`}                                               Ic={AlertTriangle} grad='bg-gradient-to-br from-amber-500 to-orange-600'/>
    </div>
    <div className='grid grid-cols-1 lg:grid-cols-2 gap-4'>
      <div style={glass} className='p-5'>
        <h3 className='text-sm font-bold text-[var(--text-primary)] mb-4'>الإيرادات والمصاريف الشهرية</h3>
        <div className='h-64'><ResponsiveContainer width='100%' height='100%'>
          <BarChart data={d.revenueByMonth}>
            <CartesianGrid strokeDasharray='3 3' stroke={grC} vertical={false}/>
            <XAxis dataKey='m' stroke={axC} fontSize={10} tickLine={false} axisLine={false}/>
            <YAxis stroke={axC} fontSize={10} tickLine={false} axisLine={false} tickFormatter={(v:number)=>`${Math.round(v/1000)}k`}/>
            <Tooltip contentStyle={tt} formatter={(v:unknown)=>[fmt(Number(v))+' DZD','']}/>
            <Legend wrapperStyle={{fontSize:11}}/>
            <Bar dataKey='rev'    name='إيرادات'  fill='#6366f1' radius={[4,4,0,0]}/>
            
            
          </BarChart>
        </ResponsiveContainer></div>
      </div>
      <div style={glass} className='p-5'>
        <h3 className='text-sm font-bold text-[var(--text-primary)] mb-4'>طرق الدفع (DZD)</h3>
        <div className='h-64'><ResponsiveContainer width='100%' height='100%'>
          <PieChart><Pie data={d.payMethods.map(p=>({name:p.method,value:p.dzd}))} cx='50%' cy='50%' innerRadius={55} outerRadius={90} paddingAngle={4} dataKey='value'>
            {d.payMethods.map((_,i)=><Cell key={i} fill={PAL[i%PAL.length]}/>)}
          </Pie>
          <Tooltip contentStyle={tt} formatter={(v:unknown)=>[fmt(Number(v)),'']}/><Legend wrapperStyle={{fontSize:11}}/></PieChart>
        </ResponsiveContainer></div>
      </div>
    </div>
    <div className='grid grid-cols-1 sm:grid-cols-3 gap-4'>
      <div style={glass} className='p-4 space-y-2'>
        <div className='text-xs font-bold text-[var(--text-muted)] uppercase tracking-wide mb-3'>الحجوزات</div>
        <RR label='المؤكدة' value={String(d.confirmedCount)} color='text-emerald-600'/>
        <RR label='المعلقة' value={String(d.pendingCount)}   color='text-amber-500'/>
        <RR label='الملغاة' value={String(d.cancelledCount)} color='text-rose-500'/>
        <RR label='الإجمالي' value={String(d.pilgrimCount)} bold border/>
      </div>
      <div style={glass} className='p-4 space-y-2'>
        <div className='text-xs font-bold text-[var(--text-muted)] uppercase tracking-wide mb-3'>مؤشرات الأداء</div>
        <RR label='معدل التحصيل' value={pct(d.collectionRate)} color={d.collectionRate>=80?'text-emerald-600':'text-amber-600'}/>
        <RR label='متوسط/معتمر'  value={`${fmt(d.avgPerPilgrim)}`}/>
        <RR label='نمو شهري'     value={pct(d.monthlyGrowth)}  color={d.monthlyGrowth>=0?'text-emerald-600':'text-rose-500'}/>
      </div>
      <div style={glass} className='p-4 space-y-2'>
        <div className='text-xs font-bold text-[var(--text-muted)] uppercase tracking-wide mb-3'>التدفق النقدي</div>
        <RR label='تدفقات داخلة' value={`+${fmt(d.collectedDzd)}`} color='text-emerald-600'/>
        <RR label='تدفقات خارجة' value={`-${fmt(d.expensesDzd)}`}  color='text-rose-500'/>
        <RR label='صافي التدفق'  value={`${fmt(d.netProfitDzd)}`}  bold border color={d.netProfitDzd>=0?'text-emerald-600':'text-rose-600'}/>
      </div>
    </div>
  </div>);
}

export function IncomeTab({d}:{d:Fin}){
  const gross=d.collectedDzd; const exp=d.expensesDzd; const net=d.netProfitDzd;
  return(<div style={glass} className='p-6 space-y-2 max-w-2xl'>
    <div className='text-xs font-bold text-[var(--text-muted)] uppercase mb-4'>قائمة الدخل</div>
    <RR label='الإيرادات المحصلة' value={`${fmt(gross)}`} color='text-emerald-600'/>
    <RR label='المصروفات الفعلية' value={`-${fmt(exp)}`} color='text-rose-500'/>
    <div className='border-t border-[var(--border)] my-2'/>
    <RR label='صافي الربح' value={`${fmt(net)}`} bold border color={net>=0?'text-emerald-600':'text-rose-600'}/>
  </div>);
}
export function CashFlowTab({d,dark}:{d:Fin;dark:boolean}){
  const tt=mkTT(dark); const axC=dark?'#6b7280':'#94a3b8'; const grC=dark?'rgba(255,255,255,0.06)':'rgba(99,102,241,0.08)';
  const data=d.revenueByMonth.map(m=>({m:m.m,inflow:m.rev,net:m.profit}));
  return(<div className='space-y-4'>
    <div className='grid grid-cols-1 sm:grid-cols-3 gap-4'>
      <div style={glass} className='p-5 space-y-2'><div className='text-xs font-bold text-[var(--text-muted)] uppercase mb-3'>تدفقات تشغيلية</div>
        <RR label='تحصيلات من عملاء' value={`+${fmt(d.collectedDzd)}`} color='text-emerald-600'/>
        <RR label='مدفوعات موردين'   value={`-${fmt(d.expensesDzd)}`}  color='text-rose-500'/>
        <RR label='صافي تشغيلي'      value={`${fmt(d.netProfitDzd)}`}  bold border color={d.netProfitDzd>=0?'text-emerald-600':'text-rose-600'}/>
      </div>
      <div style={glass} className='p-5 space-y-2'><div className='text-xs font-bold text-[var(--text-muted)] uppercase mb-3'>المستحقات المعلقة</div>
        <RR label='ذمم معلقة إجمالية' value={`${fmt(d.pendingDzd)}`} color='text-amber-500'/>
        <RR label='نسبة من الإيرادات' value={pct(d.totalRevDzd>0?(d.pendingDzd/d.totalRevDzd)*100:0)}/>
        <RR label='معتمرون معلقون'    value={`${d.pendingCount} حجز`}/>
      </div>
      <div style={glass} className='p-5 space-y-2'><div className='text-xs font-bold text-[var(--text-muted)] uppercase mb-3'>الموقف النقدي</div>
        <RR label='سيولة متاحة (تقدير)' value={`${fmt(d.netProfitDzd*.3)}`} color='text-blue-600'/>
        <RR label='احتياطي التشغيل'     value={`${fmt(d.expensesDzd/12)}/شهر`}/>
        <RR label='أشهر التشغيل'        value={d.expensesDzd>0?`${f1(d.expensesDzd > 0 ? (d.netProfitDzd*.3/(d.expensesDzd/12)) : 0)} شهر`:'—'}/>
      </div>
    </div>
    <div style={glass} className='p-5'><h3 className='text-sm font-bold text-[var(--text-primary)] mb-4'>التدفق النقدي الشهري</h3>
      <div className='h-64'><ResponsiveContainer width='100%' height='100%'>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray='3 3' stroke={grC} vertical={false}/>
          <XAxis dataKey='m' stroke={axC} fontSize={10} tickLine={false} axisLine={false}/>
          <YAxis stroke={axC} fontSize={10} tickLine={false} axisLine={false} tickFormatter={(v:number)=>`${Math.round(v/1000)}k`}/>
          <Tooltip contentStyle={tt} formatter={(v:unknown)=>[fmt(Math.abs(Number(v)))+' DZD','']}/>
          <Legend wrapperStyle={{fontSize:11}}/>
          <Line type='monotone' dataKey='inflow' name='تدفق داخل' stroke='#10b981' strokeWidth={2} dot={false}/>
          <Line type='monotone' dataKey='net'    name='صافي نقدي' stroke='#6366f1' strokeWidth={2.5} dot={false}/>
        </LineChart>
      </ResponsiveContainer></div>
    </div>
  </div>);
}

export function AgingTab({d,dark}:{d:Fin;dark:boolean}){
  const tt=mkTT(dark); const axC=dark?'#6b7280':'#94a3b8'; const colors=['#10b981','#6366f1','#f59e0b','#f97316','#f43f5e'];
  return(<div className='space-y-4'>
    <div style={glass} className='p-5'><h3 className='text-sm font-bold text-[var(--text-primary)] mb-4'>تقادم الذمم المدينة (AR Aging)</h3>
      <div className='h-64'><ResponsiveContainer width='100%' height='100%'>
        <BarChart data={d.arAging}><CartesianGrid strokeDasharray='3 3' stroke={dark?'rgba(255,255,255,0.06)':'rgba(99,102,241,0.08)'} vertical={false}/>
          <XAxis dataKey='label' stroke={axC} fontSize={10} tickLine={false} axisLine={false}/>
          <YAxis stroke={axC} fontSize={10} tickLine={false} axisLine={false} tickFormatter={(v:number)=>`${Math.round(v/1000)}k`}/>
          <Tooltip contentStyle={tt} formatter={(v:unknown)=>[fmt(Number(v))+' DZD','مستحق']}/>
          <Bar dataKey='dzd' radius={[6,6,0,0]}>{d.arAging.map((_,i)=><Cell key={i} fill={colors[i]}/>)}</Bar>
        </BarChart>
      </ResponsiveContainer></div>
    </div>
    <div style={glass} className='p-5 space-y-3'>
      <div className='text-xs font-bold text-[var(--text-muted)] uppercase tracking-wide mb-3'>تفصيل الذمم</div>
      {d.arAging.map((a,i)=>(<div key={i} className='flex items-center justify-between gap-3'>
        <div className='flex items-center gap-2'><span className='h-3 w-3 rounded-full' style={{background:colors[i]}}/><span className='text-xs text-[var(--text-secondary)]'>{a.label}</span></div>
        <div className='flex items-center gap-4'>
          <div className='w-32 h-1.5 bg-[var(--bg-hover)] rounded-full overflow-hidden'>
            <div className='h-full rounded-full transition-all duration-700' style={{width:`${d.pendingDzd>0?(a.dzd/d.pendingDzd)*100:0}%`,background:colors[i]}}/>
          </div>
          <span className='text-sm font-bold tabular-nums'>{fmt(a.dzd)}</span>
          <span className='text-xs text-[var(--text-muted)]'>{d.pendingDzd>0?pct((a.dzd/d.pendingDzd)*100):'0%'}</span>
        </div>
      </div>))}
      <RR label='إجمالي الذمم المعلقة' value={`${fmt(d.pendingDzd)}`} bold border color='text-amber-600'/>
    </div>
  </div>);
}

export function RatiosTab({d}:{d:Fin}){
  const liq=d.expensesDzd>0?(d.collectedDzd/d.expensesDzd):0;
  const debt=d.collectedDzd>0?(d.pendingDzd/d.collectedDzd)*100:0;
  const gm=d.collectedDzd>0?((d.collectedDzd-d.expensesDzd)/d.collectedDzd)*100:0;
  const opEff=d.expensesDzd>0?(d.netProfitDzd/d.expensesDzd)*100:0;
  const ros=d.totalRevDzd>0?(d.netProfitDzd/d.totalRevDzd)*100:0;
  const items=[
    {lbl:'نسبة السيولة',val:f2(liq)+'×',note:'مثالي >1',good:liq>=1,tip:'المحصّل ÷ المصاريف'},
    {lbl:'نسبة الديون',val:pct(debt),note:'مثالي <30%',good:debt<30,tip:'ذمم معلقة ÷ إيرادات'},
    {lbl:'هامش الربح الإجمالي',val:pct(gm),note:'مثالي >20%',good:gm>=20,tip:'(إيرادات-مصاريف) ÷ إيرادات'},
    {lbl:'كفاءة التشغيل',val:pct(opEff),note:'مثالي >15%',good:opEff>=15,tip:'صافي ربح ÷ مصاريف'},
    {lbl:'العائد على المبيعات',val:pct(ros),note:'مثالي >15%',good:ros>=15,tip:'صافي ربح ÷ إجمالي إيرادات'},
    {lbl:'معدل التحصيل',val:pct(d.collectionRate),note:'مثالي >85%',good:d.collectionRate>=85,tip:'محصّل ÷ مستحق'},
    {lbl:'نمو شهري',val:pct(d.monthlyGrowth),note:'مثالي >5%',good:d.monthlyGrowth>=5,tip:'نمو الإيراد شهر/شهر'},
    {lbl:'متوسط الإيراد/معتمر',val:fmt(d.avgPerPilgrim)+' DZD',note:'مرجع',good:true,tip:'إجمالي محصّل ÷ عدد حجوزات'},
  ];
  return(<div style={glass} className='p-6'>
    <div className='text-xs font-bold text-[var(--text-muted)] uppercase tracking-wide mb-4'>النسب المالية الرئيسية</div>
    <div className='grid grid-cols-1 sm:grid-cols-2 gap-3'>
      {items.map(r=>(<div key={r.lbl} style={glassInner} className='p-4 space-y-2'>
        <div className='flex items-start justify-between gap-2'>
          <span className='text-xs font-medium text-[var(--text-muted)]'>{r.lbl}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${r.good?'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300':'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300'}`}>{r.note}</span>
        </div>
        <div className={`text-xl font-bold tabular-nums ${r.good?'text-emerald-600 dark:text-emerald-400':'text-rose-600 dark:text-rose-400'}`}>{r.val}</div>
        <div className='text-[10px] text-[var(--text-muted)]'>{r.tip}</div>
      </div>))}
    </div>
  </div>);
}

export function MarginTab({d}:{d:Fin}){
  const[exp,setExp]=useState('');
  const e=pf(exp)||d.expensesDzd; const g=d.collectedDzd-e; const m=d.collectedDzd>0?(g/d.collectedDzd)*100:0; const mk=e>0?(g/e)*100:0;
  return(<div className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
    <div style={glass} className='p-5 space-y-3'>
      <div className='text-xs font-bold text-[var(--text-muted)] uppercase mb-2'>المدخلات</div>
      <Inp label='المحصّل (DZD) — من DB' value={String(Math.round(d.collectedDzd))} readOnly/>
      <Inp label='المصاريف الفعلية (DZD)' value={exp} onChange={setExp} placeholder='أدخل المصاريف الفعلية...'/>
      <div className='text-xs text-[var(--text-muted)]'>إذا تركت الحقل فارغاً يُستخدم إجمالي النفقات المحاسبية من دفتر الأستاذ (Real Ledger Expenses)</div>
    </div>
    <div style={glass} className='p-5 space-y-3'>
      <div className='text-xs font-bold text-[var(--text-muted)] uppercase mb-2'>النتائج</div>
      <RR label='الربح الإجمالي'         value={`${fmt(g)}`}     color={g>=0?'text-emerald-600':'text-rose-600'}/>
      <RR label='هامش الربح (GP Margin)' value={pct(m)}              color={m>=20?'text-emerald-600':m>=10?'text-amber-600':'text-rose-600'}/>
      <RR label='نسبة الترميز (Markup)'  value={pct(mk)}/>
      <RR label='متوسط/معتمر'            value={`${fmt(d.avgPerPilgrim)}`}/>
      <RR label='معدل التحصيل'           value={pct(d.collectionRate)} color={d.collectionRate>=80?'text-emerald-600':'text-amber-600'}/>
      <div className='pt-2'><div className='text-[10px] text-[var(--text-muted)] mb-1'>هامش الربح</div>
        <div className='w-full h-3 bg-[var(--bg-hover)] rounded-full overflow-hidden'>
          <div className={`h-full rounded-full transition-all duration-700 ${m>=20?'bg-emerald-500':m>=10?'bg-amber-500':'bg-rose-500'}`} style={{width:`${Math.min(100,Math.max(0,m))}%`}}/>
        </div>
      </div>
    </div>
  </div>);
}

export function ProjectionTab({d}:{d:Fin}){
  const[tgt,setTgt]=useState(''); const[el,setEl]=useState(''); const[tot,setTot]=useState(''); const[gr,setGr]=useState('');
  const t2=pf(tgt); const e2=Math.max(pf(el,1),1); const to=Math.max(pf(tot,1),1);
  const proj=d.collectedDzd>0?(d.collectedDzd/e2)*to:0;
  const gap=t2>0?t2-proj:0; const needed=e2<to?((t2-d.collectedDzd)/(to-e2)):0;
  const g2=pf(gr,d.monthlyGrowth);
  return(<div className='space-y-4'>
    <div className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
      <div style={glass} className='p-5 space-y-3'>
        <div className='text-xs font-bold text-[var(--text-muted)] uppercase mb-2'>مدخلات التوقع</div>
        <Inp label='الهدف المالي (DZD)' value={tgt} onChange={setTgt} placeholder='الهدف السنوي...'/>
        <Inp label='أيام مضت' value={el} onChange={setEl} placeholder='مثال: 120'/>
        <Inp label='مدة الفترة الكلية (أيام)' value={tot} onChange={setTot} placeholder='مثال: 365'/>
        <Inp label='معدل النمو الشهري المتوقع (%)' value={gr} onChange={setGr} placeholder={`الحالي: ${f1(d.monthlyGrowth)}%`} step='0.1'/>
      </div>
      <div style={glass} className='p-5 space-y-3'>
        <div className='text-xs font-bold text-[var(--text-muted)] uppercase mb-2'>التوقعات</div>
        <RR label='الإيراد المتوقع نهاية الفترة' value={`${fmt(proj)}`} color='text-blue-600'/>
        <RR label='تقدم الفترة'                  value={pct(to>0?(e2/to)*100:0)}/>
        <RR label='الفجوة عن الهدف'             value={gap>0?`${fmt(gap)}`:'✅ تحقق الهدف'} color={gap>0?'text-rose-500':'text-emerald-600'}/>
        <RR label='إيراد يومي مطلوب'            value={needed>0?`${fmt(needed)}/يوم`:'—'} color='text-amber-600'/>
        <div className='border-t border-[var(--border)] pt-3 mt-1 space-y-2'>
          <div className='text-[10px] text-[var(--text-muted)] mb-1'>توقع بمعدل نمو {pct(g2)}/شهر</div>
          <RR label='بعد 3 أشهر'  value={`${fmt(d.collectedDzd*Math.pow(1+g2/100,3))}`}/>
          <RR label='بعد 6 أشهر'  value={`${fmt(d.collectedDzd*Math.pow(1+g2/100,6))}`}/>
          <RR label='بعد 12 شهر'  value={`${fmt(d.collectedDzd*Math.pow(1+g2/100,12))}`} bold color='text-blue-600'/>
        </div>
      </div>
    </div>
  </div>);
}

export function TaxTab({d}:{d:Fin}){
  return(<div style={glass} className='p-6 space-y-2 max-w-2xl'>
    <div className='text-xs font-bold text-[var(--text-muted)] uppercase mb-4'>الضرائب والرسوم</div>
    <div className='text-sm text-amber-600 p-4 bg-amber-50 dark:bg-amber-900/20 rounded-xl'>لا توجد ضرائب مسجلة في دفتر الأستاذ حالياً.</div>
  </div>);
}
export function LoanTab(){
  const[pr2,setPr]=useState(''); const[rt,setRt]=useState('6'); const[mo,setMo]=useState('24'); const[gc,setGc]=useState('0');
  const pr=pf(pr2); const mr=pf(rt)/100/12; const m2=Math.max(parseInt(mo)||1,1); const g2=parseInt(gc)||0; const eff=m2-g2;
  const mPay=mr>0&&eff>0?pr*(mr*Math.pow(1+mr,eff))/(Math.pow(1+mr,eff)-1):eff>0?pr/eff:0;
  const tot2=mPay*eff; const int2=tot2-pr;
  const sched=pr>0?Array.from({length:Math.min(m2,12)},(_,i)=>{
    if(i<g2)return{m:i+1,pay:0,int:0,pri:0,bal:pr};
    const mi=i-g2; const intv=mPay-(mr>0?pr*mr*Math.pow(1+mr,mi)/(Math.pow(1+mr,eff)-1):mPay/eff||0);
    return{m:i+1,pay:mPay,int:mPay-intv,pri:intv,bal:Math.max(0,pr-intv*(mi+1))};
  }):[];
  return(<div className='space-y-4'>
    <div className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
      <div style={glass} className='p-5 space-y-3'>
        <div className='text-xs font-bold text-[var(--text-muted)] uppercase mb-2'>تفاصيل القرض</div>
        <Inp label='مبلغ القرض (DZD)' value={pr2} onChange={setPr} placeholder='أدخل المبلغ...'/>
        <Inp label='معدل الفائدة السنوي (%)' value={rt} onChange={setRt} step='0.1'/>
        <Inp label='مدة القرض (أشهر)' value={mo} onChange={setMo}/>
        <Inp label='فترة السماح (أشهر)' value={gc} onChange={setGc} placeholder='0'/>
      </div>
      <div style={glass} className='p-5 space-y-3'>
        <div className='text-xs font-bold text-[var(--text-muted)] uppercase mb-2'>نتائج التمويل</div>
        <RR label='القسط الشهري'          value={`${fmt(mPay)}`}         color='text-blue-600' bold/>
        <RR label='مدة السداد الفعلية'    value={`${eff} شهر`}/>
        <RR label='إجمالي المدفوعات'      value={`${fmt(tot2)}`}/>
        <RR label='إجمالي الفوائد'        value={`${fmt(int2)}`}         color='text-rose-500'/>
        <RR label='نسبة الفوائد'         value={pr>0?pct((int2/pr)*100):'—'}  color='text-amber-500'/>
        <RR label='تكلفة القرض السنوية'   value={pct(pf(rt))}/>
      </div>
    </div>
    {pr>0&&(<div style={glass} className='p-5'>
      <div className='text-xs font-bold text-[var(--text-muted)] uppercase mb-3'>جدول الاستهلاك (أول 12 قسط)</div>
      <div className='overflow-x-auto'><table className='w-full text-xs'>
        <thead><tr className='text-[var(--text-muted)]'>
          <th className='text-start pb-2 font-medium'>القسط</th>
          <th className='text-end pb-2 font-medium'>المبلغ</th>
          <th className='text-end pb-2 font-medium'>فائدة</th>
          <th className='text-end pb-2 font-medium'>أصل</th>
          <th className='text-end pb-2 font-medium'>الرصيد</th>
        </tr></thead>
        <tbody>{sched.map(r=>(<tr key={r.m} className='border-t border-[var(--border)]'>
          <td className='py-1.5 text-[var(--text-secondary)]'>{r.m}</td>
          <td className='py-1.5 text-end tabular-nums'>{fmt(r.pay)}</td>
          <td className='py-1.5 text-end tabular-nums text-rose-500'>{fmt(r.int)}</td>
          <td className='py-1.5 text-end tabular-nums text-emerald-600'>{fmt(r.pri)}</td>
          <td className='py-1.5 text-end tabular-nums font-medium'>{fmt(r.bal)}</td>
        </tr>))}</tbody>
      </table></div>
    </div>)}
  </div>);
}

export function BepTab({d}:{d:Fin}){
  return(<div style={glass} className='p-6 space-y-2 max-w-2xl'>
    <div className='text-xs font-bold text-[var(--text-muted)] uppercase mb-4'>نقطة التعادل</div>
    <div className='text-sm text-amber-600 p-4 bg-amber-50 dark:bg-amber-900/20 rounded-xl'>يرجى إدخال المصروفات الثابتة في دفتر الأستاذ لحساب التعادل.</div>
  </div>);
}
export function BudgetTab({d}:{d:Fin}){
  return(<div style={glass} className='p-6 space-y-2 max-w-2xl'>
    <div className='text-xs font-bold text-[var(--text-muted)] uppercase mb-4'>الميزانية التقديرية</div>
    <div className='text-sm text-amber-600 p-4 bg-amber-50 dark:bg-amber-900/20 rounded-xl'>لا توجد بيانات ميزانية معتمدة.</div>
  </div>);
}
export function JournalTab({d}:{d:Fin}){
  return(<div style={glass} className='p-5'>
    <div className='text-xs font-bold text-[var(--text-muted)] uppercase mb-4'>آخر قيود اليومية (مولّدة تلقائياً من المدفوعات)</div>
    <div className='overflow-x-auto'><table className='w-full text-xs'>
      <thead><tr className='text-[var(--text-muted)]'>
        <th className='text-start pb-3 font-medium'>التاريخ</th>
        <th className='text-start pb-3 font-medium'>المرجع</th>
        <th className='text-start pb-3 font-medium'>مدين (DR)</th>
        <th className='text-start pb-3 font-medium'>دائن (CR)</th>
        <th className='text-end pb-3 font-medium'>المبلغ (DZD)</th>
        <th className='text-start pb-3 font-medium'>البيان</th>
      </tr></thead>
      <tbody>{d.journalEntries.map((e,i)=>(<tr key={i} className='border-t border-[var(--border)]'>
        <td className='py-2 text-[var(--text-muted)]'>{e.date}</td>
        <td className='py-2 font-mono text-indigo-600 dark:text-indigo-400'>{e.ref}</td>
        <td className='py-2 text-emerald-700 dark:text-emerald-400'>{e.debit}</td>
        <td className='py-2 text-rose-600 dark:text-rose-400'>{e.credit}</td>
        <td className='py-2 text-end tabular-nums font-semibold'>{fmt(e.dzd)}</td>
        <td className='py-2 text-[var(--text-secondary)]'>{e.desc}</td>
      </tr>))}</tbody>
    </table></div>
    <div className='mt-4 p-3 rounded-xl bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 text-xs'>💡 هذه القيود مولّدة تلقائياً. للقيد المزدوج الكامل استخدم قسم «دفتر القيود».</div>
  </div>);
}


