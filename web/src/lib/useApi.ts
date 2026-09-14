import { useCallback, useEffect, useRef, useState } from 'react';

export interface Loaded<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => Promise<void>;
  /** Optimistically replace the data without a round trip. */
  set: (updater: (prev: T) => T) => void;
}

/** Load once (and on `deps` change); `reload()` refetches after a mutation. */
export function useApi<T>(fetcher: () => Promise<T>, deps: unknown[] = []): Loaded<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const fetchRef = useRef(fetcher);
  fetchRef.current = fetcher;
  const seq = useRef(0);

  const reload = useCallback(async () => {
    const my = ++seq.current;
    try {
      const d = await fetchRef.current();
      if (my === seq.current) {
        setData(d);
        setError(null);
      }
    } catch (err) {
      if (my === seq.current) setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const set = useCallback((updater: (prev: T) => T) => setData((prev) => (prev === null ? prev : updater(prev))), []);
  return { data, error, loading, reload, set };
}

/** Run a mutation, surface its error, then refresh. */
export function useAction(afterwards?: () => Promise<void> | void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(
    async <R,>(fn: () => Promise<R>): Promise<R | undefined> => {
      setBusy(true);
      setError(null);
      try {
        const r = await fn();
        await afterwards?.();
        return r;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong');
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [afterwards],
  );
  return { run, busy, error, clear: () => setError(null) };
}
