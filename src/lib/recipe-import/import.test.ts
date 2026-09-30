import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseIsoDuration } from "./duration";
import { assertPublicUrl, ImportError, type Resolver } from "./guard";
import { extractPageFacts, parseJsonLd, robotsForbid } from "./html";
import { importRecipe, type FetchedPage, type Transport } from "./import";
import { isPublicAddress } from "./ip";
import { findRecipeNode, mapRecipe, normalizeInstructions, toPlainText } from "./schema";
import { createNodeTransport } from "./transport";

// ─────────────────────────────── addresses ───────────────────────────────

describe("isPublicAddress", () => {
  it.each([
    "8.8.8.8",
    "1.1.1.1",
    "93.184.216.34",
    "172.32.0.1",
    "172.15.255.255",
    "2606:4700:4700::1111",
    "2001:4860:4860::8888",
  ])("%s is public", (ip) => {
    expect(isPublicAddress(ip)).toBe(true);
  });

  it.each([
    "127.0.0.1",
    "127.255.255.254",
    "10.0.0.1",
    "10.255.255.255",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254", // cloud metadata
    "100.64.0.1", // carrier-grade NAT
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "198.18.0.1",
    "::1",
    "::",
    "fe80::1",
    "fc00::1",
    "fd12:3456::1",
    "ff02::1",
    "2001:db8::1",
    "::ffff:127.0.0.1", // IPv4-mapped loopback
    "::ffff:7f00:1",
    "::ffff:10.0.0.1",
    "::ffff:a9fe:a9fe", // mapped metadata
    "64:ff9b::7f00:1", // NAT64 → loopback
    "2002:7f00:1::1", // 6to4 → loopback
    "[::1]",
  ])("%s is NOT public", (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });

  it("treats anything unparseable as not public", () => {
    for (const bad of [
      "",
      "not an ip",
      "999.1.1.1",
      "1.2.3",
      "1.2.3.4.5",
      "::g",
      "1::2::3",
      "localhost",
    ]) {
      expect(isPublicAddress(bad), bad).toBe(false);
    }
  });
});

// ─────────────────────────────── durations ───────────────────────────────

describe("parseIsoDuration", () => {
  it.each([
    ["PT1H15M", 75],
    ["PT45M", 45],
    ["PT90M", 90],
    ["PT1H", 60],
    ["P0DT30M", 30],
    ["P1DT2H", 1560],
    ["PT30S", 1],
    ["1 hour 30 minutes", 90],
    ["45 min", 45],
    ["2 hrs", 120],
    [30, 30],
  ])("%s → %s minutes", (input, expected) => {
    expect(parseIsoDuration(input)).toBe(expected);
  });

  it("returns null for nothing usable", () => {
    for (const bad of [null, undefined, "", "PT", "P", "garbage", -5, Number.NaN, {}])
      expect(parseIsoDuration(bad)).toBeNull();
  });
});

// ─────────────────────────────── schema.org mapping ───────────────────────────────

describe("normalizeInstructions", () => {
  it("reads HowToStep lists", () => {
    expect(
      normalizeInstructions([
        { "@type": "HowToStep", text: "Boil water." },
        { "@type": "HowToStep", name: "Add pasta." },
      ]),
    ).toEqual(["Boil water.", "Add pasta."]);
  });

  it("flattens HowToSection (PRD: including HowToSection)", () => {
    const sections = [
      {
        "@type": "HowToSection",
        name: "Sauce",
        itemListElement: [{ "@type": "HowToStep", text: "Whisk the sauce." }],
      },
      {
        "@type": "HowToSection",
        name: "Bowls",
        itemListElement: [
          { "@type": "HowToStep", text: "Cook the rice." },
          { "@type": "HowToStep", text: "Assemble." },
        ],
      },
    ];
    expect(normalizeInstructions(sections)).toEqual([
      "Whisk the sauce.",
      "Cook the rice.",
      "Assemble.",
    ]);
  });

  it("splits a single string on line breaks or numbering and strips tags and entities", () => {
    expect(normalizeInstructions("Chop the onion.\nFry it.")).toEqual([
      "Chop the onion.",
      "Fry it.",
    ]);
    expect(normalizeInstructions("1. Chop the onion. 2. Fry it gently. 3. Serve.")).toEqual([
      "Chop the onion.",
      "Fry it gently.",
      "Serve.",
    ]);
    expect(
      normalizeInstructions(["<p>Mix the flour &amp; sugar.</p>", "Bake at 350&deg;F."]),
    ).toEqual(["Mix the flour & sugar.", "Bake at 350°F."]);
  });

  it("returns nothing for nothing", () => {
    expect(normalizeInstructions(null)).toEqual([]);
    expect(normalizeInstructions(undefined)).toEqual([]);
    expect(normalizeInstructions([])).toEqual([]);
  });
});

