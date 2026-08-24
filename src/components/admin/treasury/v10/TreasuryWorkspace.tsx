import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { DollarSign, TrendingUp, Activity, BarChart2, Briefcase, RefreshCcw, ArrowUpRight, ArrowDownRight, Loader2, AlertCircle } from 'lucide-react';
import { WorkspaceRegistry } from '../../../../platform/compat/workspaceRegistry';
import { supabase } from '../../../../lib/supabase';

interface TreasuryWorkspaceProps {
  registry: WorkspaceRegistry;
}

interface CashPosition {
  id: string;
  account: string;
  currency: string;
  balance: number;
  change: number;
}

export function TreasuryWorkspace({ registry }: TreasuryWorkspaceProps) {
  const [cashPositions, setCashPositions] = useState<CashPosition[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchPositions = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const { data, error: fetchError } = await supabase
          .from('cash_positions')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(10);

        if (fetchError) {
          if (fetchError.code === '42P01') {
            setCashPositions([]);
            return;
          }
          throw fetchError;
        }

        if (data && data.length > 0) {
          setCashPositions((data as Array<Record<string, unknown>>).map(p => ({
            id: String(p.id || ''),
            account: String(p.bank_portfolio || 'Unknown Account'),
            currency: 'SAR', // Standardize to SAR for now or fetch currency from another table
            balance: Number(p.net_position || 0),
            change: 0 // Mocking daily change
          })));
        } else {
          setCashPositions([
            { id: '1', account: 'Main Operating', currency: 'USD', balance: 12500000, change: 450000 },
            { id: '2', account: 'Reserve', currency: 'SAR', balance: 45000000, change: -120000 },
            { id: '3', account: 'Payroll', currency: 'USD', balance: 850000, change: 0 }
          ]);
        }
      } catch (err: unknown) {
        if (err instanceof Error) {
          setError(err.message);
        } else {
          setError('Failed to fetch cash positions');
        }
      } finally {
        setIsLoading(false);
      }
    };
    fetchPositions();
  }, []);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-white/90">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-500 mb-4" />
        <p className="text-white/55">Loading treasury data...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-white/90 p-6">
        <AlertCircle className="w-8 h-8 text-rose-400 mb-4" />
        <p className="text-rose-400">{error}</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 text-white/90">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-white flex items-center gap-2">
            <Briefcase className="w-6 h-6 text-indigo-400" />
            Treasury & Liquidity
          </h2>
          <p className="text-sm text-white/55 mt-1">Cash positioning, forecasting, and bank relations</p>
        </div>
        <div className="flex items-center gap-3">
          <button className="flex items-center gap-2 px-4 py-2 bg-white/[0.08] backdrop-blur-lg rounded-xl border border-white/10 text-white/90 rounded-lg text-sm font-medium hover:bg-white/[0.08] transition-colors">
            <RefreshCcw className="w-4 h-4" />
            Sync Banks
          </button>
          <button className="px-4 py-2 bg-indigo-500 text-white rounded-lg text-sm font-medium hover:bg-indigo-600 transition-colors">
            Initiate Transfer
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="p-5 bg-white/[0.04]/50 border border-white/5 rounded-xl flex flex-col justify-between">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-indigo-500/10 rounded-lg text-indigo-400">
              <DollarSign className="w-5 h-5" />
            </div>
            <h3 className="font-medium text-white/80">Global Cash</h3>
          </div>
          <div>
            <div className="text-3xl font-semibold text-white mb-1">
              ${(cashPositions.reduce((acc, pos) => acc + (pos.currency === 'SAR' ? pos.balance / 3.75 : pos.balance), 0)).toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </div>
            <div className="text-sm text-emerald-400 flex items-center gap-1">
              <ArrowUpRight className="w-4 h-4" /> +1.2% Today
            </div>
          </div>
        </div>

        <div className="p-5 bg-white/[0.04]/50 border border-white/5 rounded-xl flex flex-col justify-between">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-emerald-500/10 rounded-lg text-emerald-400">
              <TrendingUp className="w-5 h-5" />
            </div>
            <h3 className="font-medium text-white/80">30-Day Forecast</h3>
          </div>
          <div>
            <div className="text-3xl font-semibold text-white mb-1">+$2.1M</div>
            <div className="text-sm text-white/55 flex items-center gap-1">
              Net Inflows
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white/[0.04]/40 border border-white/10 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-white/10 bg-white/[0.05]">
          <h3 className="font-medium text-white/90">Account Positions</h3>
        </div>
        <div className="divide-y divide-white/5">
          {cashPositions.map((pos) => (
            <div key={pos.id} className="p-4 flex items-center justify-between hover:bg-white/5 transition-colors">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-full bg-white/[0.08] backdrop-blur-lg rounded-xl border border-white/10 flex items-center justify-center font-medium text-white/80">
                  {pos.currency}
                </div>
                <div>
                  <h4 className="font-medium text-white/90">{pos.account}</h4>
                  <p className="text-sm text-white/55">Standard Chartered •••• 4092</p>
                </div>
              </div>
              <div className="text-right">
                <div className="font-semibold text-white">
                  {pos.currency === 'USD' ? '$' : 'SAR '}
                  {pos.balance.toLocaleString()}
                </div>
                <div className={`text-sm flex items-center justify-end gap-1 ${pos.change >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {pos.change >= 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                  {Math.abs(pos.change).toLocaleString()}
                </div>
              </div>
            </div>
          ))}
          {cashPositions.length === 0 && (
            <div className="p-8 text-center text-white/40 text-sm">
              No cash positions found.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
