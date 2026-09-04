import { useConfirmDialog } from '@/components/ConfirmDialog';
import Select from '@/components/admin/GlassSelect';
import { useEffect, useState } from 'react';
import { useI18n } from '@/i18n/I18nProvider';
import { Search, FileText, Plane, Users, Plus, Trash2, AlertCircle, Pencil, UserPlus, X, ExternalLink } from 'lucide-react';
import { Spinner } from '@/components/admin/ui';
import { useSupabaseData } from '@/hooks/useSupabaseData';
import { pilgrimCommands } from '@/services/domainCommands';
import { supabase } from '@/lib/supabase';
import GlassDate from '@/components/admin/GlassDate';
import type { PilgrimRow } from '@/types/database';
import { PilgrimProfile360 } from '@/components/admin/PilgrimProfile360';

interface GroupSummary { id: string; code: string | null; name: string | null; }
interface PackageSummary { id: string; code: string | null; name: string | null; }

const VISA_STATI = [
  'NOT_STARTED', 'DOCUMENTS_REQUIRED', 'DOCUMENTS_PARTIAL', 'DOCUMENTS_COMPLETE',
  'UNDER_REVIEW', 'READY_FOR_SUBMISSION', 'SUBMITTED', 'PROCESSING',
  'ADDITIONAL_INFO_REQUIRED', 'APPROVED', 'ISSUED', 'REJECTED', 'CANCELLED',
];
const PAYMENT_STATI = ['PENDING', 'PARTIAL', 'PAID'];
const PILGRIM_STATI = ['REGISTERED', 'DOCS_PENDING', 'VISA_READY', 'READY', 'TRAVELING', 'RETURNED', 'INACTIVE'];

const inputCls = 'input';

const visaPill = (s: string) => {
  if (s === 'ISSUED' || s === 'APPROVED' || s === 'DOCUMENTS_COMPLETE') return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400';
  if (s === 'REJECTED' || s === 'CANCELLED' || s === 'ADDITIONAL_INFO_REQUIRED') return 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-400';
  if (s === 'SUBMITTED' || s === 'PROCESSING' || s === 'UNDER_REVIEW') return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400';
  if (s === 'READY_FOR_SUBMISSION' || s && s.startsWith('DOCUMENTS')) return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400';
  return 'bg-[var(--bg-hover)] text-[var(--text-secondary)] dark:bg-[var(--bg-hover)] dark:text-[var(--text-secondary)]';
};

const payPill = (s: string) =>
  s === 'PAID' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400'
  : s === 'PARTIAL' ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400'
  : 'bg-[var(--bg-hover)] text-[var(--text-secondary)] dark:bg-[var(--bg-hover)] dark:text-[var(--text-secondary)]';

const statusPill = (s: string) =>
  s === 'TRAVELING' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400'
  : s === 'VISA_READY' || s === 'READY' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400'
  : s === 'DOCS_PENDING' ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400'
  : s === 'RETURNED' ? 'bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-400'
  : 'bg-[var(--bg-hover)] text-[var(--text-secondary)] dark:bg-[var(--bg-hover)] dark:text-[var(--text-secondary)]';

