"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useSession } from "@/lib/store/session";
import { logout as endSession, useAuthNavigate } from "@/lib/auth/session-client";
import { useScrolled } from "@/lib/hooks/useScrolled";
import { ButtonLink } from "@/components/ui/Button";
import { DevAccountSwitcher } from "./DevAccountSwitcher";
import { CartButton } from "./store/CartButton";
import { RoleToggle } from "./RoleToggle";
import { MenuIcon, XIcon } from "./ui/icons";
import { BLUR_DATA_URL } from "@/lib/media/photos";
import { DURATION, EASE_GLIDE, EASE_OUT, layoutGlide } from "@/lib/motion";
import { cn } from "@/lib/utils";

function Logo() {
  return (
    <Link
      href="/"
      className="group flex items-center gap-2"
      aria-label="Leash — home"
    >
      {/* small ID-tag mark, nodding to the leash-line motif without paws */}
      <span className="relative flex h-8 w-8 items-center justify-center rounded-full bg-ink transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-110">
        <span className="h-3 w-3 rounded-full border-2 border-marigold transition-colors duration-300 group-hover:border-leash" />
      </span>
      <span className="text-lg font-semibold tracking-tight text-ink">Leash</span>
    </Link>
  );
}

/**
 * `guarded` marks routes behind proxy.ts. Prefetching one while signed out
 * caches the redirect to /login, and the router then replays that stale
 * redirect after the user signs in — so those links only prefetch once there
 * is a session to prefetch with.
 */
const NAV = [
  { href: "/search", label: "Find care" },
  { href: "/vets", label: "Vets" },
  { href: "/store", label: "Store" },
  { href: "/dashboard", label: "Dashboard", guarded: true },
];

/** A nav item is "current" for its whole section, not just its exact URL. */
function isCurrent(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SiteHeader() {
  const pathname = usePathname();
  const navigateAfterAuth = useAuthNavigate();
  const { currentUser, hasHydrated } = useSession();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const scrolled = useScrolled(8);

  // What the sliding pill sits under: whatever is hovered, else the current
  // section. One shared element travels between items rather than four
  // independent underlines fading in and out.
  const active = hovered ?? NAV.find((i) => isCurrent(pathname, i.href))?.href ?? null;

  async function handleLogout() {
    await endSession();
    navigateAfterAuth("/");
  }

  return (
    <>
      <motion.header
        // The chrome tightens as you leave the top of the page: the bar loses
        // height, the blur deepens, and a hairline appears. At rest it should
        // feel like part of the page, not a toolbar bolted over it.
        initial={false}
        animate={{
          backgroundColor: scrolled
            ? "rgba(241, 243, 240, 0.88)"
            : "rgba(241, 243, 240, 0)",
          borderBottomColor: scrolled
            ? "rgba(200, 214, 198, 0.7)"
            : "rgba(200, 214, 198, 0)",
          boxShadow: scrolled
            ? "0 1px 24px rgba(27, 59, 54, 0.06)"
            : "0 1px 24px rgba(27, 59, 54, 0)",
        }}
        transition={{ duration: DURATION.base, ease: EASE_OUT }}
        className={cn(
          "sticky top-0 z-40 border-b",
          scrolled && "backdrop-blur-xl"
        )}
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
              {NAV.map((item) => {
                const current = isCurrent(pathname, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    prefetch={item.guarded ? Boolean(currentUser) : undefined}
                    onMouseEnter={() => setHovered(item.href)}
                    onFocus={() => setHovered(item.href)}
                    onBlur={() => setHovered(null)}
                    aria-current={current ? "page" : undefined}
                    className={cn(
                      "relative rounded-full px-3 py-1.5 text-sm transition-colors duration-200",
                      current ? "font-medium text-ink" : "text-charcoal/75 hover:text-ink"
                    )}
                  >
                    {active === item.href && (
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
            <CartButton />
            {!hasHydrated ? (
              <div className="h-9 w-40" />
            ) : currentUser ? (
              <>
                {/* renders nothing for single-role users */}
                <RoleToggle />
                <Link
                  href="/dashboard"
                  prefetch={false}
                  className="group flex items-center gap-2 rounded-full border border-mist bg-white py-1 pl-1 pr-3 transition-all duration-300 hover:border-ink/30 hover:shadow-sm"
                >
                  <span className="relative h-7 w-7 overflow-hidden rounded-full">
                    <Image
                      src={currentUser.avatarUrl}
                      alt=""
                      fill
                      sizes="28px"
                      placeholder="blur"
                      blurDataURL={BLUR_DATA_URL}
                      className="object-cover transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-110"
                    />
                  </span>
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
                  href="/login"
                  className="text-sm font-medium text-ink transition-colors duration-200 hover:text-leash"
                >
                  Log in
                </Link>
                <ButtonLink href="/signup" variant="primary" size="sm">
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
                  {NAV.map((item, i) => (
                    <motion.div
                      key={item.href}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{
                        duration: DURATION.fast,
                        ease: EASE_OUT,
                        delay: 0.04 + i * 0.04,
                      }}
                    >
                      <Link
                        href={item.href}
                        prefetch={item.guarded ? Boolean(currentUser) : undefined}
                        onClick={() => setMobileOpen(false)}
                        aria-current={isCurrent(pathname, item.href) ? "page" : undefined}
                        className={cn(
                          "block rounded-lg px-3 py-2.5 text-sm transition-colors",
                          isCurrent(pathname, item.href)
                            ? "bg-white font-medium text-ink"
                            : "text-charcoal hover:bg-white"
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
                        href="/login"
                        variant="outline"
                        size="sm"
                        onClick={() => setMobileOpen(false)}
                      >
                        Log in
                      </ButtonLink>
                      <ButtonLink
                        href="/signup"
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
