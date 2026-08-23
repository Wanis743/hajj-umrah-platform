import { useState } from 'react';
import Select from '@/components/admin/GlassSelect';
import { useI18n } from '@/i18n/I18nProvider';
import { Users, ArrowRight, PhoneCall, Plus, Trash2 } from 'lucide-react';
import { Spinner } from '@/components/admin/ui';
import { useSupabaseData } from '@/hooks/useSupabaseData';
import { crmCommands } from '@/services/domainCommands';

const STAGES = ['NEW', 'CONTACTED', 'QUALIFIED', 'PROPOSAL', 'CONVERTED'];
const ALL_STATUSES = [...STAGES, 'LOST'];
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH'];

const getStageColor = (stage: string | undefined) => {
  switch (stage?.toUpperCase()) {
    case 'NEW': return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400';
    case 'CONTACTED': return 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400';
    case 'QUALIFIED': return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400';
    case 'PROPOSAL': return 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400';
    case 'CONVERTED': return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400';
    case 'LOST': return 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-400';
    default: return 'bg-[var(--bg-hover)] text-[var(--text-secondary)] dark:bg-[var(--bg-hover)] dark:text-[var(--text-secondary)]';
  }
};

const getPriorityColor = (priority: string) => {
  switch (priority?.toUpperCase()) {
    case 'HIGH': return 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-400';
    case 'MEDIUM': return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400';
    case 'LOW': return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400';
    default: return 'bg-[var(--bg-hover)] text-[var(--text-secondary)] dark:bg-[var(--bg-hover)] dark:text-[var(--text-secondary)]';
  }
};

const EMPTY_FORM = { first_name: '', last_name: '', phone: '', email: '', source: '', priority: 'MEDIUM' };

