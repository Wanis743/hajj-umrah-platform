import React, { useEffect, useState } from 'react';
import { SideSheet } from './SideSheet';
import { PaymentModal } from './PaymentModal';
import { FileText, Download, Mail, CreditCard } from 'lucide-react';
import { useI18n } from '@/i18n/I18nProvider';
import { money } from '@/lib/currency';
import { supabase } from '@/lib/supabase';
import type { BaseRow } from '@/types/database';

interface InvoiceRow extends BaseRow {
  invoice_number?: string | null;
  total_dzd?: number | null;
  total_sar?: number | null;
  paid_dzd?: number | null;
  due_date?: string | null;
  status?: string | null;
}

interface InvoiceWorkspaceSheetProps {
  invoiceId: string | null;
  onClose: () => void;
}

export function InvoiceWorkspaceSheet({ invoiceId, onClose }: InvoiceWorkspaceSheetProps) {
  const { lang } = useI18n();
  const t = (ar: string, fr: string, en: string) => lang === 'ar' ? ar : lang === 'fr' ? fr : en;

  const [invoice, setInvoice] = useState<InvoiceRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [journalId, setJournalId] = useState<string | null>(null);
  const [showPayment, setShowPayment] = useState(false);

  const fetchInvoice = () => {
    if (!invoiceId) return;
    setLoading(true);
    supabase.from('invoices').select('*').eq('id', invoiceId).single().then(({ data }) => {
      setInvoice(data as InvoiceRow);
      setLoading(false);
      supabase.from('journal_entries').select('id, reference').eq('source_type', 'INVOICE').eq('source_id', invoiceId).maybeSingle().then(({ data: jData }) => { if (jData) setJournalId(String(jData.reference || jData.id)); });
    });
  };

  useEffect(() => {
    fetchInvoice();
  }, [invoiceId]);

  return (
    <SideSheet isOpen={!!invoiceId} onClose={onClose} title={t('تفاصيل الفاتورة', 'Détails de la facture', 'Invoice Details')} width="max-w-3xl">
      {loading ? (
        <div className="flex items-center justify-center h-40">
          <p className="text-[var(--text-muted)]">{t('جاري التحميل...', 'Chargement...', 'Loading...')}</p>
        </div>
      ) : invoice ? (
        <div className="space-y-6">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-xl font-bold text-[var(--text-primary)]">{invoice.invoice_number || 'INV'}</h3>
              <p className="text-sm text-[var(--text-muted)] flex items-center gap-2 mt-1">
                <FileText className="h-4 w-4" /> {invoice.due_date ? new Date(invoice.due_date).toLocaleDateString() : ''}
              </p>
              {journalId && (
                <div className="mt-2 text-xs text-blue-600 bg-blue-50 px-2 py-1 rounded-md inline-block">
                  Ledger Sync: {journalId}
                </div>
              )}
            </div>
            <div className="flex flex-col items-end gap-2">
              <span className="px-3 py-1 bg-[var(--brand-500)]/10 text-[var(--brand-500)] font-semibold rounded-full text-sm">
                {invoice.status || 'ISSUED'}
              </span>
              {(invoice.status !== 'PAID') && (
                <button className="btn btn-sm btn-primary flex items-center gap-1" onClick={() => setShowPayment(true)}>
                  <CreditCard className="w-4 h-4" /> Pay Now
                </button>
              )}
            </div>
          </div>

          
          </div>
      ) : (
        <div className="flex items-center justify-center h-40">
          <p className="text-[var(--text-muted)]">{t('لم يتم العثور على الفاتورة', 'Facture non trouvée', 'Invoice not found')}</p>
        </div>
      )}
          {showPayment && invoice && (
        <PaymentModal 
          invoiceId={invoice.id}
          amountDzd={(invoice.total_dzd || 0) - (invoice.paid_dzd || 0)}
          bookingId={(invoice.booking_id as string) || undefined}
          onClose={() => setShowPayment(false)}
          onSuccess={() => { setShowPayment(false); fetchInvoice(); }}
        />
      )}
    </SideSheet>
  );
}