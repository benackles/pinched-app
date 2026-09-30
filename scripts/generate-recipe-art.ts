/**
 * Original flat, top-down illustrations for the seeded catalog and the landing hero.
 *
 * PRD: "Images are commissioned, generated, or user-contributed; never copied from third-party
 * sites." These are generated here from a small shape vocabulary — no photos, no gradients — in
 * the app's warm palette. Output is deterministic (seeded per recipe), so re-running is a no-op.
 *
 *   pnpm assets:recipe-art
 */
import fs from "node:fs";
import path from "node:path";

import { parseCatalog } from "../src/lib/catalog/build";

const root = path.resolve(import.meta.dirname, "..");
const W = 1024;
const H = 768;
const CX = W / 2;
const CY = H / 2;

// ───────────────────────────── random + geometry ─────────────────────────────

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash = (text: string) => {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
};

type Rng = () => number;
const pick = <T>(rng: Rng, list: readonly T[]) => list[Math.floor(rng() * list.length)]!;
const between = (rng: Rng, lo: number, hi: number) => lo + (hi - lo) * rng();
const f = (n: number) => Math.round(n * 10) / 10;

/** Points spread inside a rectangle, kept apart from each other. */
function spreadRect(
  rng: Rng,
  n: number,
  w: number,
  h: number,
  gap: number,
  cx = CX,
  cy = CY,
): [number, number][] {
  const out: [number, number][] = [];
  let tries = 0;
  let g = gap;
  while (out.length < n && tries < 4000) {
    tries++;
    if (tries % 400 === 0) g *= 0.85;
    const x = cx + (rng() - 0.5) * w;
    const y = cy + (rng() - 0.5) * h;
    if (out.every(([ox, oy]) => Math.hypot(ox - x, oy - y) >= g)) out.push([x, y]);
  }
  return out;
}

/** Points spread inside a disc, kept apart from each other (simple rejection sampling). */
function spread(
  rng: Rng,
  n: number,
  radius: number,
  gap: number,
  cx = CX,
  cy = CY,
): [number, number][] {
  const out: [number, number][] = [];
  let tries = 0;
  let g = gap;
  while (out.length < n && tries < 4000) {
    tries++;
    if (tries % 400 === 0) g *= 0.85;
    const angle = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * radius;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    if (out.every(([ox, oy]) => Math.hypot(ox - x, oy - y) >= g)) out.push([x, y]);
  }
  return out;
}

// ───────────────────────────── palette ─────────────────────────────

const C = {
  ink: "#3d2b20",
  cream: "#faf4e8",
  linen: "#f1e6d0",
  sand: "#ead9b9",
  butter: "#f5e3a1",
  peach: "#f3c9a8",
  blush: "#efc3b8",
  sage: "#c9d8b6",
  mist: "#cfdde0",
  clay: "#c9734f",
  terracotta: "#b85c3a",
  plate: "#fbf8f1",
  plateEdge: "#e7dfcf",
  slate: "#7d8b94",
  slateDark: "#5d6a73",
  pan: "#6b7780",
  wood: "#c79a64",
  woodDark: "#a9794a",
  rice: "#fffbf0",
  riceShade: "#efe5cf",
  tomato: "#d4452b",
  tomatoDark: "#a8321f",
  orange: "#e98a3a",
  sweet: "#e57c2a",
  sweetDark: "#c2601c",
  green: "#6f9a4b",
  greenDark: "#4c7a37",
  greenLight: "#a5c46c",
  purple: "#a4508b",
  bean: "#4a3127",
  beanLight: "#6d4a39",
  yolk: "#f2b73a",
  egg: "#fffdf7",
  corn: "#f3cb45",
  chicken: "#d9a066",
  chickenDark: "#b9803f",
  salmon: "#f08a62",
  salmonLight: "#f7b193",
  fish: "#f1e6d0",
  glaze: "#b8682f",
  beef: "#7a4632",
  brown: "#8a5a3c",
  cheese: "#f4c95a",
  pink: "#ef9a90",
  blue: "#5c6fa8",
  lentil: "#b77a3d",
  curry: "#e4a23a",
  coconut: "#f6ecd6",
  broth: "#e8b766",
  greenSoup: "#9fc273",
};

const BACKDROPS = [C.linen, C.sage, C.peach, C.butter, C.blush, C.mist, C.sand] as const;

// ───────────────────────────── primitives ─────────────────────────────

const circle = (x: number, y: number, r: number, fill: string, extra = "") =>
  `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" fill="${fill}"${extra ? ` ${extra}` : ""}/>`;
const ellipse = (x: number, y: number, rx: number, ry: number, fill: string, rot = 0, extra = "") =>
  `<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(rx)}" ry="${f(ry)}" fill="${fill}" transform="rotate(${f(rot)} ${f(x)} ${f(y)})"${extra ? ` ${extra}` : ""}/>`;
const rrect = (
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fill: string,
  rot = 0,
  extra = "",
) =>
  `<rect x="${f(x - w / 2)}" y="${f(y - h / 2)}" width="${f(w)}" height="${f(h)}" rx="${f(r)}" fill="${fill}" transform="rotate(${f(rot)} ${f(x)} ${f(y)})"${extra ? ` ${extra}` : ""}/>`;
const stroke = (d: string, color: string, width: number, extra = "") =>
  `<path d="${d}" fill="none" stroke="${color}" stroke-width="${f(width)}" stroke-linecap="round" stroke-linejoin="round"${extra ? ` ${extra}` : ""}/>`;
const leaf = (x: number, y: number, size: number, rot: number, fill: string, vein: string) =>
  `<g transform="translate(${f(x)} ${f(y)}) rotate(${f(rot)})"><path d="M0 ${f(-size)} C ${f(size * 0.8)} ${f(-size * 0.4)} ${f(size * 0.8)} ${f(size * 0.6)} 0 ${f(size)} C ${f(-size * 0.8)} ${f(size * 0.6)} ${f(-size * 0.8)} ${f(-size * 0.4)} 0 ${f(-size)} Z" fill="${fill}"/><path d="M0 ${f(-size * 0.7)} L0 ${f(size * 0.8)}" stroke="${vein}" stroke-width="${f(Math.max(2, size * 0.08))}" stroke-linecap="round"/></g>`;

// ───────────────────────────── ingredients ─────────────────────────────

type Item = (rng: Rng, x: number, y: number, s: number) => string;

