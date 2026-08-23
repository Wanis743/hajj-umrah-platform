import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

export interface InvoiceDTO {
  id: string;
  customerName: string;
  amount: number;
  balanceDue: number;
  dueDate: string;
  status: 'OPEN' | 'PAID' | 'OVERDUE';
}

export function ARWorkspace() {
  const [invoices, setInvoices] = useState<InvoiceDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const { data, error: fetchError } = await supabase
          .from('invoices')
          .select('*')
          .order('created_at', { ascending: false });

        if (fetchError) throw fetchError;

        const mapped: InvoiceDTO[] = (data || []).map((d: unknown) => {
          const inv = d as Record<string, unknown>;
          const amount = Number(inv.total_dzd || inv.total_sar || 0);
          return {
            id: String(inv.id || ''),
            customerName: String(inv.invoice_number || inv.booking_id || 'Unknown'),
            amount: amount,
            balanceDue: amount, // Approximated
            dueDate: String(inv.due_date || ''),
            status: (inv.status as InvoiceDTO['status']) || 'OPEN'
          };
        });
        setInvoices(mapped);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return (
    <div className="flex flex-col h-full bg-slate-950 p-6 text-slate-200 font-sans">
      <h1 className="text-2xl font-semibold tracking-tight mb-4">Accounts Receivable Workspace</h1>
      <div className="backdrop-blur-md bg-slate-900/40 border border-white/10 rounded-xl p-4 flex-1">
         <div className="grid grid-cols-5 gap-4 pb-2 border-b-2 border-indigo-400 mb-4 text-slate-400 uppercase tracking-wider text-xs font-medium">
           <div>Customer</div>
           <div>Amount</div>
           <div>Balance Due</div>
           <div>Due Date</div>
           <div>Status</div>
         </div>
         {loading && <div className="text-slate-500 mt-4 text-sm">Loading...</div>}
         {error && <div className="text-red-500 mt-4 text-sm">Error: {error}</div>}
         {!loading && !error && invoices.length === 0 && <div className="text-slate-500 mt-4 text-sm">No invoices found.</div>}
         {!loading && !error && invoices.map(invoice => (
           <div key={invoice.id} className="grid grid-cols-5 gap-4 py-2 border-b border-white/5 text-sm">
             <div>{invoice.customerName}</div>
             <div>{invoice.amount}</div>
             <div>{invoice.balanceDue}</div>
             <div>{invoice.dueDate}</div>
             <div>{invoice.status}</div>
           </div>
         ))}
      </div>
    </div>
  );
}
