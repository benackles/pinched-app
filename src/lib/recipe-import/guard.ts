import { isIP } from "node:net";

import { isPublicAddress } from "./ip";

export type ImportFailureReason =
  | "invalid_url"
  | "blocked_url"
  | "fetch_failed"
  | "not_html"
  | "too_large"
  | "robots"
  | "no_recipe_data"
  | "rate_limited";

export class ImportError extends Error {
  constructor(
    public readonly reason: ImportFailureReason,
    message: string,
  ) {
    super(message);
    this.name = "ImportError";
  }
}

/** Resolves a hostname to every address it points at. Injected so tests never touch DNS. */
export type Resolver = (hostname: string) => Promise<string[]>;

const BLOCKED_HOSTNAMES =
  /^(localhost|.*\.localhost|.*\.local|.*\.internal|.*\.lan|.*\.home|metadata\.google\.internal)$/i;
const ALLOWED_PORTS = new Set(["", "80", "443"]);

/**
 * Validates a URL BEFORE any request is made: http(s) only, no credentials, default ports only,
 * no internal hostnames, and every address the name resolves to must be public. The fetcher
 * checks again at connect time, so a DNS answer that changes in between cannot slip through.
 */
export async function assertPublicUrl(
  raw: string,
  resolve: Resolver,
  options: { allowPrivate?: boolean } = {},
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new ImportError("invalid_url", "That doesn't look like a web address.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ImportError("invalid_url", "Only web pages (http or https) can be imported.");
  }
  if (url.username || url.password) {
    throw new ImportError(
      "invalid_url",
      "Addresses with a username or password can't be imported.",
    );
  }
  if (options.allowPrivate) return url; // local-mode fixtures only; never reachable in production

  if (!ALLOWED_PORTS.has(url.port)) {
    throw new ImportError("blocked_url", "That address can't be imported.");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (BLOCKED_HOSTNAMES.test(host))
    throw new ImportError("blocked_url", "That address can't be imported.");

  if (isIP(host)) {
    if (!isPublicAddress(host))
      throw new ImportError("blocked_url", "That address can't be imported.");
    return url;
  }

  let addresses: string[];
  try {
    addresses = await resolve(host);
  } catch {
    throw new ImportError("fetch_failed", "We couldn't find that website.");
  }
  if (addresses.length === 0)
    throw new ImportError("fetch_failed", "We couldn't find that website.");
  if (!addresses.every(isPublicAddress))
    throw new ImportError("blocked_url", "That address can't be imported.");
  return url;
}