const ITEMS: Record<string, Item> = {
  bean: (rng, x, y, s) => {
    const rot = rng() * 180;
    return (
      ellipse(x, y, 17 * s, 11 * s, C.bean, rot) +
      ellipse(x - 3 * s, y - 3 * s, 7 * s, 3.5 * s, C.beanLight, rot)
    );
  },
  corn: (rng, x, y, s) =>
    circle(x, y, 9 * s, C.corn) + circle(x - 2 * s, y - 2 * s, 3 * s, "#fbe58a"),
  tomato: (rng, x, y, s) =>
    circle(x, y, 22 * s, C.tomato) +
    circle(x - 7 * s, y - 7 * s, 6 * s, "#e9705a") +
    leaf(x, y - 20 * s, 7 * s, rng() * 360, C.greenDark, C.green),
  cherry: (rng, x, y, s) => {
    const rot = rng() * 360;
    return `<g transform="rotate(${f(rot)} ${f(x)} ${f(y)})"><path d="M${f(x - 22 * s)} ${f(y)} A${f(22 * s)} ${f(22 * s)} 0 0 1 ${f(x + 22 * s)} ${f(y)} Z" fill="${C.tomato}"/><path d="M${f(x - 14 * s)} ${f(y)} A${f(14 * s)} ${f(14 * s)} 0 0 1 ${f(x + 14 * s)} ${f(y)} Z" fill="#e9705a"/></g>`;
  },
  avocado: (rng, x, y, s) => {
    const rot = rng() * 360;
    return (
      ellipse(x, y, 30 * s, 18 * s, C.greenDark, rot) +
      ellipse(x, y, 25 * s, 13 * s, C.greenLight, rot) +
      ellipse(x, y, 13 * s, 6 * s, "#d6e69c", rot)
    );
  },
  chicken: (rng, x, y, s) => {
    const rot = rng() * 180;
    return (
      rrect(x, y, 70 * s, 42 * s, 18 * s, C.chicken, rot) +
      rrect(x, y, 56 * s, 28 * s, 12 * s, "#e7b982", rot) +
      `<g transform="rotate(${f(rot)} ${f(x)} ${f(y)})">${[-14, 0, 14].map((o) => stroke(`M${f(x + o * s)} ${f(y - 14 * s)} L${f(x + o * s)} ${f(y + 14 * s)}`, C.chickenDark, 3.5 * s)).join("")}</g>`
    );
  },
  salmon: (rng, x, y, s) => {
    const rot = rng() * 40 - 20;
    return (
      rrect(x, y, 96 * s, 52 * s, 22 * s, C.salmon, rot) +
      `<g transform="rotate(${f(rot)} ${f(x)} ${f(y)})">${[-28, -10, 8, 26].map((o) => stroke(`M${f(x + o * s)} ${f(y - 18 * s)} Q${f(x + (o + 6) * s)} ${f(y)} ${f(x + o * s)} ${f(y + 18 * s)}`, C.salmonLight, 5 * s)).join("")}</g>`
    );
  },
  cod: (rng, x, y, s) => {
    const rot = rng() * 30 - 15;
    return (
      rrect(x, y, 110 * s, 58 * s, 24 * s, C.fish, rot) +
      rrect(x, y, 92 * s, 40 * s, 18 * s, C.glaze, rot, 'opacity="0.85"') +
      `<g transform="rotate(${f(rot)} ${f(x)} ${f(y)})">${[-26, -6, 14, 34].map((o) => stroke(`M${f(x + o * s)} ${f(y - 14 * s)} L${f(x + (o + 6) * s)} ${f(y + 14 * s)}`, "#e0a36a", 4 * s)).join("")}</g>`
    );
  },
  shrimp: (rng, x, y, s) => {
    const rot = rng() * 360;
    return `<g transform="rotate(${f(rot)} ${f(x)} ${f(y)})">${stroke(`M${f(x - 28 * s)} ${f(y + 10 * s)} C ${f(x - 30 * s)} ${f(y - 34 * s)} ${f(x + 28 * s)} ${f(y - 34 * s)} ${f(x + 26 * s)} ${f(y + 8 * s)}`, C.pink, 20 * s)}${stroke(`M${f(x - 20 * s)} ${f(y - 14 * s)} L${f(x - 12 * s)} ${f(y - 22 * s)} M${f(x - 2 * s)} ${f(y - 22 * s)} L${f(x + 4 * s)} ${f(y - 28 * s)} M${f(x + 14 * s)} ${f(y - 18 * s)} L${f(x + 22 * s)} ${f(y - 22 * s)}`, "#fbc7bf", 4 * s)}</g>`;
  },
  sweetpotato: (rng, x, y, s) => {
    const rot = rng() * 90;
    return (
      rrect(x, y, 34 * s, 34 * s, 8 * s, C.sweet, rot) +
      rrect(x, y, 22 * s, 22 * s, 5 * s, C.sweetDark, rot, 'opacity="0.35"') +
      circle(x - 6 * s, y - 6 * s, 3.5 * s, "#f7b06a")
    );
  },
  potato: (rng, x, y, s) =>
    rrect(x, y, 32 * s, 32 * s, 9 * s, "#e8c878", rng() * 90) +
    circle(x - 5 * s, y - 5 * s, 3 * s, "#f6e3a8"),
  onion: (rng, x, y, s) => {
    const rot = rng() * 360;
    return `<g transform="rotate(${f(rot)} ${f(x)} ${f(y)})">${stroke(`M${f(x - 22 * s)} ${f(y)} A${f(22 * s)} ${f(22 * s)} 0 0 1 ${f(x + 22 * s)} ${f(y)}`, C.purple, 9 * s)}${stroke(`M${f(x - 12 * s)} ${f(y)} A${f(12 * s)} ${f(12 * s)} 0 0 1 ${f(x + 12 * s)} ${f(y)}`, "#c883b3", 6 * s)}</g>`;
  },
  broccoli: (rng, x, y, s) =>
    rrect(x, y + 14 * s, 11 * s, 26 * s, 4 * s, C.greenLight, rng() * 30 - 15) +
    circle(x - 12 * s, y - 2 * s, 14 * s, C.greenDark) +
    circle(x + 12 * s, y - 2 * s, 14 * s, C.green) +
    circle(x, y - 12 * s, 15 * s, C.green) +
    circle(x - 4 * s, y - 14 * s, 5 * s, C.greenLight),
  pepper: (rng, x, y, s) => {
    const color = pick(rng, [C.tomato, C.yolk, C.green, C.orange] as const);
    const rot = rng() * 180;
    return `<g transform="rotate(${f(rot)} ${f(x)} ${f(y)})">${stroke(`M${f(x - 26 * s)} ${f(y)} Q${f(x)} ${f(y - 22 * s)} ${f(x + 26 * s)} ${f(y)}`, color, 13 * s)}</g>`;
  },
  egg: (rng, x, y, s) =>
    `<path d="M${f(x - 34 * s)} ${f(y)} C ${f(x - 40 * s)} ${f(y - 34 * s)} ${f(x + 6 * s)} ${f(y - 44 * s)} ${f(x + 34 * s)} ${f(y - 22 * s)} C ${f(x + 50 * s)} ${f(y - 4 * s)} ${f(x + 30 * s)} ${f(y + 32 * s)} ${f(x - 4 * s)} ${f(y + 28 * s)} C ${f(x - 26 * s)} ${f(y + 26 * s)} ${f(x - 30 * s)} ${f(y + 14 * s)} ${f(x - 34 * s)} ${f(y)} Z" fill="${C.egg}"/>` +
    circle(x + 2 * s, y - 6 * s, 15 * s, C.yolk) +
    circle(x - 3 * s, y - 11 * s, 4.5 * s, "#fbd77c"),
  cheese: (rng, x, y, s) => rrect(x, y, 13 * s, 9 * s, 2 * s, C.cheese, rng() * 180),
  basil: (rng, x, y, s) => leaf(x, y, 15 * s, rng() * 360, C.greenDark, C.greenLight),
  cilantro: (rng, x, y, s) =>
    leaf(x, y, 8 * s, rng() * 360, C.green, C.greenLight) +
    leaf(x + 8 * s, y + 4 * s, 6 * s, rng() * 360, C.greenLight, C.green),
  lemon: (rng, x, y, s) =>
    circle(x, y, 27 * s, "#f0d050") +
    circle(x, y, 21 * s, "#fbeaa0") +
    [0, 60, 120]
      .map((a) =>
        stroke(
          `M${f(x - 20 * s)} ${f(y)} L${f(x + 20 * s)} ${f(y)}`,
          "#f0d050",
          3 * s,
          `transform="rotate(${a} ${f(x)} ${f(y)})"`,
        ),
      )
      .join(""),
  beefstrip: (rng, x, y, s) =>
    rrect(x, y, 54 * s, 14 * s, 7 * s, C.beef, rng() * 180) +
    rrect(x, y, 40 * s, 6 * s, 3 * s, "#a06a50", rng() * 0, 'opacity="0.6"'),
  sausage: (rng, x, y, s) => {
    const rot = rng() * 180;
    return (
      rrect(x, y, 70 * s, 26 * s, 13 * s, C.brown, rot) +
      rrect(x - 6 * s, y - 4 * s, 44 * s, 6 * s, 3 * s, "#b98560", rot, 'opacity="0.7"')
    );
  },
  greenbean: (rng, x, y, s) => {
    const rot = rng() * 180;
    return `<g transform="rotate(${f(rot)} ${f(x)} ${f(y)})">${stroke(`M${f(x - 34 * s)} ${f(y)} Q${f(x)} ${f(y - 10 * s)} ${f(x + 34 * s)} ${f(y + 2 * s)}`, C.green, 9 * s)}</g>`;
  },
  berry: (rng, x, y, s) => {
    const c = pick(rng, [C.blue, C.tomato, C.purple] as const);
    return (
      circle(x, y, 13 * s, c) + circle(x - 4 * s, y - 4 * s, 4 * s, "#ffffff", 'opacity="0.35"')
    );
  },
  banana: (rng, x, y, s) =>
    circle(x, y, 27 * s, "#f3e3a6") +
    circle(x, y, 20 * s, "#faf0c8") +
    circle(x, y, 4 * s, "#d8c67c"),
  chickpea: (rng, x, y, s) =>
    circle(x, y, 11 * s, "#e2c27f") + circle(x - 3 * s, y - 3 * s, 3.5 * s, "#f0dba4"),
  lentil: (rng, x, y, s) => ellipse(x, y, 8 * s, 6 * s, C.lentil, rng() * 180),
  peanut: (rng, x, y, s) => ellipse(x, y, 8 * s, 5 * s, "#d8b37a", rng() * 180),
  sesame: (rng, x, y, s) => ellipse(x, y, 3.5 * s, 2 * s, "#fff3d6", rng() * 180),
  yogurt: (rng, x, y, s) =>
    circle(x, y, 28 * s, "#fffaf0") + circle(x - 6 * s, y - 6 * s, 10 * s, "#ffffff"),
  cream: (rng, x, y, s) =>
    circle(x, y, 16 * s, "#fff6ea") +
    stroke(
      `M${f(x - 10 * s)} ${f(y)} Q${f(x)} ${f(y - 10 * s)} ${f(x + 10 * s)} ${f(y)}`,
      "#e9d9bf",
      3 * s,
    ),
  spinach: (rng, x, y, s) => leaf(x, y, 20 * s, rng() * 360, C.greenDark, C.green),
  mushroom: (rng, x, y, s) =>
    ellipse(x, y, 20 * s, 13 * s, "#d8c2a0", rng() * 180) +
    ellipse(x, y + 2 * s, 12 * s, 6 * s, "#efe2c8", 0),
  carrot: (rng, x, y, s) => circle(x, y, 13 * s, C.orange) + circle(x, y, 7 * s, "#f5b064"),
  celery: (rng, x, y, s) => rrect(x, y, 24 * s, 13 * s, 5 * s, C.greenLight, rng() * 180),
  garlic: (rng, x, y, s) => ellipse(x, y, 5 * s, 3.5 * s, "#f6ead0", rng() * 180),
  peas: (rng, x, y, s) =>
    circle(x, y, 8 * s, C.greenLight) + circle(x - 2 * s, y - 2 * s, 2.5 * s, "#d6e69c"),
  noodleBit: (rng, x, y, s) => circle(x, y, 6 * s, "#f5dfa0"),
};

