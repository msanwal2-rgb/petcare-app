import type { User } from "@/types";
import { BASE, postJson } from "./_client";

/**
 * Auth domain — API client.
 *
 * Every one of these is a POST to /api/v1/auth/*, and every one that
 * establishes a session relies on the server setting an HttpOnly cookie. There
 * is no token in this file and nothing is written to `localStorage`: the
 * session is not readable by JavaScript, which is the point.
 */

/**
 * What a successful sign-in or signup returns.
 *
 * `tokens` is always null here. The server populates it only for a client that
 * asks for tokens by header — a native app — and the web client deliberately
 * does not, so it receives the cookie instead. The field is typed rather than
 * omitted because it is part of the shared contract.
 */
export interface AuthResponse {
  user: User;
  tokens: null;
  /** Present in development only, so the email flows can be walked without a mail provider. */
  devLink: string | null;
}

export interface OkResponse {
  ok: boolean;
  devLink: string | null;
  alreadyVerified: boolean | null;
}

export function signup(input: {
  name: string;
  email: string;
  password: string;
  phone?: string;
  roles?: string[];
}): Promise<AuthResponse> {
  return postJson<AuthResponse>("/auth/signup", input);
}

export function login(email: string, password: string): Promise<AuthResponse> {
  return postJson<AuthResponse>("/auth/login", { email, password });
}

export function logout(): Promise<void> {
  return postJson<void>("/auth/logout", {});
}

export function verifyEmail(token: string): Promise<{ user: User }> {
  return postJson<{ user: User }>("/auth/verify-email", { token });
}

export function resendVerification(): Promise<OkResponse> {
  return postJson<OkResponse>("/auth/resend-verification", {});
}

export function forgotPassword(email: string): Promise<OkResponse> {
  return postJson<OkResponse>("/auth/forgot-password", { email });
}

export function resetPassword(token: string, password: string): Promise<OkResponse> {
  return postJson<OkResponse>("/auth/reset-password", { token, password });
}

/**
 * POST /auth/set-password — a guest's first password, from the emailed link
 * (STATUS §3-G). Activates the account and signs it in, like sign-up. A used,
 * expired or made-up token is a 400.
 */
export function setPassword(token: string, password: string): Promise<AuthResponse> {
  return postJson<AuthResponse>("/auth/set-password", { token, password });
}

/**
 * Where to send the browser to start Google sign-in.
 *
 * A full navigation, not a fetch: OAuth is a redirect flow, and the response to
 * this is a 302 to Google's consent screen that only the browser can follow.
 */
export function googleSignInUrl(callbackUrl?: string): string {
  const query = callbackUrl ? `?callbackUrl=${encodeURIComponent(callbackUrl)}` : "";
  return `${BASE}/api/v1/auth/google${query}`;
}
