/**
 * Pluggable mailer. If RESEND_API_KEY is set, sends via Resend; otherwise it
 * logs the message (and link) server-side so the verification/reset flows are
 * fully exercisable in development without an email provider.
 *
 * To enable real delivery: set RESEND_API_KEY and EMAIL_FROM (a verified
 * sender), then emails go out for real — no code change needed.
 */

function mailerConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

/** When true, dev-only endpoints may surface the action link in responses. */
export function emailDevMode(): boolean {
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
