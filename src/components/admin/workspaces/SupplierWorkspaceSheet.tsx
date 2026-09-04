import React, { useEffect, useState } from 'react';
import { SideSheet } from './SideSheet';
import { Truck, Phone, Mail, FileText, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { supabase } from '@/lib/supabase';

type ContractType = {
  id?: string;
  type?: string;
  value_dzd?: number;
  start_date?: string;
  end_date?: string;
};

type BillType = {
  id?: string;
  amount_dzd?: number;
  due_date?: string;
  status?: string;
};

type SupplierRow = {
  id: string;
  name?: string;
  category?: string;
  contact_person?: string;
  phone?: string;
  email?: string;
  status?: string;
  rating?: number;
  outstanding_balance_dzd?: number;
  contracts?: ContractType[];
  outstanding_bills?: BillType[];
};

export function SupplierWorkspaceSheet({ supplierId, onClose }: { supplierId: string | null, onClose: () => void }) {
  const { lang } = useI18n();
  const isAr = lang === 'ar';
  const isFr = lang === 'fr';
  const t = (ar: string, fr: string, en: string) => isAr ? ar : isFr ? fr : en;

  const [supplier, setSupplier] = useState<SupplierRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supplierId) {
      setSupplier(null);
      return;
    }
    let active = true;
    const fetchSupplier = async () => {
      setLoading(true);
      setError(null);
      const { data, error } = await supabase.from('suppliers').select('*').eq('id', supplierId).single();
      if (!active) return;
      if (error) {
        setError(error.message);
      } else {
        setSupplier(data as unknown as SupplierRow);
      }
      setLoading(false);
    };
    fetchSupplier();
    return () => { active = false; };
  }, [supplierId]);

  return (
    <SideSheet isOpen={!!supplierId} onClose={onClose} title={t('مساحة المورد', 'Espace Fournisseur', 'Supplier Workspace')} width="max-w-3xl">
      <div className="p-4 space-y-6">
        {loading && <div className="text-center p-4 text-[var(--text-muted)]">{t('جاري التحميل...', 'Chargement...', 'Loading...')}</div>}
        {error && <div className="p-4 bg-red-50 text-red-600 rounded-lg">{error}</div>}
        
        {supplier && !loading && (
          <>
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Truck className="h-6 w-6 text-brand-500" />
                  {supplier.name || 'Unknown Supplier'}
                </h2>
                <div className="mt-1 flex items-center gap-3 text-sm text-[var(--text-secondary)]">
                  <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                    {supplier.category || 'GENERAL'}
                  </span>
                  <span className={`flex items-center gap-1 ${supplier.status === 'ACTIVE' ? 'text-emerald-500' : 'text-rose-500'}`}>
                    {supplier.status === 'ACTIVE' ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
                    {supplier.status || 'UNKNOWN'}
                  </span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50">
                <div className="flex items-center gap-2 text-brand-600 mb-2 font-medium">
                  <FileText className="w-4 h-4" /> {t('المالية', 'Finances', 'Financials')}
                </div>
                <div className="space-y-2 text-sm text-[var(--text-secondary)]">
                  <div className="flex justify-between">
                    <span>{t('الرصيد المستحق', 'Solde dû', 'Outstanding Balance')}:</span>
                    <span className="font-semibold text-rose-600">{supplier.outstanding_balance_dzd?.toLocaleString()} DZD</span>
                  </div>
                  <div className="flex justify-between">
                    <span>{t('الفواتير المعلقة', 'Factures en attente', 'Pending Bills')}:</span>
                    <span className="text-slate-900 dark:text-slate-100">{supplier.outstanding_bills?.length || 0}</span>
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50">
                <div className="flex items-center gap-2 text-brand-600 mb-2 font-medium">
                  <Phone className="w-4 h-4" /> {t('معلومات الاتصال', 'Contact', 'Contact Info')}
                </div>
                <div className="space-y-2 text-sm text-[var(--text-secondary)]">
                  <div className="flex items-center gap-2">
                    <span className="text-slate-900 dark:text-slate-100">{supplier.contact_person || 'N/A'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Phone className="w-3.5 h-3.5" /> <span>{supplier.phone || 'N/A'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Mail className="w-3.5 h-3.5" /> <span>{supplier.email || 'N/A'}</span>
                  </div>
                </div>
              </div>
            </div>

            
          </>
        )}
      </div>
    </SideSheet>
  );
}
