// Zutaten zerlegen, kategorisieren, zusammenrechnen und Kalorien schätzen.

const UNIT_ALIASES = {
  g: ["g", "gr", "gramm", "gram", "grams"],
  kg: ["kg", "kilo", "kilogramm"],
  ml: ["ml", "milliliter"],
  cl: ["cl"],
  l: ["l", "liter", "litre"],
  EL: ["el", "esslöffel", "essl", "tbsp", "tablespoon", "tablespoons"],
  TL: ["tl", "teelöffel", "teel", "tsp", "teaspoon", "teaspoons"],
  Prise: ["prise", "prisen", "pinch"],
  Dose: ["dose", "dosen", "can", "cans"],
  Becher: ["becher"],
  Packung: ["packung", "packungen", "pck", "pck.", "pkg", "päckchen", "pack"],
  Bund: ["bund", "bunch"],
  Zehe: ["zehe", "zehen", "clove", "cloves"],
  Scheibe: ["scheibe", "scheiben", "slice", "slices"],
  Stück: ["stück", "stk", "stk.", "st.", "piece", "pieces"],
  Tasse: ["tasse", "tassen", "cup", "cups"],
  Handvoll: ["handvoll", "handful"],
  Glas: ["glas", "gläser"],
};

const UNIT_LOOKUP = {};
for (const [unit, aliases] of Object.entries(UNIT_ALIASES)) {
  for (const a of aliases) UNIT_LOOKUP[a] = unit;
}

const FRACTIONS = { "½": 0.5, "⅓": 1 / 3, "⅔": 2 / 3, "¼": 0.25, "¾": 0.75, "⅛": 0.125 };

