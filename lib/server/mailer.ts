/**
 * Pluggable mailer. If RESEND_API_KEY is set, sends via Resend; otherwise it
 * logs the message (and link) server-side so the verification/reset flows are
 * fully exercisable in development without an email provider.
 *
 * To enable real delivery: create an account at https://resend.com, verify a
 * sending domain at https://resend.com/domains, then set RESEND_API_KEY and
 * EMAIL_FROM. No code change needed. See docs/going-live.md.
 *
 * Worth doing before taking payments: a membership whose renewal fails emails
 * the member a link to fix their card, and without a provider that email is a
 * line in a server log nobody reads.
 */

function mailerConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

/**
 * When true, dev-only endpoints may surface the action link in responses.
 *
 * **Forced off in production, whatever the environment variable says.** With it
 * on, `POST /api/forgot-password` returns a working password-reset link for any
 * address to an unauthenticated caller — that is account takeover as a feature,
 * and `EMAIL_DEV_MODE=true` has been the committed default in
 * `.env.local.example` for months. A convenience that is one misconfigured
 * variable away from handing over every account should not be reachable by
 * misconfiguring that variable.
 */
export function emailDevMode(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return process.env.EMAIL_DEV_MODE === "true";
}

const FROM = process.env.EMAIL_FROM || "Leash <onboarding@resend.dev>";

export async function sendMail(opts: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<void> {
  if (!mailerConfigured()) {
    // No provider — log so the flow can still be followed locally.
    console.log(
      `[mailer:dev] To: ${opts.to}\nSubject: ${opts.subject}\n${opts.text}`
    );
    return;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Email send failed (${res.status}): ${detail}`);
  }
}
