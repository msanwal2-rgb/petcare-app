import { useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { AnimatePresence, motion } from "framer-motion";
import { useSession } from "@/store/session";
import { logout as endSession } from "@/auth/session";
import { useScrolled } from "@/hooks/useScrolled";
import { ButtonLink } from "./ui/Button";
import { RoleToggle } from "./RoleToggle";
import { Avatar } from "./Avatar";
import { CartButton } from "./store/CartButton";
import { DevAccountSwitcher } from "./DevAccountSwitcher";
import { MenuIcon, XIcon } from "./ui/icons";
import { DURATION, EASE_GLIDE, EASE_OUT, layoutGlide } from "@/lib/motion";
import { cn } from "@/lib/utils";

function Logo() {
  return (
    <Link to="/" className="group flex items-center gap-2" aria-label="Leash — home">
      {/* small ID-tag mark, nodding to the leash-line motif without paws */}
      <span className="relative flex h-8 w-8 items-center justify-center rounded-full bg-ink transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-110">
        <span className="h-3 w-3 rounded-full border-2 border-marigold transition-colors duration-300 group-hover:border-leash" />
      </span>
      <span className="text-lg font-semibold tracking-tight text-ink">Leash</span>
    </Link>
  );
}

/**
 * The nav.
 *
 * The reference project marked guarded routes so it could disable Next's
 * prefetching on them — prefetching a guarded route while signed out cached the
 * middleware's redirect, and the router replayed it after sign-in. React Router
 * does not prefetch and the guard is a component, so that flag is gone and the
 * links are ordinary links.
 */
const NAV = [
  { to: "/search", label: "Find care" },
  { to: "/vets", label: "Vets" },
  { to: "/adopt", label: "Adopt" },
  { to: "/store", label: "Store" },
  { to: "/dashboard", label: "Dashboard" },
];

/**
 * The admin entry, appended for staff only.
 *
 * `staffRoles` reaches the client on the session user, which is safe because it
 * only ever describes the person it is sent to. Hiding the link is courtesy —
 * every endpoint behind it re-checks, so typing the URL gets an explanation
 * rather than a console.
 */
const ADMIN_NAV = { to: "/dashboard/admin", label: "Admin" };

/** A nav item is "current" for its whole section, not just its exact URL. */
function isCurrent(pathname: string, to: string): boolean {
  return pathname === to || pathname.startsWith(`${to}/`);
}

export function SiteHeader() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { currentUser, hasHydrated } = useSession();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const scrolled = useScrolled(8);

  // Staff get one extra item. Derived with useMemo rather than state, so it
  // follows the session without an effect that sets state during render.
  const nav = useMemo(
    () => ((currentUser?.staffRoles?.length ?? 0) > 0 ? [...NAV, ADMIN_NAV] : NAV),
    [currentUser?.staffRoles],
  );

  // What the sliding pill sits under: whatever is hovered, else the current
  // section. One shared element travels between items rather than five
  // independent underlines fading in and out.
  const active = hovered ?? nav.find((i) => isCurrent(pathname, i.to))?.to ?? null;

  async function handleLogout() {
    await endSession();
    // Home, and never a stale callbackUrl — signing out must not drag someone
    // back into the app they just left.
    navigate("/", { replace: true });
  }

  return (
    <>
    <motion.header
      // The chrome tightens as you leave the top of the page: the bar loses
      // height, the blur deepens, and a hairline appears. At rest it should feel
      // like part of the page, not a toolbar bolted over it.
      initial={false}
      animate={{
        backgroundColor: scrolled ? "rgba(241, 243, 240, 0.88)" : "rgba(241, 243, 240, 0)",
        borderBottomColor: scrolled ? "rgba(200, 214, 198, 0.7)" : "rgba(200, 214, 198, 0)",
        boxShadow: scrolled
          ? "0 1px 24px rgba(27, 59, 54, 0.06)"
          : "0 1px 24px rgba(27, 59, 54, 0)",
      }}
      transition={{ duration: DURATION.base, ease: EASE_OUT }}
      className={cn("sticky top-0 z-40 border-b", scrolled && "backdrop-blur-xl")}
    >
      <motion.div
        initial={false}
        animate={{ height: scrolled ? 56 : 64 }}
        transition={{ duration: DURATION.base, ease: EASE_OUT }}
        className="mx-auto flex max-w-[1200px] items-center justify-between px-4 sm:px-6"
      >
        <div className="flex items-center gap-8">
          <Logo />
          <nav
            className="relative hidden items-center gap-1 md:flex"
            onMouseLeave={() => setHovered(null)}
          >
            {nav.map((item) => {
              const current = isCurrent(pathname, item.to);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  onMouseEnter={() => setHovered(item.to)}
                  onFocus={() => setHovered(item.to)}
                  onBlur={() => setHovered(null)}
                  aria-current={current ? "page" : undefined}
                  className={cn(
                    "relative rounded-full px-3 py-1.5 text-sm transition-colors duration-200",
                    current ? "font-medium text-ink" : "text-charcoal/75 hover:text-ink",
                  )}
                >
                  {active === item.to && (
                    <motion.span
                      layoutId="nav-pill"
                      transition={layoutGlide}
                      className="absolute inset-0 -z-10 rounded-full bg-ink/[0.07]"
                    />
                  )}
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="hidden items-center gap-3 md:flex">
          {/* Outside the session branch: the cart is client-side and works
              signed out, so it should not wait on — or flicker with — auth. */}
          <CartButton />
          {!hasHydrated ? (
            // Reserved width, so the bar does not jump when the session resolves.
            <div className="h-9 w-40" />
          ) : currentUser ? (
            <>
              {/* renders nothing for single-role users */}
              <RoleToggle />
              <Link
                to="/dashboard"
                className="group flex items-center gap-2 rounded-full border border-mist bg-white py-1 pl-1 pr-3 transition-all duration-300 hover:border-ink/30 hover:shadow-sm"
              >
                <Avatar
                  src={currentUser.avatarUrl}
                  size={28}
                  className="transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-110"
                />
                <span className="text-sm font-medium text-ink">
                  {currentUser.name.split(" ")[0]}
                </span>
              </Link>
              <button
                onClick={handleLogout}
                className="text-sm text-charcoal/60 transition-colors duration-200 hover:text-ink"
              >
                Log out
              </button>
            </>
          ) : (
            <>
              <Link
                to="/login"
                className="text-sm font-medium text-ink transition-colors duration-200 hover:text-leash"
              >
                Log in
              </Link>
              <ButtonLink to="/signup" variant="primary" size="sm">
                Sign up
              </ButtonLink>
            </>
          )}
        </div>

        <div className="flex items-center gap-1 md:hidden">
          <CartButton />
          <button
            onClick={() => setMobileOpen((v) => !v)}
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileOpen}
            className="relative flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:bg-mist/40"
          >
            {/* Cross-fade + quarter turn between the two glyphs. */}
            <AnimatePresence initial={false} mode="wait">
              <motion.span
                key={mobileOpen ? "close" : "open"}
                initial={{ opacity: 0, rotate: mobileOpen ? -90 : 90 }}
                animate={{ opacity: 1, rotate: 0 }}
                exit={{ opacity: 0, rotate: mobileOpen ? 90 : -90 }}
                transition={{ duration: DURATION.fast, ease: EASE_OUT }}
                className="flex"
              >
                {mobileOpen ? <XIcon /> : <MenuIcon />}
              </motion.span>
            </AnimatePresence>
          </button>
        </div>
      </motion.div>

      {/* Mobile sheet: unrolls from the bar rather than snapping open. */}
      <AnimatePresence initial={false}>
        {mobileOpen && (
          <motion.div
            key="mobile-nav"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: DURATION.base, ease: EASE_GLIDE }}
            className="overflow-hidden border-t border-mist bg-fog/95 backdrop-blur-xl md:hidden"
          >
            <div className="px-4 py-4">
              <nav className="flex flex-col gap-1">
                {nav.map((item, i) => (
                  <motion.div
                    key={item.to}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{
                      duration: DURATION.fast,
                      ease: EASE_OUT,
                      delay: 0.04 + i * 0.04,
                    }}
                  >
                    <Link
                      to={item.to}
                      onClick={() => setMobileOpen(false)}
                      aria-current={isCurrent(pathname, item.to) ? "page" : undefined}
                      className={cn(
                        "block rounded-lg px-3 py-2.5 text-sm transition-colors",
                        isCurrent(pathname, item.to)
                          ? "bg-white font-medium text-ink"
                          : "text-charcoal hover:bg-white",
                      )}
                    >
                      {item.label}
                    </Link>
                  </motion.div>
                ))}
              </nav>
              <div className="mt-3 flex items-center gap-3 border-t border-mist pt-3">
                {hasHydrated && currentUser ? (
                  <>
                    <RoleToggle />
                    <button
                      onClick={() => {
                        void handleLogout();
                        setMobileOpen(false);
                      }}
                      className="text-sm text-charcoal/70"
                    >
                      Log out
                    </button>
                  </>
                ) : (
                  <>
                    <ButtonLink
                      to="/login"
                      variant="outline"
                      size="sm"
                      onClick={() => setMobileOpen(false)}
                    >
                      Log in
                    </ButtonLink>
                    <ButtonLink
                      to="/signup"
                      variant="primary"
                      size="sm"
                      onClick={() => setMobileOpen(false)}
                    >
                      Sign up
                    </ButtonLink>
                  </>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.header>
    <DevAccountSwitcher />
    </>
  );
}
