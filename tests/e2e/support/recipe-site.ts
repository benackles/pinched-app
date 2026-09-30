import http from "node:http";
import type { AddressInfo } from "node:net";

/**
 * A tiny recipe website for the URL-import tests: one page with schema.org Recipe JSON-LD, like
 * most food blogs. The headnote is a marker the app must never copy.
 */
export const HEADNOTE = "NEVER COPY THIS HEADNOTE";

const html = `<!doctype html><html><head><title>Best Lentil Soup</title>
<script type="application/ld+json">${JSON.stringify({
  "@context": "https://schema.org",
  "@type": "Recipe",
  name: "Best Lentil Soup",
  author: { "@type": "Person", name: "Sam Cook" },
  description: HEADNOTE,
  recipeYield: "4 servings",
  prepTime: "PT10M",
  cookTime: "PT30M",
  recipeIngredient: [
    "1 tbsp olive oil",
    "1 yellow onion, diced",
    "2 cloves garlic, minced",
    "1 cup red lentils",
    "4 cups vegetable broth",
    "1 tsp cumin",
  ],
  recipeInstructions: [
    { "@type": "HowToStep", text: "Soften the onion in the oil." },
    { "@type": "HowToStep", text: "Add everything else and simmer 25 minutes." },
  ],
})}</script></head><body><h1>Best Lentil Soup</h1></body></html>`;

export async function startRecipeSite(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((_request, response) => {
    response.setHeader("content-type", "text/html");
    response.end(html);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/lentil-soup`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