describe("toPlainText", () => {
  it("decodes entities and removes tags", () => {
    expect(toPlainText("Tom &amp; Jerry&#39;s <b>best</b>&nbsp;soup")).toBe(
      "Tom & Jerry's best soup",
    );
    expect(toPlainText("a<br>b")).toBe("a\nb");
    expect(toPlainText(42)).toBe("");
  });
});

describe("findRecipeNode", () => {
  const recipe = { "@type": "Recipe", name: "Soup" };
  it("finds a Recipe at the top level, in @graph, in arrays and under mainEntity", () => {
    expect(findRecipeNode(recipe)).toBe(recipe);
    expect(findRecipeNode({ "@graph": [{ "@type": "WebSite" }, recipe] })).toBe(recipe);
    expect(findRecipeNode([{ "@type": "Organization" }, recipe])).toBe(recipe);
    expect(findRecipeNode({ "@type": "WebPage", mainEntity: recipe })).toBe(recipe);
    expect(findRecipeNode({ "@type": ["Recipe", "NewsArticle"], name: "Dual" })).toMatchObject({
      name: "Dual",
    });
  });

  it("returns null when there is none, and survives hostile nesting", () => {
    expect(findRecipeNode({ "@type": "Article" })).toBeNull();
    expect(findRecipeNode(null)).toBeNull();
    let deep: Record<string, unknown> = { "@type": "Recipe" };
    for (let i = 0; i < 50; i++) deep = { "@graph": [deep] };
    expect(findRecipeNode(deep)).toBeNull(); // deeper than we're willing to look
  });
});

describe("mapRecipe", () => {
  const full = {
    "@context": "https://schema.org",
    "@type": "Recipe",
    name: "Weeknight Chicken Curry",
    description: "My grandmother's curry — the headnote the PRD says never to copy.",
    author: { "@type": "Person", name: "Sam Cook" },
    image: [{ "@type": "ImageObject", url: "/photos/curry.jpg" }],
    recipeYield: ["4", "4 servings"],
    prepTime: "PT15M",
    cookTime: "PT35M",
    totalTime: "PT50M",
    recipeIngredient: [
      "1 tbsp oil",
      "1 yellow onion, diced",
      "2 cloves garlic, minced",
      "1 lb chicken thighs",
      "For the rice:",
      "1 cup basmati rice",
    ],
    recipeInstructions: [
      { "@type": "HowToStep", text: "Soften the onion." },
      { "@type": "HowToStep", text: "Add the chicken and simmer." },
    ],
  };

  it("maps every field the PRD lists", () => {
    const result = mapRecipe(full, "https://blog.example.com/curry", null)!;
    expect(result).toMatchObject({
      title: "Weeknight Chicken Curry",
      author: "Sam Cook",
      source_url: "https://blog.example.com/curry",
      image_url: "https://blog.example.com/photos/curry.jpg",
      servings: 4,
      servings_label: null,
      prep_minutes: 15,
      cook_minutes: 35,
      total_minutes: 50,
      steps: ["Soften the onion.", "Add the chicken and simmer."],
    });
    expect(result.ingredients).toHaveLength(5);
    expect(result.ingredients[1]).toMatchObject({
      normalized_name: "onion",
      preparation: "diced",
      grocery_section: "Produce",
    });
    expect(result.ingredients[4]).toMatchObject({ group_label: "For the rice" });
    expect(result.warnings).toEqual([]);
  });

  it("never copies the source's headnote", () => {
    const result = mapRecipe(full, "https://blog.example.com/curry", null)!;
    expect(JSON.stringify(result)).not.toContain("grandmother");
    expect(result).not.toHaveProperty("description");
    expect(result).not.toHaveProperty("headnote");
  });

  it("copes with the many shapes sites use", () => {
    const alt = mapRecipe(
      {
        "@type": "Recipe",
        name: "Muffins",
        author: [{ name: "A" }, { name: "B" }],
        image: "https://cdn.example.com/m.jpg",
        recipeYield: "Makes 12 muffins",
        cookTime: "PT20M",
        recipeIngredient: "2 cups flour\n1 cup sugar",
        recipeInstructions: "Mix.\nBake.",
      },
      "https://x.example/muffins",
      null,
    )!;
    expect(alt).toMatchObject({
      author: "A, B",
      image_url: "https://cdn.example.com/m.jpg",
      servings: 12,
      servings_label: "Makes 12 muffins",
      total_minutes: 20,
      steps: ["Mix.", "Bake."],
    });
    expect(alt.ingredients.map((i) => i.normalized_name)).toEqual(["flour", "sugar"]);
  });

  it("warns instead of failing when details are missing", () => {
    const result = mapRecipe(
      {
        "@type": "Recipe",
        name: "Bare",
        recipeIngredient: ["rice", "beans", "salt", "oil", "water"],
        recipeInstructions: ["Cook."],
      },
      "https://x.example/bare",
      null,
    )!;
    expect(result.warnings.join(" ")).toMatch(/servings/);
    expect(result.warnings.join(" ")).toMatch(/no amount/);
  });

  it("refuses non-http images and uses the page title when the recipe has none", () => {
    const result = mapRecipe(
      { "@type": "Recipe", image: "javascript:alert(1)", recipeIngredient: ["1 egg"] },
      "https://x.example/r",
      "Page Title",
    )!;
    expect(result.image_url).toBeNull();
    expect(result.title).toBe("Page Title");
  });

  it("returns null for a Recipe node with nothing in it", () => {
    expect(mapRecipe({ "@type": "Recipe", name: "Empty" }, "https://x.example/e", null)).toBeNull();
    expect(mapRecipe({ "@type": "Recipe" }, "https://x.example/e", null)).toBeNull();
  });
});