function parseNumber(s) {
  s = s.trim();
  if (FRACTIONS[s] !== undefined) return FRACTIONS[s];
  const mixed = s.match(/^(\d+)\s*([½⅓⅔¼¾⅛])$/);
  if (mixed) return Number(mixed[1]) + FRACTIONS[mixed[2]];
  const mixedFrac = s.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
  if (mixedFrac) return Number(mixedFrac[1]) + Number(mixedFrac[2]) / Number(mixedFrac[3]);
  const frac = s.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

const NUM = String.raw`\d+\s+\d+\s*\/\s*\d+|\d+(?:[.,]\d+)?(?:\s*\/\s*\d+)?\s*[½⅓⅔¼¾⅛]?|[½⅓⅔¼¾⅛]`;
const LINE_RE = new RegExp(String.raw`^\s*(${NUM})(?:\s*[-–]\s*(${NUM}))?\s*(.*)$`);
// "Basmatireis 150 g" – Menge am Ende
const TRAIL_RE = new RegExp(String.raw`^(.*?\D)\s+(${NUM})\s*([A-Za-zÄÖÜäöüß.]*)$`);

/** "200 g Feta, zerbröselt" -> { amount: 200, unit: "g", name: "Feta, zerbröselt" } */
export function parseIngredient(line) {
  const text = line.replace(/^[-•*·▪︎\s]+/, "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  let amount = null;
  let rest = text;
  const t = text.match(TRAIL_RE);
  if (t && !/^\s*[\d½⅓⅔¼¾⅛]/.test(text) && (!t[3] || UNIT_LOOKUP[t[3].toLowerCase()])) {
    const a = parseNumber(t[2]);
    if (a !== null) {
      return { amount: a, unit: t[3] ? UNIT_LOOKUP[t[3].toLowerCase()] : null, name: t[1].replace(/[:,\s]+$/, "").trim() };
    }
  }
  const m = text.match(LINE_RE);
  if (m) {
    const a = parseNumber(m[1]);
    const b = m[2] ? parseNumber(m[2]) : null;
    if (a !== null) {
      amount = b !== null ? (a + b) / 2 : a;
      rest = m[3];
    }
  }
  let unit = null;
  const um = rest.match(/^([A-Za-zÄÖÜäöüß.]+)\s+(.*)$/);
  if (um && UNIT_LOOKUP[um[1].toLowerCase()]) {
    unit = UNIT_LOOKUP[um[1].toLowerCase()];
    rest = um[2];
  } else {
    // "200g Feta"
    const glued = rest.match(/^(g|kg|ml|l|el|tl)\b\.?\s*(.*)$/i);
    if (glued && amount !== null) {
      unit = UNIT_LOOKUP[glued[1].toLowerCase()];
      rest = glued[2];
    }
  }
  rest = rest.replace(/^(of|von)\s+/i, "").trim();
  return { amount, unit, name: rest || text };
}

export function formatAmount(amount, unit) {
  if (amount === null || amount === undefined) return unit ?? "";
  let a = amount;
  let u = unit;
  if (u === "g" && a >= 1000) { a /= 1000; u = "kg"; }
  if (u === "ml" && a >= 1000) { a /= 1000; u = "l"; }
  const rounded = a >= 10 ? Math.round(a) : Math.round(a * 100) / 100;
  const txt = String(rounded).replace(".", ",");
  return u ? `${txt} ${u}` : txt;
}

export function formatIngredient(ing) {
  const amt = formatAmount(ing.amount, ing.unit);
  return amt ? `${amt} ${ing.name}` : ing.name;
}

// Schlüssel für das Zusammenfassen gleicher Zutaten
export function baseName(name) {
  return name
    .toLowerCase()
    .split(/[,(]/)[0]
    .replace(/\b(frische[rsn]?|frisch|gehackt|gewürfelt|klein|große?[rsn]?|mittelgroße?[rsn]?|rote?[rsn]?|gelbe?[rsn]?|grüne?[rsn]?|bio|optional|ca\.?|etwa)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Einheiten auf eine Basis bringen, damit sie addierbar sind
function normalizeUnit(amount, unit) {
  if (amount === null) return { amount, unit };
  if (unit === "kg") return { amount: amount * 1000, unit: "g" };
  if (unit === "l") return { amount: amount * 1000, unit: "ml" };
  if (unit === "cl") return { amount: amount * 10, unit: "ml" };
  return { amount, unit };
}

export const CATEGORIES = [
  "Obst & Gemüse",
  "Kühlregal",
  "Fleisch & Fisch",
  "Brot & Backwaren",
  "Vorrat",
  "Gewürze & Öle",
  "Tiefkühl",
  "Getränke",
  "Sonstiges",
];

const CATEGORY_WORDS = [
  ["Tiefkühl", ["tiefkühl", "^tk", "gefroren", "frozen"]],
  ["Gewürze & Öle", ["salz", "pfeffer", "paprikapulver", "curry", "kreuzkümmel", "kümmel", "zimt", "muskat", "oregano", "thymian", "rosmarin", "chiliflocken", "chilipulver", "kurkuma", "gewürz", "öl", "essig", "balsamico", "sojasauce", "sojasoße", "brühe", "fond", "senf", "honig", "ahornsirup", "vanille", "lorbeer", "majoran", "garam masala", "edelsüß", "oil", "vinegar"]],
  ["Vorrat", ["mehl", "zucker", "=reis", "basmati", "jasminreis", "risotto", "nudel", "pasta", "spaghetti", "penne", "fusilli", "linsen", "kichererbsen", "haferflocken", "couscous", "bulgur", "quinoa", "passierte", "gehackte tomaten", "tomatenmark", "kokosmilch", "nüsse", "mandel", "walnuss", "cashew", "samen", "kerne", "backpulver", "hefe", "stärke", "rice", "flour", "sugar", "noodle", "lasagne", "gnocchi", "schokolade", "kakao", "rosinen", "erdnuss", "kidneybohnen", "weiße bohnen", "dose"]],
  ["Fleisch & Fisch", ["hähnchen", "huhn", "hühnchen", "^pute", "rind", "schwein", "^hack", "hackfleisch", "speck", "bacon", "schinken", "wurst", "salami", "lachs", "thunfisch", "fisch", "garnele", "shrimp", "chicken", "beef", "pork", "salmon", "chorizo", "lamm"]],
  ["Kühlregal", ["milch", "sahne", "joghurt", "quark", "butter", "käse", "feta", "mozzarella", "parmesan", "gouda", "ricotta", "mascarpone", "schmand", "crème", "creme", "=ei", "=eier", "eigelb", "eiweiß", "tofu", "halloumi", "skyr", "cheese", "milk", "cream", "=egg", "=eggs"]],
  ["Brot & Backwaren", ["brot", "brötchen", "toast", "baguette", "wrap", "tortilla", "fladen", "pita", "naan", "bread", "blätterteig", "pizzateig"]],
  ["Getränke", ["wein", "=bier", "saft", "wasser", "wine"]],
  ["Obst & Gemüse", ["zucchini", "paprika", "tomate", "gurke", "salat", "zwiebel", "knoblauch", "karotte", "möhre", "kartoffel", "aubergine", "brokkoli", "blumenkohl", "spinat", "pilz", "champignon", "lauch", "porree", "sellerie", "kürbis", "avocado", "zitrone", "limette", "apfel", "banane", "beere", "orange", "mango", "ingwer", "petersilie", "basilikum", "koriander", "schnittlauch", "minze", "dill", "rucola", "radieschen", "kohl", "fenchel", "=mais", "erbsen", "bohnen", "spargel", "chili", "rote bete", "obst", "gemüse", "onion", "garlic", "tomato", "lemon", "lime"]],
];

// "=ei" passt nur auf das ganze Wort, "^hack" nur auf Wortanfänge,
// alles andere auch innerhalb zusammengesetzter Wörter ("Kirschtomaten").
function matchWord(name, word) {
  const n = name.toLowerCase().split(",")[0];
  if (word[0] === "=" || word[0] === "^") {
    const tokens = n.split(/[^a-zäöüß]+/);
    const w = word.slice(1);
    return word[0] === "=" ? tokens.includes(w) : tokens.some((t) => t.startsWith(w));
  }
  return n.includes(word);
}

export function categorize(name) {
  for (const [cat, words] of CATEGORY_WORDS) {
    if (words.some((w) => matchWord(name, w))) return cat;
  }
  return "Sonstiges";
}

/**
 * Fasst Zutaten aller geplanten Rezepte zusammen.
 * entries: [{ recipe, servings }]
 */
export function buildShoppingList(entries) {
  const map = new Map();
  for (const { recipe, servings } of entries) {
    const factor = servings / (recipe.servings || servings || 1);
    for (const ing of recipe.ingredients || []) {
      const scaled = ing.amount === null || ing.amount === undefined ? null : ing.amount * factor;
      const { amount, unit } = normalizeUnit(scaled, ing.unit ?? null);
      const key = `${baseName(ing.name)}|${unit ?? ""}|${amount === null ? "x" : "n"}`;
      const prev = map.get(key);
      if (prev) {
        if (prev.amount !== null && amount !== null) prev.amount += amount;
      } else {
        map.set(key, {
          name: ing.name.split(",")[0].trim(),
          amount,
          unit,
          category: categorize(ing.name),
        });
      }
    }
  }
  return [...map.values()];
}

// ---------- Kalorien ----------

// kcal pro 100 g (bzw. 100 ml) für gängige Zutaten. Grobe Durchschnittswerte.
const KCAL = [
  ["paprikapulver", 0], ["chiliflocken", 0], ["gemüsebrühe", 5], ["hühnerbrühe", 5], ["salzkartoffel", 77],
  ["olivenöl", 884], ["rapsöl", 884], ["sonnenblumenöl", 884], ["sesamöl", 884], ["öl", 884],
  ["butter", 741], ["margarine", 720], ["mayonnaise", 680],
  ["erdnussbutter", 590], ["erdnuss", 570], ["walnuss", 650], ["mandel", 600], ["cashew", 570], ["nüsse", 620], ["kerne", 570], ["samen", 530],
  ["schokolade", 540], ["kakao", 380],
  ["zucker", 400], ["honig", 304], ["ahornsirup", 260],
  ["mehl", 350], ["haferflocken", 370], ["reis", 350], ["nudel", 355], ["pasta", 355], ["spaghetti", 355], ["penne", 355], ["lasagne", 355], ["couscous", 360], ["bulgur", 350], ["quinoa", 370], ["gnocchi", 150],
  ["rote linsen", 340], ["linsen", 330], ["kichererbsen", 120], ["kidneybohnen", 100], ["bohnen", 100],
  ["brot", 250], ["toast", 260], ["brötchen", 270], ["baguette", 260], ["tortilla", 300], ["wrap", 300],
  ["parmesan", 400], ["gouda", 360], ["cheddar", 400], ["emmentaler", 380], ["mozzarella", 250], ["feta", 260], ["halloumi", 320], ["frischkäse", 230], ["mascarpone", 430], ["ricotta", 150], ["käse", 350],
  ["schmand", 240], ["saure sahne", 190], ["crème fraîche", 290], ["creme fraiche", 290], ["sahne", 300], ["kokosmilch", 190], ["milch", 64], ["joghurt", 70], ["skyr", 63], ["quark", 70],
  ["=eier", 155], ["=ei", 155], ["eigelb", 320], ["eiweiß", 50], ["tofu", 120],
  ["speck", 450], ["bacon", 450], ["salami", 380], ["chorizo", 450], ["schinken", 140], ["wurst", 300],
  ["hackfleisch", 250], ["^hack", 250], ["rind", 190], ["schwein", 200], ["lamm", 230], ["hähnchen", 120], ["hühnchen", 120], ["huhn", 120], ["pute", 110],
  ["lachs", 200], ["thunfisch", 120], ["garnele", 90], ["shrimp", 90], ["fisch", 100],
  ["tomatenmark", 80], ["passierte tomaten", 30], ["gehackte tomaten", 25], ["tomate", 18],
  ["süßkartoffel", 86], ["kartoffel", 77], ["avocado", 160], ["mais", 90], ["erbsen", 80],
  ["zwiebel", 40], ["knoblauch", 150], ["ingwer", 80], ["karotte", 40], ["möhre", 40], ["paprika", 30], ["zucchini", 17], ["aubergine", 25], ["brokkoli", 34], ["blumenkohl", 25], ["spinat", 23], ["pilz", 22], ["champignon", 22], ["lauch", 30], ["kürbis", 30], ["gurke", 15], ["salat", 15], ["rucola", 25], ["sellerie", 18], ["fenchel", 31], ["kohl", 30], ["spargel", 20],
  ["banane", 89], ["apfel", 52], ["beere", 45], ["mango", 60], ["orange", 47], ["zitrone", 29], ["limette", 30],
  ["brühe", 5], ["sojasauce", 60], ["sojasoße", 60], ["senf", 70], ["essig", 20], ["balsamico", 90], ["wein", 80],
  ["salz", 0], ["pfeffer", 0], ["wasser", 0], ["gewürz", 0], ["petersilie", 0], ["basilikum", 0], ["koriander", 0], ["schnittlauch", 0], ["minze", 0], ["dill", 0], ["thymian", 0], ["rosmarin", 0], ["oregano", 0], ["chili", 0], ["paprikapulver", 0], ["curry", 0], ["kurkuma", 0], ["zimt", 0], ["muskat", 0], ["kreuzkümmel", 0], ["backpulver", 0], ["hefe", 0],
];

// Durchschnittsgewicht pro Stück in g
const PIECE_G = [
  ["=eier", 60], ["=ei", 60], ["zwiebel", 100], ["knoblauch", 5], ["zucchini", 200], ["paprika", 150], ["tomate", 100], ["karotte", 80], ["möhre", 80], ["kartoffel", 150], ["süßkartoffel", 250], ["aubergine", 300], ["avocado", 150], ["zitrone", 100], ["limette", 60], ["apfel", 150], ["banane", 120], ["orange", 150], ["gurke", 400], ["brokkoli", 400], ["blumenkohl", 600], ["lauch", 200], ["mango", 300], ["mozzarella", 125], ["feta", 200], ["tortilla", 60], ["wrap", 60], ["brötchen", 60], ["hähnchenbrust", 150], ["lachsfilet", 125],
];

const UNIT_G = { g: 1, ml: 1, EL: 12, TL: 4, Prise: 0, Dose: 400, Becher: 200, Packung: 200, Bund: 30, Zehe: 5, Scheibe: 25, Tasse: 200, Handvoll: 30, Glas: 300 };

function lookup(table, name) {
  for (const [word, v] of table) if (matchWord(name, word)) return v;
  return null;
}

function grams(ing) {
  const { amount, unit } = normalizeUnit(ing.amount ?? null, ing.unit ?? null);
  if (amount === null) return null;
  if (!unit || unit === "Stück") return lookup(PIECE_G, ing.name) !== null ? amount * lookup(PIECE_G, ing.name) : null;
  const f = UNIT_G[unit];
  return f === undefined ? null : amount * f;
}

/** Liefert { perServing, known, total } – known = Anteil erkannter Zutaten. */
export function estimateKcal(recipe) {
  const ings = recipe.ingredients || [];
  if (!ings.length) return { perServing: null, known: 0, total: 0 };
  let kcal = 0;
  let known = 0;
  let relevant = 0;
  for (const ing of ings) {
    const per100 = lookup(KCAL, ing.name);
    if (per100 === 0) continue; // Gewürze, Wasser etc. zählen nicht mit
    relevant++;
    const g = grams(ing);
    if (per100 === null || g === null) continue;
    kcal += (g / 100) * per100;
    known++;
  }
  return {
    perServing: known ? Math.round(kcal / (recipe.servings || 1)) : null,
    known,
    total: relevant,
  };
}

// ---------- Text (z. B. aus Screenshot) in Rezept aufteilen ----------

const ING_HEAD = /^(zutaten|ingredients|du brauchst|einkaufsliste|für\s+\d+\s+(portionen|personen))\b/i;
const STEP_HEAD = /^(zubereitung|anleitung|so geht'?s|so wird'?s gemacht|schritte|instructions|directions|method|preparation)\b/i;

export function splitRecipeText(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 1);
  let title = "";
  const ingredients = [];
  const steps = [];
  let servings = null;
  let mode = null;

  for (const line of lines) {
    const sv = line.match(/(\d+)\s*(portionen|personen|servings|pers\.)/i);
    if (sv && !servings) servings = Number(sv[1]);

    if (ING_HEAD.test(line)) { mode = "ing"; continue; }
    if (STEP_HEAD.test(line)) { mode = "step"; continue; }

    if (mode === "ing") ingredients.push(line);
    else if (mode === "step") steps.push(line.replace(/^\d+[.)]\s*/, ""));
    else {
      const looksLikeIng = /^[-•*]?\s*(\d|[½⅓¼¾])/.test(line) && line.length < 60;
      if (looksLikeIng) ingredients.push(line);
      else if (!title && line.length < 70) title = line;
      else if (line.length >= 40) steps.push(line.replace(/^\d+[.)]\s*/, ""));
    }
  }

  // Zeilenumbrüche mitten im Satz wieder zusammenfügen
  const merged = [];
  for (const s of steps) {
    if (merged.length && !/[.!?:]$/.test(merged[merged.length - 1]) && /^[a-zäöü]/.test(s)) {
      merged[merged.length - 1] += " " + s;
    } else merged.push(s);
  }
  return { title, servings, ingredients, steps: merged };
}
