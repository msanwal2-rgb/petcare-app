import type { ReactNode } from "react";
import { Link } from "react-router";
import {
  FAQS,
  POLICIES,
  POLICY_TOPICS,
  type PolicyTopic,
} from "@/lib/content/support-policies";
import { ButtonLink } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { Reveal } from "@/components/ui/Reveal";
import {
  BagIcon,
  PawIcon,
  StethoscopeIcon,
  ShieldCheckIcon,
  UserIcon,
  HeartIcon,
} from "@/components/ui/icons";

const TOPIC_ICONS: Record<PolicyTopic, ReactNode> = {
  orders: <BagIcon width={22} height={22} />,
  care: <PawIcon width={22} height={22} />,
  vet: <StethoscopeIcon width={22} height={22} />,
  adoption: <HeartIcon width={22} height={22} />,
  trust: <ShieldCheckIcon width={22} height={22} />,
  account: <UserIcon width={22} height={22} />,
};

/** The reference's `app/support/page.tsx`, ported as-is. Every figure comes from lib/content/support-policies.ts, which reads it from code. */
export default function SupportPage() {
  return (
    <div className="mx-auto w-full max-w-[900px] px-4 py-10 sm:px-6">
      <p className="font-mono text-xs uppercase tracking-widest text-leash">
        Help
      </p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
        How things work here
      </h1>
      <p className="mt-3 max-w-2xl text-charcoal/75">
        The rules the app already enforces, written down. Every figure on this
        page is read from the code that enforces it, so it cannot quietly drift
        out of date.
      </p>
      <div className="mt-5 flex flex-wrap gap-3">
        <ButtonLink to="/store/orders" variant="cta">
          Track an order
        </ButtonLink>
        <ButtonLink to="/pet-health" variant="outline">
          Pet health guides
        </ButtonLink>
      </div>

      {/* Jump links — this page is long and someone arrives with one question. */}
      <nav aria-label="Sections" className="mt-8 flex flex-wrap gap-2">
        {POLICY_TOPICS.map((t) => (
          <Link
            key={t.topic}
            to={`#${t.topic}`}
            className="rounded-full border border-mist bg-white px-3.5 py-1.5 text-sm text-charcoal/80 transition-colors hover:border-ink hover:text-ink"
          >
            {t.title}
          </Link>
        ))}
      </nav>

      {POLICY_TOPICS.map((topic) => {
        const sections = POLICIES.filter((p) => p.topic === topic.topic);
        const faqs = FAQS.filter((f) => f.topic === topic.topic);

        return (
          <Reveal key={topic.topic} className="mt-14">
            <h2
              id={topic.topic}
              className="flex items-center gap-2 scroll-mt-24 text-2xl font-semibold text-ink"
            >
              <span className="text-ink/70" aria-hidden>
                {TOPIC_ICONS[topic.topic]}
              </span>
              {topic.title}
            </h2>
            <p className="mt-1 text-sm text-charcoal/70">{topic.blurb}</p>

            <div className="mt-5 space-y-5">
              {sections.map((section) => (
                <Panel key={section.slug} title={section.title}>
                  <p id={section.slug} className="scroll-mt-24 text-sm text-charcoal/75">
                    {section.summary}
                  </p>
                  <ul className="mt-3 space-y-2 text-sm text-charcoal/85">
                    {section.points.map((point) => (
                      <li key={point} className="flex gap-2">
                        <span
                          className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-marigold"
                          aria-hidden
                        />
                        <span>{point}</span>
                      </li>
                    ))}
                  </ul>
                  <Link
                    to={section.href}
                    className="mt-3 inline-block text-sm font-medium text-ink underline underline-offset-2 hover:text-leash"
                  >
                    Go there
                  </Link>
                </Panel>
              ))}
            </div>

            {faqs.length > 0 && (
              <div className="mt-5 overflow-hidden rounded-2xl border border-mist bg-white">
                <p className="border-b border-mist bg-fog/60 px-5 py-3 font-semibold text-ink">
                  Common questions
                </p>
                <dl className="divide-y divide-mist">
                  {faqs.map((faq) => (
                    <div key={faq.slug} id={faq.slug} className="scroll-mt-24 px-5 py-4">
                      <dt className="font-medium text-ink">{faq.question}</dt>
                      <dd className="mt-1 text-sm text-charcoal/75">{faq.answer}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
          </Reveal>
        );
      })}

      <div className="mt-14 rounded-2xl border border-mist bg-white p-6 text-center">
        <h2 className="text-lg font-semibold text-ink">
          Still stuck?
        </h2>
        <p className="mx-auto mt-1 max-w-lg text-sm text-charcoal/70">
          If your pet is unwell rather than your order, the pet health guides
          cover what is urgent and what can wait — and several vets on Leash take
          emergencies.
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-3">
          <ButtonLink to="/pet-health" variant="cta">
            Pet health guides
          </ButtonLink>
          <ButtonLink to="/vets" variant="outline">
            Find a vet
          </ButtonLink>
        </div>
      </div>
    </div>
  );
}
