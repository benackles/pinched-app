/**
 * Curated data for ingredient normalization and aisle classification.
 *
 * Normalization is deliberately CONSERVATIVE (PRD principle 5): words are dropped or merged only
 * when they never change what you would put in the cart. "yellow onion" and "onion" are one
 * product; "boneless chicken thigh" and "chicken thigh", "red onion" and "onion", and "unsalted
 * butter" and "butter" are not, so they stay separate rows and over-adding wins over a wrong guess.
 */
import type { GrocerySection } from "./constants";

/** Words that never change the product. */
export const DROP_WORDS = new Set([
  "fresh",
  "freshly",
  "large",
  "medium",
  "small",
  "big",
  "jumbo",
  "ripe",
  "organic",
  "good",
  "quality",
  "finely",
  "roughly",
  "coarsely",
  "thinly",
  "thickly",
  "packed",
  "heaping",
  "heaped",
  "scant",
  "level",
  "optional",
  "about",
  "approximately",
]);

/** Multi-word phrases removed before anything else. */
export const DROP_PHRASES: RegExp[] = [
  /\bextra[\s-]?virgin\b/g,
  /\bgood[\s-]quality\b/g,
  /\bhigh[\s-]quality\b/g,
  /\bfor (?:serving|garnish|garnishing|topping|dusting|frying|greasing)\b/g,
  /\bto taste\b/g,
  /\bas needed\b/g,
];

/** Singular nouns that end in "s" and must not be singularized further. */
const SINGULAR_EXCEPTIONS = new Set([
  "asparagus",
  "couscous",
  "hummus",
  "molasses",
  "swiss",
  "watercress",
  "grits",
  "brussels",
  "hibiscus",
  "octopus",
  "series",
  "species",
  "harissa",
  "gyoza",
  "bass",
  "swordfish",
  "lemongrass",
]);

const IRREGULAR: Record<string, string> = {
  leaves: "leaf",
  halves: "half",
  loaves: "loaf",
  knives: "knife",
  tomatoes: "tomato",
  potatoes: "potato",
  mangoes: "mango",
  avocados: "avocado",
  radishes: "radish",
  peaches: "peach",
  anchovies: "anchovy",
  berries: "berry",
  cherries: "cherry",
  chives: "chive",
  olives: "olive",
  cloves: "clove",
  limes: "lime",
  lemons: "lemon",
  cookies: "cookie",
  brownies: "brownie",
  dates: "date",
};

/** Singularizes the LAST word of a phrase (chicken thighs → chicken thigh). */
export function singularize(phrase: string): string {
  const words = phrase.split(" ");
  const last = words.pop() ?? "";
  words.push(singularWord(last));
  return words.join(" ");
}

function singularWord(word: string): string {
  if (word.length <= 3) return word;
  if (IRREGULAR[word]) return IRREGULAR[word]!;
  if (SINGULAR_EXCEPTIONS.has(word)) return word;
  if (/ies$/.test(word) && word.length > 4) return `${word.slice(0, -3)}y`;
  if (/(ches|shes|sses|xes|zes)$/.test(word)) return word.slice(0, -2);
  if (/oes$/.test(word)) return word.slice(0, -2);
  if (/(ss|us|is)$/.test(word)) return word;
  if (word.endsWith("s")) return word.slice(0, -1);
  return word;
}

/**
 * Whole-phrase synonyms, keyed by the SINGULAR phrase after descriptors are dropped.
 * Keep this short and curated — every entry is a judgement that two names are one product.
 */
