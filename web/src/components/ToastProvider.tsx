import { Toaster } from "sonner";

/**
 * Sonner toaster styled with the token palette (brief §3). Every meaningful
 * action (booking requested, accepted, profile saved…) fires a toast in plain,
 * active-voice language.
 *
 * The 88px bottom offset in the reference project cleared the AI assistant
 * launcher, which is out of scope for this build — so the toaster sits at its
 * natural position again.
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
          fontFamily: "var(--font-body), sans-serif",
        },
        className: "leash-toast",
      }}
      icons={{}}
    />
  );
}
