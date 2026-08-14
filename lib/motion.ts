/**
 * The app's motion vocabulary.
 *
 * Every animation reads its easing and duration from here rather than inlining
 * a bezier, so the whole product moves with one hand. Before this, the same
 * `[0.22, 1, 0.36, 1]` was written out in four files and had already started
 * drifting on duration.
 *
 * The feel is deliberately Apple-ish: long, decelerating, no overshoot or
 * bounce. Motion should look like something heavy settling into place, not
 * something springing. Anything that reverses direction reads as a toy.
 *
 * Reduced motion is handled globally by `MotionConfig reducedMotion="user"` in
 * PageTransition plus the media query in globals.css — individual components
 * never need to check.
 */

/** Decelerating ease. The default for anything entering or settling. */
export const EASE_OUT = [0.22, 1, 0.36, 1] as const;

/**
 * Apple's panel curve: a long, slightly weighted glide. Used where an element
 * travels a visible distance — the nav indicator, the mobile sheet.
 */
export const EASE_GLIDE = [0.32, 0.72, 0, 1] as const;

export const DURATION = {
  /** Small UI state changes — badges, icon swaps, tab panels. */
  fast: 0.25,
  /** The default: route transitions, panels opening. */
  base: 0.4,
  /** Content arriving on scroll. */
  slow: 0.6,
} as const;

/** Container that lets its <RevealItem> children arrive in sequence. */
export const stagger = (each = 0.06) => ({
  hidden: {},
  show: { transition: { staggerChildren: each } },
});

/** Springless settle for shared-layout elements (the nav indicator). */
export const layoutGlide = {
  type: "spring",
  stiffness: 420,
  damping: 38,
  mass: 0.9,
} as const;