export const SYNONYMS: Record<string, string> = {
  // alliums
  "green onion": "scallion",
  "spring onion": "scallion",
  "yellow onion": "onion",
  "brown onion": "onion",
  "garlic clove": "garlic",
  "clove of garlic": "garlic",
  "clove garlic": "garlic",
  // herbs & aromatics
  "coriander leaf": "cilantro",
  "fresh coriander": "cilantro",
  "cilantro leaf": "cilantro",
  "ginger root": "ginger",
  "flat leaf parsley": "parsley",
  "flat-leaf parsley": "parsley",
  "italian parsley": "parsley",
  // produce
  capsicum: "bell pepper",
  courgette: "zucchini",
  aubergine: "eggplant",
  rocket: "arugula",
  garbanzo: "chickpea",
  "garbanzo bean": "chickpea",
  // oils, vinegars, pantry
  evoo: "olive oil",
  "virgin olive oil": "olive oil",
  "bicarbonate of soda": "baking soda",
  bicarb: "baking soda",
  "all purpose flour": "flour",
  "all-purpose flour": "flour",
  "plain flour": "flour",
  "ap flour": "flour",
  "confectioner sugar": "powdered sugar",
  "confectioners sugar": "powdered sugar",
  "confectioners' sugar": "powdered sugar",
  "icing sugar": "powdered sugar",
  "granulated sugar": "sugar",
  "white sugar": "sugar",
  "caster sugar": "superfine sugar",
  "heavy whipping cream": "heavy cream",
  "whipping cream": "heavy cream",
  // spices
  "freshly ground black pepper": "black pepper",
  "ground black pepper": "black pepper",
  "cracked black pepper": "black pepper",
  pepper: "black pepper",
  "ground cumin": "cumin",
  "cumin powder": "cumin",
  "ground cinnamon": "cinnamon",
  "ground nutmeg": "nutmeg",
  "ground turmeric": "turmeric",
  "ground allspice": "allspice",
  "smoked paprika": "smoked paprika",
  // dairy
  "parmesan cheese": "parmesan",
  "parmigiano reggiano": "parmesan",
  "parmigiano-reggiano": "parmesan",
  "cheddar cheese": "cheddar",
  "mozzarella cheese": "mozzarella",
  "feta cheese": "feta",
  "plain greek yogurt": "greek yogurt",
  "plain yogurt": "yogurt",
  // stocks
  "chicken stock": "chicken broth",
  "vegetable stock": "vegetable broth",
  "beef stock": "beef broth",
  // grains
  "jasmine rice": "rice",
  "white rice": "rice",
  "long grain rice": "rice",
  "long-grain rice": "rice",
  "long grain white rice": "rice",
  "long-grain white rice": "rice",
  "panko breadcrumb": "breadcrumb",
  "panko bread crumb": "breadcrumb",
  "bread crumb": "breadcrumb",
  panko: "breadcrumb",
};

/** Things nobody buys. They stay on the list, pre-marked "already have" and easy to undo. */
export const ASSUMED_ON_HAND = new Set([
  "water",
  "tap water",
  "cold water",
  "warm water",
  "hot water",
  "boiling water",
  "ice water",
  "ice",
  "lukewarm water",
]);

/** Grains the prep planner batch-cooks, with minutes and whether the task is hands-off. */
export const GRAINS: Record<string, { minutes: number; largeMinutes: number }> = {
  rice: { minutes: 25, largeMinutes: 35 },
  quinoa: { minutes: 20, largeMinutes: 25 },
  farro: { minutes: 35, largeMinutes: 40 },
  couscous: { minutes: 10, largeMinutes: 12 },
  barley: { minutes: 40, largeMinutes: 45 },
  bulgur: { minutes: 15, largeMinutes: 18 },
};

