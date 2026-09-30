/**
 * Generates a VAPID key pair for Web Push (no dependencies).
 *
 *   pnpm vapid:keys
 *
 * The PUBLIC key goes in NEXT_PUBLIC_VAPID_PUBLIC_KEY (the app) and VAPID_PUBLIC_KEY (the Edge
 * Function secret); the PRIVATE key is only ever a Supabase function secret (VAPID_PRIVATE_KEY).
 */
import { generateKeyPairSync } from "node:crypto";

const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const pub = publicKey.export({ format: "jwk" });
const priv = privateKey.export({ format: "jwk" });

if (!pub.x || !pub.y || !priv.d) throw new Error("Could not export the key pair.");

// The public key is the uncompressed EC point: 0x04 || X || Y, base64url. The private key is D.
const point = Buffer.concat([
  Buffer.from([4]),
  Buffer.from(pub.x, "base64url"),
  Buffer.from(pub.y, "base64url"),
]);

console.log(`VAPID_PUBLIC_KEY=${point.toString("base64url")}`);
console.log(`VAPID_PRIVATE_KEY=${priv.d}`);
console.log(
  "\nKeep the private key secret. Rotating the pair signs every device out of reminders.",
);
