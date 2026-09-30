/**
 * Photos and video on a recipe: a big phone photo is shrunk (and its embedded location stripped)
 * before it leaves the device, the free plan allows one per recipe, Pro allows more, video plays,
 * odd files are refused, and removing a photo really deletes it.
 */
import sharp from "sharp";

import { RECIPES, saveCatalogRecipe, signIn, watchForErrors } from "./support/app";
import { expect, test } from "./support/test";

/** A 4000×3000 JPEG that carries metadata, like a real phone photo. */
async function phonePhoto() {
  return sharp({
    create: { width: 4000, height: 3000, channels: 3, background: { r: 200, g: 90, b: 60 } },
  })
    .withExif({ IFD0: { Copyright: "SECRET-COPYRIGHT", Artist: "Walker" } })
    .jpeg({ quality: 90 })
    .toBuffer();
}

const transparentPng = () =>
  sharp({
    create: { width: 300, height: 300, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .png()
    .toBuffer();

test("photos and video: shrunk, private, limited on Free, removable", async ({ page }) => {
  test.setTimeout(180_000);
  const errors = watchForErrors(page);
  await signIn(page, "media");
  await saveCatalogRecipe(page, RECIPES.bowls);

  await page.goto("/recipes");
  await page
    .getByRole("link", { name: new RegExp(RECIPES.bowls) })
    .first()
    .click();
  await page.waitForURL(/\/recipes\/[0-9a-f-]{36}$/);
  const recipeUrl = page.url();
  await page.getByRole("tab", { name: /^Photos/ }).click();

  await test.step("a recipe that isn't in the book has no Photos tab", async () => {
    await page.goto("/recipes?tab=discover");
    await page
      .getByRole("link", { name: new RegExp(RECIPES.patties) })
      .first()
      .click();
    await page.waitForURL(/\/recipes\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("tab", { name: /^Photos/ })).toHaveCount(0);
    await page.goto(recipeUrl);
    await page.getByRole("tab", { name: /^Photos/ }).click();
  });

  let photoUrl = "";
  await test.step("a 4000×3000 photo is shrunk and stripped of metadata before upload", async () => {
    await page.locator("input[type=file]").setInputFiles({
      name: "IMG_0001.jpg",
      mimeType: "image/jpeg",
      buffer: await phonePhoto(),
    });
    await expect(page.getByText("Photo added").first()).toBeVisible({ timeout: 30_000 });
    const image = page.getByRole("img", { name: new RegExp(`Your photo 1 of ${RECIPES.bowls}`) });
    await expect(image).toBeVisible();
    photoUrl = (await image.getAttribute("src"))!;

    // What was stored, not what the page shows: fetch the file and look inside it.
    const stored = await page.request.get(photoUrl);
    expect(stored.status()).toBe(200);
    const meta = await sharp(await stored.body()).metadata();
    expect(meta.format).toBe("jpeg");
    expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(2048);
    expect(meta.exif).toBeUndefined(); // the copyright/artist tags never left the device
  });

  await test.step("Free allows one per recipe", async () => {
    await expect(
      page.getByText("Free accounts can add one photo or video per recipe."),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Add photo or video" })).toBeDisabled();
  });

  await test.step("Pro adds more: a transparent PNG and a real video", async () => {
    await page.goto("/settings");
    await page.getByRole("button", { name: "Try Pro locally (demo)" }).click();
    await expect(page.getByText("Pro is on (demo)").first()).toBeVisible();
    await page.goto(recipeUrl);
    await page.getByRole("tab", { name: /^Photos/ }).click();
    await expect(page.getByRole("button", { name: "Add photo or video" })).toBeEnabled();

    await page.locator("input[type=file]").setInputFiles({
      name: "logo.png",
      mimeType: "image/png",
      buffer: await transparentPng(),
    });
    await expect(page.getByText("Photo added").first()).toBeVisible({ timeout: 30_000 });

    // A genuine WebM, recorded by the browser itself.
    const video = await page.evaluate(async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 160;
      canvas.height = 120;
      const context = canvas.getContext("2d")!;
      const recorder = new MediaRecorder(canvas.captureStream(15), { mimeType: "video/webm" });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => chunks.push(event.data);
      const stopped = new Promise((resolve) => (recorder.onstop = resolve));
      recorder.start();
      for (let i = 0; i < 12; i++) {
        context.fillStyle = `hsl(${i * 30} 80% 50%)`;
        context.fillRect(0, 0, 160, 120);
        await new Promise((resolve) => setTimeout(resolve, 80));
      }
      recorder.stop();
      await stopped;
      const bytes = new Uint8Array(await new Blob(chunks, { type: "video/webm" }).arrayBuffer());
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return btoa(binary);
    });
    await page.locator("input[type=file]").setInputFiles({
      name: "clip.webm",
      mimeType: "video/webm",
      buffer: Buffer.from(video, "base64"),
    });
    await expect(page.getByText("Video added").first()).toBeVisible({ timeout: 30_000 });

    const player = page.getByLabel(new RegExp(`Your video 3 of ${RECIPES.bowls}`));
    await expect(player).toBeVisible();
    await expect
      .poll(() => player.evaluate((element: HTMLVideoElement) => element.videoWidth), {
        timeout: 15_000,
      })
      .toBe(160);
    await expect(page.getByRole("tab", { name: "Photos (3)" })).toBeVisible();
  });

  await test.step("files that aren't photos or video are refused, and nothing is stored", async () => {
    await page.locator("input[type=file]").setInputFiles({
      name: "page.html",
      mimeType: "text/html",
      buffer: Buffer.from("<script>alert(1)</script>"),
    });
    await expect(page.getByText("That file type isn't supported.").first()).toBeVisible();
    await expect(page.getByRole("tab", { name: "Photos (3)" })).toBeVisible();
  });

  await test.step("removing a photo deletes the file, not just the tile", async () => {
    await page.getByRole("button", { name: "Remove photo 1" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Remove" }).click();
    await expect(page.getByRole("tab", { name: "Photos (2)" })).toBeVisible();
    // The old link, still unexpired, now leads nowhere.
    expect((await page.request.get(photoUrl)).status()).toBe(404);
  });

  expect(errors).toEqual([]);
});
