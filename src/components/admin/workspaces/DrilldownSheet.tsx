import React from 'react';
import { SideSheet } from './SideSheet';
import { money } from '@/lib/currency';

interface DrilldownSheetProps {
  isOpen: boolean;
  onClose: () => void;
  data: {
    title: string;
    metric: string;
    rows: Record<string, string | number | boolean | null | undefined>[];
  } | null;
  onRowClick?: (row: Record<string, string | number | boolean | null | undefined>) => void;
}

export function DrilldownSheet({ isOpen, onClose, data, onRowClick }: DrilldownSheetProps) {
  if (!data) return null;

  return (
    <SideSheet isOpen={isOpen} onClose={onClose} title={data.title} width="max-w-xl">
      <div className="mb-4">
        <p className="text-sm text-[var(--text-muted)]">
          {data.rows.length} records found for this metric
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[var(--text-muted)] border-b border-[var(--border)]">
              <th className="py-3 px-2 font-medium">Reference</th>
              <th className="py-3 px-2 font-medium">Name / Package</th>
              <th className="py-3 px-2 font-medium">Status / Date</th>
              <th className="py-3 px-2 font-medium text-right">Value</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row, idx) => {
              const ref = row.reference || row.invoice_number || row.code || row.booking_reference || '---';
              const name = row.full_name || row.pilgrim_name || row.name || row.package_name || '---';
              const status = row.status || row.due_date || row.departure_date || row.received_at || (row.readiness_score != null ? `${Number(row.readiness_score).toFixed(0)}%` : '---');
              
              let value = '---';
              if (row.balance_dzd != null) value = money(Number(row.balance_dzd), 'DZD');
              else if (row.amount_dzd != null) value = money(Number(row.amount_dzd), 'DZD');
              else if (row.revenue_dzd != null) value = money(Number(row.revenue_dzd), 'DZD');
              else if (row.bookings != null) value = String(row.bookings);

              return (
                <tr 
                  key={String(row.id || idx)} 
                  className={`border-b border-[var(--border)] last:border-0 ${onRowClick ? 'cursor-pointer hover:bg-[var(--bg-hover)] transition-colors' : ''}`}
                  onClick={() => onRowClick?.(row)}
                >
                  <td className="py-3 px-2">{ref}</td>
                  <td className="py-3 px-2 font-medium text-[var(--text-primary)]">{name}</td>
                  <td className="py-3 px-2">
                    <span className="inline-flex items-center px-2 py-1 rounded-md bg-[var(--bg-hover)] text-xs">
                      {status}
                    </span>
                  </td>
                  <td className="py-3 px-2 text-right tabular-nums font-medium">{value}</td>
                </tr>
              );
            })}
            
            {data.rows.length === 0 && (
              <tr>
                <td colSpan={4} className="py-8 text-center text-[var(--text-muted)]">
                  No records found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </SideSheet>
  );
}
