import type { MetadataRoute } from "next";

/** The cream page color — used for the splash screen and the desktop window header. */
export const CREAM = "#faf4e8";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Pinched",
    short_name: "Pinched",
    description: "Plan the week. Shop for what you're missing. Prep once. Cook faster.",
    // Opens the weekly plan, not the landing page.
    start_url: "/plan",
    scope: "/",
    // Chromeless window on desktop (Chrome, Edge, macOS), full screen on phones.
    display: "standalone",
    display_override: ["window-controls-overlay", "standalone"],
    orientation: "portrait-primary",
    background_color: CREAM,
    theme_color: CREAM,
    categories: ["food", "lifestyle", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "This week", url: "/plan", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Grocery list", short_name: "Grocery", url: "/grocery-list" },
      { name: "Prep plan", short_name: "Prep", url: "/prep" },
    ],
  };
}
