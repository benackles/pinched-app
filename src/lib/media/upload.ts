/**
 * Rules for user photos and video: what is accepted, how big, and where it lives.
 * Shared by the browser (fail fast), the Server Actions (the real check) and the storage layer.
 */
import type { MediaKind } from "@/lib/domain/constants";

export const MEDIA_BUCKET = "recipe-media";

const MB = 1024 * 1024;
/** Photos are downscaled in the browser first; this is the most we will take as-is. */
export const MAX_PHOTO_BYTES = 15 * MB;
/** Matches the smallest Supabase Storage upload limit (free projects: 50 MB). */
export const MAX_VIDEO_BYTES = 50 * MB;
/** Longest edge of a photo after the browser downscales it. */
export const PHOTO_MAX_EDGE = 2048;

const TYPES = {
  "image/jpeg": { kind: "photo", ext: "jpg" },
  "image/png": { kind: "photo", ext: "png" },
  "image/webp": { kind: "photo", ext: "webp" },
  "video/mp4": { kind: "video", ext: "mp4" },
  "video/quicktime": { kind: "video", ext: "mov" },
  "video/webm": { kind: "video", ext: "webm" },
} as const satisfies Record<string, { kind: MediaKind; ext: string }>;

export type MediaContentType = keyof typeof TYPES;
export type MediaExt = (typeof TYPES)[MediaContentType]["ext"];

export const ACCEPTED_CONTENT_TYPES = Object.keys(TYPES) as MediaContentType[];
/** The `accept` attribute for the file picker. */
export const FILE_ACCEPT = ACCEPTED_CONTENT_TYPES.join(",");

const BY_EXT = Object.fromEntries(
  Object.entries(TYPES).map(([contentType, { ext }]) => [ext, contentType]),
) as Record<MediaExt, MediaContentType>;

export function contentTypeForExt(ext: string): MediaContentType | null {
  return Object.hasOwn(BY_EXT, ext) ? BY_EXT[ext as MediaExt] : null;
}

// HEIC is left out on purpose: most browsers can't show it. iPhones convert photos to JPEG when a
// file picker asks for JPEG, so nobody needs it.
const UNSUPPORTED =
  "That file type isn't supported. Use a JPG, PNG or WebP photo, or an MP4, MOV or WebM video.";

export type UploadCheck =
  | { ok: true; kind: MediaKind; ext: MediaExt; contentType: MediaContentType }
  | { ok: false; message: string };

/** Accept or reject a file by its declared type and size. Parameters are parsed, never trusted. */
export function validateUpload(file: { contentType: string; size: number }): UploadCheck {
  // "image/jpeg; charset=…" → "image/jpeg"
  const contentType = file.contentType.split(";")[0]!.trim().toLowerCase();
  if (!Object.hasOwn(TYPES, contentType)) return { ok: false, message: UNSUPPORTED };
  const { kind, ext } = TYPES[contentType as MediaContentType];

  if (!Number.isFinite(file.size) || file.size <= 0) {
    return { ok: false, message: "That file looks empty." };
  }
  if (kind === "photo" && file.size > MAX_PHOTO_BYTES) {
    return { ok: false, message: "Photos can be up to 15 MB." };
  }
  if (kind === "video" && file.size > MAX_VIDEO_BYTES) {
    return { ok: false, message: "Videos can be up to 50 MB — trim it first, then try again." };
  }
  return { ok: true, kind, ext, contentType: contentType as MediaContentType };
}

// ─────────────────────────────── object paths ───────────────────────────────

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const EXTS = Object.values(TYPES)
  .map((t) => t.ext)
  .join("|");
const PATH = new RegExp(`^([A-Za-z0-9_-]{1,64})/(${UUID})/(${UUID})\\.(${EXTS})$`);

/** `<user id>/<recipe id>/<file id>.<ext>` — the first segment is what Storage policies check. */
export function mediaPath(userId: string, recipeId: string, fileId: string, ext: MediaExt): string {
  return `${userId}/${recipeId}/${fileId}.${ext}`;
}

export type ParsedMediaPath = {
  userId: string;
  recipeId: string;
  fileId: string;
  ext: MediaExt;
  contentType: MediaContentType;
  kind: MediaKind;
};

/** Strict parse: anything that isn't exactly our path shape (including `..` tricks) is null. */
export function parseMediaPath(path: string): ParsedMediaPath | null {
  const match = PATH.exec(path);
  if (!match) return null;
  const [, userId, recipeId, fileId, ext] = match as unknown as [
    string,
    string,
    string,
    string,
    MediaExt,
  ];
  const contentType = BY_EXT[ext];
  return { userId, recipeId, fileId, ext, contentType, kind: TYPES[contentType].kind };
}

/** Where a longest-edge limit puts a picture, never enlarging it. */
export function fitWithin(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
