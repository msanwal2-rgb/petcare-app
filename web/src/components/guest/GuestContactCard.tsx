import type { GuestContact } from "@/types";

/**
 * On a caretaker's booking or a vet's appointment whose owner booked as a
 * guest (STATUS §3-G). A guest cannot read messages until they set a
 * password, so this is how to reach them. The API sends it to the provider
 * only, and only while the owner has no account.
 */
export function GuestContactCard({ contact, className }: { contact: GuestContact; className?: string }) {
  const first = contact.name.split(" ")[0];
  return (
    <div className={className}>
      <div className="rounded-2xl border border-[#2F6F5E]/25 bg-[#2F6F5E]/6 p-5">
        <p className="font-mono text-[11px] uppercase tracking-wide text-[#2F6F5E]">Guest booking</p>
        <p className="mt-1 text-sm text-charcoal">
          {contact.name} booked without an account, so they can’t read messages yet. Call or email{" "}
          {first} instead.
        </p>
        <dl className="mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-charcoal/55">Phone</dt>
            <dd>
              <a href={`tel:${contact.phone.replace(/[^0-9+]/g, "")}`} className="font-medium text-ink underline">
                {contact.phone}
              </a>
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-charcoal/55">Email</dt>
            <dd className="truncate">
              <a href={`mailto:${contact.email}`} className="font-medium text-ink underline">
                {contact.email}
              </a>
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
