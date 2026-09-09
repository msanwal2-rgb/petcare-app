/**
 * The origin to build emailed links from.
 *
 * Not `new URL(request.url).origin`, which is what the signup, reset and
 * resend-verification routes used to do. That value comes from the `Host`
 * header, and Auth.js is configured with `trustHost: true`, so a request
 * carrying `Host: attacker.example` produces a password-reset link pointing at
 * attacker.example — with a valid, single-use token in it. The victim clicks
 * the link in a genuine email from us and hands over their reset token.
 *
 * So the origin is configuration, never input. `AUTH_URL`/`NEXTAUTH_URL` are
 * checked first because Auth.js already uses them to build its own callback
 * URLs, and having two different answers to "where does this app live" is how
 * they drift.
 */
export function appOrigin(): string {
  const configured =
    process.env.APP_ORIGIN ??
    process.env.AUTH_URL ??
    process.env.NEXTAUTH_URL ??
    process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return configured.replace(/\/$/, "");

  // Vercel injects this per deployment, which is right for a preview: links in
  // a preview's emails should point at that preview.
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;

  return "http://localhost:3000";
}