interface CrmLead { id: string; first_name?: string; last_name?: string; phone?: string; email?: string; source?: string; priority?: string; status?: string; created_at?: string; [key: string]: unknown; }
export function CrmManager() {
  const { lang } = useI18n();
  const isAr = lang === 'ar' || lang === 'dz';
  const isFr = lang === 'fr';
  const t = (ar: string, fr: string, en: string) => (isAr ? ar : isFr ? fr : en);

  const { data: leads, loading } = useSupabaseData<CrmLead>({
    table: 'crm_leads',
    orderBy: { column: 'created_at', ascending: false },
    fallbackData: [],
  });

  const [form, setForm] = useState(EMPTY_FORM);
  const [showAddForm, setShowAddForm] = useState(false);

  const fullName = (lead: CrmLead) => [lead.first_name, lead.last_name].filter(Boolean).join(' ') || lead.phone || lead.email || '—';

  const handleAdd = async () => {
    if (!form.first_name && !form.phone) return;
    await crmCommands.create({
      ...form,
      first_name: form.first_name || 'Unknown',
      status: 'NEW',
    });
    setForm(EMPTY_FORM);
    setShowAddForm(false);
  };

  return (
    <div className={`space-y-6 ${isAr ? 'rtl' : 'ltr'}`}>
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <h1 className="text-lg font-semibold text-[var(--text-primary)] flex items-center gap-2">
          <Users className="h-5 w-5 text-[var(--accent)]" />
          {t('إدارة علاقات العملاء', 'CRM', 'CRM')}
        </h1>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="btn btn-primary"
        >
          <Plus className="w-4 h-4" />
          {t('إضافة عميل محتمل', 'Ajouter un prospect', 'Add Lead')}
        </button>
      </div>

      {showAddForm && (
        <div className="card p-5">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            <input
              value={form.first_name}
              onChange={(e) => setForm({ ...form, first_name: e.target.value })}
              placeholder={t('الاسم الأول', 'Prénom', 'First name')}
              className="input"
            />
            <input
              value={form.last_name}
              onChange={(e) => setForm({ ...form, last_name: e.target.value })}
              placeholder={t('اسم العائلة', 'Nom', 'Last name')}
              className="input"
            />
            <input
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              placeholder={t('الهاتف', 'Téléphone', 'Phone')}
              className="input"
            />
            <input
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="Email"
              className="input"
            />
            <input
              value={form.source}
              onChange={(e) => setForm({ ...form, source: e.target.value })}
              placeholder={t('المصدر', 'Source', 'Source')}
              className="input"
            />
            <Select
              value={form.priority}
              onChange={(e) => setForm({ ...form, priority: e.target.value })}
              className="input"
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </Select>
          </div>
          <div className="mt-4 flex justify-end">
            <button
              onClick={handleAdd}
              className="btn btn-primary"
            >
              {t('حفظ', 'Enregistrer', 'Save Lead')}
            </button>
          </div>
        </div>
      )}

      <div className="card p-5 overflow-x-auto">
        <h3 className="text-lg font-bold text-[var(--text-secondary)] dark:text-white mb-4">
          {t('مسار المبيعات', 'Entonnoir de Vente', 'Sales Funnel')}
        </h3>
        <div className="flex items-center min-w-[600px] justify-between pb-4">
          {STAGES.map((stage, idx) => (
            <div key={stage} className="flex items-center">
              <div className="flex flex-col items-center">
                <div className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-lg mb-2 ${getStageColor(stage)}`}>
                  {leads.filter((l: CrmLead) => l.status === stage).length}
                </div>
                <span className="text-xs font-semibold text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">{stage}</span>
              </div>
              {idx < STAGES.length - 1 && (
                <ArrowRight className={`w-5 h-5 text-[var(--text-secondary)] dark:text-[var(--text-secondary)] ${isAr ? 'rotate-180' : ''}`} />
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="card p-5">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-bold text-[var(--text-secondary)] dark:text-white">
            {t('قائمة العملاء المحتملين', 'Liste des Prospects', 'Lead List')}
          </h3>
          <span className="text-sm text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">{leads.length}</span>
        </div>

        {loading ? (
          <Spinner className="p-10" />
        ) : leads.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">
            <PhoneCall className="w-12 h-12 mb-2 opacity-20" />
            <p>{t('لا يوجد عملاء محتملون', 'Aucun prospect', 'No leads found')}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-start">
              <thead>
                <tr className={`border-b border-[var(--border)] dark:border-[var(--border)] text-sm text-[var(--text-secondary)] dark:text-[var(--text-secondary)] ${isAr ? 'text-end' : 'text-start'}`}>
                  <th className="pb-3 font-medium">{t('الاسم', 'Nom', 'Name')}</th>
                  <th className="pb-3 font-medium">{t('المصدر', 'Source', 'Source')}</th>
                  <th className="pb-3 font-medium">{t('الأولوية', 'Priorité', 'Priority')}</th>
                  <th className="pb-3 font-medium">{t('الحالة', 'Statut', 'Status')}</th>
                  <th className="pb-3 font-medium">{t('التاريخ', 'Date', 'Date Added')}</th>
                  <th className="pb-3 font-medium"></th>
                </tr>
              </thead>
              <tbody className="text-sm">
                {leads.map((lead: CrmLead) => (
                  <tr key={lead.id} className="border-b border-[var(--border)] dark:border-[var(--border)]/50 hover:bg-[var(--bg-hover)] dark:hover:bg-[var(--bg-hover)]/50 transition-colors">
                    <td className="py-3">
                      <p className="font-semibold text-[var(--text-secondary)] dark:text-white">{fullName(lead)}</p>
                      <p className="text-[13px] text-[var(--text-muted)]">{lead.phone || lead.email}</p>
                    </td>
                    <td className="py-3 text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">{lead.source || '—'}</td>
                    <td className="py-3">
                      <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${getPriorityColor(String(lead.priority || ''))}`}>
                        {lead.priority || 'LOW'}
                      </span>
                    </td>
                    <td className="py-3">
                      <Select
                        value={lead.status || 'NEW'}
                        onChange={(e) => crmCommands.update(lead.id, { status: e.target.value, converted_at: e.target.value === 'CONVERTED' ? new Date().toISOString() : null })}
                        className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${getStageColor(lead.status)} bg-transparent border-none cursor-pointer outline-none`}
                      >
                        {ALL_STATUSES.map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </Select>
                    </td>
                    <td className="py-3 text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">
                      {new Date(lead.created_at || '').toLocaleDateString()}
                    </td>
                    <td className="py-3">
                      <button
                        onClick={() => crmCommands.remove(lead.id)}
                        className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors"
                        title={t('حذف', 'Supprimer', 'Delete')}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