// ─────────────────────────────── HTML ───────────────────────────────

describe("page parsing", () => {
  it("extracts JSON-LD, robots directives and titles", () => {
    const facts = extractPageFacts(`<html><head><title> My  Recipe </title>
      <meta name="robots" content="index, noai"><meta property="og:title" content="OG Title">
      <script type="application/ld+json">{"@type":"Recipe"}</script><script>var x=1</script>
      <script type="application/ld+json">{"@type":"WebSite"}</script></head></html>`);
    expect(facts.jsonLd).toHaveLength(2);
    expect(facts.robots).toEqual(["index", "noai"]);
    expect(facts.title).toBe("My Recipe");
    expect(facts.ogTitle).toBe("OG Title");
  });

  it("repairs the JSON real pages contain", () => {
    expect(parseJsonLd('{"a": "line one\nline two"}')).toEqual({ a: "line one line two" });
    expect(parseJsonLd('﻿<!-- {"a": 1} -->')).toEqual({ a: 1 });
    expect(parseJsonLd('//<![CDATA[\n{"a": 2}\n//]]>')).toEqual({ a: 2 });
    expect(parseJsonLd("{not json")).toBeNull();
  });

  it("respects robots directives (PRD: respect robots meta)", () => {
    expect(robotsForbid(["noindex"])).toBe(true);
    expect(robotsForbid(["none"])).toBe(true);
    expect(robotsForbid(["noai"])).toBe(true);
    expect(robotsForbid(["index", "follow"])).toBe(false);
    expect(robotsForbid([], "noindex, nofollow")).toBe(true);
    expect(robotsForbid([], "all")).toBe(false);
  });
});

// ─────────────────────────────── the URL guard ───────────────────────────────

const publicResolver: Resolver = async () => ["93.184.216.34"];

