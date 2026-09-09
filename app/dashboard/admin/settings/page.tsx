"use client";

import { useState } from "react";
import { toast } from "sonner";
import { getAdminSettings, updateAdminSettings } from "@/lib/api/admin";
import type { SystemSettings } from "@/lib/server/settings";
import { useAsync } from "@/lib/hooks/useAsync";
import { useSession } from "@/lib/store/session";
import { ApiError } from "@/lib/api/_client";
import { AdminShell } from "@/components/admin/AdminShell";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { formatCents } from "@/lib/utils";

/**
 * Runtime settings.
 *
 * Each one is saved on its own, immediately, because these are switches rather
 * than a form: "close signups" is a decision someone makes and wants to take
 * effect, not a draft they assemble and submit.
 */

function Toggle({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-mist bg-white px-3 py-3 transition-colors hover:border-ink/30">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 accent-ink"
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-ink">{label}</span>
        <span className="block text-xs text-charcoal/60">{description}</span>
      </span>
    </label>
  );
}

export default function AdminSettingsPage() {
  const { currentUser } = useSession();
  const [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [threshold, setThreshold] = useState<string | null>(null);

  const { data: settings, loading, reload } = useAsync(async () => {
    if (!currentUser) return null;
    try {
      return await getAdminSettings();
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        setDenied(true);
        return null;
      }
      throw e;
    }
  }, [currentUser?.id]);

  async function save(patch: Partial<SystemSettings>, label: string) {
    setBusy(true);
    try {
      await updateAdminSettings(patch);
      toast.success(label);
      reload();
    } catch (e) {
      toast.error("Couldn't save that", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  }

  // Local edits fall back to the saved value until someone types.
  const bannerValue = banner ?? settings?.maintenanceBanner ?? "";
  const thresholdValue =
    threshold ?? String(settings?.freeShippingThresholdCents ?? 0);

  return (
    <AdminShell
      title="Settings"
      lede="Things worth changing without a deploy."
      denied={denied}
      loading={loading}
    >
      {settings && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Access">
            <div className="space-y-2">
              <Toggle
                label="Accept new signups"
                description="When off, /api/signup refuses new accounts and the form says so."
                checked={settings.signupsOpen}
                disabled={busy}
                onChange={(v) =>
                  save({ signupsOpen: v }, v ? "Signups open" : "Signups closed")
                }
              />
              <Toggle
                label="Show demo accounts on the login page"
                description="The one-tap demo logins and their shared password. Off by default in production — a published password on a seeded database is a working login for anyone who reads the page."
                checked={settings.demoLoginVisible}
                disabled={busy}
                onChange={(v) =>
                  save(
                    { demoLoginVisible: v },
                    v ? "Demo logins visible" : "Demo logins hidden"
                  )
                }
              />
            </div>
          </Panel>

          <Panel title="Store">
            <Field
              label="Free shipping threshold"
              htmlFor="setting-threshold"
              hint={`Currently ${formatCents(settings.freeShippingThresholdCents)}. Entered in cents.`}
            >
              <Input
                id="setting-threshold"
                inputMode="numeric"
                value={thresholdValue}
                onChange={(e) => setThreshold(e.target.value.replace(/\D/g, ""))}
              />
            </Field>
            <Button
              size="sm"
              variant="primary"
              className="mt-3"
              disabled={
                busy ||
                threshold === null ||
                Number(thresholdValue) === settings.freeShippingThresholdCents
              }
              onClick={() =>
                save(
                  { freeShippingThresholdCents: Number(thresholdValue) },
                  "Threshold updated"
                ).then(() => setThreshold(null))
              }
            >
              Save threshold
            </Button>
          </Panel>

          <Panel title="Maintenance banner" className="lg:col-span-2">
            <Field
              label="Message"
              htmlFor="setting-banner"
              hint="Shown site-wide to everyone. Leave empty for no banner."
            >
              <Input
                id="setting-banner"
                value={bannerValue}
                maxLength={300}
                onChange={(e) => setBanner(e.target.value)}
                placeholder="We're doing scheduled maintenance from 02:00 UTC."
              />
            </Field>
            <div className="mt-3 flex gap-2">
              <Button
                size="sm"
                variant="primary"
                disabled={busy || banner === null || banner === settings.maintenanceBanner}
                onClick={() =>
                  save({ maintenanceBanner: bannerValue }, "Banner updated").then(() =>
                    setBanner(null)
                  )
                }
              >
                Save banner
              </Button>
              {settings.maintenanceBanner && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    save({ maintenanceBanner: "" }, "Banner cleared").then(() =>
                      setBanner(null)
                    )
                  }
                >
                  Clear
                </Button>
              )}
            </div>
          </Panel>
        </div>
      )}
    </AdminShell>
  );
}
