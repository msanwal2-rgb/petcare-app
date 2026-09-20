
/* This is a small generic data-fetching hook: fetch on mount, expose a
   loading→data→error cycle, and re-run when `deps` change. That inherently
   means setting state from inside an effect, so the corresponding hook lints
   are disabled deliberately for this file only. */
/* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */

import { useCallback, useEffect, useState } from "react";

export function useAsync<T>(
  fn: () => Promise<T>,
  deps: unknown[]
): { data: T | null; loading: boolean; error: Error | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    // `fn` is intentionally excluded from deps — we re-run only when the
    // caller's `deps` (or a reload) change, using the latest fn closure.
    fn()
      .then((res) => alive && setData(res))
      .catch((e) => alive && setError(e as Error))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, loading, error, reload };
}
