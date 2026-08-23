import React, { useState } from 'react';
import { supabase } from '@/lib/supabase';
import toast from 'react-hot-toast';
import { CreditCard, X } from 'lucide-react';

interface PaymentModalProps {
  invoiceId: string;
  amountDzd: number;
  bookingId?: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function PaymentModal({ invoiceId, amountDzd, bookingId, onClose, onSuccess }: PaymentModalProps) {
  const [loading, setLoading] = useState(false);
  const [amount, setAmount] = useState(amountDzd);
  const [method, setMethod] = useState('CASH');

  const handlePay = async () => {
    setLoading(true);
    try {
      const { error } = await supabase.from('payments').insert({
        amount_dzd: amount,
        method: method,
        status: 'PAID',
        reference: 'INV-' + invoiceId.slice(0,6),
        booking_id: bookingId || null,
        received_at: new Date().toISOString()
      });
      if (error) throw error;
      
      await supabase.from('invoices').update({ status: 'PAID', paid_dzd: amount }).eq('id', invoiceId);
      
      toast.success('Payment recorded and Journal Entry automatically created.');
      onSuccess();
    } catch (e: any) {
      toast.error('Payment failed: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center">
      <div className="bg-[var(--bg-primary)] p-6 rounded-xl w-full max-w-md shadow-xl border border-[var(--border)]">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <CreditCard className="w-5 h-5" /> Record Payment
          </h2>
          <button onClick={onClose} className="p-2 hover:bg-[var(--bg-hover)] rounded-full">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Amount (DZD)</label>
            <input 
              type="number" 
              className="w-full bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg px-3 py-2"
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Payment Method</label>
            <select 
              className="w-full bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg px-3 py-2"
              value={method}
              onChange={(e) => setMethod(e.target.value)}
            >
              <option value="CASH">Cash</option>
              <option value="BANK_TRANSFER">Bank Transfer</option>
              <option value="CHECK">Check</option>
            </select>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium hover:bg-[var(--bg-hover)] rounded-lg">
            Cancel
          </button>
          <button 
            onClick={handlePay}
            disabled={loading}
            className="px-4 py-2 text-sm font-medium bg-[var(--brand-500)] text-white rounded-lg hover:bg-[var(--brand-600)]"
          >
            {loading ? 'Processing...' : 'Confirm Payment'}
          </button>
        </div>
      </div>
    </div>
  );
}
