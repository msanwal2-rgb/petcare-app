import type { Pet, Product } from "@/types";
import { Panel } from "@/components/ui/Panel";
import { formatCents } from "@/lib/utils";

/** Categories where a feeding table makes sense at all. */
const FOOD_CATEGORIES = ["dry_food", "wet_food", "prescription_diet"];

/**
 * Rough daily rations by body weight, of the kind printed on the back of a bag.
 * Dry food is cups; wet food is cans. Deliberately banded rather than precise —
 * a real ration depends on body condition and activity, which is a
 * conversation with a vet, not a lookup table.
 */
interface Band {
  maxLbs: number;
  /** Human-readable range, e.g. "1½ – 2¾". */
  perDay: string;
  /** Midpoint of that range, used for the cost-per-day estimate. */
  typical: number;
}

const DRY_FOOD_BANDS: Band[] = [
  { maxLbs: 10, perDay: "½ – ¾", typical: 0.625 },
  { maxLbs: 25, perDay: "¾ – 1½", typical: 1.125 },
  { maxLbs: 50, perDay: "1½ – 2¾", typical: 2.125 },
  { maxLbs: 75, perDay: "2¾ – 3½", typical: 3.125 },
  { maxLbs: 100, perDay: "3½ – 4½", typical: 4 },
  { maxLbs: Infinity, perDay: "4½ +", typical: 5 },
];

const WET_FOOD_BANDS: Band[] = [
  { maxLbs: 10, perDay: "1", typical: 1 },
  { maxLbs: 25, perDay: "1 – 2", typical: 1.5 },
  { maxLbs: 50, perDay: "2 – 3", typical: 2.5 },
  { maxLbs: 75, perDay: "3 – 4", typical: 3.5 },
  { maxLbs: Infinity, perDay: "4 +", typical: 4.5 },
];

function bandFor(bands: Band[], weightLbs: number): Band {
  return bands.find((b) => weightLbs <= b.maxLbs) ?? bands[bands.length - 1];
}

/**
 * Roughly how long a bag lasts, which is the number an owner actually wants
 * when choosing between sizes. Assumes ~4 cups of kibble per pound.
 */
function daysOfFood(product: Product, weightLbs: number): number | null {
  if (product.category === "wet_food") return null;
  const cupsPerDay = bandFor(DRY_FOOD_BANDS, weightLbs).typical;
  const totalCups = product.weightLbs * 4;
  return Math.round(totalCups / cupsPerDay);
}

export function FeedingGuide({
  product,
  pet,
}: {
  product: Product;
  pet?: Pet;
}) {
  if (!FOOD_CATEGORIES.includes(product.category)) return null;

  const isWet = product.category === "wet_food";
  const bands = isWet ? WET_FOOD_BANDS : DRY_FOOD_BANDS;
  const petBand = pet ? bandFor(bands, pet.weightLbs) : null;
  const lasts = pet ? daysOfFood(product, pet.weightLbs) : null;

  return (
    <Panel title="Feeding guide">
      {pet && petBand && (
        <div className="mb-4 rounded-xl bg-fog px-4 py-3">
          <p className="text-sm text-charcoal/80">
            For <span className="font-medium text-ink">{pet.name}</span> at{" "}
            {pet.weightLbs} lb:{" "}
            <span className="font-mono font-medium text-ink">
              {petBand.perDay} {isWet ? "cans" : "cups"}
            </span>{" "}
            per day, split across two meals.
          </p>
          {lasts && (
            <p className="mt-1 text-xs text-charcoal/60">
              This {product.sizeLabel.toLowerCase()} should last roughly {lasts}{" "}
              days — about {formatCents(Math.round(product.priceCents / lasts))} a day.
            </p>
          )}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[280px] text-left text-sm">
          <thead>
            <tr className="border-b border-mist text-xs uppercase tracking-wide text-charcoal/55">
              <th className="py-2 font-medium">Body weight</th>
              <th className="py-2 font-medium">{isWet ? "Cans/day" : "Cups/day"}</th>
            </tr>
          </thead>
          <tbody>
            {bands.map((band, i) => {
              const lower = i === 0 ? 0 : bands[i - 1].maxLbs;
              const label =
                band.maxLbs === Infinity
                  ? `Over ${lower} lb`
                  : `${lower + 1}–${band.maxLbs} lb`;
              return (
                <tr key={label} className="border-b border-mist/70 last:border-0">
                  <td className="py-2 text-charcoal/80">{label}</td>
                  <td className="py-2 font-mono text-charcoal/80">{band.perDay}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-3 border-t border-mist pt-3 text-xs text-charcoal/60">
        A starting point, not a prescription. Adjust to keep a waist visible and
        ribs easy to feel, and switch foods over 7–10 days to avoid an upset gut.
      </p>
    </Panel>
  );
}