// ───────────────────────────── vessels ─────────────────────────────

type Vessel = { open: string; close: string; cx: number; cy: number; r: number };

function shadow(rx: number, ry: number, dy = 14) {
  return ellipse(CX + 10, CY + dy, rx, ry, C.ink, 0, 'opacity="0.10"');
}

const VESSELS = {
  plate: (rim = C.plate): Vessel => ({
    open:
      shadow(318, 304) +
      circle(CX, CY, 300, rim) +
      circle(CX, CY, 300, "none", `stroke="${C.plateEdge}" stroke-width="4"`) +
      circle(CX, CY, 238, "#fdfbf6") +
      circle(CX, CY, 238, "none", `stroke="${C.plateEdge}" stroke-width="3"`),
    close: "",
    cx: CX,
    cy: CY,
    r: 215,
  }),
  bowl: (color = C.clay, inner = C.cream): Vessel => ({
    open:
      shadow(320, 306) +
      circle(CX, CY, 304, color) +
      circle(CX, CY, 270, "#ffffff", 'opacity="0.22"') +
      circle(CX, CY, 252, inner),
    close: circle(CX, CY, 252, "none", `stroke="${C.ink}" stroke-width="3" opacity="0.10"`),
    cx: CX,
    cy: CY,
    r: 228,
  }),
  skillet: (): Vessel => ({
    open:
      shadow(330, 296) +
      rrect(CX + 360, CY + 10, 240, 52, 26, C.slateDark, -4) +
      circle(CX, CY, 302, "#4b5560") +
      circle(CX, CY, 276, "#2f363d") +
      circle(CX, CY, 262, "#3a434b"),
    close: "",
    cx: CX,
    cy: CY,
    r: 236,
  }),
  pot: (color = C.terracotta): Vessel => ({
    open:
      shadow(330, 306) +
      rrect(CX - 345, CY, 70, 40, 18, C.slateDark) +
      rrect(CX + 345, CY, 70, 40, 18, C.slateDark) +
      circle(CX, CY, 304, color) +
      circle(CX, CY, 268, "#ffffff", 'opacity="0.18"') +
      circle(CX, CY, 252, "#fff"),
    close: "",
    cx: CX,
    cy: CY,
    r: 228,
  }),
  tray: (): Vessel => ({
    open:
      shadow(440, 300) +
      rrect(CX, CY, 880, 628, 38, C.slate) +
      rrect(CX, CY, 846, 594, 28, "#8f9ca4") +
      rrect(CX, CY, 800, 548, 22, "#dfe5e7") +
      rrect(CX, CY, 800, 548, 22, "#f3efe6", 0, 'opacity="0.55"'),
    close: "",
    cx: CX,
    cy: CY,
    r: 330,
  }),
  board: (): Vessel => ({
    open:
      shadow(440, 290) +
      rrect(CX, CY, 880, 600, 46, C.woodDark) +
      rrect(CX, CY, 856, 576, 38, C.wood) +
      [200, 330, 470, 560, 690]
        .map((x, i) =>
          stroke(
            `M${x + 60} ${CY - 250} L${x + 40 + i * 4} ${CY + 250}`,
            C.woodDark,
            3,
            'opacity="0.35"',
          ),
        )
        .join(""),
    close: "",
    cx: CX,
    cy: CY,
    r: 300,
  }),
};

