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
export const StethoscopeIcon = (p: P) => (
  <svg {...svg(p)}>
    <path d="M6 3v5a4 4 0 0 0 8 0V3" />
    <path d="M6 3H4.5M14 3h1.5" />
    <path d="M10 12v2.5a5 5 0 0 0 5 5 4 4 0 0 0 4-4V14" />
    <circle cx="19" cy="12" r="2" />
  </svg>
);
export const PillIcon = (p: P) => (
  <svg {...svg(p)}>
    <rect x="2.5" y="8.5" width="19" height="7" rx="3.5" transform="rotate(-45 12 12)" />
    <path d="m9 9 6 6" />
  </svg>
);
export const SyringeIcon = (p: P) => (
  <svg {...svg(p)}>
    <path d="m14 4 6 6M17.5 6.5 20.5 3.5" />
    <path d="m5.5 18.5 9-9 3 3-9 9H5.5v-3Z" />
    <path d="m10 11 2 2M12.5 8.5l2 2" />
  </svg>
);
export const VideoIcon = (p: P) => (
  <svg {...svg(p)}>
    <rect x="3" y="6" width="12" height="12" rx="2.5" />
    <path d="m15 10.5 6-3.5v10l-6-3.5z" />
  </svg>
);
export const BagIcon = (p: P) => (
  <svg {...svg(p)}>
    <path d="M5 8h14l-1 12H6L5 8Z" />
    <path d="M9 8V6a3 3 0 0 1 6 0v2" />
  </svg>
);
export const TruckIcon = (p: P) => (
  <svg {...svg(p)}>
    <path d="M3 6h11v11H3zM14 10h4l3 3v4h-7z" />
    <circle cx="7" cy="18" r="1.8" />
    <circle cx="17" cy="18" r="1.8" />
  </svg>
);
export const PackageIcon = (p: P) => (
  <svg {...svg(p)}>
    <path d="M12 3 4 7v10l8 4 8-4V7l-8-4Z" />
    <path d="m4 7 8 4 8-4M12 11v10" />
  </svg>
);
export const AlertIcon = (p: P) => (
  <svg {...svg(p)}>
    <path d="M12 4.5 21 19H3L12 4.5Z" />
    <path d="M12 10v4M12 16.5h.01" />
  </svg>
);
export const TrashIcon = (p: P) => (
  <svg {...svg(p)}>
    <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" />
    <path d="M10 11v6M14 11v6" />
  </svg>
);
