/**
 * Row reads for the DMS screens.
 *
 * The document library is one query against an RLS-protected table: the
 * dms_documents_staff_select policy in 20260831120000_dms_vertical_slice.sql
 * restricts each row to has_permission('dms_documents','read') and
 * row_in_staff_scope(agency_id, branch_id), so a screen cannot see another
 * agency's documents even though the query is issued by the browser.
 *
 * Reads only. Every DMS write goes through a command RPC -- see dmsCommands in
 * @/services/domainCommands for why: review_status is a transition that also
 * stamps the reviewer and appends to the event ledger, a version's checksum is
 * compared against the bytes at finalise time, and a sealed evidence package is a
 * digest over its members.
 *
 * Composed payloads (dashboard, document 360, review queue, expiry report,
 * extraction quality, evidence packages) come from @/services/dmsAnalytics.
 */
import { useSupabaseData } from '@/hooks/useSupabaseData';
import type { DmsDocumentRow } from '@/types/dms';

export interface DmsRowsState<T> {
  data: T[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useDmsDocumentRows(
  opts: { reviewStatus?: string; term?: string; limit?: number } = {},
): DmsRowsState<DmsDocumentRow> {
  const { data, loading, error, refetch } = useSupabaseData<DmsDocumentRow>({
    table: 'dms_documents',
    orderBy: { column: 'updated_at', ascending: false },
    filter: opts.reviewStatus && opts.reviewStatus !== 'ALL'
      ? { column: 'review_status', value: opts.reviewStatus }
      : undefined,
    search: opts.term?.trim()
      ? { columns: ['title', 'document_number', 'document_type', 'description'], term: opts.term }
      : undefined,
    limit: opts.limit ?? 100,
  });
  return { data, loading, error, refetch };
}