// ───────────────────────────── scene builders ─────────────────────────────

type Scene = { vessel: keyof typeof VESSELS; vesselColor?: string; bg: number; layers: Layer[] };
type Layer =
  | { kind: "fill"; color: string; r?: number }
  | { kind: "rice"; r?: number; dx?: number; dy?: number; color?: string }
  | { kind: "noodles"; color: string; thick?: number; rows?: number }
  | { kind: "greens"; count?: number; color?: string }
  | {
      kind: "scatter";
      item: keyof typeof ITEMS;
      count: number;
      scale?: number;
      r?: number;
      dx?: number;
      dy?: number;
      gap?: number;
      rect?: [number, number];
    }
  | { kind: "garnish"; item: keyof typeof ITEMS; count: number; r?: number }
  | { kind: "tin"; fills: string[] }
  | { kind: "waffle" }
  | { kind: "sandwich" }
  | { kind: "wraps" }
  | { kind: "patty"; color?: string }
  | { kind: "bun" }
  | { kind: "tacos" }
  | { kind: "pepperBoat" }
  | { kind: "sideLemon" }
  | { kind: "sideHerb" };

function drawLayers(scene: Scene, vessel: Vessel, rng: Rng): string {
  const out: string[] = [];
  for (const layer of scene.layers) {
    switch (layer.kind) {
      case "fill":
        out.push(circle(vessel.cx, vessel.cy, layer.r ?? vessel.r, layer.color));
        break;
      case "rice": {
        const r = layer.r ?? vessel.r * 0.62;
        const cx = vessel.cx + (layer.dx ?? 0);
        const cy = vessel.cy + (layer.dy ?? 0);
        out.push(
          circle(cx, cy, r, layer.color ?? C.rice),
          circle(cx, cy, r, "none", `stroke="${C.riceShade}" stroke-width="6"`),
        );
        for (const [x, y] of spread(rng, 70, r - 14, 18, cx, cy))
          out.push(ellipse(x, y, 9, 4.5, C.riceShade, rng() * 180));
        break;
      }
      case "noodles": {
        const rows = layer.rows ?? 7;
        for (let i = 0; i < rows; i++) {
          const y = vessel.cy - vessel.r * 0.62 + (i * vessel.r * 1.24) / (rows - 1);
          const half = Math.sqrt(Math.max(0, vessel.r * vessel.r * 0.78 - (y - vessel.cy) ** 2));
          const amp = 16 + rng() * 10;
          const x0 = vessel.cx - half;
          let d = `M${f(x0)} ${f(y)}`;
          const steps = 6;
          for (let k = 1; k <= steps; k++) {
            const x = x0 + (k * 2 * half) / steps;
            d += ` Q${f(x - half / steps)} ${f(y + (k % 2 ? amp : -amp))} ${f(x)} ${f(y)}`;
          }
          out.push(
            stroke(d, layer.color, layer.thick ?? 15, `opacity="${f(0.85 + rng() * 0.15)}"`),
          );
        }
        break;
      }
      case "greens": {
        for (const [x, y] of spread(
          rng,
          layer.count ?? 26,
          vessel.r * 0.86,
          40,
          vessel.cx,
          vessel.cy,
        )) {
          out.push(
            leaf(
              x,
              y,
              between(rng, 34, 54),
              rng() * 360,
              pick(rng, [layer.color ?? C.greenDark, C.green, C.greenLight]),
              C.greenLight,
            ),
          );
        }
        break;
      }
      case "scatter": {
        const r = layer.r ?? vessel.r * 0.8;
        const gap = (layer.gap ?? 44) * (layer.scale ?? 1);
        const cx = vessel.cx + (layer.dx ?? 0);
        const cy = vessel.cy + (layer.dy ?? 0);
        const points = layer.rect
          ? spreadRect(rng, layer.count, layer.rect[0], layer.rect[1], gap, cx, cy)
          : spread(rng, layer.count, r, gap, cx, cy);
        for (const [x, y] of points) {
          out.push(ITEMS[layer.item]!(rng, x, y, (layer.scale ?? 1) * between(rng, 0.9, 1.1)));
        }
        break;
      }
      case "garnish": {
        for (const [x, y] of spread(
          rng,
          layer.count,
          layer.r ?? vessel.r * 0.75,
          26,
          vessel.cx,
          vessel.cy,
        ))
          out.push(ITEMS[layer.item]!(rng, x, y, between(rng, 0.8, 1.1)));
        break;
      }
      case "tin": {
        out.push(rrect(CX, CY, 800, 560, 44, "#9aa6ad") + rrect(CX, CY, 772, 532, 34, "#b7c1c6"));
        const cols = 3;
        const rows = 2;
        layer.fills.forEach((fill, i) => {
          const x = CX + ((i % cols) - 1) * 240;
          const y = CY + (Math.floor(i / cols) - 0.5) * 250;
          out.push(
            circle(x, y, 104, "#8c989f") + circle(x, y, 94, "#d5dde0") + circle(x, y, 82, fill),
          );
          out.push(circle(x, y, 82, "none", `stroke="#ffffff" stroke-width="5" opacity="0.25"`));
          for (const [ix, iy] of spread(rng, 9, 66, 24, x, y))
            out.push(
              ITEMS[pick(rng, ["spinach", "pepper", "cheese", "cheese"] as const)]!(
                rng,
                ix,
                iy,
                0.55,
              ),
            );
        });
        void rows;
        break;
      }
      case "waffle": {
        const s = 400;
        out.push(rrect(CX, CY, s, s, 54, "#d99a43") + rrect(CX, CY, s - 26, s - 26, 42, "#eab65e"));
        for (let i = -2; i <= 2; i++) {
          out.push(
            stroke(
              `M${CX + i * 70} ${CY - s / 2 + 26} L${CX + i * 70} ${CY + s / 2 - 26}`,
              "#c98631",
              10,
            ),
            stroke(
              `M${CX - s / 2 + 26} ${CY + i * 70} L${CX + s / 2 - 26} ${CY + i * 70}`,
              "#c98631",
              10,
            ),
          );
        }
        out.push(rrect(CX - 10, CY - 8, 120, 60, 26, "#fffbee", -10, 'opacity="0.95"'));
        for (const [x, y] of spread(rng, 6, 110, 52, CX + 10, CY + 6))
          out.push(ITEMS.banana!(rng, x, y, 0.85));
        break;
      }
      case "sandwich": {
        const halves = [
          [CX - 195, CY - 40, -8],
          [CX + 185, CY + 30, 6],
        ] as const;
        for (const [x, y, rot] of halves) {
          out.push(rrect(x, y, 330, 250, 56, "#a8682f", rot));
          out.push(rrect(x, y, 304, 224, 46, "#f6e6c0", rot));
          out.push(rrect(x, y, 240, 160, 30, "#f7e9c6", rot, 'opacity="0.0"'));
          for (const [ix, iy] of spread(rng, 14, 92, 26, x, y))
            out.push(
              ITEMS[pick(rng, ["chickpea", "chickpea", "spinach", "celery"] as const)]!(
                rng,
                ix,
                iy,
                0.9,
              ),
            );
        }
        break;
      }
      case "wraps": {
        const items = [
          [CX - 200, CY - 80, -16],
          [CX + 40, CY + 60, 10],
          [CX + 210, CY - 120, -6],
        ] as const;
        for (const [x, y, rot] of items) {
          out.push(
            rrect(x, y, 340, 136, 66, "#d9dde0", rot) + rrect(x, y, 330, 124, 60, "#f0e0bd", rot),
          );
          out.push(
            `<g transform="rotate(${rot} ${x} ${y})">${stroke(`M${x + 130} ${y - 52} Q${x + 158} ${y} ${x + 130} ${y + 52}`, "#dcc79a", 6)}</g>`,
          );
          out.push(ellipse(x + (rot > 0 ? 154 : -154), y, 26, 50, C.yolk, rot));
        }
        break;
      }
      case "patty": {
        const positions: [number, number][] = [
          [CX - 150, CY - 110],
          [CX + 150, CY - 110],
          [CX - 150, CY + 130],
          [CX + 150, CY + 130],
        ];
        for (const [x, y] of positions) {
          out.push(
            circle(x, y, 108, layer.color ?? "#9b6a4a") +
              circle(x, y, 92, "#b07f5c", 'opacity="0.9"'),
          );
          for (const [ix, iy] of spread(rng, 18, 80, 22, x, y))
            out.push(circle(ix, iy, 5, "#6d4530", 'opacity="0.55"'));
          out.push(ITEMS.yogurt!(rng, x + 6, y - 4, 0.6));
        }
        break;
      }
      case "bun": {
        break;
      }
      case "tacos": {
        const positions: [number, number, number][] = [
          [CX - 130, CY - 120, -8],
          [CX + 150, CY - 40, 6],
          [CX - 40, CY + 170, -2],
        ];
        for (const [x, y, rot] of positions) {
          out.push(
            `<g transform="rotate(${rot} ${x} ${y})"><path d="M${x - 170} ${y} A170 170 0 0 1 ${x + 170} ${y} Z" fill="#f0d79a"/><path d="M${x - 150} ${y} A150 150 0 0 1 ${x + 150} ${y} Z" fill="#f7e7bd"/></g>`,
          );
          for (const [ix, iy] of spread(rng, 14, 70, 22, x, y - 50))
            out.push(
              ITEMS[pick(rng, ["bean", "sweetpotato", "avocado", "cilantro", "corn"] as const)]!(
                rng,
                ix,
                iy,
                0.7,
              ),
            );
        }
        break;
      }
      case "pepperBoat": {
        const positions: [number, number][] = [
          [CX - 200, CY - 100],
          [CX + 200, CY - 100],
          [CX, CY + 130],
        ];
        for (const [x, y] of positions) {
          out.push(
            rrect(x, y, 230, 250, 90, pick(rng, [C.tomato, C.yolk, C.orange] as const)) +
              rrect(x, y, 190, 210, 70, "#7a4a30"),
          );
          for (const [ix, iy] of spread(rng, 16, 72, 26, x, y))
            out.push(
              ITEMS[pick(rng, ["bean", "corn", "cheese", "peas"] as const)]!(rng, ix, iy, 0.75),
            );
        }
        break;
      }
      case "sideLemon": {
        out.push(ITEMS.lemon!(rng, CX + 330, CY + 250, 0.9));
        break;
      }
      case "sideHerb": {
        out.push(
          leaf(CX - 340, CY + 250, 28, 40, C.greenDark, C.greenLight),
          leaf(CX - 300, CY + 268, 24, -20, C.green, C.greenLight),
        );
        break;
      }
    }
  }
  return out.join("");
}

