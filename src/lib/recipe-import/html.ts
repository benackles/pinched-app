import { Parser } from "htmlparser2";

export type PageFacts = {
  /** Raw text of every <script type="application/ld+json"> block. */
  jsonLd: string[];
  /** Lower-cased robots-style directives from <meta name="robots|googlebot|pinchedimport">. */
  robots: string[];
  title: string | null;
  ogTitle: string | null;
};

const MAX_SCRIPT_BYTES = 1_000_000;
const ROBOTS_NAMES = new Set(["robots", "googlebot", "pinchedimport", "pinchedbot"]);

/** Pulls the few things import needs out of an HTML page without building a DOM. */
export function extractPageFacts(html: string): PageFacts {
  const jsonLd: string[] = [];
  const robots: string[] = [];
  let title = "";
  let ogTitle: string | null = null;
  let inTitle = false;
  let ldBuffer: string | null = null;

  const parser = new Parser(
    {
      onopentag(name, attributes) {
        if (name === "script" && /application\/ld\+json/i.test(attributes.type ?? ""))
          ldBuffer = "";
        else if (name === "title") inTitle = true;
        else if (name === "meta") {
          const key = (attributes.name ?? attributes.property ?? "").toLowerCase();
          const content = attributes.content ?? "";
          if (ROBOTS_NAMES.has(key)) {
            for (const token of content.toLowerCase().split(/[\s,]+/))
              if (token) robots.push(token);
          } else if (key === "og:title" && content) {
            ogTitle = content.trim();
          }
        }
      },
      ontext(text) {
        if (ldBuffer !== null) {
          if (ldBuffer.length < MAX_SCRIPT_BYTES) ldBuffer += text;
        } else if (inTitle) {
          title += text;
        }
      },
      onclosetag(name) {
        if (name === "script" && ldBuffer !== null) {
          if (ldBuffer.trim()) jsonLd.push(ldBuffer);
          ldBuffer = null;
        } else if (name === "title") {
          inTitle = false;
        }
      },
    },
    { decodeEntities: true },
  );
  parser.write(html);
  parser.end();

  return { jsonLd, robots, title: title.replace(/\s+/g, " ").trim() || null, ogTitle };
}

/** Directives that mean "do not copy this page": noindex, none and the noai family. */
const DO_NOT_COPY = new Set(["noindex", "none", "noai", "noimageai"]);

export function robotsForbid(directives: string[], xRobotsTag?: string | null): boolean {
  const tokens = [...directives];
  if (xRobotsTag)
    for (const token of xRobotsTag.toLowerCase().split(/[\s,]+/)) if (token) tokens.push(token);
  return tokens.some((token) => DO_NOT_COPY.has(token));
}

/**
 * Parses a JSON-LD block, tolerating what real pages contain: a BOM, CDATA or HTML-comment
 * wrappers, and raw newlines or tabs inside strings (invalid JSON that every browser accepts).
 */
export function parseJsonLd(raw: string): unknown | null {
  const cleaned = raw
    .replace(/^﻿/, "")
    .replace(/^\s*<!--/, "")
    .replace(/-->\s*$/, "")
    .replace(/^\s*\/\/\s*<!\[CDATA\[/, "")
    .replace(/\/\/\s*\]\]>\s*$/, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // fall through to the repair pass
  }
  try {
    return JSON.parse(escapeControlCharsInStrings(cleaned));
  } catch {
    return null;
  }
}

function escapeControlCharsInStrings(text: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (const char of text) {
    if (inString) {
      if (escaped) {
        escaped = false;
        out += char;
      } else if (char === "\\") {
        escaped = true;
        out += char;
      } else if (char === '"') {
        inString = false;
        out += char;
      } else if (char < " ") {
        out += " ";
      } else {
        out += char;
      }
    } else {
      if (char === '"') inString = true;
      out += char;
    }
  }
  return out;
}
