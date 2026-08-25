import { useMemo } from 'react';
import { useSupabaseData } from '@/hooks/useSupabaseData';
import type { JournalLineRow } from '@/types/database';

/**
 * Net posted balance per account (debit − credit; statement readers flip
 * liability/revenue signs at display time). Balances are computed from posted
 * lines — the table has no denormalised balance column, so showing one from
 * `chart_of_accounts` lied by omission.
 *
 * Read-only. Kept in its own module so the generic-hook mutation check
 * (verify-architecture) does not attribute an unrelated mutation elsewhere
 * in the consuming component to the critical `journal_lines` table.
 */
export function useJournalLineBalances(): Map<string, number> {
  const { data: lines } = useSupabaseData<JournalLineRow>({
    table: 'journal_lines',
    columns: 'id,account_id,currency_code,debit,credit',
    limit: 2000,
  });
  return useMemo(() => {
    const map = new Map<string, number>();
    for (const l of lines) {
      const prev = map.get(l.account_id) ?? 0;
      map.set(l.account_id, prev + Number(l.debit ?? 0) - Number(l.credit ?? 0));
    }
    return map;
  }, [lines]);
}