// ───────────────────────────── recipes ─────────────────────────────

const soup = (color: string, extras: Layer[]): Scene["layers"] => [
  { kind: "fill", color },
  ...extras,
];

const SCENES: Record<string, Scene> = {
  "egg-muffins": {
    vessel: "board",
    bg: 3,
    layers: [
      { kind: "tin", fills: ["#f4cf5c", "#f2c450", "#f7d873", "#f4cf5c", "#f2c450", "#f7d873"] },
    ],
  },
  "peanut-butter-waffles": {
    vessel: "plate",
    bg: 5,
    layers: [{ kind: "waffle" }, { kind: "sideLemon" }],
  },
  "berry-overnight-oats": {
    vessel: "bowl",
    vesselColor: C.sage,
    bg: 4,
    layers: [
      { kind: "fill", color: "#efe0c0" },
      { kind: "scatter", item: "peanut", count: 10, scale: 1.1, r: 120 },
      { kind: "scatter", item: "berry", count: 14, scale: 1.3, r: 150 },
      { kind: "scatter", item: "yogurt", count: 1, scale: 1.1, r: 10 },
    ],
  },
  "veggie-breakfast-burritos": {
    vessel: "board",
    bg: 2,
    layers: [{ kind: "wraps" }, { kind: "sideHerb" }],
  },
  "sweet-potato-black-bean-hash": {
    vessel: "skillet",
    bg: 3,
    layers: [
      { kind: "scatter", item: "sweetpotato", count: 16, scale: 1.05, r: 190 },
      { kind: "scatter", item: "bean", count: 14, r: 190 },
      { kind: "scatter", item: "pepper", count: 6, r: 180 },
      { kind: "scatter", item: "egg", count: 3, scale: 1.05, r: 120 },
      { kind: "garnish", item: "cilantro", count: 8 },
    ],
  },
  "chickpea-salad-sandwiches": {
    vessel: "board",
    bg: 0,
    layers: [{ kind: "sandwich" }, { kind: "sideLemon" }],
  },
  "caprese-pasta-salad": {
    vessel: "bowl",
    vesselColor: C.slate,
    bg: 5,
    layers: [
      { kind: "fill", color: "#f3e3b0" },
      { kind: "scatter", item: "cherry", count: 11, scale: 1.1, r: 185 },
      { kind: "scatter", item: "yogurt", count: 7, scale: 0.6, r: 185 },
      { kind: "garnish", item: "basil", count: 7 },
    ],
  },
  "lentil-vegetable-soup": {
    vessel: "bowl",
    vesselColor: C.terracotta,
    bg: 0,
    layers: soup("#c98a3f", [
      { kind: "scatter", item: "lentil", count: 40, r: 190 },
      { kind: "scatter", item: "carrot", count: 9, r: 180 },
      { kind: "scatter", item: "celery", count: 7, r: 180 },
      { kind: "garnish", item: "spinach", count: 4, r: 140 },
    ]),
  },
  "vegetable-soup": {
    vessel: "pot",
    bg: 1,
    layers: soup("#e3a04c", [
      { kind: "scatter", item: "carrot", count: 10, r: 185 },
      { kind: "scatter", item: "celery", count: 7, r: 185 },
      { kind: "scatter", item: "chickpea", count: 12, r: 185 },
      { kind: "scatter", item: "spinach", count: 5, r: 165 },
    ]),
  },
  "quinoa-black-bean-bowls": {
    vessel: "bowl",
    vesselColor: C.blue,
    bg: 1,
    layers: [
      { kind: "fill", color: "#f2e3bd" },
      { kind: "scatter", item: "bean", count: 14, r: 175, dx: -20, dy: -10 },
      { kind: "scatter", item: "corn", count: 26, r: 175 },
      { kind: "scatter", item: "avocado", count: 4, r: 150 },
      { kind: "scatter", item: "tomato", count: 4, scale: 0.6, r: 150 },
      { kind: "garnish", item: "cilantro", count: 8 },
    ],
  },
  "chicken-rice-bowls": {
    vessel: "bowl",
    vesselColor: C.clay,
    bg: 4,
    layers: [
      { kind: "fill", color: C.cream },
      { kind: "rice", dx: -58, dy: 18, r: 135 },
      { kind: "scatter", item: "chicken", count: 4, dx: 70, dy: -40, r: 90, scale: 0.95 },
      { kind: "scatter", item: "broccoli", count: 3, dx: 40, dy: 100, r: 70, scale: 0.85 },
      { kind: "scatter", item: "carrot", count: 5, dx: 90, dy: 90, r: 60, scale: 0.8 },
    ],
  },
  "turkey-patties": {
    vessel: "plate",
    bg: 2,
    layers: [{ kind: "patty" }, { kind: "garnish", item: "cilantro", count: 6, r: 200 }],
  },
  "tomato-pasta": {
    vessel: "plate",
    bg: 4,
    layers: [
      { kind: "noodles", color: "#f1cf74", thick: 17 },
      { kind: "scatter", item: "cherry", count: 8, r: 150, scale: 1.05 },
      { kind: "scatter", item: "cheese", count: 12, r: 160, scale: 0.9 },
      { kind: "garnish", item: "basil", count: 6, r: 160 },
    ],
  },
  "miso-glazed-cod": {
    vessel: "plate",
    bg: 5,
    layers: [
      { kind: "scatter", item: "cod", count: 2, scale: 1.9, r: 70, dy: -40, gap: 105 },
      { kind: "scatter", item: "greenbean", count: 10, r: 120, dy: 105, scale: 1.3, gap: 34 },
      { kind: "scatter", item: "sesame", count: 34, r: 90, dy: -40, scale: 1.4 },
      { kind: "sideLemon" },
    ],
  },
  "sheet-pan-chicken-sweet-potatoes": {
    vessel: "tray",
    bg: 3,
    layers: [
      { kind: "scatter", item: "sweetpotato", count: 22, rect: [740, 500], scale: 1.9, gap: 40 },
      { kind: "scatter", item: "chicken", count: 4, rect: [700, 460], scale: 1.6, gap: 70 },
      { kind: "scatter", item: "onion", count: 10, rect: [740, 500], scale: 1.6, gap: 32 },
      { kind: "scatter", item: "broccoli", count: 5, rect: [700, 460], scale: 1.4, gap: 60 },
    ],
  },
  "black-bean-patties": {
    vessel: "plate",
    bg: 1,
    layers: [
      { kind: "patty", color: "#4f3a30" },
      { kind: "garnish", item: "cilantro", count: 8, r: 200 },
    ],
  },
  "salmon-bowls": {
    vessel: "bowl",
    vesselColor: C.slate,
    bg: 2,
    layers: [
      { kind: "fill", color: C.cream },
      { kind: "rice", dx: -62, dy: 10, r: 120 },
      { kind: "scatter", item: "salmon", count: 2, dx: 70, dy: -50, r: 60, scale: 0.95, gap: 90 },
      { kind: "scatter", item: "avocado", count: 3, dx: 70, dy: 90, r: 60, scale: 0.85 },
      { kind: "scatter", item: "sesame", count: 24, r: 150 },
      { kind: "scatter", item: "peas", count: 7, dx: -10, dy: 130, r: 70 },
    ],
  },
  "chicken-fried-rice": {
    vessel: "skillet",
    bg: 3,
    layers: [
      { kind: "rice", r: 200, color: "#f0d9a0" },
      { kind: "scatter", item: "chicken", count: 4, r: 140, scale: 0.75, gap: 70 },
      { kind: "scatter", item: "peas", count: 18, r: 190 },
      { kind: "scatter", item: "carrot", count: 12, r: 190 },
      { kind: "scatter", item: "egg", count: 2, scale: 0.6, r: 140 },
      { kind: "garnish", item: "cilantro", count: 8 },
    ],
  },
  "weeknight-chicken-curry": {
    vessel: "bowl",
    vesselColor: C.terracotta,
    bg: 3,
    layers: soup(C.curry, [
      { kind: "scatter", item: "chicken", count: 5, r: 150, scale: 0.85, gap: 75 },
      { kind: "scatter", item: "onion", count: 6, r: 170, scale: 0.8 },
      { kind: "scatter", item: "cream", count: 3, r: 120 },
      { kind: "garnish", item: "cilantro", count: 8 },
    ]),
  },
  "sweet-potato-black-bean-tacos": {
    vessel: "board",
    bg: 2,
    layers: [{ kind: "tacos" }, { kind: "sideLemon" }],
  },
  "sheet-pan-sausage-vegetables": {
    vessel: "tray",
    bg: 1,
    layers: [
      { kind: "scatter", item: "potato", count: 16, rect: [740, 500], scale: 1.9, gap: 40 },
      { kind: "scatter", item: "sausage", count: 6, rect: [700, 460], scale: 1.6, gap: 60 },
      { kind: "scatter", item: "pepper", count: 10, rect: [740, 500], scale: 1.7, gap: 32 },
      { kind: "scatter", item: "onion", count: 8, rect: [740, 500], scale: 1.5, gap: 32 },
      { kind: "scatter", item: "broccoli", count: 5, rect: [700, 460], scale: 1.4, gap: 60 },
    ],
  },
  "beef-and-broccoli": {
    vessel: "skillet",
    bg: 4,
    layers: [
      { kind: "fill", color: "#5a3a2a", r: 230 },
      { kind: "scatter", item: "beefstrip", count: 12, r: 190, scale: 1 },
      { kind: "scatter", item: "broccoli", count: 7, r: 190, scale: 1 },
      { kind: "scatter", item: "sesame", count: 30, r: 190 },
    ],
  },
  "creamy-tomato-soup": {
    vessel: "bowl",
    vesselColor: C.sage,
    bg: 4,
    layers: soup("#dc6a45", [
      { kind: "scatter", item: "cream", count: 1, scale: 1.8, r: 10 },
      { kind: "scatter", item: "basil", count: 4, r: 130 },
    ]),
  },
  shakshuka: {
    vessel: "skillet",
    bg: 3,
    layers: [
      { kind: "fill", color: "#c7432a", r: 232 },
      { kind: "scatter", item: "tomato", count: 7, scale: 0.75, r: 180 },
      { kind: "scatter", item: "pepper", count: 6, r: 180, scale: 0.9 },
      { kind: "scatter", item: "egg", count: 4, scale: 0.95, r: 130, gap: 120 },
      { kind: "garnish", item: "cilantro", count: 8 },
    ],
  },
  "garlic-butter-shrimp": {
    vessel: "plate",
    bg: 2,
    layers: [
      { kind: "rice", dx: -70, dy: 0, r: 130 },
      { kind: "scatter", item: "shrimp", count: 7, dx: 40, dy: 10, r: 130, scale: 1.15, gap: 70 },
      { kind: "scatter", item: "garlic", count: 18, r: 170 },
      { kind: "garnish", item: "basil", count: 4, r: 150 },
      { kind: "sideLemon" },
    ],
  },
  "turkey-chili": {
    vessel: "pot",
    vesselColor: C.slate,
    bg: 4,
    layers: soup("#a9412a", [
      { kind: "scatter", item: "bean", count: 16, r: 185 },
      { kind: "scatter", item: "corn", count: 18, r: 185 },
      { kind: "scatter", item: "pepper", count: 5, r: 170 },
      { kind: "scatter", item: "cheese", count: 12, r: 120 },
    ]),
  },
  "chickpea-coconut-curry": {
    vessel: "bowl",
    vesselColor: C.clay,
    bg: 0,
    layers: soup("#f0c66a", [
      { kind: "scatter", item: "chickpea", count: 22, r: 175 },
      { kind: "scatter", item: "spinach", count: 6, r: 170 },
      { kind: "scatter", item: "cream", count: 3, r: 120 },
      { kind: "garnish", item: "cilantro", count: 8 },
    ]),
  },
  "sheet-pan-chicken-fajitas": {
    vessel: "tray",
    bg: 2,
    layers: [
      { kind: "scatter", item: "pepper", count: 16, rect: [740, 500], scale: 1.9, gap: 34 },
      { kind: "scatter", item: "chicken", count: 6, rect: [700, 460], scale: 1.6, gap: 60 },
      { kind: "scatter", item: "onion", count: 12, rect: [740, 500], scale: 1.6, gap: 30 },
      { kind: "garnish", item: "cilantro", count: 10, r: 300 },
    ],
  },
  "garlic-spinach-pasta": {
    vessel: "plate",
    bg: 1,
    layers: [
      { kind: "noodles", color: "#f1d78a", thick: 16 },
      { kind: "scatter", item: "spinach", count: 9, r: 150, scale: 0.9 },
      { kind: "scatter", item: "garlic", count: 14, r: 160 },
      { kind: "scatter", item: "cheese", count: 10, r: 150, scale: 0.9 },
    ],
  },
  "turkey-stuffed-peppers": {
    vessel: "board",
    bg: 4,
    layers: [{ kind: "pepperBoat" }, { kind: "sideHerb" }],
  },
  "sesame-peanut-noodles": {
    vessel: "bowl",
    vesselColor: C.blue,
    bg: 3,
    layers: [
      { kind: "fill", color: C.cream },
      { kind: "noodles", color: "#e3b45e", thick: 17 },
      { kind: "scatter", item: "carrot", count: 8, r: 160 },
      { kind: "scatter", item: "peanut", count: 14, r: 170 },
      { kind: "scatter", item: "sesame", count: 30, r: 170 },
      { kind: "garnish", item: "cilantro", count: 6 },
    ],
  },
  "black-bean-soup": {
    vessel: "bowl",
    vesselColor: C.slate,
    bg: 6,
    layers: soup("#4c3429", [
      { kind: "scatter", item: "bean", count: 14, r: 175 },
      { kind: "scatter", item: "yogurt", count: 2, scale: 0.9, r: 90 },
      { kind: "garnish", item: "cilantro", count: 8 },
      { kind: "scatter", item: "tomato", count: 4, scale: 0.5, r: 150 },
    ]),
  },
  "lemon-herb-chicken-green-beans": {
    vessel: "plate",
    bg: 0,
    layers: [
      { kind: "scatter", item: "chicken", count: 2, dx: -30, dy: -30, r: 70, scale: 2, gap: 110 },
      {
        kind: "scatter",
        item: "greenbean",
        count: 12,
        dx: 40,
        dy: 95,
        r: 120,
        scale: 1.4,
        gap: 34,
      },
      { kind: "garnish", item: "basil", count: 5, r: 160 },
      { kind: "sideLemon" },
    ],
  },
};

