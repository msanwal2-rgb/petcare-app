import type { Metadata } from "next";
import { Space_Grotesk, Inter, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { PageTransition } from "@/components/PageTransition";
import { ToastProvider } from "@/components/ToastProvider";

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
        <SiteHeader />
        <main className="flex-1 flex flex-col">
          <PageTransition>{children}</PageTransition>
        </main>
        <SiteFooter />
        <ToastProvider />
      </body>
    </html>
  );
}
