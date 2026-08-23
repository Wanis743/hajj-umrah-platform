import { useCallback, useRef, useState } from 'react';
import { reportWarning } from '@/lib/logger';

export function useQueryResource<T>(query: (signal: AbortSignal) => Promise<T>) {
  const controllerRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);
  const [data, setData] = useState<T | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const generation = ++generationRef.current;
    setLoading(true);
    try {
      const next = await query(controller.signal);
      if (generation === generationRef.current && !controller.signal.aborted) {
        setData(next);
        setError(null);
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : 'Request failed');
      reportWarning('resource.query_failed');
    } finally {
      // Always clear loading regardless of generation to prevent infinite spinners
      setLoading(false);
    }
  }, [query]);

  return { data, setData, loading, error, refetch };
}
