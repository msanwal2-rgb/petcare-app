
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
      // Lifted clear of the assistant launcher, which sits at bottom-6 right-6.
      // Moving the toaster instead would be the bigger change: its position is
      // assumed by every action in the app and by the browser suite.
      offset={{ bottom: 88 }}
      mobileOffset={{ bottom: 88 }}
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