describe("assertPublicUrl", () => {
  it.each([
    ["", "invalid_url"],
    ["not a url", "invalid_url"],
    ["ftp://example.com/recipe", "invalid_url"],
    ["javascript:alert(1)", "invalid_url"],
    ["data:text/html,<h1>hi</h1>", "invalid_url"],
    ["file:///etc/passwd", "invalid_url"],
    ["http://user:pass@example.com/", "invalid_url"],
    ["http://127.0.0.1/", "blocked_url"],
    ["http://localhost/", "blocked_url"],
    ["http://foo.localhost/", "blocked_url"],
    ["http://169.254.169.254/latest/meta-data/", "blocked_url"],
    ["http://metadata.google.internal/", "blocked_url"],
    ["http://[::1]/", "blocked_url"],
    ["http://[::ffff:127.0.0.1]/", "blocked_url"],
    ["http://10.0.0.5/", "blocked_url"],
    ["http://192.168.1.1/admin", "blocked_url"],
    ["http://2130706433/", "blocked_url"], // decimal form of 127.0.0.1
    ["http://0x7f.0.0.1/", "blocked_url"], // hex octet
    ["http://0177.0.0.1/", "blocked_url"], // octal octet
    ["http://example.com:8080/", "blocked_url"],
    ["http://example.com:22/", "blocked_url"],
    ["https://printer.lan/", "blocked_url"],
  ])("rejects %s", async (raw, reason) => {
    const error = await assertPublicUrl(raw, publicResolver).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ImportError);
    expect((error as ImportError).reason).toBe(reason);
  });

  it("rejects a name that resolves to a private address, or to a mix", async () => {
    const internal: Resolver = async () => ["10.0.0.5"];
    const mixed: Resolver = async () => ["93.184.216.34", "127.0.0.1"];
    for (const resolver of [internal, mixed]) {
      const error = await assertPublicUrl("https://recipes.example.com/x", resolver).catch(
        (e: unknown) => e,
      );
      expect((error as ImportError).reason).toBe("blocked_url");
    }
  });

  it("reports a DNS failure as a fetch failure, not a crash", async () => {
    const broken: Resolver = async () => {
      throw new Error("ENOTFOUND");
    };
    const error = await assertPublicUrl("https://nope.example/", broken).catch((e: unknown) => e);
    expect((error as ImportError).reason).toBe("fetch_failed");
  });

  it("accepts ordinary public pages on default ports", async () => {
    for (const raw of [
      "https://cooking.example.com/recipes/chili",
      "http://example.com/r",
      "https://example.com:443/r",
    ]) {
      await expect(assertPublicUrl(raw, publicResolver)).resolves.toBeInstanceOf(URL);
    }
  });

  it("lets local-mode fixtures through only when explicitly allowed", async () => {
    await expect(
      assertPublicUrl("http://127.0.0.1:4000/r", publicResolver, { allowPrivate: true }),
    ).resolves.toBeInstanceOf(URL);
    await expect(
      assertPublicUrl("ftp://127.0.0.1/r", publicResolver, { allowPrivate: true }),
    ).rejects.toBeInstanceOf(ImportError);
  });
});

// ─────────────────────────────── the whole import ───────────────────────────────

const RECIPE_HTML = `<!doctype html><html><head><title>Best Chili | Food Blog</title>
<script type="application/ld+json">${JSON.stringify({
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "WebSite", name: "Food Blog" },
    {
      "@type": "Recipe",
      name: "Best Chili",
      author: { "@type": "Person", name: "Pat" },
      recipeYield: "6 servings",
      totalTime: "PT1H",
      recipeIngredient: [
        "2 tbsp olive oil",
        "1 onion, diced",
        "1 lb ground beef",
        "1 (15-oz) can kidney beans, drained",
      ],
      recipeInstructions: [
        {
          "@type": "HowToSection",
          name: "Chili",
          itemListElement: [
            { "@type": "HowToStep", text: "Brown the beef." },
            { "@type": "HowToStep", text: "Simmer everything for 45 minutes." },
          ],
        },
      ],
    },
  ],
})}</script></head><body><h1>Best Chili</h1></body></html>`;

const html = (body: string, headers: Record<string, string> = {}): FetchedPage => ({
  status: 200,
  headers: { "content-type": "text/html; charset=utf-8", ...headers },
  body,
});

/** A transport that serves fixed pages by URL and records what was requested. */
function fakeTransport(pages: Record<string, FetchedPage>): Transport & { requested: string[] } {
  const requested: string[] = [];
  const transport = (async (url: URL) => {
    requested.push(url.toString());
    const page = pages[url.toString()];
    if (!page) return { status: 404, headers: {}, body: "" };
    return page;
  }) as Transport & { requested: string[] };
  transport.requested = requested;
  return transport;
}

const deps = (transport: Transport, resolve: Resolver = publicResolver) => ({ transport, resolve });

