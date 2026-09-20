
import { useEffect, useState } from "react";

/**
 * Whether the page has scrolled past `threshold` pixels.
 *
 * Reads on a passive scroll listener and only updates state when the boolean
 * actually flips, so a long scroll costs one render, not hundreds.
 */
export function useScrolled(threshold = 8): boolean {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const read = () => {
      const past = window.scrollY > threshold;
      setScrolled((was) => (was === past ? was : past));
    };
    read(); // the page may load already scrolled (a refresh, or a #hash link)
    window.addEventListener("scroll", read, { passive: true });
    return () => window.removeEventListener("scroll", read);
  }, [threshold]);

  return scrolled;
}
