import type { Metadata } from "next";
import { Space_Grotesk, Inter, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { SiteHeader } from "@/components/SiteHeader";
import { MaintenanceBanner } from "@/components/MaintenanceBanner";
import { SiteFooter } from "@/components/SiteFooter";
import { PageTransition } from "@/components/PageTransition";
import { ToastProvider } from "@/components/ToastProvider";
import { AssistantLauncher } from "@/components/assistant/AssistantLauncher";
import { SessionSync } from "@/components/SessionSync";

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  display: "swap",
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Leash — trusted pet care, booked in minutes",
    template: "%s · Leash",
  },
  description:
    "Find vetted local caretakers for walking, sitting, boarding, and daycare. Hand off the leash to someone competent.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${spaceGrotesk.variable} ${inter.variable} ${plexMono.variable} h-full`}
    >
      <body className="min-h-full flex flex-col bg-fog text-charcoal">
        <SessionSync />
        <SiteHeader />
        <MaintenanceBanner />
        <main className="flex-1 flex flex-col">
          <PageTransition>{children}</PageTransition>
        </main>
        <SiteFooter />
        <ToastProvider />
        {/*
          Outside <main> deliberately: it must survive PageTransition's
          pathname-keyed remount so a conversation is not lost on navigation,
          and it must stay out of the subtree e2e:sweep scans for content stuck
          at opacity 0, which an animating panel transiently is.
        */}
        <AssistantLauncher enabled={process.env.ASSISTANT_ENABLED !== "false"} />
      </body>
    </html>
  );
}
