import { describe, expect, it } from "vitest";

import {
  MAX_PHOTO_BYTES,
  MAX_VIDEO_BYTES,
  contentTypeForExt,
  fitWithin,
  mediaPath,
  parseMediaPath,
  validateUpload,
} from "./upload";

const user = "user_2abcDEF123";
const recipe = "3f2a9c1e-5b7d-4e8a-9c6b-1a2b3c4d5e6f";
const file = "9d8c7b6a-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

describe("validateUpload", () => {
  it("accepts photos and videos by type and reports the kind", () => {
    expect(validateUpload({ contentType: "image/jpeg", size: 1000 })).toMatchObject({
      ok: true,
      kind: "photo",
      ext: "jpg",
    });
    expect(validateUpload({ contentType: "video/quicktime", size: 1000 })).toMatchObject({
      ok: true,
      kind: "video",
      ext: "mov",
    });
  });

  it("ignores case and parameters in the content type", () => {
    expect(validateUpload({ contentType: "Image/PNG; foo=bar", size: 5 })).toMatchObject({
      ok: true,
      ext: "png",
    });
  });

  it("rejects everything else, including look-alikes and prototype keys", () => {
    for (const contentType of [
      "image/svg+xml", // scriptable
      "text/html",
      "application/pdf",
      "image/gif",
      "image/heic", // browsers can't show it; iPhones convert to JPEG for the picker
      "",
      "constructor",
      "__proto__",
      "toString",
    ]) {
      const result = validateUpload({ contentType, size: 10 });
      expect(result.ok, contentType).toBe(false);
    }
  });

  it("enforces size limits per kind", () => {
    expect(validateUpload({ contentType: "image/jpeg", size: MAX_PHOTO_BYTES }).ok).toBe(true);
    const bigPhoto = validateUpload({ contentType: "image/jpeg", size: MAX_PHOTO_BYTES + 1 });
    expect(bigPhoto).toEqual({ ok: false, message: "Photos can be up to 15 MB." });
    expect(validateUpload({ contentType: "video/mp4", size: MAX_VIDEO_BYTES }).ok).toBe(true);
    const bigVideo = validateUpload({ contentType: "video/mp4", size: MAX_VIDEO_BYTES + 1 });
    expect(bigVideo.ok).toBe(false);
    // a photo-sized limit must not apply to video
    expect(validateUpload({ contentType: "video/mp4", size: MAX_PHOTO_BYTES + 1 }).ok).toBe(true);
  });

  it("rejects empty and non-finite sizes", () => {
    for (const size of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(validateUpload({ contentType: "image/jpeg", size }).ok).toBe(false);
    }
  });
});

describe("media paths", () => {
  it("round-trips", () => {
    const path = mediaPath(user, recipe, file, "webp");
    expect(path).toBe(`${user}/${recipe}/${file}.webp`);
    expect(parseMediaPath(path)).toEqual({
      userId: user,
      recipeId: recipe,
      fileId: file,
      ext: "webp",
      contentType: "image/webp",
      kind: "photo",
    });
    expect(parseMediaPath(mediaPath(user, recipe, file, "mp4"))?.kind).toBe("video");
  });

  it("rejects traversal, extra segments, odd extensions and bad ids", () => {
    const bad = [
      `${user}/../${recipe}/${file}.jpg`,
      `../${user}/${recipe}/${file}.jpg`,
      `${user}/${recipe}/${file}.jpg/extra`,
      `${user}/${recipe}/${file}.jpeg`,
      `${user}/${recipe}/${file}.svg`,
      `${user}/${recipe}/${file}`,
      `${user}/${recipe}/not-a-uuid.jpg`,
      `${user}/not-a-uuid/${file}.jpg`,
      `/${recipe}/${file}.jpg`,
      `user id/${recipe}/${file}.jpg`,
      `${user}\\${recipe}\\${file}.jpg`,
      `${user}/${recipe}/${file}.jpg\n`,
      `${user}/${recipe.toUpperCase()}/${file}.jpg`,
      "",
    ];
    for (const path of bad) expect(parseMediaPath(path), JSON.stringify(path)).toBeNull();
  });

  it("maps extensions back to content types", () => {
    expect(contentTypeForExt("mov")).toBe("video/quicktime");
    expect(contentTypeForExt("jpg")).toBe("image/jpeg");
    expect(contentTypeForExt("exe")).toBeNull();
    expect(contentTypeForExt("constructor")).toBeNull();
  });
});

describe("fitWithin", () => {
  it("shrinks the longest edge and keeps the aspect ratio", () => {
    expect(fitWithin(4000, 3000, 2048)).toEqual({ width: 2048, height: 1536 });
    expect(fitWithin(3000, 4000, 2048)).toEqual({ width: 1536, height: 2048 });
  });
  it("never enlarges", () => {
    expect(fitWithin(800, 600, 2048)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(2048, 100, 2048)).toEqual({ width: 2048, height: 100 });
  });
  it("never collapses to zero", () => {
    expect(fitWithin(100000, 1, 2048).height).toBe(1);
  });
});
