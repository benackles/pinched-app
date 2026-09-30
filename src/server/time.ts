import "server-only";

/**
 * A client-supplied timestamp, clamped to "now". Last-write-wins uses the client's clock so an
 * offline edit replays in the right order, but a device with a wrong clock must not be able to
 * pin a row in the future and lock everyone else out.
 */
export const clampToNow = (at: number): string => new Date(Math.min(at, Date.now())).toISOString();
