"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { useSession } from "@/lib/store/session";
import { logout as endSession } from "@/lib/auth/session-client";
import { ButtonLink } from "@/components/ui/Button";
import { DevAccountSwitcher } from "./DevAccountSwitcher";
import { CartButton } from "./store/CartButton";
import { RoleToggle } from "./RoleToggle";
import { MenuIcon, XIcon } from "./ui/icons";
import { BLUR_DATA_URL } from "@/lib/media/photos";
import { cn } from "@/lib/utils";

function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2" aria-label="Leash — home">
      {/* small ID-tag mark, nodding to the leash-line motif without paws */}
      <span className="relative flex h-8 w-8 items-center justify-center rounded-full bg-ink">
        <span className="h-3 w-3 rounded-full border-2 border-marigold" />
      </span>
      <span className="text-lg font-semibold tracking-tight text-ink">Leash</span>
    </Link>
  );
}

const NAV = [
  { href: "/search", label: "Find care" },
  { href: "/vets", label: "Vets" },
  { href: "/store", label: "Store" },
  { href: "/dashboard", label: "Dashboard" },
];

export function SiteHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const { currentUser, hasHydrated } = useSession();
  const [mobileOpen, setMobileOpen] = useState(false);

  async function handleLogout() {
    await endSession();
    router.push("/");
  }

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-mist/70 bg-fog/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-8">
            <Logo />
            <nav className="hidden items-center gap-6 md:flex">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "text-sm text-charcoal/75 transition-colors hover:text-ink",
                    pathname === item.href && "font-medium text-ink"
                  )}
                >
                  {item.label}
                </Link>
              ))}
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
                  className="flex items-center gap-2 rounded-full border border-mist bg-white py-1 pl-1 pr-3 transition-colors hover:border-ink/30"
                >
                  <span className="relative h-7 w-7 overflow-hidden rounded-full">
                    <Image
                      src={currentUser.avatarUrl}
                      alt=""
                      fill
                      sizes="28px"
                      placeholder="blur"
                      blurDataURL={BLUR_DATA_URL}
                      className="object-cover"
                    />
                  </span>
                  <span className="text-sm font-medium text-ink">
                    {currentUser.name.split(" ")[0]}
                  </span>
                </Link>
                <button
                  onClick={handleLogout}
                  className="text-sm text-charcoal/60 transition-colors hover:text-ink"
                >
                  Log out
                </button>
              </>
            ) : (
              <>
                <Link
                  href="/login"
                  className="text-sm font-medium text-ink transition-colors hover:text-ink-hover"
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
            >
              {mobileOpen ? <XIcon /> : <MenuIcon />}
            </button>
          </div>
        </div>

        {mobileOpen && (
          <div className="border-t border-mist bg-fog px-4 py-4 md:hidden">
            <nav className="flex flex-col gap-1">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className="rounded-lg px-3 py-2.5 text-sm text-charcoal hover:bg-white"
                >
                  {item.label}
                </Link>
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
                  <ButtonLink href="/login" variant="outline" size="sm" onClick={() => setMobileOpen(false)}>
                    Log in
                  </ButtonLink>
                  <ButtonLink href="/signup" variant="primary" size="sm" onClick={() => setMobileOpen(false)}>
                    Sign up
                  </ButtonLink>
                </>
              )}
            </div>
          </div>
        )}
      </header>
      <DevAccountSwitcher />
    </>
  );
}