export function PilgrimManager({
  pilgrims: fallback = [],
  onOpenNewReservationModal,
}: {
  pilgrims?: PilgrimRow[];
  onOpenNewReservationModal?: () => void;
}) {
  const confirmDialog = useConfirmDialog();
  const { lang } = useI18n();
  const isAr = lang === 'ar';
  const isFr = lang === 'fr';
  const t = (ar: string, fr: string, en: string) => (isAr ? ar : isFr ? fr : en);

  const { data: pilgrims, loading } = useSupabaseData<PilgrimRow>({
    table: 'pilgrims',
    orderBy: { column: 'created_at', ascending: false },
    fallbackData: fallback,
  });

  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [packages, setPackages] = useState<PackageSummary[]>([]);
  
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  
  const toggleSelection = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedIds(newSet);
  };
  
  const toggleAll = () => {
    if (selectedIds.size === filtered.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(filtered.map(p => p.id)));
  };

  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    full_name: '', full_name_ar: '', passport_number: '', phone: '', email: '',
    gender: 'M', birth_date: '', nationality: '', wilaya: '', departure_airport: '',
    group_id: '', package_id: '', visa_status: 'NOT_STARTED', payment_status: 'PENDING', status: 'REGISTERED',
  });
  const [editId, setEditId] = useState<string | null>(null);
  const [profile360Id, setProfile360Id] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    supabase.from('groups').select('id, code, name').then(({ data }) => {
      if (active && data) setGroups(data as GroupSummary[]);
    });
    supabase.from('packages').select('id, code, name').then(({ data }) => {
      if (active && data) setPackages(data as PackageSummary[]);
    });
    return () => { active = false; };
  }, []);

  const handleBulkStatus = async (status: string) => {
    if (!status) return;
    if (confirm(t('هل أنت متأكد من تغيير حالة ' + selectedIds.size + ' حاج؟', 'Confirmer le changement de statut pour ' + selectedIds.size + ' pèlerins?', 'Confirm status change for ' + selectedIds.size + ' pilgrims?'))) {
      await Promise.all(Array.from(selectedIds).map(id => pilgrimCommands.update(id, { status })));
      window.location.reload();
      setSelectedIds(new Set());
    }
  };

  const handleBulkGroup = async (groupId: string) => {
    if (!groupId) return;
    if (confirm(t('هل أنت متأكد من تعيين ' + selectedIds.size + ' حاج للفوج؟', 'Confirmer l\'assignation de ' + selectedIds.size + ' pèlerins au groupe?', 'Confirm assigning ' + selectedIds.size + ' pilgrims to group?'))) {
      await Promise.all(Array.from(selectedIds).map(id => pilgrimCommands.update(id, { group_id: groupId })));
      window.location.reload();
      setSelectedIds(new Set());
    }
  };

  const groupMap = new Map(groups.map(g => [g.id, g]));
  const packageMap = new Map(packages.map(p => [p.id, p]));

  const set = (k: string, v: string) => setForm((prev) => ({ ...prev, [k]: v }));

  const submit = async () => {
    if (!form.full_name.trim()) return;
    await pilgrimCommands.create({
      full_name: form.full_name,
      full_name_ar: form.full_name_ar,
      passport_number: form.passport_number,
      phone: form.phone,
      email: form.email,
      gender: form.gender,
      birth_date: form.birth_date || null,
      nationality: form.nationality,
      wilaya: form.wilaya,
      departure_airport: form.departure_airport,
      group_id: form.group_id || null,
      package_id: form.package_id || null,
      visa_status: form.visa_status,
      payment_status: form.payment_status,
      status: form.status,
    });
    setForm({
      full_name: '', full_name_ar: '', passport_number: '', phone: '', email: '',
      gender: 'M', birth_date: '', nationality: '', wilaya: '', departure_airport: '',
      group_id: '', package_id: '', visa_status: 'NOT_STARTED', payment_status: 'PENDING', status: 'REGISTERED',
    });
    setShowForm(false);
  };

  const saveEdit = async () => {
    if (!editId) return;
    await pilgrimCommands.update(editId, {
      visa_status: form.visa_status,
      payment_status: form.payment_status,
      status: form.status,
    });
    setEditId(null);
  };


  const q = search.toLowerCase();
  const filtered = pilgrims.filter(p => {
    if (!q) return true;
    return (
      (p.full_name || '').toLowerCase().includes(q) ||
      (p.full_name_ar || '').includes(q) ||
      (p.passport_number || '').toLowerCase().includes(q) ||
      (p.phone || '').toLowerCase().includes(q)
    );
  });

  const stats = {
    total: pilgrims.length,
    paid: pilgrims.filter(p => p.payment_status === 'PAID').length,
    visaIssued: pilgrims.filter(p => p.visa_status === 'ISSUED' || p.visa_status === 'APPROVED').length,
    traveling: pilgrims.filter(p => p.status === 'TRAVELING').length,
  };

  return (
    <div className={'space-y-6 ' + (isAr ? 'rtl' : 'ltr')}>
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-lg font-semibold text-[var(--text-primary)]">{t('الحجاج والعائلات', 'Pelerins & Familles', 'Pilgrims & Families')}</h1>
          <p className="text-[13px] text-[var(--text-muted)] mt-0.5">{pilgrims.length} {t('حاج', 'pelerins', 'pilgrims')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {onOpenNewReservationModal && (
            <button onClick={onOpenNewReservationModal} className="flex items-center gap-1.5 rounded-xl border border-[var(--border)] dark:border-[var(--border)] bg-white dark:bg-[var(--bg-hover)] px-4 py-2 text-sm font-bold text-[var(--text-secondary)] dark:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] dark:hover:bg-[var(--bg-hover)] transition-all">
              <UserPlus className="w-4 h-4 text-brand-500" />
              {t('حجز جديد', 'Nouvelle reservation', 'New Reservation')}
            </button>
          )}
          <button onClick={() => setShowForm((v) => !v)} className="btn btn-primary">
            <Plus className="w-4 h-4" />
            {t('حاج جديد', 'Nouveau pelerin', 'New Pilgrim')}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {[
          { icon: Users, label: t('الإجمالي', 'Total', 'Total'), value: stats.total, color: 'text-[var(--text-secondary)] dark:text-[var(--text-secondary)]' },
          { icon: FileText, label: t('مدفوع بالكامل', 'Payes', 'Paid'), value: stats.paid, color: 'text-emerald-500' },
          { icon: Plane, label: t('تأشيرة جاهزة', 'Visa prete', 'Visa Issued'), value: stats.visaIssued, color: 'text-brand-500' },
          { icon: Users, label: t('في رحلة', 'En voyage', 'Traveling'), value: stats.traveling, color: 'text-blue-500' },
        ].map((stat, idx) => (
          <div key={idx} className="card p-5 flex items-center gap-4">
            <div className={`p-3 rounded-full bg-[var(--bg-hover)] dark:bg-[var(--bg-hover)] ${stat.color}`}>
              <stat.icon className="w-6 h-6" />
            </div>
            <div>
              <p className="text-[13px] text-[var(--text-muted)]">{stat.label}</p>
              <p className="text-xl font-semibold text-[var(--text-secondary)] dark:text-white">{stat.value}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="card p-5 flex flex-col md:flex-row gap-4 justify-between items-center">
        <div className="relative w-full md:w-96">
          <Search className={`absolute top-2.5 start-3 w-5 h-5 text-[var(--text-secondary)]`} />
          <input
            type="text"
            placeholder={t('البحث بالاسم أو الجواز أو الهاتف...', 'Rechercher par nom, passeport ou telephone...', 'Search by name, passport or phone...')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={`w-full bg-[var(--bg-hover)] dark:bg-[var(--bg-hover)] border border-[var(--border)] dark:border-[var(--border)] text-[var(--text-secondary)] dark:text-white rounded-xl py-2 ps-10 pe-4 focus:ring-2 focus:ring-[var(--accent-soft)] focus:outline-none transition-all`}
          />
        </div>
        <span className="text-xs text-[var(--text-secondary)] dark:text-[var(--text-secondary)] font-bold">{(isAr ? 'نتائج: ' : isFr ? 'Resultats: ' : 'Results: ') + filtered.length}</span>
      </div>

      {showForm && (
        <div className="card p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <input className={inputCls} value={form.full_name} onChange={(e) => set('full_name', e.target.value)} placeholder={t('الاسم الكامل *', 'Nom complet *', 'Full name *')} />
            <input className={inputCls} value={form.full_name_ar} onChange={(e) => set('full_name_ar', e.target.value)} placeholder={t('الاسم بالعربية', 'Nom AR', 'Name AR')} />
            <input className={inputCls} value={form.passport_number} onChange={(e) => set('passport_number', e.target.value)} placeholder={t('رقم الجواز', 'N° passeport', 'Passport number')} />
            <input className={inputCls} value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder={t('الهاتف', 'Telephone', 'Phone')} />
            <input className={inputCls} value={form.email} onChange={(e) => set('email', e.target.value)} placeholder={t('البريد', 'Email', 'Email')} />
            <Select className={inputCls} value={form.gender} onChange={(e) => set('gender', e.target.value)}>
              <option value="M">M</option>
              <option value="F">F</option>
            </Select>
            <GlassDate className={inputCls} value={form.birth_date} onChange={(e) => set('birth_date', e.target.value)} />
            <input className={inputCls} value={form.nationality} onChange={(e) => set('nationality', e.target.value)} placeholder={t('الجنسية', 'Nationalite', 'Nationality')} />
            <input className={inputCls} value={form.wilaya} onChange={(e) => set('wilaya', e.target.value)} placeholder={t('الولاية', 'Wilaya', 'Wilaya')} />
            <input className={inputCls} value={form.departure_airport} onChange={(e) => set('departure_airport', e.target.value)} placeholder={t('مطار المغادرة', 'Aeroport depart', 'Departure airport')} />
            <Select className={inputCls} value={form.group_id} onChange={(e) => set('group_id', e.target.value)}>
              <option value="">{t('الفوج', 'Groupe', 'Group')}</option>
              {groups.map(g => <option key={g.id} value={g.id}>{g.code} - {g.name}</option>)}
            </Select>
            <Select className={inputCls} value={form.package_id} onChange={(e) => set('package_id', e.target.value)}>
              <option value="">{t('الباقة', 'Forfait', 'Package')}</option>
              {packages.map(pk => <option key={pk.id} value={pk.id}>{pk.code} - {pk.name}</option>)}
            </Select>
            <Select className={inputCls} value={form.visa_status} onChange={(e) => set('visa_status', e.target.value)}>
              {VISA_STATI.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
            <Select className={inputCls} value={form.payment_status} onChange={(e) => set('payment_status', e.target.value)}>
              {PAYMENT_STATI.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
            <Select className={inputCls} value={form.status} onChange={(e) => set('status', e.target.value)}>
              {PILGRIM_STATI.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          </div>
          <div className="flex gap-2">
            <button onClick={submit} disabled={!form.full_name.trim()} className="btn btn-primary flex-1">
              {t('حفظ', 'Enregistrer', 'Save')}
            </button>
            <button onClick={() => setShowForm(false)} className="rounded-xl bg-[var(--bg-hover)] dark:bg-[var(--bg-hover)] px-5 py-2 text-sm font-bold text-[var(--text-secondary)] dark:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] dark:hover:bg-[var(--bg-hover)] transition-all">
              {t('إلغاء', 'Annuler', 'Cancel')}
            </button>
          </div>
        </div>
      )}

      <div className="card overflow-hidden">
        {loading ? (
          <Spinner className="p-10" />
        ) : filtered.length === 0 ? (
          <div className="p-10 flex flex-col items-center justify-center text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">
            <AlertCircle className="w-12 h-12 mb-3 opacity-50" />
            <p>{t('لا يوجد معتمرين', 'Aucun pelerin', 'No pilgrims found')}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead className="bg-[var(--bg-hover)] dark:bg-[var(--bg-hover)] text-[var(--text-secondary)] dark:text-[var(--text-secondary)] border-b border-[var(--border)] dark:border-[var(--border)]">
                <tr>
                  <th className="px-4 py-3 w-10"><input type="checkbox" className="rounded border-[var(--border)] text-[var(--brand-500)] focus:ring-[var(--brand-500)]" checked={filtered.length > 0 && selectedIds.size === filtered.length} onChange={toggleAll} /></th>
                    <th className={`px-4 py-3 font-semibold ${isAr ? 'text-end' : 'text-start'}`}>{t('الاسم', 'Nom', 'Name')}</th>
                  <th className={`px-4 py-3 font-semibold ${isAr ? 'text-end' : 'text-start'}`}>{t('الجواز', 'Passeport', 'Passport')}</th>
                  <th className={`px-4 py-3 font-semibold ${isAr ? 'text-end' : 'text-start'}`}>{t('الاتصال', 'Contact', 'Contact')}</th>
                  <th className={`px-4 py-3 font-semibold ${isAr ? 'text-end' : 'text-start'}`}>{t('الفوج', 'Groupe', 'Group')}</th>
                  <th className={`px-4 py-3 font-semibold ${isAr ? 'text-end' : 'text-start'}`}>{t('الباقة', 'Forfait', 'Package')}</th>
                  <th className={`px-4 py-3 font-semibold ${isAr ? 'text-end' : 'text-start'}`}>{t('التأشيرة', 'Visa', 'Visa')}</th>
                  <th className={`px-4 py-3 font-semibold ${isAr ? 'text-end' : 'text-start'}`}>{t('الدفع', 'Paiement', 'Payment')}</th>
                  <th className={`px-4 py-3 font-semibold ${isAr ? 'text-end' : 'text-start'}`}>{t('الحالة', 'Statut', 'Status')}</th>
                  <th className="px-4 py-3 font-semibold text-center">{t('إجراءات', 'Actions', 'Actions')}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(p => {
                  const grp = p.group_id ? groupMap.get(p.group_id) : null;
                  const pkg = p.package_id ? packageMap.get(p.package_id) : null;
                  return (
                    <tr key={p.id} className="border-b border-[var(--border)] dark:border-[var(--border)] hover:bg-[var(--bg-hover)] dark:hover:bg-[var(--bg-hover)]/50 transition-colors">
                      <td className="px-4 py-3"><input type="checkbox" className="rounded border-[var(--border)] text-[var(--brand-500)] focus:ring-[var(--brand-500)]" checked={selectedIds.has(p.id)} onChange={() => toggleSelection(p.id)} onClick={e => e.stopPropagation()} /></td>
                      <td className="px-4 py-3">
                        <p className="text-[var(--text-secondary)] dark:text-white font-medium">{p.full_name || '-'}</p>
                        <p className="text-[10px] text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">{p.full_name_ar || ''}{p.gender ? ' (' + p.gender + ')' : ''}</p>
                      </td>
                      <td className="px-4 py-3 font-mono text-[var(--text-secondary)] dark:text-[var(--text-secondary)] whitespace-nowrap">{p.passport_number || '-'}</td>
                      <td className="px-4 py-3 text-[var(--text-secondary)] dark:text-[var(--text-secondary)] whitespace-nowrap">
                        <p>{p.phone || '-'}</p>
                        <p className="text-[10px] text-[var(--text-secondary)]">{p.email || ''}</p>
                      </td>
                      <td className="px-4 py-3 text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">{grp ? grp.code + ' - ' + grp.name : '-'}</td>
                      <td className="px-4 py-3 text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">{pkg ? pkg.code + ' - ' + pkg.name : '-'}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold whitespace-nowrap ${visaPill(p.visa_status || '')}`}>{p.visa_status || '-'}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${payPill(p.payment_status || '')}`}>{p.payment_status || '-'}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${statusPill(p.status || '')}`}>{p.status || '-'}</span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={() => setProfile360Id(p.id)}
                            className="rounded-lg bg-emerald-500/10 p-1.5 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 transition-all"
                            title={t('ملف 360°', 'Profil 360°', 'View 360° Profile')}
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => {
                              setEditId(p.id);
                              setForm((prev) => ({ ...prev, visa_status: p.visa_status || 'NOT_STARTED', payment_status: p.payment_status || 'PENDING', status: p.status || 'REGISTERED' }));
                            }}
                            className="rounded-lg bg-blue-500/10 p-1.5 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20 transition-all"
                            title={t('تعديل', 'Modifier', 'Edit')}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={async () => {
                              if (await confirmDialog({ title: t('تأكيد الحذف', 'Confirmer la suppression', 'Confirm deletion'), message: t('حذف الحاج؟', 'Supprimer le pèlerin ?', 'Delete pilgrim?'), danger: true })) await pilgrimCommands.remove(p.id);
                            }}
                            className="rounded-lg bg-rose-500/10 p-1.5 text-rose-600 dark:text-rose-400 hover:bg-rose-500/20 transition-all"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setEditId(null)}>
          <div
            className="w-[min(95vw,28rem)] flex flex-col max-h-[90vh] card overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-5 pb-4 border-b border-[var(--border)] dark:border-[var(--border)] shrink-0">
              <h3 className="text-lg font-semibold text-[var(--text-secondary)] dark:text-white">{t('تعديل الحاج', 'Modifier le pelerin', 'Edit Pilgrim')}</h3>
              <button onClick={() => setEditId(null)} className="text-[var(--text-secondary)] hover:text-[var(--text-secondary)] dark:hover:text-[var(--text-secondary)]">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="overflow-y-auto px-6 py-5 space-y-4">
            <p className="text-[13px] text-[var(--text-muted)]">
              {pilgrims.find(x => x.id === editId)?.full_name} · {pilgrims.find(x => x.id === editId)?.passport_number}
            </p>
            <div className="space-y-3">
              <div>
                <label className="text-[10px] font-bold text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">{t('حالة التأشيرة', 'Statut visa', 'Visa status')}</label>
                <Select className={inputCls + ' mt-1'} value={form.visa_status} onChange={(e) => set('visa_status', e.target.value)}>
                  {VISA_STATI.map((s) => <option key={s} value={s}>{s}</option>)}
                </Select>
              </div>
              <div>
                <label className="text-[10px] font-bold text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">{t('حالة الدفع', 'Statut paiement', 'Payment status')}</label>
                <Select className={inputCls + ' mt-1'} value={form.payment_status} onChange={(e) => set('payment_status', e.target.value)}>
                  {PAYMENT_STATI.map((s) => <option key={s} value={s}>{s}</option>)}
                </Select>
              </div>
              <div>
                <label className="text-[10px] font-bold text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">{t('الحالة', 'Statut', 'Status')}</label>
                <Select className={inputCls + ' mt-1'} value={form.status} onChange={(e) => set('status', e.target.value)}>
                  {PILGRIM_STATI.map((s) => <option key={s} value={s}>{s}</option>)}
                </Select>
              </div>
            </div>
            </div>
            <div className="flex gap-2 px-6 py-5 pt-4 border-t border-[var(--border)] dark:border-[var(--border)] shrink-0">
              <button onClick={saveEdit} className="btn btn-primary flex-1">
                {t('حفظ', 'Enregistrer', 'Save')}
              </button>
              <button onClick={() => setEditId(null)} className="rounded-xl bg-[var(--bg-hover)] dark:bg-[var(--bg-hover)] px-5 py-2 text-sm font-bold text-[var(--text-secondary)] dark:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] dark:hover:bg-[var(--bg-hover)] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]">
                {t('إلغاء', 'Annuler', 'Cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Pilgrim 360° Profile Drawer */}

        {/* Bulk Action Bar */}
        {selectedIds.size > 0 && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[80] bg-[var(--surface)] shadow-2xl border border-[var(--border)] rounded-full px-4 py-3 flex items-center gap-4 animate-in slide-in-from-bottom-5">
            <span className="bg-[var(--brand-500)]/10 text-[var(--brand-500)] px-3 py-1 rounded-full font-bold text-sm">
              {selectedIds.size} {t('محدد', 'sAclec.', 'selected')}
            </span>
            <div className="h-6 w-px bg-[var(--border)]" />
            <div className="flex items-center gap-2">
                <select className="input h-8 py-1 text-sm bg-transparent border-slate-300 dark:border-slate-700" onChange={(e) => handleBulkStatus(e.target.value)} value="">
                  <option value="" disabled>{t('تغيير الحالة', 'Changer statut', 'Update Status')}</option>
                  {PILGRIM_STATI.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <select className="input h-8 py-1 text-sm bg-transparent border-slate-300 dark:border-slate-700" onChange={(e) => handleBulkGroup(e.target.value)} value="">
                  <option value="" disabled>{t('تعيين فوج', 'Assigner groupe', 'Assign Group')}</option>
                  {groups.map(g => <option key={g.id} value={g.id}>{g.code} - {g.name}</option>)}
                </select>
                <button className="btn btn-sm bg-rose-500/10 text-rose-500 hover:bg-rose-500/20" onClick={() => setSelectedIds(new Set())}>
                  {t('إلغاء', 'Annuler', 'Clear')}
                </button>
              </div>
          </div>
        )}

      <PilgrimProfile360
        pilgrimId={profile360Id}
        onClose={() => setProfile360Id(null)}
      />
    </div>
  );
}