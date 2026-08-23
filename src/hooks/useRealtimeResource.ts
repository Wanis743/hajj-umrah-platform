import { useEffect } from 'react';
import { realtimeManager, type RealtimeDomain } from '@/services/realtimeManager';

export function useRealtimeResource(domain: RealtimeDomain, invalidate: () => void) {
  useEffect(() => realtimeManager.subscribe(domain, invalidate), [domain, invalidate]);
}