describe("importRecipe", () => {
  it("imports a valid page: title, ingredients, directions, yield, time, author, source", async () => {
    const result = await importRecipe(
      "https://blog.example.com/chili",
      deps(fakeTransport({ "https://blog.example.com/chili": html(RECIPE_HTML) })),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.recipe).toMatchObject({
      title: "Best Chili",
      author: "Pat",
      servings: 6,
      total_minutes: 60,
      source_url: "https://blog.example.com/chili",
    });
    expect(result.recipe.steps).toEqual(["Brown the beef.", "Simmer everything for 45 minutes."]);
    expect(result.recipe.ingredients.map((i) => i.normalized_name)).toEqual([
      "olive oil",
      "onion",
      "ground beef",
      "kidney bean",
    ]);
    expect(result.recipe.ingredients[3]).toMatchObject({
      unit: "15-oz can",
      quantity: 1,
      grocery_section: "Pantry",
      preparation: "drained",
    });
  });

  it("falls back to a prefilled manual form when there is no JSON-LD", async () => {
    const page = html(
      "<html><head><title>Grandma's Stew</title></head><body>No structured data here.</body></html>",
    );
    const result = await importRecipe(
      "https://blog.example.com/stew",
      deps(fakeTransport({ "https://blog.example.com/stew": page })),
    );
    expect(result).toMatchObject({
      ok: false,
      reason: "no_recipe_data",
      prefill: { title: "Grandma's Stew", source_url: "https://blog.example.com/stew" },
    });
  });

  it("skips unusable JSON-LD blocks and uses the next", async () => {
    const page = html(
      `<script type="application/ld+json">{broken</script><script type="application/ld+json">{"@type":"Recipe","name":"Toast","recipeIngredient":["2 slices bread"],"recipeInstructions":["Toast it."]}</script>`,
    );
    const result = await importRecipe(
      "https://x.example/toast",
      deps(fakeTransport({ "https://x.example/toast": page })),
    );
    expect(result.ok && result.recipe.title).toBe("Toast");
  });

  it("does not import pages that ask not to be copied", async () => {
    for (const page of [
      html(`<meta name="robots" content="noindex">${RECIPE_HTML}`),
      html(RECIPE_HTML, { "x-robots-tag": "noai" }),
    ]) {
      const result = await importRecipe(
        "https://x.example/r",
        deps(fakeTransport({ "https://x.example/r": page })),
      );
      expect(result).toMatchObject({
        ok: false,
        reason: "robots",
        prefill: { source_url: "https://x.example/r" },
      });
    }
  });

  it("never makes a request for a bad or private URL", async () => {
    const transport = fakeTransport({});
    for (const url of [
      "",
      "javascript:alert(1)",
      "http://127.0.0.1/",
      "http://169.254.169.254/",
      "http://localhost:3000/",
    ]) {
      const result = await importRecipe(url, deps(transport));
      expect(result.ok).toBe(false);
    }
    expect(transport.requested).toEqual([]);
  });

  it("follows redirects but re-checks every hop", async () => {
    const good = fakeTransport({
      "https://short.example/r": { status: 301, headers: { location: "/recipes/chili" }, body: "" },
      "https://short.example/recipes/chili": html(RECIPE_HTML),
    });
    const ok = await importRecipe("https://short.example/r", deps(good));
    expect(ok).toMatchObject({ ok: true });
    if (ok.ok) expect(ok.recipe.source_url).toBe("https://short.example/recipes/chili");

    const toMetadata = fakeTransport({
      "https://short.example/r": {
        status: 302,
        headers: { location: "http://169.254.169.254/latest/meta-data/" },
        body: "",
      },
    });
    expect(await importRecipe("https://short.example/r", deps(toMetadata))).toMatchObject({
      ok: false,
      reason: "blocked_url",
    });
    expect(toMetadata.requested).toEqual(["https://short.example/r"]); // the metadata URL was never requested

    const toLoopbackName = fakeTransport({
      "https://short.example/r": {
        status: 302,
        headers: { location: "https://rebind.example/x" },
        body: "",
      },
    });
    const split: Resolver = async (host) =>
      host === "rebind.example" ? ["127.0.0.1"] : ["93.184.216.34"];
    expect(
      await importRecipe("https://short.example/r", deps(toLoopbackName, split)),
    ).toMatchObject({ ok: false, reason: "blocked_url" });
  });

  it("gives up after too many redirects", async () => {
    const loop = fakeTransport({
      "https://x.example/a": {
        status: 302,
        headers: { location: "https://x.example/b" },
        body: "",
      },
      "https://x.example/b": {
        status: 302,
        headers: { location: "https://x.example/c" },
        body: "",
      },
      "https://x.example/c": {
        status: 302,
        headers: { location: "https://x.example/d" },
        body: "",
      },
      "https://x.example/d": {
        status: 302,
        headers: { location: "https://x.example/e" },
        body: "",
      },
      "https://x.example/e": {
        status: 302,
        headers: { location: "https://x.example/a" },
        body: "",
      },
    });
    expect(await importRecipe("https://x.example/a", deps(loop))).toMatchObject({
      ok: false,
      reason: "fetch_failed",
    });
  });

  it("explains HTTP failures and non-web content", async () => {
    const pages = {
      "https://x.example/gone": { status: 404, headers: {}, body: "" },
      "https://x.example/blocked": { status: 403, headers: {}, body: "" },
      "https://x.example/pdf": {
        status: 200,
        headers: { "content-type": "application/pdf" },
        body: "%PDF",
      },
    };
    expect(await importRecipe("https://x.example/gone", deps(fakeTransport(pages)))).toMatchObject({
      ok: false,
      reason: "fetch_failed",
      message: expect.stringContaining("wasn't found"),
    });
    expect(
      await importRecipe("https://x.example/blocked", deps(fakeTransport(pages))),
    ).toMatchObject({ ok: false, reason: "fetch_failed" });
    expect(await importRecipe("https://x.example/pdf", deps(fakeTransport(pages)))).toMatchObject({
      ok: false,
      reason: "not_html",
    });
  });

  it("turns a transport error into a friendly failure", async () => {
    const boom: Transport = async () => {
      throw new ImportError("too_large", "That page is too large to import.");
    };
    expect(await importRecipe("https://x.example/big", deps(boom))).toMatchObject({
      ok: false,
      reason: "too_large",
    });
    const crash: Transport = async () => {
      throw new Error("socket hang up");
    };
    expect(await importRecipe("https://x.example/crash", deps(crash))).toMatchObject({
      ok: false,
      reason: "fetch_failed",
    });
  });
});