function renderScene(slug: string, scene: Scene): string {
  const rng = mulberry32(hash(slug));
  const vessel = VESSELS[scene.vessel](scene.vesselColor as never);
  const bg = BACKDROPS[scene.bg % BACKDROPS.length]!;
  // A few flat cloth stripes keep the backdrop from feeling empty.
  const cloth = [90, 690]
    .map((y) => rrect(CX, y, W + 40, 34, 0, C.cream, 0, 'opacity="0.35"'))
    .join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img">` +
    `<rect width="${W}" height="${H}" fill="${bg}"/>${cloth}` +
    vessel.open +
    drawLayers(scene, vessel, rng) +
    vessel.close +
    `</svg>\n`
  );
}

// ───────────────────────────── landing hero ─────────────────────────────

/** Glass meal-prep containers of rice, roasted sweet potatoes and chopped onions (the prototype's hero subject). */
function renderHero(): string {
  const rng = mulberry32(hash("hero-prep"));
  const hw = 1600;
  const hh = 1200;
  const containers = [
    { x: 420, y: 330, fill: "rice" },
    { x: 1180, y: 330, fill: "sweet" },
    { x: 420, y: 880, fill: "onion" },
    { x: 1180, y: 880, fill: "rice2" },
  ] as const;
  const parts: string[] = [`<rect width="${hw}" height="${hh}" fill="${C.linen}"/>`];
  for (let y = 80; y < hh; y += 200)
    parts.push(`<rect x="0" y="${y}" width="${hw}" height="60" fill="${C.cream}" opacity="0.4"/>`);
  for (const c of containers) {
    const w = 640;
    const h = 480;
    parts.push(rrect(c.x + 14, c.y + 20, w + 30, h + 30, 60, C.ink, 0, 'opacity="0.10"'));
    parts.push(
      rrect(c.x, c.y, w, h, 56, "#dfe9ea") + rrect(c.x, c.y, w - 34, h - 34, 44, "#f4f8f8"),
    );
    // Lid clips
    parts.push(
      rrect(c.x - w / 2 + 6, c.y, 22, 110, 10, C.slate),
      rrect(c.x + w / 2 - 6, c.y, 22, 110, 10, C.slate),
    );
    const fx = (
      n: number,
      r: number,
      spreadGap: number,
      draw: (x: number, y: number) => string,
    ) => {
      for (const [x, y] of spread(rng, n, r, spreadGap, c.x, c.y)) parts.push(draw(x, y));
    };
    if (c.fill === "rice" || c.fill === "rice2") {
      parts.push(rrect(c.x, c.y, w - 70, h - 70, 40, c.fill === "rice" ? C.rice : "#f7efd6"));
      fx(120, 230, 26, (x, y) => ellipse(x, y, 14, 7, C.riceShade, rng() * 180));
      if (c.fill === "rice2")
        for (const [x, y] of spread(rng, 12, 200, 60, c.x, c.y))
          parts.push(ITEMS.peas!(rng, x, y, 1.3));
    } else if (c.fill === "sweet") {
      parts.push(rrect(c.x, c.y, w - 70, h - 70, 40, "#f3e6cf"));
      fx(30, 220, 66, (x, y) => ITEMS.sweetpotato!(rng, x, y, 1.75));
    } else {
      parts.push(rrect(c.x, c.y, w - 70, h - 70, 40, "#f5ecdc"));
      fx(46, 220, 50, (x, y) => ITEMS.onion!(rng, x, y, 1.25));
      fx(18, 200, 70, (x, y) => ITEMS.cilantro!(rng, x, y, 1.6));
    }
  }
  // Loose items between the containers.
  parts.push(
    ITEMS.lemon!(rng, 800, 610, 1.4),
    leaf(700, 560, 40, 30, C.greenDark, C.greenLight),
    leaf(905, 660, 36, -25, C.green, C.greenLight),
  );
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${hw} ${hh}" width="${hw}" height="${hh}" role="img" aria-label="Glass meal-prep containers of rice, roasted sweet potatoes and chopped onions">${parts.join("")}</svg>\n`;
}

// ───────────────────────────── main ─────────────────────────────

const catalogDir = path.join(root, "data", "catalog");
const slugs = fs
  .readdirSync(catalogDir)
  .filter((name) => name.endsWith(".json"))
  .flatMap((name) =>
    parseCatalog(JSON.parse(fs.readFileSync(path.join(catalogDir, name), "utf8")), name),
  )
  .map((recipe) => recipe.slug);

const outDir = path.join(root, "public", "images", "recipes");
fs.mkdirSync(outDir, { recursive: true });

const missing = slugs.filter((slug) => !SCENES[slug]);
if (missing.length) {
  console.error(`No scene defined for: ${missing.join(", ")}`);
  process.exit(1);
}
for (const slug of slugs)
  fs.writeFileSync(path.join(outDir, `${slug}.svg`), renderScene(slug, SCENES[slug]!));
fs.writeFileSync(path.join(root, "public", "images", "hero-prep.svg"), renderHero());
console.log(`wrote ${slugs.length} recipe illustrations and the landing hero`);
