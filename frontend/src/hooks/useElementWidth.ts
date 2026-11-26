import { useCallback, useState } from 'react';

/**
 * How wide an element is drawn, followed as it changes (8e2a: the gear table keeps in its row what fits): a ref to put on
 * it, and its width in pixels. 0 until measured, and where the browser can't say (no ResizeObserver, as in tests).
 */
export function useElementWidth(): [(el: HTMLElement | null) => void, number] {
  const [width, setWidth] = useState(0);
  const ref = useCallback((el: HTMLElement | null) => {
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const seen = new ResizeObserver((entries) => {
      const w = Math.round(entries[0]?.contentRect.width ?? 0);
      setWidth((was) => (was === w ? was : w));
    });
    seen.observe(el);
    return () => seen.disconnect();
  }, []);
  return [ref, width];
}
