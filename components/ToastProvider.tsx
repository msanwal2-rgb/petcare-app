"use client";

import { Toaster } from "sonner";

/**
 * Sonner toaster styled with the token palette (brief §3). Every meaningful
 * action (booking requested, accepted, profile saved…) fires a toast in plain,
 * active-voice language.
 */
export function ToastProvider() {
  return (
    <Toaster
      position="bottom-right"
      toastOptions={{
        style: {
          background: "#ffffff",
          border: "1px solid #C8D6C6",
          color: "#22282A",
          borderRadius: "12px",
          fontFamily: "var(--font-inter), sans-serif",
        },
        className: "leash-toast",
      }}
      icons={{}}
    />
  );
}
