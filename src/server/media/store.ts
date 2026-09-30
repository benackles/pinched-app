import "server-only";

import { isLocalMode } from "@/lib/auth/config";
import { MEDIA_BUCKET } from "@/lib/media/upload";
import type { Supabase } from "@/server/supabase";

import { localMediaStore } from "./local-store";

/**
 * What the browser needs to send one file: a URL, the headers that go with it, and how the file
 * is carried — "form" is multipart (the `fields`, then the file under an empty name — how Supabase
 * Storage's signed uploads work), "raw" puts the file itself in the body.
 */
export type UploadTicket = {
  method: "PUT";
  url: string;
  headers: Record<string, string>;
  encoding: "form" | "raw";
  fields?: Record<string, string>;
};

export type StoredObject = { size: number; contentType: string };

/**
 * Where photos and video live. Production is Supabase Storage (private bucket, per-user folders,
 * signed URLs); local mode keeps files on disk so the whole flow works without credentials.
 *
 * Every method acts as the signed-in user and is bounded by Storage RLS — a person can only
 * create, read or remove objects under their own folder.
 */
export interface MediaStore {
  /** A short-lived URL for the browser to PUT one new file to. */
  createUpload(path: string, contentType: string): Promise<UploadTicket>;
  /** What actually landed at `path`, or null when nothing did. */
  info(path: string): Promise<StoredObject | null>;
  /** Short-lived read URLs. Paths that can't be signed are simply absent from the map. */
  sign(paths: string[], expiresInSeconds?: number): Promise<Map<string, string>>;
  remove(paths: string[]): Promise<void>;
}

export class MediaStoreError extends Error {}

/** Objects are named by a random id, so they never change: cache them for a year (Storage takes seconds). */
const OBJECT_CACHE_CONTROL = "31536000";

export function supabaseMediaStore(db: Supabase): MediaStore {
  const bucket = () => db.storage.from(MEDIA_BUCKET);
  return {
    async createUpload(path) {
      const { data, error } = await bucket().createSignedUploadUrl(path);
      if (error || !data) throw new MediaStoreError("Couldn't start the upload.");
      return {
        method: "PUT",
        url: data.signedUrl,
        // The file's own type travels on its multipart part; the bucket checks it against its allowlist.
        headers: { "x-upsert": "false" },
        encoding: "form",
        fields: { cacheControl: OBJECT_CACHE_CONTROL },
      };
    },

    async info(path) {
      const { data, error } = await bucket().info(path);
      if (error || !data || typeof data.size !== "number" || !data.contentType) return null;
      return { size: data.size, contentType: data.contentType };
    },

    async sign(paths, expiresInSeconds = 3600) {
      const signed = new Map<string, string>();
      if (paths.length === 0) return signed;
      const { data, error } = await bucket().createSignedUrls(paths, expiresInSeconds);
      if (error || !data) return signed;
      for (const item of data)
        if (item.path && item.signedUrl) signed.set(item.path, item.signedUrl);
      return signed;
    },

    async remove(paths) {
      if (paths.length === 0) return;
      const { error } = await bucket().remove(paths);
      if (error) throw new MediaStoreError("Couldn't remove the file.");
    },
  };
}

export function mediaStore(db: Supabase): MediaStore {
  return isLocalMode() ? localMediaStore() : supabaseMediaStore(db);
}
