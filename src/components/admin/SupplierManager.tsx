import { useState } from 'react';
import Select from '@/components/admin/GlassSelect';
import { useI18n } from '@/i18n/I18nProvider';
import { Truck, Star, Phone, Mail, Building2, Plus, Trash2, FileText } from 'lucide-react';
import { Spinner } from '@/components/admin/ui';
import { useSupabaseData } from '@/hooks/useSupabaseData';
import GlassDate from '@/components/admin/GlassDate';

const SUPPLIER_STATUSES = ['ACTIVE', 'INACTIVE', 'BLACKLISTED'];
const CONTRACT_STATUSES = ['DRAFT', 'ACTIVE', 'EXPIRED', 'TERMINATED'];

const statusBadge = (status: string) => {
  switch (status) {
    case 'ACTIVE':
      return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400';
    case 'INACTIVE':
    case 'DRAFT':
      return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400';
    case 'BLACKLISTED':
    case 'TERMINATED':
      return 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-400';
    case 'EXPIRED':
      return 'bg-[var(--bg-hover)] text-[var(--text-secondary)] dark:bg-[var(--bg-hover)] dark:text-[var(--text-secondary)]';
    default:
      return 'bg-[var(--bg-hover)] text-[var(--text-secondary)] dark:bg-[var(--bg-hover)] dark:text-[var(--text-secondary)]';
  }
};

const EMPTY_SUPPLIER = { name: '', category: '', contact_person: '', phone: '', email: '', performance_score: 80, status: 'ACTIVE' };

