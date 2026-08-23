import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import {
  Database, CheckCircle2, AlertTriangle, ShieldCheck, XCircle,
  RefreshCw, Radio, Clock, Users, CreditCard, FileText, Map,
  Bus, AlertOctagon,
} from "lucide-react";
import { Spinner } from "@/components/admin/ui";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";

interface CheckResult {
  id: string;
  ar: string; fr: string; en: string;
  status: "OK" | "WARN" | "CRITICAL";
  threshold: string;
  actual: string;
  icon: React.ReactNode;
  detail?: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const statusOf = (good: boolean, tolerable: boolean): "OK" | "WARN" | "CRITICAL" =>
  good ? "OK" : tolerable ? "WARN" : "CRITICAL";

import React from "react";

export default function DataQualityDashboard() {
  const { lang } = useI18n();
  const isAr = lang === "ar" || lang === "dz";
  const isFr = lang === "fr";
  const t = (ar: string, fr: string, en: string) => (isAr ? ar : isFr ? fr : en);
  const [summaryData, setSummaryData] = useState<Record<string, unknown> | null>(null);
  const [loading,   setLoading]    = useState(true);
  const [updatedAt, setUpdatedAt]  = useState<Date | null>(null);
  const [isLive,    setIsLive]     = useState(false);
  const genRef = useRef(0);

  const fetchAll = useCallback(async () => {
    if (!isSupabaseConfigured) { setLoading(false); return; }
    const gen = ++genRef.current;
    setLoading(true);
    const { data } = await supabase.rpc("get_data_quality_snapshot");
    if (gen !== genRef.current) return;
    if (data) {
      setSummaryData(data as Record<string, unknown>);
      setUpdatedAt(new Date());
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void fetchAll();
    if (!isSupabaseConfigured) return;
    const tables = ["pilgrims","bookings","visas","alerts","incidents","documents","payments","groups"];
    const channels = tables.map(table =>
      supabase.channel("dq-" + table)
        .on("postgres_changes", { event: "*", schema: "public", table }, () => { void fetchAll(); })
        .subscribe(status => { if (status === "SUBSCRIBED") setIsLive(true); })
    );
    return () => { channels.forEach(c => { void supabase.removeChannel(c); }); setIsLive(false); };
  }, [fetchAll]);

  const { checks, scoreCards, summary } = useMemo(() => {
    if (!summaryData) return { checks: [], scoreCards: [], summary: { criticalCount:0, warnCount:0, okCount:0, allOk:true, score:100, visaCounts:{}, total:0 } };
    const {
      total_pilgrims: total,
      with_passport: withPassport,
      dup_emails: dupEmails,
      missing_phone: missingPhone,
      missing_birth: missingBirth,
      stale_bookings: staleBookings,
      orphan_bookings: orphanBookings,
      orphan_payments: orphanPayments,
      open_alerts: openAlerts,
      open_incidents: openIncidents,
      expired_docs: expiredDocs,
      soon_expiry: soonExpiry,
      groups_no_guide: groupsNoGuide,
      groups_no_transport: groupsNoTransport,
      visa_counts: visaCounts = {},
    } = summaryData as {
      total_pilgrims: number;
      with_passport: number;
      dup_emails: number;
      missing_phone: number;
      missing_birth: number;
      stale_bookings: number;
      orphan_bookings: number;
      orphan_payments: number;
      open_alerts: number;
      open_incidents: number;
      expired_docs: number;
      soon_expiry: number;
      groups_no_guide: number;
      groups_no_transport: number;
      visa_counts: Record<string, number>;
    };
    const passportPct   = total ? Math.round((withPassport / total) * 100) : 100;

    const checks: CheckResult[] = [
      { id:"passport",      icon:<FileText className="h-4 w-4"/>,    ar:"اكتمال جوازات السفر",           fr:"Complétude passeports",           en:"Passport completeness",     status:statusOf(passportPct>=95,passportPct>=80),      threshold:"≥ 95%",  actual:`${passportPct}% (${withPassport}/${total})` },
      { id:"phone",         icon:<Users className="h-4 w-4"/>,       ar:"نقص أرقام الهواتف",              fr:"Téléphones manquants",            en:"Missing phones",            status:statusOf(missingPhone===0,missingPhone<=Math.max(3,Math.ceil(total*0.05))), threshold:"0", actual:String(missingPhone) },
      { id:"birth",         icon:<Users className="h-4 w-4"/>,       ar:"تواريخ الميلاد المفقودة",        fr:"Dates naissance manquantes",      en:"Missing birth dates",       status:statusOf(missingBirth===0,missingBirth<=Math.ceil(total*0.05)),            threshold:"0", actual:String(missingBirth) },
      { id:"dup_email",     icon:<Users className="h-4 w-4"/>,       ar:"البريد الإلكتروني المكرر",       fr:"Emails dupliqués",                en:"Duplicate emails",          status:statusOf(dupEmails===0,dupEmails<=3),            threshold:"0",      actual:String(dupEmails) },
      { id:"stale",         icon:<CreditCard className="h-4 w-4"/>,  ar:"حجوزات معلقة > 7 أيام",         fr:"Réservations en attente +7j",     en:"Stale pending bookings",    status:statusOf(staleBookings===0,staleBookings<=5),   threshold:"0",      actual:String(staleBookings) },
      { id:"orphan_bkg",    icon:<CreditCard className="h-4 w-4"/>,  ar:"حجوزات بدون حاج",               fr:"Réservations sans pèlerin",       en:"Bookings without pilgrim",  status:statusOf(orphanBookings===0,orphanBookings<=2), threshold:"0",      actual:String(orphanBookings) },
      { id:"orphan_pay",    icon:<CreditCard className="h-4 w-4"/>,  ar:"مدفوعات بدون حجز",              fr:"Paiements sans réservation",      en:"Payments without booking",  status:statusOf(orphanPayments===0,orphanPayments<=2), threshold:"0",      actual:String(orphanPayments) },
      { id:"alerts",        icon:<AlertOctagon className="h-4 w-4"/>,ar:"تنبيهات مفتوحة",                fr:"Alertes ouvertes",                en:"Open alerts",               status:statusOf(openAlerts===0,openAlerts<=5),         threshold:"0",      actual:String(openAlerts) },
      { id:"incidents",     icon:<AlertTriangle className="h-4 w-4"/>,ar:"حوادث مفتوحة",               fr:"Incidents ouverts",               en:"Open incidents",            status:statusOf(openIncidents===0,openIncidents<=3),   threshold:"0",      actual:String(openIncidents) },
      { id:"exp_docs",      icon:<FileText className="h-4 w-4"/>,    ar:"وثائق منتهية الصلاحية",         fr:"Documents expirés",              en:"Expired documents",         status:statusOf(expiredDocs===0,expiredDocs<=2),       threshold:"0",      actual:String(expiredDocs), detail:soonExpiry>0?`${soonExpiry} `+t("تنتهي خلال 30 يوم","expirent dans 30j","expiring in 30d"):undefined },
      { id:"grp_guide",     icon:<Map className="h-4 w-4"/>,         ar:"مجموعات بدون مرشد",             fr:"Groupes sans guide",             en:"Groups without guide",      status:statusOf(groupsNoGuide===0,groupsNoGuide<=1),   threshold:"0",      actual:String(groupsNoGuide) },
      { id:"grp_transport", icon:<Bus className="h-4 w-4"/>,         ar:"مجموعات بدون نقل",              fr:"Groupes sans transport",         en:"Groups without transport",  status:statusOf(groupsNoTransport===0,groupsNoTransport<=1), threshold:"0", actual:String(groupsNoTransport) },
    ];
    const criticalCount = checks.filter(c => c.status === "CRITICAL").length;
    const warnCount     = checks.filter(c => c.status === "WARN").length;
    const okCount       = checks.filter(c => c.status === "OK").length;
    const score         = checks.length > 0 ? Math.round((okCount / checks.length) * 100) : 100;
    const allOk         = criticalCount === 0 && warnCount === 0;
    const scoreCards = [
      { id:"passport",  label:t("اكتمال الجوازات","Passeports","Passports"),       value:`${passportPct}%`,   bar:passportPct, status:checks.find(c=>c.id==="passport")!.status },
      { id:"dup",       label:t("بريد مكرر","Emails dupliqués","Dup Emails"),       value:String(dupEmails),   bar:null,        status:checks.find(c=>c.id==="dup_email")!.status },
      { id:"phone",     label:t("هواتف مفقودة","Tél. manquants","Missing Phones"), value:String(missingPhone),bar:null,        status:checks.find(c=>c.id==="phone")!.status },
      { id:"stale",     label:t("حجوزات قديمة","Réserv. anciennes","Stale"),        value:String(staleBookings),bar:null,      status:checks.find(c=>c.id==="stale")!.status },
      { id:"docs",      label:t("وثائق منتهية","Docs expirés","Expired Docs"),      value:String(expiredDocs), bar:null,       status:checks.find(c=>c.id==="exp_docs")!.status },
      { id:"health",    label:t("صحة البيانات","Santé données","Data Health"),       value:`${score}%`,         bar:score,      status:(score>=90?"OK":score>=70?"WARN":"CRITICAL") as "OK"|"WARN"|"CRITICAL" },
    ];
    return { checks, scoreCards, summary:{ criticalCount, warnCount, okCount, allOk, score, visaCounts, total } };
  }, [summaryData, t]);

  const statusColor = (s: string) => s==="OK" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" : s==="WARN" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" : "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400";
  const barColor    = (s: string) => s==="OK" ? "bg-emerald-500" : s==="WARN" ? "bg-amber-500" : "bg-rose-500";
  const iconOf      = (s: string) => s==="OK" ? <CheckCircle2 className="h-5 w-5 text-emerald-500"/> : s==="WARN" ? <AlertTriangle className="h-5 w-5 text-amber-500"/> : <XCircle className="h-5 w-5 text-rose-500"/>;

  return (
    <div className={`space-y-6 ${isAr?"rtl":"ltr"}`}>
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-brand-500/10 flex items-center justify-center">
            <Database className="h-5 w-5 text-brand-500"/>
          </div>
          <div>
            <h1 className="text-lg font-semibold text-[var(--text-primary)]">{t("جودة البيانات","Qualité des données","Data Quality")}</h1>
            <p className="text-[12px] text-[var(--text-muted)]">{t("12 فحص مباشر — يتحدث مع كل تغيير","12 vérifications temps réel","12 live checks — updates on every change")}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className={`flex items-center gap-1.5 text-[11px] font-semibold rounded-full px-3 py-1 ${isLive?"bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400":"bg-[var(--bg-hover)] text-[var(--text-muted)]"}`}>
            <Radio className={`h-3 w-3 ${isLive?"animate-pulse":""}`}/>
            {isLive?t("مباشر","En direct","LIVE"):t("غير متصل","Hors ligne","OFFLINE")}
          </span>
          {updatedAt && (
            <span className="flex items-center gap-1 text-[11px] text-[var(--text-muted)]">
              <Clock className="h-3 w-3"/>
              {updatedAt.toLocaleTimeString()}
            </span>
          )}
          <button type="button" className="btn btn-ghost text-[13px] flex items-center gap-1.5" onClick={()=>void fetchAll()} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading?"animate-spin":""}`}/>
            {t("تحديث","Actualiser","Refresh")}
          </button>
        </div>
      </div>

      {loading && !updatedAt ? (
        <div className="p-10 flex justify-center"><Spinner/></div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {scoreCards.map(m => (
              <div key={m.id} className="card p-5 flex flex-col justify-between">
                <div className="flex items-start justify-between mb-4">
                  <span className="text-sm font-bold text-[var(--text-primary)]">{m.label}</span>
                  {iconOf(m.status)}
                </div>
                <div>
                  <div className="text-3xl font-semibold text-[var(--text-primary)]">{m.value}</div>
                  {m.bar !== null && (
                    <div className="w-full h-1.5 bg-[var(--bg-hover)] rounded-full mt-3 overflow-hidden">
                      <div className={`h-full rounded-full transition-all duration-700 ${barColor(m.status)}`} style={{width:`${Math.min(100,m.bar)}%`}}/>
                    </div>
                  )}
                  {m.id==="health" && Object.keys(summary.visaCounts).length>0 && (
                    <div className="flex flex-wrap gap-1.5 mt-3">
                      {Object.entries(summary.visaCounts).map(([s,c])=>(
                        <span key={s} className="rounded-full px-2.5 py-0.5 text-[10px] font-bold bg-[var(--bg-hover)] text-[var(--text-secondary)]">{s}: {c}</span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="card overflow-hidden">
            <div className="p-4 border-b border-[var(--border)] flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-bold text-[var(--text-primary)]">{t("تفاصيل الفحوصات (12)","Détail vérifications (12)","Check Breakdown (12)")}</h3>
              <div className="flex items-center gap-2 text-xs">
                <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 font-bold">{summary.okCount} OK</span>
                {summary.warnCount>0 && <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 font-bold">{summary.warnCount} WARN</span>}
                {summary.criticalCount>0 && <span className="px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400 font-bold">{summary.criticalCount} CRITICAL</span>}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead className={`text-xs text-[var(--text-secondary)] bg-[var(--bg-hover)]/50 ${isAr?"text-end":"text-start"}`}>
                  <tr>
                    <th className="px-3 py-3 font-medium w-8"/>
                    <th className="px-4 py-3 font-medium">{t("الفحص","Vérification","Check")}</th>
                    <th className="px-4 py-3 font-medium">{t("الحالة","Statut","Status")}</th>
                    <th className="px-4 py-3 font-medium">{t("المعيار","Seuil","Threshold")}</th>
                    <th className="px-4 py-3 font-medium">{t("الفعلي","Réel","Actual")}</th>
                    <th className="px-4 py-3 font-medium">{t("ملاحظة","Note","Note")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]">
                  {checks.map(c => (
                    <tr key={c.id} className="hover:bg-[var(--bg-hover)]/30 transition-colors">
                      <td className="px-3 py-3 text-[var(--text-muted)]">{c.icon}</td>
                      <td className="px-4 py-3 font-medium text-[var(--text-primary)]">{t(c.ar,c.fr,c.en)}</td>
                      <td className="px-4 py-3"><span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold ${statusColor(c.status)}`}>{c.status}</span></td>
                      <td className="px-4 py-3 text-[var(--text-secondary)] tabular-nums">{c.threshold}</td>
                      <td className="px-4 py-3 font-semibold text-[var(--text-primary)] tabular-nums">{c.actual}</td>
                      <td className="px-4 py-3 text-[11px] text-[var(--text-muted)] italic">{c.detail ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className={`rounded-xl border p-5 flex items-center gap-4 ${summary.allOk?"border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-900/10":summary.criticalCount>0?"border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-900/10":"border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/10"}`}>
            <div className={`h-12 w-12 rounded-full flex items-center justify-center shrink-0 ${summary.allOk?"bg-emerald-100 dark:bg-emerald-900/30":summary.criticalCount>0?"bg-rose-100 dark:bg-rose-900/30":"bg-amber-100 dark:bg-amber-900/30"}`}>
              {summary.allOk
                ? <ShieldCheck className="h-6 w-6 text-emerald-600 dark:text-emerald-400"/>
                : <AlertTriangle className={`h-6 w-6 ${summary.criticalCount>0?"text-rose-600 dark:text-rose-400":"text-amber-600 dark:text-amber-400"}`}/>}
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-bold text-[var(--text-primary)]">
                {summary.allOk
                  ? t("النظام صحي — جميع الفحوصات نجحت","Système sain","All checks passed")
                  : t(`نتيجة: ${summary.score}%`,`Score: ${summary.score}%`,`Score: ${summary.score}%`)}
              </h3>
              {!summary.allOk && (
                <p className="text-xs text-[var(--text-secondary)] mt-1">
                  {t(`حرجة: ${summary.criticalCount} · تحذيرات: ${summary.warnCount} · ناجحة: ${summary.okCount}/${checks.length}`,
                     `Critiques: ${summary.criticalCount} · Alertes: ${summary.warnCount} · OK: ${summary.okCount}/${checks.length}`,
                     `Critical: ${summary.criticalCount} · Warnings: ${summary.warnCount} · OK: ${summary.okCount}/${checks.length}`)}
                </p>
              )}
            </div>
            <div className="text-right shrink-0">
              <div className={`text-2xl font-bold ${summary.allOk?"text-emerald-600":summary.criticalCount>0?"text-rose-600":"text-amber-600"}`}>{summary.score}%</div>
              <div className="text-[11px] text-[var(--text-muted)]">{t("صحة البيانات","Santé","Health score")}</div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
