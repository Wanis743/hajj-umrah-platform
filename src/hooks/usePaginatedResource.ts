import { useCallback, useState } from 'react';

export type CursorPage<T> = { items: T[]; nextCursor: string | null };

export function usePaginatedResource<T>(fetchPage: (cursor: string | null, signal: AbortSignal) => Promise<CursorPage<T>>) {
  const [pages, setPages] = useState<CursorPage<T>[]>([]);
  const [loading, setLoading] = useState(false);

  const loadMore = useCallback(async () => {
    setLoading(true);
    const controller = new AbortController();
    try {
      const cursor = pages.at(-1)?.nextCursor ?? null;
      if (cursor === null && pages.length > 0) return;
      const page = await fetchPage(cursor, controller.signal);
      setPages(prev => [...prev, page]);
    } finally {
      setLoading(false);
    }
  }, [fetchPage, pages]);

  return { pages, items: pages.flatMap(page => page.items), loading, loadMore };
}