// ─────────────────────────────── the real transport ───────────────────────────────

describe("createNodeTransport (real HTTP)", () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === "/gzip") {
        res.writeHead(200, { "content-type": "text/html", "content-encoding": "gzip" });
        res.end(gzipSync("<html>zipped recipe</html>"));
      } else if (req.url === "/huge") {
        res.writeHead(200, { "content-type": "text/html" });
        res.end("x".repeat(5_000));
      } else if (req.url === "/bomb") {
        res.writeHead(200, { "content-type": "text/html", "content-encoding": "gzip" });
        res.end(gzipSync("y".repeat(200_000))); // tiny on the wire, huge decoded
      } else if (req.url === "/slow") {
        // never responds
      } else if (req.url === "/redirect") {
        res.writeHead(302, { location: "/gzip" });
        res.end();
      } else {
        res.writeHead(200, { "content-type": "text/html" });
        res.end(`<html>${req.headers["user-agent"]}</html>`);
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => {
    server.closeAllConnections();
    server.close();
  });

  it("fetches, decompresses and identifies itself", async () => {
    const transport = createNodeTransport();
    expect((await transport(new URL(`${base}/gzip`))).body).toBe("<html>zipped recipe</html>");
    expect((await transport(new URL(`${base}/ua`))).body).toContain("PinchedImport/1.0");
    const redirect = await transport(new URL(`${base}/redirect`));
    expect(redirect).toMatchObject({ status: 302, headers: { location: "/gzip" } });
  });

  it("caps the body, including after decompression", async () => {
    const small = createNodeTransport({ maxBytes: 1_000 });
    await expect(small(new URL(`${base}/huge`))).rejects.toMatchObject({ reason: "too_large" });
    await expect(small(new URL(`${base}/bomb`))).rejects.toMatchObject({ reason: "too_large" });
  });

  it("times out on a server that never answers", async () => {
    const impatient = createNodeTransport({ timeoutMs: 150 });
    await expect(impatient(new URL(`${base}/slow`))).rejects.toMatchObject({
      reason: "fetch_failed",
    });
  });

  it("refuses a hostname that resolves to loopback at connect time (DNS-rebinding defence)", async () => {
    // "localhost" passes no name-based check here — the transport itself must refuse to connect.
    const port = new URL(base).port;
    const error = await createNodeTransport()(new URL(`http://localhost:${port}/gzip`)).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ImportError);
    expect((error as ImportError).reason).toBe("blocked_url");
  });
});
