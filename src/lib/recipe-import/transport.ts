import "server-only";

import { lookup as dnsLookup, promises as dnsPromises, type LookupAddress } from "node:dns";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import { Readable } from "node:stream";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";

import { ImportError, type Resolver } from "./guard";
import { isPublicAddress } from "./ip";
import type { FetchedPage, Transport } from "./import";

export const USER_AGENT =
  "Mozilla/5.0 (compatible; PinchedImport/1.0; +https://pinched.app/import)";
export const FETCH_TIMEOUT_MS = 8_000;
export const MAX_BODY_BYTES = 2 * 1024 * 1024;

/** Resolves every A and AAAA record for a hostname. */
export const dnsResolver: Resolver = async (hostname) => {
  const records = await dnsPromises.lookup(hostname, { all: true, verbatim: true });
  return records.map((r) => r.address);
};

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address?: string | LookupAddress[],
  family?: number,
) => void;

/**
 * The connection-time check. Node calls this to turn a hostname into the address it will actually
 * connect to, so a DNS answer that flips to a private address after validation (DNS rebinding)
 * is still refused. It is the last line of defence; assertPublicUrl is the first.
 */
function safeLookup(
  hostname: string,
  options: { all?: boolean; family?: number },
  callback: LookupCallback,
): void {
  dnsLookup(hostname, { all: true, family: options.family, verbatim: true }, (error, addresses) => {
    if (error) return callback(error);
    const list = addresses as LookupAddress[];
    if (list.length === 0 || !list.every((a) => isPublicAddress(a.address))) {
      const blocked = new Error("blocked address") as NodeJS.ErrnoException;
      blocked.code = "PINCHED_BLOCKED";
      return callback(blocked);
    }
    if (options.all) return callback(null, list);
    callback(null, list[0]!.address, list[0]!.family);
  });
}

function decoderFor(encoding: string | undefined) {
  switch ((encoding ?? "").toLowerCase()) {
    case "gzip":
    case "x-gzip":
      return createGunzip();
    case "deflate":
      return createInflate();
    case "br":
      return createBrotliDecompress();
    default:
      return null;
  }
}

/** One GET with a timeout, a byte cap on the DECODED body, and the connect-time address check. */
export function createNodeTransport(
  limits: { timeoutMs?: number; maxBytes?: number } = {},
): Transport {
  const timeoutMs = limits.timeoutMs ?? FETCH_TIMEOUT_MS;
  const maxBytes = limits.maxBytes ?? MAX_BODY_BYTES;
  return (url) =>
    new Promise<FetchedPage>((resolve, reject) => {
      const lib = url.protocol === "https:" ? https : http;
      let settled = false;
      const done = (fn: () => void) => {
        if (!settled) {
          settled = true;
          fn();
        }
      };

      const request = lib.request(
        url,
        {
          method: "GET",
          headers: {
            "user-agent": USER_AGENT,
            accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
            "accept-encoding": "gzip, deflate, br",
            "accept-language": "en",
          },
          // Literal IPs skip DNS entirely and were already validated; hostnames go through safeLookup.
          lookup: isIP(url.hostname.replace(/^\[|\]$/g, "")) ? undefined : (safeLookup as never),
        },
        (response) => {
          const status = response.statusCode ?? 0;
          const headers: Record<string, string> = {};
          for (const [key, value] of Object.entries(response.headers)) {
            if (typeof value === "string") headers[key] = value;
            else if (Array.isArray(value)) headers[key] = value.join(", ");
          }

          if (status >= 300 && status < 400) {
            response.resume();
            return done(() => resolve({ status, headers, body: "" }));
          }

          const decoder = decoderFor(headers["content-encoding"]);
          const source: Readable = decoder ? response.pipe(decoder) : response;
          const chunks: Buffer[] = [];
          let size = 0;
          source.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > maxBytes) {
              request.destroy();
              done(() => reject(new ImportError("too_large", "That page is too large to import.")));
              return;
            }
            chunks.push(chunk);
          });
          source.on("end", () =>
            done(() => resolve({ status, headers, body: Buffer.concat(chunks).toString("utf8") })),
          );
          source.on("error", () =>
            done(() => reject(new ImportError("fetch_failed", "That page couldn't be read."))),
          );
        },
      );

      request.setTimeout(timeoutMs, () => {
        request.destroy();
        done(() =>
          reject(new ImportError("fetch_failed", "That website took too long to respond.")),
        );
      });
      request.on("error", (error: NodeJS.ErrnoException) => {
        done(() =>
          reject(
            error.code === "PINCHED_BLOCKED"
              ? new ImportError("blocked_url", "That address can't be imported.")
              : new ImportError("fetch_failed", "We couldn't reach that website."),
          ),
        );
      });
      request.end();
    });
}

export const nodeTransport: Transport = createNodeTransport();