/** Ordered rules: the first match wins, so exceptions sit above the general cases. */
const SECTION_RULES: [RegExp, GrocerySection][] = [
  // Frozen
  [/^frozen |\bice cream\b|\bgelato\b|\bsorbet\b|\bpuff pastry\b|\bpopsicle/, "Frozen"],

  // Bakery items that mention a meat or dairy word
  [/\b(hot dog|hamburger|burger|slider|sandwich|sausage) (buns?|rolls?)\b/, "Bakery"],

  // Pantry exceptions that would otherwise look like dairy / meat / produce
  [
    /\b(peanut|almond|cashew|sunflower|apple|cookie) butter\b|\bcream of tartar\b|\bcream of (mushroom|chicken|celery)\b/,
    "Pantry",
  ],
  [/\bcoconut (milk|cream|water)\b/, "Pantry"],
  [/\b(broth|stock|bouillon|consomme|consommé)\b/, "Pantry"],
  [
    /\b(canned|tinned|jarred|dried|dry|sun[- ]dried|pickled?|powdered|instant|powder|whole peeled|split peas?)\b/,
    "Pantry",
  ],
  [/\b(tuna|anchov\w*|sardines?|capers?|olives?)\b/, "Pantry"],
  [/\b(breadcrumbs?|crackers?|croutons?|chips?|pretzels?|popcorn)\b/, "Pantry"],
  [
    /\b(black|white|cayenne|ground|crushed red) pepper\b|\bpepper ?flakes?\b|\bpeppercorns?\b/,
    "Pantry",
  ],
  [
    /\b(paste|puree|purée|salsa|ketchup|mustard|mayonnaise|mayo|relish|jam|jelly|syrup|molasses|tahini|miso|pesto|hummus)\b/,
    "Pantry",
  ],
  [
    /\bsauce\b|\bsoy\b|\bvinegar\b|\bextract\b|\bworcestershire\b|\bmirin\b|\bsake\b|\bwine\b|\bbeer\b/,
    "Pantry",
  ],
  [
    /\b(flour|sugar|salt|cornstarch|cornmeal|baking (powder|soda)|yeast|gelatin|cocoa|chocolate|vanilla)\b/,
    "Pantry",
  ],

  // Meat & seafood
  [
    /\bground (beef|turkey|pork|chicken|lamb|veal|meat|sausage|bison)\b|\b(chicken|turkey|beef|pork|lamb|veal|bison|duck|goose|venison|bacon|sausage|ham|prosciutto|pancetta|steak|brisket|chorizo|salami|pepperoni|kielbasa|bratwurst|hot dog|meatball|ribs?|drumsticks?|wings?|thighs?|breasts?|tenderloin|loin|chops?|roast|salmon|cod|tilapia|halibut|trout|haddock|snapper|bass|mahi|swordfish|shrimp|prawns?|crab|lobster|scallops?|clams?|mussels?|oysters?|squid|calamari|fish|seafood)\b/,
    "Meat & Seafood",
  ],

  // Dairy & eggs
  [
    /\b(milk|buttermilk|butter|ghee|cream|half[- ]and[- ]half|creme fraiche|crème fraîche|yogurt|yoghurt|kefir|cheese|cheddar|parmesan|mozzarella|feta|gouda|brie|ricotta|mascarpone|gruyere|gruyère|provolone|swiss|queso|paneer|halloumi|cotija|romano|pecorino|havarti|gorgonzola|asiago|fontina|burrata|egg|eggs|egg whites?|egg yolks?)\b/,
    "Dairy & Eggs",
  ],

  // Bakery
  [
    /\b(bread|buns?|rolls?|bagels?|baguettes?|pitas?|naan|tortillas?|wraps?|croissants?|english muffins?|ciabatta|focaccia|sourdough|brioche|flatbread|lavash)\b/,
    "Bakery",
  ],

  // Produce
  [
    /\b(onion|scallion|shallot|leek|chive|garlic|ginger|tomato|tomatillo|lemon|lime|orange|grapefruit|tangerine|clementine|apple|banana|pear|peach|plum|nectarine|apricot|cherry|cherries|berry|berries|strawberr\w*|blueberr\w*|raspberr\w*|blackberr\w*|grapes?|mango|pineapple|melon|watermelon|cantaloupe|kiwi|papaya|pomegranate|fig|avocado|potato|yam|carrot|celery|cucumber|zucchini|squash|pumpkin|eggplant|bell pepper|jalapeno|jalapeño|poblano|serrano|habanero|chile|chili|broccoli|broccolini|cauliflower|cabbage|lettuce|romaine|spinach|kale|chard|arugula|radicchio|endive|watercress|basil|cilantro|parsley|dill|mint|thyme|rosemary|sage|oregano|tarragon|mushrooms?|corn|peas?|green beans?|asparagus|brussels sprouts?|beets?|radish\w*|turnip|parsnip|fennel|bok choy|napa|jicama|kohlrabi|artichokes?|okra|sprouts?|microgreens?|salad|herbs?|lemongrass|plantain|rutabaga|celeriac|daikon)\b/,
    "Produce",
  ],

  // Pantry staples (positive list so genuinely unknown things land in Other)
  [
    /\b(oil|rice|pasta|spaghetti|penne|macaroni|fusilli|linguine|fettuccine|rigatoni|orzo|lasagna|noodles?|vermicelli|ramen|udon|soba|couscous|quinoa|farro|barley|bulgur|oats?|oatmeal|granola|cereal|beans?|chickpeas?|lentils?|split peas?|tofu|tempeh|nuts?|almonds?|walnuts?|pecans?|cashews?|peanuts?|pistachios?|hazelnuts?|seeds?|sesame|chia|flax|raisins?|cranberr\w*|dates?|coconut|honey|maple|agave|cumin|paprika|turmeric|cinnamon|nutmeg|cloves?|cardamom|coriander|allspice|oregano|thyme|bay leaf|bay leaves|cayenne|chili powder|curry|garam masala|za'?atar|seasoning|spice|pepper|stuffing|panko|tortilla chips|cornflakes|graham|marshmallows?|sprinkles|shortening|lard|cooking spray|gravy)\b/,
    "Pantry",
  ],
];

/** Which aisle an ingredient lives in. Falls back to "Other" rather than guessing. */
export function classifySection(normalizedName: string): GrocerySection {
  const text = normalizedName.toLowerCase();
  for (const [pattern, section] of SECTION_RULES) {
    if (pattern.test(text)) return section;
  }
  return "Other";
}
