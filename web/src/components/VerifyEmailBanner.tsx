import { useState } from "react";
import { toast } from "sonner";
import { useSession } from "@/store/session";
import { resendVerification } from "@/api/auth";

/**
 * Shown on the dashboard when the signed-in user hasn't verified their email.
 * Verification is not required to use the app — this is a gentle nudge.
 */
export function VerifyEmailBanner() {
  const { currentUser, hasHydrated } = useSession();
  const [sending, setSending] = useState(false);
  const [devLink, setDevLink] = useState<string | null>(null);

  if (!hasHydrated || !currentUser || currentUser.verified) return null;

  async function resend() {
    setSending(true);
    try {
      const res = await resendVerification();
      if (res.devLink) setDevLink(res.devLink);
      toast.success("Verification email sent.");
    } catch {
      toast.error("Couldn’t send the email. Try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mb-6 rounded-xl border border-marigold/50 bg-marigold/10 px-4 py-3 text-sm text-[#8a5a12]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>Verify your email to secure your account.</span>
        <button
          onClick={resend}
          disabled={sending}
          className="font-medium underline underline-offset-2 disabled:opacity-50"
        >
          {sending ? "Sending…" : "Resend verification"}
        </button>
      </div>
      {devLink && (
        <p className="mt-2 break-all font-mono text-[11px]">
          Dev mode — verify link:{" "}
          <a href={devLink} className="underline">
            {devLink}
          </a>
        </p>
      )}
    </div>
  );
}
