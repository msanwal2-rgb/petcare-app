/**
 * Minimal inline icon set (stroke-based, currentColor). Kept small and
 * functional — this is a photography-led product, not an icon-heavy one (§3).
 * No paw prints scattered around; the one signature motif is the leash line.
 */
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement>;
const svg = (props: P) => ({
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  width: 20,
  height: 20,
  ...props,
});

export const SearchIcon = (p: P) => (
  <svg {...svg(p)}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
);
export const MapPinIcon = (p: P) => (
  <svg {...svg(p)}>
    <path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11Z" />
    <circle cx="12" cy="10" r="2.5" />
  </svg>
);
export const CalendarIcon = (p: P) => (
  <svg {...svg(p)}>
    <rect x="3" y="4.5" width="18" height="16" rx="2.5" />
    <path d="M3 9h18M8 3v3M16 3v3" />
  </svg>
);
export const ClockIcon = (p: P) => (
  <svg {...svg(p)}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </svg>
);
export const CheckIcon = (p: P) => (
  <svg {...svg(p)}>
    <path d="m4.5 12.5 5 5 10-11" />
  </svg>
);
export const ShieldCheckIcon = (p: P) => (
  <svg {...svg(p)}>
    <path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3Z" />
    <path d="m9 12 2 2 4-4.5" />
  </svg>
);
export const PlusIcon = (p: P) => (
  <svg {...svg(p)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);
export const ChevronRightIcon = (p: P) => (
  <svg {...svg(p)}>
    <path d="m9 6 6 6-6 6" />
  </svg>
);
export const ChevronDownIcon = (p: P) => (
  <svg {...svg(p)}>
    <path d="m6 9 6 6 6-6" />
  </svg>
);
export const XIcon = (p: P) => (
  <svg {...svg(p)}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);
export const MenuIcon = (p: P) => (
  <svg {...svg(p)}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </svg>
);
export const HeartIcon = (p: P) => (
  <svg {...svg(p)}>
    <path d="M12 20s-7-4.4-7-9.5A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 7 3.5C19 15.6 12 20 12 20Z" />
  </svg>
);
export const DogIcon = (p: P) => (
  <svg {...svg(p)}>
    <path d="M10 5.5 7 4v4M14 5.5 17 4v4" />
    <path d="M5 9.5C5 8 6 8 7 8h10c1 0 2 0 2 1.5V15a5 5 0 0 1-5 5h-4a5 5 0 0 1-5-5Z" />
    <path d="M9.5 13h.01M14.5 13h.01M12 16v1.5" />
  </svg>
);
export const PawIcon = (p: P) => (
  <svg {...svg(p)}>
    <circle cx="6.5" cy="10" r="1.6" />
    <circle cx="10" cy="7" r="1.6" />
    <circle cx="14" cy="7" r="1.6" />
    <circle cx="17.5" cy="10" r="1.6" />
    <path d="M12 12c-2.5 0-4.5 1.7-4.5 3.8 0 1.6 1.4 2.2 2.8 1.8.9-.3 2.5-.3 3.4 0 1.4.4 2.8-.2 2.8-1.8 0-2.1-2-3.8-4.5-3.8Z" />
  </svg>
);
export const StarIcon = (p: P) => (
  <svg {...svg(p)}>
    <path d="M12 3.5l2.6 5.27 5.82.85-4.21 4.1.99 5.79L12 16.77l-5.2 2.73.99-5.79-4.21-4.1 5.82-.85z" />
  </svg>
);
export const UserIcon = (p: P) => (
  <svg {...svg(p)}>
    <circle cx="12" cy="8" r="3.5" />
    <path d="M5 20c0-3.5 3-5.5 7-5.5s7 2 7 5.5" />
  </svg>
);
export const HomeIcon = (p: P) => (
  <svg {...svg(p)}>
    <path d="M4 11 12 4l8 7" />
    <path d="M6 10v9h12v-9" />
  </svg>
);
