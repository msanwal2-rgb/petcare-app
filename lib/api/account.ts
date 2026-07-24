/**
 * Account / email-flow API client (verification + password reset).
 */

import type { User } from "@/types";
import { postJson } from "./_client";

export async function verifyEmail(token: string): Promise<User> {
  const { user } = await postJson<{ user: User }>(`/api/verify-email`, { token });
  return user;
}

export function resendVerification(): Promise<{ ok: boolean; devLink?: string }> {
  return postJson(`/api/resend-verification`, {});
}

export function forgotPassword(
  email: string
): Promise<{ ok: boolean; devLink?: string }> {
  return postJson(`/api/forgot-password`, { email });
}

export function resetPassword(
  token: string,
  password: string
): Promise<{ ok: boolean }> {
  return postJson(`/api/reset-password`, { token, password });
}
