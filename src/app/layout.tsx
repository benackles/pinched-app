import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { ClerkProvider } from "@clerk/nextjs";

import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { PwaRegister } from "@/components/pwa/pwa-register";
import { isClerkConfigured } from "@/lib/auth/config";

// Self-hosted variable fonts (OFL). next/font bundles them at build time, so they are part of the
// precached build output and render offline with no fallback flash.
const fraunces = localFont({
  src: [
    { path: "./fonts/Fraunces-Variable.woff2", style: "normal", weight: "100 900" },
    { path: "./fonts/Fraunces-Variable-Italic.woff2", style: "italic", weight: "100 900" },
  ],
  variable: "--font-fraunces",
  display: "swap",
  fallback: ["Georgia", "ui-serif", "serif"],
});

const figtree = localFont({
  src: [{ path: "./fonts/Figtree-Variable.woff2", style: "normal", weight: "300 900" }],
  variable: "--font-figtree",
  display: "swap",
  fallback: ["ui-sans-serif", "system-ui", "sans-serif"],
});

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const TITLE = "Pinched — Plan the week. Prep once. Cook faster.";
const DESCRIPTION =
  "Pinched turns your own recipes into one grocery list of only what you're missing, and one prep session for the whole week.";

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: { default: TITLE, template: "%s — Pinched" },
  description: DESCRIPTION,
  applicationName: "Pinched",
  manifest: "/manifest.webmanifest",
  // iOS / iPadOS shell: appleWebApp renders the capable + title tags; the apple-touch-icon is 180×180.
  appleWebApp: { capable: true, title: "Pinched", statusBarStyle: "default" },
  other: { "apple-mobile-web-app-capable": "yes" },
  formatDetection: { telephone: false },
  icons: {
    icon: [
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  openGraph: {
    type: "website",
    siteName: "Pinched",
    title: TITLE,
    description: DESCRIPTION,
    images: [
      { url: "/og.png", width: 1200, height: 630, alt: "Pinched — Plan the week. Prep once." },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/og.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#faf4e8",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const tree = (
    <html lang="en" className={`${fraunces.variable} ${figtree.variable}`}>
      <body>
        {children}
        <Toaster />
        <PwaRegister />
      </body>
    </html>
  );

  // Without Clerk keys the app runs in local mode (or shows a setup screen) — no provider.
  return isClerkConfigured() ? (
    <ClerkProvider
      appearance={{
        // Brand values in hex — Clerk's color math does not parse OKLCH.
        variables: {
          colorPrimary: "#c44323", // --primary-strong
          colorPrimaryForeground: "#fdfaf4",
          colorBackground: "#fdfaf4", // --card
          colorForeground: "#291c15", // --foreground
          colorMutedForeground: "#6f6056", // --muted-foreground
          colorInput: "#fdfaf4",
          colorInputForeground: "#291c15",
          colorBorder: "#e6dccb", // --border
          colorDanger: "#c2362a", // --destructive
          colorSuccess: "#448247", // --success
          fontFamily: "var(--font-figtree), system-ui, sans-serif",
          borderRadius: "1rem",
        },
      }}
    >
      {tree}
    </ClerkProvider>
  ) : (
    tree
  );
}
