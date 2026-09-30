/**
 * Browser-only helpers for adding photos and video. Not imported by server code.
 */
import { PHOTO_MAX_EDGE, fitWithin } from "./upload";

/** Anything bigger than this isn't worth decoding just to shrink it. */
export const MAX_PHOTO_INPUT_BYTES = 80 * 1024 * 1024;

/**
 * Shrinks a photo to a sensible size and re-encodes it as an upright JPEG. That keeps uploads fast,
 * and it drops embedded metadata — including GPS location — before the picture leaves the device.
 * If the browser can't decode the file, the original is returned and the server's checks decide.
 */
export async function preparePhoto(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return file;
  }
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height, PHOTO_MAX_EDGE);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return file;
    // JPEG has no transparency: put transparent PNGs on white rather than black.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.86),
    );
    if (!blob) return file;
    return new File([blob], `${file.name.replace(/\.[^.]+$/, "") || "photo"}.jpg`, {
      type: "image/jpeg",
    });
  } finally {
    bitmap.close();
  }
}

export type Ticket = {
  url: string;
  headers: Record<string, string>;
  encoding: "form" | "raw";
  fields?: Record<string, string> | undefined;
};

export class UploadError extends Error {}

function describe(status: number): string {
  if (status === 413) return "That file is too large.";
  if (status === 401 || status === 403) return "The upload link expired. Please try again.";
  if (status === 415) return "That file type isn't supported.";
  if (status === 409) return "That file was already uploaded.";
  return "The upload didn't go through. Please try again.";
}

/** PUT the file to its upload link, reporting progress (0–1). Rejects with an AbortError if cancelled. */
export function putFile(
  ticket: Ticket,
  file: File,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Cancelled", "AbortError"));
      return;
    }
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", ticket.url);
    for (const [name, value] of Object.entries(ticket.headers)) xhr.setRequestHeader(name, value);

    let body: Blob | FormData = file;
    if (ticket.encoding === "form") {
      const form = new FormData();
      for (const [name, value] of Object.entries(ticket.fields ?? {})) form.append(name, value);
      form.append("", file);
      body = form;
    }

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(1);
        resolve();
      } else reject(new UploadError(describe(xhr.status)));
    };
    xhr.onerror = () =>
      reject(new UploadError("You seem to be offline. Try again when you're back."));
    xhr.onabort = () => reject(new DOMException("Cancelled", "AbortError"));
    signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(body);
  });
}
