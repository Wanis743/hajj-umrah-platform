import { useCallback, useState } from 'react';

export function useResourceMutation<TInput, TOutput>(mutation: (input: TInput) => Promise<TOutput>) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const execute = useCallback(async (input: TInput) => {
    setLoading(true); setError(null);
    try { return await mutation(input); }
    catch (err) { setError(err instanceof Error ? err.message : 'Mutation failed'); throw err; }
    finally { setLoading(false); }
  }, [mutation]);
  return { execute, loading, error };
}
