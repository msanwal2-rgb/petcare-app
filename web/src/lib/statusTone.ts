import type { StatusTone } from "@/components/ui/StatusBadge";

/**
 * The dot colour of each status tone — the badge's dot, and the calendar's
 * markers, so a day's dots read the same as the badges under them.
 */
export const TONE_DOT: Record<StatusTone, string> = {
  pending: "#F2A93B",
  active: "#1B3B36",
  progress: "#2F6F5E",
  done: "#7d938a",
  failed: "#E85C41",
  muted: "#9aa0a2",
};
