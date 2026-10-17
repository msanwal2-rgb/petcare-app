import { useCallback, useState } from "react";

/**
 * Page-by-page navigation over a cursor-paged list.
 *
 * The admin screens keep the reference's "Previous · 2 / 5 · Next" controls,
 * but the API pages by cursor rather than offset (REQUIREMENTS.md §2.5). The
 * total still gives the page count; a stack of the cursors that started each
 * page visited gives "Previous" without asking the server to count backwards.
 */
export function useCursorPager() {
  const [stack, setStack] = useState<(string | null)[]>([null]);

  const next = useCallback((cursor: string | null | undefined) => {
    if (cursor) setStack((s) => [...s, cursor]);
  }, []);
  const prev = useCallback(() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)), []);
  const reset = useCallback(() => setStack([null]), []);

  return { page: stack.length - 1, cursor: stack[stack.length - 1], next, prev, reset };
}
