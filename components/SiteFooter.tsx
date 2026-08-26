import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="border-t border-mist bg-fog">
      <div className="mx-auto max-w-[1200px] px-4 py-10 sm:px-6">
        <div className="flex flex-col gap-8 md:flex-row md:justify-between">
          <div className="max-w-xs">
            <div className="flex items-center gap-2">
              <span className="relative flex h-8 w-8 items-center justify-center rounded-full bg-ink">
                <span className="h-3 w-3 rounded-full border-2 border-marigold" />
              </span>
              <span className="text-lg font-semibold tracking-tight text-ink">
                Leash
              </span>
            </div>
            <p className="mt-3 text-sm text-charcoal/65">
              Trusted local pet care, licensed vets, and the food they
              recommend — in one place, so your pet&apos;s history follows them.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
            <FooterCol
              title="Care"
              links={[
                ["Find a caretaker", "/search"],
                ["How it works", "/#how"],
                ["Become a caretaker", "/signup"],
              ]}
            />
            <FooterCol
              title="Health"
              links={[
                ["Find a vet", "/vets"],
                ["Emergency signs", "/pet-health#emergencies"],
                ["Vaccination schedules", "/pet-health#vaccinations"],
              ]}
            />
            <FooterCol
              title="Store"
              links={[
                ["Food & supplies", "/store"],
                ["Your orders", "/store/orders"],
                ["Your cart", "/store/cart"],
              ]}
            />
            <FooterCol
              title="Account"
              links={[
                ["Dashboard", "/dashboard"],
                ["Help & policies", "/support"],
                ["Log in", "/login"],
                ["Sign up", "/signup"],
              ]}
            />
          </div>
        </div>
        <div className="mt-10 flex flex-col gap-2 border-t border-mist pt-6 text-xs text-charcoal/50 sm:flex-row sm:justify-between">
          <p>
            © 2026 Leash. A demo marketplace — bookings, appointments and
            orders are real records; payments and delivery are simulated.
          </p>
          <p className="font-mono">Care · Vets · Store</p>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({
  title,
  links,
}: {
  title: string;
  links: [string, string][];
}) {
  return (
    <div>
      <h4 className="text-xs font-semibold uppercase tracking-wide text-ink">
        {title}
      </h4>
      <ul className="mt-3 space-y-2">
        {links.map(([label, href]) => (
          <li key={label}>
            <Link
              href={href}
              className="text-sm text-charcoal/65 transition-colors hover:text-ink"
            >
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
