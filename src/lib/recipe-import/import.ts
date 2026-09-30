/**
 * Recipe import: fetch ONE page the user chose, read its schema.org Recipe JSON-LD, and return a
 * preview. Nothing is stored until the user confirms.
 */
import { ImportError, assertPublicUrl, type ImportFailureReason, type Resolver } from "./guard";
import { extractPageFacts, parseJsonLd, robotsForbid } from "./html";
import { findRecipeNode, mapRecipe, type ImportedRecipe } from "./schema";

export type FetchedPage = {
  status: number;
  headers: Record<string, string>;
  body: string;
};

/** One HTTP GET, no redirect following. The real implementation pins the connection to a public IP. */
export type Transport = (url: URL) => Promise<FetchedPage>;

export type ImportResult =
  | { ok: true; recipe: ImportedRecipe }
  | {
      ok: false;
      reason: ImportFailureReason;
      message: string;
      /** Everything we learned, so manual entry opens prefilled with the page title and URL. */
      prefill?: { title: string | null; source_url: string };
    };

export const MAX_REDIRECTS = 3;

export async function fetchWithRedirects(
  startUrl: URL,
  transport: Transport,
  resolve: Resolver,
  options: { allowPrivate?: boolean } = {},
): Promise<{ url: URL; page: FetchedPage }> {
  let url = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const page = await transport(url);
    if (page.status >= 300 && page.status < 400 && page.headers.location) {
      let next: URL;
      try {
        next = new URL(page.headers.location, url);
      } catch {
        throw new ImportError("fetch_failed", "That page redirected somewhere we couldn't follow.");
      }
      // Every hop gets the same checks as the first request.
      url = await assertPublicUrl(next.toString(), resolve, options);
      continue;
    }
    if (page.status === 403 || page.status === 401 || page.status === 429) {
      throw new ImportError("fetch_failed", "That website wouldn't let us read the page.");
    }
    if (page.status === 404 || page.status === 410) {
      throw new ImportError("fetch_failed", "That page wasn't found.");
    }
    if (page.status < 200 || page.status >= 300) {
      throw new ImportError("fetch_failed", "That website couldn't be reached.");
    }
    return { url, page };
  }
  throw new ImportError("fetch_failed", "That page redirected too many times.");
}

export async function importRecipe(
  rawUrl: string,
  deps: { transport: Transport; resolve: Resolver; allowPrivate?: boolean },
): Promise<ImportResult> {
  let startUrl: URL;
  try {
    startUrl = await assertPublicUrl(rawUrl, deps.resolve, { allowPrivate: deps.allowPrivate });
  } catch (error) {
    return failure(error, rawUrl, null);
  }

  let page: FetchedPage;
  let finalUrl: URL;
  try {
    ({ url: finalUrl, page } = await fetchWithRedirects(startUrl, deps.transport, deps.resolve, {
      allowPrivate: deps.allowPrivate,
    }));
  } catch (error) {
    return failure(error, startUrl.toString(), null);
  }

  const contentType = (page.headers["content-type"] ?? "").toLowerCase();
  if (contentType && !/(text\/html|application\/xhtml\+xml)/.test(contentType)) {
    return failure(
      new ImportError("not_html", "That link isn't a web page."),
      finalUrl.toString(),
      null,
    );
  }

  const facts = extractPageFacts(page.body);
  const title = facts.ogTitle ?? facts.title;
  const sourceUrl = finalUrl.toString();

  if (robotsForbid(facts.robots, page.headers["x-robots-tag"])) {
    return failure(
      new ImportError(
        "robots",
        "That page asks not to be copied, so Pinched won't import it. You can add it by hand instead.",
      ),
      sourceUrl,
      title,
    );
  }

  for (const block of facts.jsonLd) {
    const parsed = parseJsonLd(block);
    if (parsed === null) continue;
    const node = findRecipeNode(parsed);
    if (!node) continue;
    const recipe = mapRecipe(node, sourceUrl, title);
    if (recipe) return { ok: true, recipe };
  }

  return failure(
    new ImportError(
      "no_recipe_data",
      "We couldn't find recipe details on that page. You can add it by hand — we've filled in the title and link.",
    ),
    sourceUrl,
    title,
  );
}

function failure(error: unknown, sourceUrl: string, title: string | null): ImportResult {
  if (error instanceof ImportError) {
    return {
      ok: false,
      reason: error.reason,
      message: error.message,
      prefill:
        error.reason === "invalid_url" || error.reason === "blocked_url"
          ? undefined
          : { title, source_url: sourceUrl },
    };
  }
  return {
    ok: false,
    reason: "fetch_failed",
    message: "Something went wrong reading that page.",
    prefill: { title, source_url: sourceUrl },
  };
}
