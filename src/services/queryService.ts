import { supabase } from '@/lib/supabase';
import { reportError } from '@/lib/logger';

export class QueryService {
  static async fetchTable<T>(tableName: string, select = '*'): Promise<T[]> {
    try {
      const { data, error } = await supabase.from(tableName).select(select);
      if (error) throw error;
      return (data || []) as T[];
    } catch (e) {
      reportError(`QUERY_FETCH_FAILED_${tableName.toUpperCase()}`, e);
      throw e;
    }
  }

  static async fetchRpc<T>(rpcName: string, params?: Record<string, unknown>): Promise<T> {
    try {
      const { data, error } = await supabase.rpc(rpcName, params);
      if (error) throw error;
      return data as T;
    } catch (e) {
      reportError(`QUERY_RPC_FAILED_${rpcName.toUpperCase()}`, e);
      throw e;
    }
  }
}
