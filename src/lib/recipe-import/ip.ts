/**
 * Is this address somewhere on the public internet? Used to keep recipe import from being turned
 * into a way to reach private networks, cloud metadata endpoints or the server itself (SSRF).
 *
 * Anything reserved, private, loopback, link-local, multicast, documentation, carrier-grade NAT,
 * or an IPv6 form that wraps such an IPv4 address (mapped, NAT64, 6to4) is rejected.
 */

function parseIPv4(ip: string): number[] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const bytes = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : Number.NaN));
  return bytes.every((b) => b >= 0 && b <= 255) ? bytes : null;
}

/** IPv6 → eight 16-bit groups, handling "::" compression and an embedded IPv4 tail. */
function parseIPv6(input: string): number[] | null {
  let ip = input.trim().replace(/^\[|\]$/g, "");
  const zone = ip.indexOf("%");
  if (zone >= 0) ip = ip.slice(0, zone);
  if (!ip.includes(":")) return null;

  const v4Tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (v4Tail) {
    const v4 = parseIPv4(v4Tail[1]!);
    if (!v4) return null;
    ip =
      ip.slice(0, -v4Tail[1]!.length) +
      ((v4[0]! << 8) | v4[1]!).toString(16) +
      ":" +
      ((v4[2]! << 8) | v4[3]!).toString(16);
  }

  const halves = ip.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 1) return null;

  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...tail].map(
    (g) => (/^[0-9a-f]{1,4}$/i.test(g) ? parseInt(g, 16) : Number.NaN),
  );
  return groups.length === 8 && groups.every((g) => g >= 0 && g <= 0xffff) ? groups : null;
}

/** [start, end] inclusive, as unsigned 32-bit integers. */
const V4_BLOCKED: [number, number][] = [
  ["0.0.0.0", "0.255.255.255"], // "this" network
  ["10.0.0.0", "10.255.255.255"], // private
  ["100.64.0.0", "100.127.255.255"], // carrier-grade NAT
  ["127.0.0.0", "127.255.255.255"], // loopback
  ["169.254.0.0", "169.254.255.255"], // link-local, incl. cloud metadata 169.254.169.254
  ["172.16.0.0", "172.31.255.255"], // private
  ["192.0.0.0", "192.0.0.255"], // IETF protocol assignments
  ["192.0.2.0", "192.0.2.255"], // documentation
  ["192.88.99.0", "192.88.99.255"], // 6to4 relay
  ["192.168.0.0", "192.168.255.255"], // private
  ["198.18.0.0", "198.19.255.255"], // benchmarking
  ["198.51.100.0", "198.51.100.255"], // documentation
  ["203.0.113.0", "203.0.113.255"], // documentation
  ["224.0.0.0", "255.255.255.255"], // multicast + reserved + broadcast
].map(([a, b]) => [toInt(a!), toInt(b!)] as [number, number]);

function toInt(ip: string): number {
  const [a, b, c, d] = parseIPv4(ip)!;
  return ((a! << 24) | (b! << 16) | (c! << 8) | d!) >>> 0;
}

function isPublicV4(bytes: number[]): boolean {
  const n = ((bytes[0]! << 24) | (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!) >>> 0;
  return !V4_BLOCKED.some(([start, end]) => n >= start && n <= end);
}

function isPublicV6(groups: number[]): boolean {
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const embedded = [g6 >> 8, g6 & 0xff, g7 >> 8, g7 & 0xff];

  if (groups.every((g) => g === 0)) return false; // ::
  if (groups.slice(0, 7).every((g) => g === 0) && g7 === 1) return false; // ::1
  // IPv4-mapped (::ffff:a.b.c.d) and deprecated IPv4-compatible (::a.b.c.d)
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && (g5 === 0xffff || g5 === 0))
    return isPublicV4(embedded);
  // NAT64 64:ff9b::/96
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0)
    return isPublicV4(embedded);
  // 6to4 2002::/16 embeds an IPv4 in groups 1–2
  if (g0 === 0x2002) return isPublicV4([g1 >> 8, g1 & 0xff, g2 >> 8, g2 & 0xff]);
  if ((g0 & 0xfe00) === 0xfc00) return false; // fc00::/7 unique local
  if ((g0 & 0xffc0) === 0xfe80) return false; // fe80::/10 link-local
  if ((g0 & 0xff00) === 0xff00) return false; // ff00::/8 multicast
  if (g0 === 0x2001 && g1 === 0x0db8) return false; // 2001:db8::/32 documentation
  if (g0 === 0x0100 && g1 === 0 && g2 === 0 && g3 === 0) return false; // 100::/64 discard
  if (g0 === 0x2001 && g1 === 0) return false; // 2001::/32 Teredo
  return true;
}

/** True only for an address on the public internet. Unparseable input is treated as NOT public. */
export function isPublicAddress(address: string): boolean {
  const v4 = parseIPv4(address);
  if (v4) return isPublicV4(v4);
  const v6 = parseIPv6(address);
  return v6 ? isPublicV6(v6) : false;
}
