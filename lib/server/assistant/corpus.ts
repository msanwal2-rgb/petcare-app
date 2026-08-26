/**
 * Turns the app's editorial content into the assistant's retrieval corpus.
 *
 * Pure: no I/O, no database, no network. That is deliberate — it makes the
 * chunking testable on its own, and it means `npm run kb:ingest --dry-run` can
 * show you exactly what would be embedded without touching anything.
 *
 * What is in, and what is deliberately not:
 *
 * - **Policies and FAQs** (lib/content/support-policies.ts) — the reason this
 *   corpus exists.
 * - **Care guides and vaccine schedules** (lib/content/pet-health.ts) — prose
 *   that answers real questions and is already scoped and non-diagnostic.
 * - **Red flags are excluded.** They live in the system prompt instead. An
 *   emergency answer must not be contingent on a similarity search returning
 *   the right row; that is the one question where retrieval failing quietly is
 *   unacceptable.
 * - **Products are excluded.** They are rows, not prose. `searchProducts`
 *   already does filtered structured search with live prices and stock, and an
 *   embedded product description is a stale price waiting to be quoted.
 */

import { FAQS, POLICIES } from "@/lib/content/support-policies";
import { CARE_GUIDES, VACCINE_SCHEDULES } from "@/lib/content/pet-health";
import type { Species } from "@/types";

/** Where a chunk came from. Lets retrieval explain itself and tests target one kind. */
export type CorpusSource = "policy" | "faq" | "guide" | "vaccine";

export interface CorpusItem {
  /** Stable identity across re-ingests. Changing this orphans the old row. */
  sourceKey: string;
  source: CorpusSource;
  title: string;
  /** The page a citation should link to. */
  href: string;
  /** Empty means "applies to every species". */
  species: Species[];
  content: string;
}

/** Collapse whitespace so hashes are stable against reformatting. */
function tidy(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * The whole corpus, in a stable order.
 *
 * Chunks are one item each — 50–200 words, already the right granularity, so
 * there is no sliding window and no token splitter. The title is prepended to
 * the content before embedding because short chunks retrieve measurably better
 * with it than without.
 */
export function buildCorpus(): CorpusItem[] {
  const items: CorpusItem[] = [];

  for (const section of POLICIES) {
    items.push({
      sourceKey: `policy:${section.slug}`,
      source: "policy",
      title: section.title,
      href: `/support#${section.slug}`,
      species: [],
      content: tidy([section.summary, ...section.points].join(" ")),
    });
  }

  for (const faq of FAQS) {
    items.push({
      sourceKey: `faq:${faq.slug}`,
      source: "faq",
      title: faq.question,
      href: `/support#${faq.slug}`,
      species: [],
      content: tidy(`${faq.question} ${faq.answer}`),
    });
  }

  for (const guide of CARE_GUIDES) {
    items.push({
      sourceKey: `guide:${guide.slug}`,
      source: "guide",
      title: guide.title,
      href: "/pet-health",
      species: [],
      content: tidy([guide.summary, ...guide.points].join(" ")),
    });
  }

  for (const schedule of VACCINE_SCHEDULES) {
    const rows = [
      ...schedule.core.map((row) => ({ row, core: true })),
      ...schedule.optional.map((row) => ({ row, core: false })),
    ];
    for (const { row, core } of rows) {
      items.push({
        sourceKey: `vaccine:${schedule.species}:${core ? "core" : "optional"}:${slugify(row.name)}`,
        source: "vaccine",
        title: `${schedule.title}: ${row.name}`,
        href: "/pet-health#vaccinations",
        species: [schedule.species],
        content: tidy(
          `${schedule.title}. ${row.name} is ${core ? "a core vaccine" : "given based on risk"}. ` +
            `First dose at ${row.firstDose}. Boosters: ${row.boosters}. ${row.note}`,
        ),
      });
    }
  }

  return items;
}

/** First few words of a vaccine name, enough to be a stable key. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .split("-")
    .slice(0, 3)
    .join("-");
}

/** What actually gets embedded: the title carries signal a short chunk lacks. */
export function embeddableText(item: CorpusItem): string {
  return `${item.title}\n${item.content}`;
}