export type ContractType = {
  id?: string;
  supplier_id?: string;
  title?: string;
  type?: string;
  value_dzd?: number;
  start_date?: string;
  end_date?: string;
  status?: string;
};
export type BillType = {
  id?: string;
  amount_dzd?: number;
  due_date?: string;
  status?: string;
};
export type SuppRow = {
  id?: string;
  name?: string;
  category?: string;
  contact_person?: string;
  phone?: string;
  email?: string;
  status?: string;
  rating?: number;
  outstanding_balance_dzd?: number;
  performance_score?: number | string;
  contracts?: ContractType[];
  outstanding_bills?: BillType[];
};
export function SupplierManager({ suppliers: propSuppliers }: { suppliers?: SuppRow[] }) {
  const { lang } = useI18n();
  const isAr = lang === 'ar';
  const isFr = lang === 'fr';
  const t = (ar: string, fr: string, en: string) => (isAr ? ar : isFr ? fr : en);

  const { data: suppliers, loading, insert, update, remove } = useSupabaseData<SuppRow>({
    table: 'suppliers',
    orderBy: { column: 'name', ascending: true },
    fallbackData: propSuppliers || [],
  });

  const { data: contracts, insert: insertContract, update: updateContract, remove: removeContract } = useSupabaseData<ContractType>({
    table: 'contracts',
    orderBy: { column: 'created_at', ascending: false },
    fallbackData: [],
  });

  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState<SuppRow>(EMPTY_SUPPLIER);
  const [expanded, setExpanded] = useState<string | null>(null);
  type ContractFormType = { title?: string; type?: string; start_date?: string; end_date?: string; value_dzd?: number | string; status?: string; };
  const [contractForm, setContractForm] = useState<Record<string, ContractFormType>>({});

  const contractsFor = (supplierId: string) => contracts.filter((c: ContractType) => c.supplier_id === supplierId);

  const startContractForm = (supplierId: string) => {
    setExpanded(supplierId);
    setContractForm((prev) => ({ ...prev, [supplierId]: { title: '', type: '', start_date: '', end_date: '', value_dzd: 0, status: 'DRAFT' } }));
  };

  const handleAdd = async () => {
    if (!form.name) return;
    const result = await insert({ ...form, performance_score: Number(form.performance_score) || 0 });
    if (!result.error) {
      setForm(EMPTY_SUPPLIER);
      setShowAddForm(false);
    }
  };

  const handleAddContract = async (supplierId: string) => {
    const f = contractForm[supplierId] || {};
    if (!f.title) return;
    await insertContract({
      supplier_id: supplierId,
      title: f.title,
      type: f.type || '',
      start_date: f.start_date || undefined,
      end_date: f.end_date || undefined,
      value_dzd: Number(f.value_dzd) || 0,
      status: f.status || 'DRAFT',
    });
    setContractForm(prev => { 
      const next = { ...prev }; 
      delete next[supplierId]; 
      return next; 
    });
  };

  return (
    <div className={`space-y-6 ${isAr ? 'rtl' : 'ltr'}`}>
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <h1 className="text-lg font-semibold text-[var(--text-primary)] flex items-center gap-2">
          <Truck className="h-5 w-5 text-[var(--accent)]" />
          {t('إدارة الموردين', 'Gestion des Fournisseurs', 'Supplier Management')}
        </h1>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="btn btn-primary"
        >
          <Plus className="w-4 h-4" />
          {t('مورد جديد', 'Nouveau fournisseur', 'Add Supplier')}
        </button>
      </div>

      {showAddForm && (
        <div className="card p-5">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder={t('الاسم', 'Nom', 'Name')}
              className="input"
            />
            <input
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              placeholder={t('الفئة', 'Catégorie', 'Category')}
              className="input"
            />
            <input
              value={form.contact_person}
              onChange={(e) => setForm({ ...form, contact_person: e.target.value })}
              placeholder={t('جهة الاتصال', 'Personne de contact', 'Contact person')}
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
              type="number"
              value={form.performance_score}
              onChange={(e) => setForm({ ...form, performance_score: e.target.value })}
              placeholder={t('درجة الأداء (0-100)', 'Score de performance (0-100)', 'Performance score (0-100)')}
              className="input"
            />
            <Select
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
              className="input"
            >
              {SUPPLIER_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </Select>
          </div>
          <div className="mt-4 flex justify-end">
            <button
              onClick={handleAdd}
              className="btn btn-primary"
            >
              {t('حفظ', 'Enregistrer', 'Save Supplier')}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <Spinner className="p-10" />
      ) : suppliers.length === 0 ? (
        <div className="card p-8 flex flex-col items-center justify-center text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">
          <Building2 className="w-12 h-12 mb-3 opacity-20" />
          <p className="text-lg font-semibold">{t('لا يوجد موردين', 'Aucun fournisseur', 'No suppliers found')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 items-start">
          {suppliers.map((supplier: SuppRow) => {
            const sid = supplier.id;
            if (!sid) return null;
            return (
            <div key={sid} className="card p-5 hover:border-brand-500 transition-colors">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="text-lg font-bold text-[var(--text-secondary)] dark:text-white">{supplier.name}</h3>
                  <span className="inline-block mt-1 px-2 py-1 text-xs rounded-md bg-[var(--bg-hover)] dark:bg-[var(--bg-hover)] text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">
                    {supplier.category || '—'}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1 bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 px-2 py-1 rounded-lg">
                    <Star className="w-3 h-3 fill-current" />
                    <span className="text-sm font-bold">{supplier.performance_score ?? 0}</span>
                  </div>
                  <button
                    onClick={() => remove(sid)}
                    className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors"
                    title={t('حذف', 'Supprimer', 'Delete')}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="space-y-2 text-sm text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">
                {supplier.contact_person && (
                  <p className="font-semibold text-[var(--text-secondary)] dark:text-white">{supplier.contact_person}</p>
                )}
                {supplier.phone && (
                  <div className="flex items-center gap-2">
                    <Phone className="w-4 h-4" />
                    <span>{supplier.phone}</span>
                  </div>
                )}
                {supplier.email && (
                  <div className="flex items-center gap-2">
                    <Mail className="w-4 h-4" />
                    <span>{supplier.email}</span>
                  </div>
                )}
              </div>

              <div className="mt-4 pt-4 border-t border-[var(--border)] dark:border-[var(--border)] flex justify-between items-center">
                <Select
                  value={supplier.status || 'ACTIVE'}
                  onChange={(e) => update(sid, { status: e.target.value })}
                  className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${statusBadge(supplier.status || '')} bg-transparent border-none cursor-pointer outline-none`}
                >
                  {SUPPLIER_STATUSES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </Select>
                <button
                  onClick={() => setExpanded(expanded === sid ? null : sid)}
                  className="text-sm text-brand-600 dark:text-brand-400 font-medium hover:underline flex items-center gap-1"
                >
                  <FileText className="w-4 h-4" />
                  {t('العقود', 'Contrats', 'Contracts')} ({contractsFor(sid).length})
                </button>
              </div>

              {expanded === sid && (
                <div className="mt-4 pt-4 border-t border-[var(--border)] dark:border-[var(--border)] space-y-2">
                  {contractsFor(sid).length === 0 && (
                    <p className="text-[13px] text-[var(--text-muted)]">{t('لا توجد عقود', 'Aucun contrat', 'No contracts')}</p>
                  )}
                  {contractsFor(sid).map((c: ContractType) => (
                    <div key={c.id} className="p-3 border border-[var(--border)] dark:border-[var(--border)] rounded-xl space-y-1.5">
                      <div className="flex justify-between items-center gap-2">
                        <p className="text-sm font-semibold text-[var(--text-secondary)] dark:text-white flex-1 truncate">{c.title}</p>
                        <button
                          onClick={() => removeContract(c.id as string)}
                          className="p-1 rounded text-[var(--text-secondary)] hover:text-rose-500 transition-colors"
                          title={t('حذف', 'Supprimer', 'Delete')}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <p className="text-[13px] text-[var(--text-muted)]">
                        {c.type || '—'} · {(c.value_dzd || 0).toLocaleString()} DZD
                      </p>
                      {c.start_date && (
                        <p className="text-[10px] text-[var(--text-secondary)] font-mono">
                          {String(c.start_date).slice(0, 10)} → {c.end_date ? String(c.end_date).slice(0, 10) : '—'}
                        </p>
                      )}
                      <Select
                        value={c.status || 'DRAFT'}
                        onChange={(e) => updateContract(c.id as string, { status: e.target.value })}
                        className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${statusBadge(c.status || '')} bg-transparent border-none cursor-pointer outline-none`}
                      >
                        {CONTRACT_STATUSES.map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </Select>
                    </div>
                  ))}
                  {contractForm[sid] ? (
                    <div className="space-y-2">
                        <input
                          value={contractForm[sid]?.title || ''}
                          onChange={(e) => setContractForm(prev => ({ ...prev, [sid]: { ...prev[sid], title: e.target.value } }))}
                          placeholder={t('عنوان العقد', 'Titre du contrat', 'Contract title')}
                          className="w-full input"
                        />
                        <div className="grid grid-cols-2 gap-2">
                          <input
                            value={contractForm[sid]?.type || ''}
                            onChange={(e) => setContractForm(prev => ({ ...prev, [sid]: { ...prev[sid], type: e.target.value } }))}
                            placeholder={t('النوع', 'Type', 'Type')}
                            className="input"
                          />
                          <input
                            type="number"
                            value={contractForm[sid]?.value_dzd || ''}
                            onChange={(e) => setContractForm(prev => ({ ...prev, [sid]: { ...prev[sid], value_dzd: e.target.value } }))}
                            placeholder={t('القيمة DZD', 'Valeur DZD', 'Value DZD')}
                            className="input"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <GlassDate
                            value={contractForm[sid]?.start_date || ''}
                            onChange={(e) => setContractForm(prev => ({ ...prev, [sid]: { ...prev[sid], start_date: e.target.value } }))}
                            className="input"
                          />
                          <GlassDate
                            value={contractForm[sid]?.end_date || ''}
                            onChange={(e) => setContractForm(prev => ({ ...prev, [sid]: { ...prev[sid], end_date: e.target.value } }))}
                            className="input"
                          />
                      </div>
                      <button
                        onClick={() => handleAddContract(sid)}
                        className="btn btn-primary w-full"
                      >
                        {t('إضافة العقد', 'Ajouter le contrat', 'Add Contract')}
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => startContractForm(sid)}
                      className="flex items-center gap-1 text-xs text-brand-600 dark:text-brand-400 font-medium hover:underline"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      {t('عقد جديد', 'Nouveau contrat', 'New Contract')}
                    </button>
                  )}
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
