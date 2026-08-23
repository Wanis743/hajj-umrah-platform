import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { FileText, Plus, Trash2, Send, Save, CheckCircle2, Loader2, AlertCircle } from 'lucide-react';
import { WorkspaceRegistry } from '../../../../lib/kernel/WorkspaceRegistry';
import { supabase } from '../../../../lib/supabase';

interface QuoteBuilderProps {
  registry: WorkspaceRegistry;
}

interface QuoteItem {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
}

interface QuoteDetails {
  id: string;
  quote_number: string;
  customer_name: string;
  opportunity_name: string;
  status: string;
  valid_until: string;
}

export function QuoteBuilder({ registry }: QuoteBuilderProps) {
  const [items, setItems] = useState<QuoteItem[]>([]);
  const [quoteDetails, setQuoteDetails] = useState<QuoteDetails | null>(null);
  const [isSaved, setIsSaved] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchQuoteData = async () => {
      try {
        setIsLoading(true);
        setError(null);
        
        // Fetch real quote without joining missing relations
        const { data: quoteData, error: quoteError } = await supabase
          .from('quotes')
          .select('*')
          .limit(1)
          .single();

        if (quoteError && quoteError.code !== 'PGRST116') throw quoteError;

        if (quoteData) {
          const q = quoteData as Record<string, unknown>;
          setQuoteDetails({
            id: String(q.id || ''),
            quote_number: String(q.quote_number || q.id || 'N/A'),
            customer_name: 'Unknown Customer',
            opportunity_name: 'Unknown Opportunity',
            status: String(q.status || 'DRAFT'),
            valid_until: String(q.valid_until || q.expires_at || '')
          });

          // Fetch items for this quote
          const { data: itemsData, error: itemsError } = await supabase
            .from('quote_line_items')
            .select('*')
            .eq('quote_id', String(q.id || ''));

          if (!itemsError && itemsData && itemsData.length > 0) {
            const mappedItems = (itemsData as Array<Record<string, unknown>>).map((d) => {
              const i = d as Record<string, unknown>;
              return {
                id: String(i.id || ''),
                description: String(i.description || ''),
                quantity: Number(i.quantity || 1),
                unitPrice: Number(i.unit_price || 0)
              };
            });
            setItems(mappedItems);
          } else {
            // Default item if none exist
            setItems([
              { id: '1', description: 'Consulting Services', quantity: 1, unitPrice: 1500.00 }
            ]);
          }
        } else {
           // No quote found in DB
           setQuoteDetails({
            id: 'new',
            quote_number: '#QT-NEW',
            customer_name: 'New Customer',
            opportunity_name: 'New Opportunity',
            status: 'DRAFT',
            valid_until: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
          });
          setItems([
            { id: '1', description: 'Consulting Services', quantity: 1, unitPrice: 1500.00 }
          ]);
        }
      } catch (err: unknown) {
        if (err instanceof Error) {
          setError(err.message);
        } else {
          setError('An unexpected error occurred while fetching quote details');
        }
      } finally {
        setIsLoading(false);
      }
    };

    fetchQuoteData();
  }, []);

  const addItem = () => {
    setItems([
      ...items,
      { id: Date.now().toString(), description: '', quantity: 1, unitPrice: 0 }
    ]);
    setIsSaved(false);
  };

  const removeItem = (id: string) => {
    setItems(items.filter(item => item.id !== id));
    setIsSaved(false);
  };

  const updateItem = (id: string, field: keyof QuoteItem, value: string | number) => {
    setItems(items.map(item => 
      item.id === id ? { ...item, [field]: value } : item
    ));
    setIsSaved(false);
  };

  const subtotal = items.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);
  const tax = subtotal * 0.15; // 15% VAT
  const total = subtotal + tax;

  if (isLoading) {
    return (
      <div className="flex flex-col h-full bg-slate-950 text-slate-200 items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin mb-4 text-indigo-500" />
        <p>Loading quote builder...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col h-full bg-slate-950 text-slate-200 items-center justify-center">
        <AlertCircle className="w-8 h-8 mb-4 text-rose-400" />
        <p className="text-rose-400">{error}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-slate-950 text-slate-200">
      <div className="flex items-center justify-between p-6 border-b border-white/10">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-200">Quote Builder</h1>
          <p className="text-sm text-slate-400 mt-1">Create and manage professional quotes for opportunities</p>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={() => setIsSaved(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-slate-900/50 border border-white/10 rounded-lg hover:bg-slate-800/50 transition-colors"
          >
            {isSaved ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <Save className="w-4 h-4 text-slate-400" />}
            {isSaved ? 'Saved' : 'Save Draft'}
          </button>
          <button className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg transition-colors">
            <Send className="w-4 h-4" />
            Send Quote
          </button>
        </div>
      </div>

      <div className="flex-1 p-6 overflow-auto">
        <div className="max-w-4xl mx-auto space-y-6">
          
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="p-6 bg-slate-900/40 backdrop-blur-md border border-white/10 rounded-xl"
          >
            <div className="flex justify-between items-start mb-8">
              <div>
                <h2 className="text-xl font-semibold mb-2">Quote {quoteDetails?.quote_number || '#QT-NEW'}</h2>
                <div className="text-sm text-slate-400 space-y-1">
                  <p>Prepared for: {quoteDetails?.customer_name || 'N/A'}</p>
                  <p>Opportunity: {quoteDetails?.opportunity_name || 'N/A'}</p>
                  <p>Valid until: {quoteDetails?.valid_until ? new Date(quoteDetails.valid_until).toLocaleDateString() : 'N/A'}</p>
                </div>
              </div>
              <div className="w-12 h-12 rounded-lg bg-indigo-500/10 flex items-center justify-center border border-indigo-500/20">
                <FileText className="w-6 h-6 text-indigo-400" />
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-slate-400 text-left">
                    <th className="pb-3 font-medium uppercase tracking-wider text-xs">Description</th>
                    <th className="pb-3 font-medium uppercase tracking-wider text-xs w-24">Qty</th>
                    <th className="pb-3 font-medium uppercase tracking-wider text-xs w-32">Unit Price</th>
                    <th className="pb-3 font-medium uppercase tracking-wider text-xs w-32 text-right">Amount</th>
                    <th className="pb-3 w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {items.map((item) => (
                    <tr key={item.id} className="group">
                      <td className="py-3 pr-4">
                        <input 
                          type="text" 
                          value={item.description}
                          onChange={(e) => updateItem(item.id, 'description', e.target.value)}
                          placeholder="Item description"
                          className="w-full bg-transparent border border-transparent hover:border-white/10 focus:border-indigo-500/50 rounded px-2 py-1 outline-none transition-colors"
                        />
                      </td>
                      <td className="py-3 pr-4">
                        <input 
                          type="number" 
                          value={item.quantity}
                          min="1"
                          onChange={(e) => updateItem(item.id, 'quantity', parseInt(e.target.value) || 0)}
                          className="w-full bg-transparent border border-transparent hover:border-white/10 focus:border-indigo-500/50 rounded px-2 py-1 outline-none transition-colors"
                        />
                      </td>
                      <td className="py-3 pr-4">
                        <div className="relative">
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500">$</span>
                          <input 
                            type="number" 
                            value={item.unitPrice}
                            min="0"
                            onChange={(e) => updateItem(item.id, 'unitPrice', parseFloat(e.target.value) || 0)}
                            className="w-full bg-transparent border border-transparent hover:border-white/10 focus:border-indigo-500/50 rounded pl-6 pr-2 py-1 outline-none transition-colors"
                          />
                        </div>
                      </td>
                      <td className="py-3 text-right font-medium text-slate-300">
                        ${(item.quantity * item.unitPrice).toFixed(2)}
                      </td>
                      <td className="py-3 text-right">
                        <button 
                          onClick={() => removeItem(item.id)}
                          className="text-slate-500 hover:text-rose-400 opacity-0 group-hover:opacity-100 transition-all p-1"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <button 
              onClick={addItem}
              className="mt-4 flex items-center gap-2 text-sm text-indigo-400 hover:text-indigo-300 transition-colors font-medium"
            >
              <Plus className="w-4 h-4" />
              Add Line Item
            </button>

            <div className="mt-8 flex justify-end">
              <div className="w-64 space-y-3 text-sm">
                <div className="flex justify-between text-slate-400">
                  <span>Subtotal</span>
                  <span className="text-slate-300">${subtotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>VAT (15%)</span>
                  <span className="text-slate-300">${tax.toFixed(2)}</span>
                </div>
                <div className="flex justify-between font-semibold text-lg border-t border-white/10 pt-3 mt-3">
                  <span>Total</span>
                  <span className="text-indigo-400">${total.toFixed(2)}</span>
                </div>
              </div>
            </div>
          </motion.div>
          
        </div>
      </div>
    </div>
  );
}
