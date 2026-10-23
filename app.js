import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";
import {
  parseIngredient, formatIngredient, formatAmount, buildShoppingList,
  estimateKcal, splitRecipeText, baseName, CATEGORIES, categorize,
} from "./parse.js";

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});

const $app = document.getElementById("app");
const $nav = document.getElementById("nav");
const $toast = document.getElementById("toast");

const state = {
  authReady: false,
  session: null,
  loaded: false,
  recipes: [],
  plan: [],
  items: [],
  view: { name: "plan" },
  search: "",
  draft: null,      // Rezept im Bearbeitungsformular
  addServings: {},  // gewählte Portionen je Rezept in der Detailansicht
  busy: null,       // { text, progress } während Import/Texterkennung
  previewUrl: null, // Screenshot-Vorschau im Formular
};

// ---------- Hilfsfunktionen ----------

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const ICONS = {
  calendar: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M16 3v4M8 3v4M4 11h16"/>',
  book: '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  cart: '<circle cx="9" cy="20" r="1.3"/><circle cx="18" cy="20" r="1.3"/><path d="M3 4h2l2.4 11h11.2L21 8H6.2"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  pencil: '<path d="M4 20h16M6 16l9.5-9.5 3 3L9 19H6z"/>',
  out: '<path d="M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10"/>',
  ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6"/>',
  flame: '<path d="M12 21a6 6 0 0 0 6-6c0-4-3-6-4-10-2 2-3 4-3 6-1-1-2-2-2-3-2 2-3 4-3 7a6 6 0 0 0 6 6z"/>',
};
const icon = (n, cls = "") => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n]}</svg>`;

const THUMB_COLORS = ["#D9C9A8", "#B9C4A7", "#E3B9A0", "#C9D1C0", "#E6D5B8", "#CFC6B4"];
function thumb(recipe, cls = "thumb") {
  if (recipe.image_url) {
    return `<img class="${cls}" src="${esc(recipe.image_url)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='icons/icon-192.png'">`;
  }
  let h = 0;
  for (const c of recipe.title) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `<div class="${cls}" style="background:${THUMB_COLORS[h % THUMB_COLORS.length]}">${esc(recipe.title.charAt(0).toUpperCase())}</div>`;
}

function kcalText(recipe, servingsFactor = 1) {
  const k = estimateKcal(recipe);
  if (k.perServing === null) return "";
  return `ca. ${Math.round(k.perServing * servingsFactor / 10) * 10} kcal`;
}

function weekNumber(d = new Date()) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - yearStart) / 86400000 + 1) / 7);
}

let toastTimer;
function toast(text) {
  $toast.textContent = text;
  $toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($toast.hidden = true), 2600);
}

function go(name, extra = {}) {
  state.view = { name, ...extra };
  if (name !== "edit") {
    state.draft = null;
    if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
    state.previewUrl = null;
  }
  render();
  window.scrollTo(0, 0);
}

const recipeById = (id) => state.recipes.find((r) => r.id === id);

// ---------- Daten ----------

async function loadAll() {
  const [r, p, i] = await Promise.all([
    sb.from("recipes").select("*").order("created_at", { ascending: false }),
    sb.from("plan_entries").select("*").order("created_at"),
    sb.from("shopping_items").select("*").order("created_at"),
  ]);
  const err = r.error || p.error || i.error;
  if (err) {
    toast("Daten konnten nicht geladen werden");
    console.error(err);
    return;
  }
  state.recipes = r.data;
  state.plan = p.data;
  state.items = i.data;
  state.loaded = true;
}

// Erzeugt die Einkaufsliste aus dem Wochenplan neu. Abgehakte Artikel
// bleiben abgehakt, selbst hinzugefügte Artikel bleiben unberührt.
async function regenerateList() {
  const entries = state.plan
    .map((e) => ({ recipe: recipeById(e.recipe_id), servings: e.servings }))
    .filter((e) => e.recipe);
  const generated = buildShoppingList(entries);
  const key = (i) => `${baseName(i.name)}|${i.unit ?? ""}`;
  const checked = new Set(state.items.filter((i) => !i.manual && i.checked).map(key));

  const del = await sb.from("shopping_items").delete().eq("manual", false);
  if (del.error) return toast("Liste konnte nicht aktualisiert werden");
  if (generated.length) {
    const rows = generated.map((g) => ({
      name: g.name,
      amount: g.amount === null ? null : Math.round(g.amount * 100) / 100,
      unit: g.unit,
      category: g.category,
      checked: checked.has(key(g)),
      manual: false,
    }));
    const ins = await sb.from("shopping_items").insert(rows);
    if (ins.error) toast("Liste konnte nicht aktualisiert werden");
  }
  await loadAll();
}

let reloadTimer;
function scheduleReload() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(async () => {
    await loadAll();
    softRender();
  }, 300);
}

let channel;
function subscribe() {
  if (channel) sb.removeChannel(channel);
  channel = sb.channel("sync");
  for (const table of ["recipes", "plan_entries", "shopping_items"]) {
    channel.on("postgres_changes", { event: "*", schema: "public", table }, scheduleReload);
  }
  channel.subscribe();
}

// Auf iOS schläft die Verbindung im Hintergrund – beim Zurückkehren neu laden.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && state.session) scheduleReload();
});

// ---------- Rendering ----------

// Neu zeichnen nach Änderungen von außen, ohne laufende Eingaben zu zerstören
function softRender() {
  if (["edit", "add"].includes(state.view.name)) return;
  const input = document.getElementById("new-item");
  const val = input?.value;
  const focused = document.activeElement === input;
  render();
  const again = document.getElementById("new-item");
  if (again && val) again.value = val;
  if (again && focused) again.focus();
}

function render() {
  if (!state.authReady) {
    $nav.hidden = true;
    $app.innerHTML = "";
    return;
  }
  if (!state.session) {
    $nav.hidden = true;
    $app.innerHTML = viewLogin();
    return;
  }
  if (!state.loaded) {
    $nav.hidden = true;
    $app.innerHTML = `<p class="center muted" style="margin-top:40vh">Lade …</p>`;
    return;
  }
  const v = state.view;
  const views = {
    plan: viewPlan,
    recipes: viewRecipes,
    recipe: () => viewRecipe(recipeById(v.id)),
    add: viewAdd,
    edit: viewEdit,
    list: viewList,
  };
  $app.innerHTML = (views[v.name] || viewPlan)();
  renderNav();
}

function renderNav() {
  const active = { recipe: "recipes", edit: "add" }[state.view.name] || state.view.name;
  const open = state.items.filter((i) => !i.checked).length;
  const tab = (name, ic, label, badge) => `
    <button data-action="nav" data-to="${name}" class="${active === name ? "on" : ""}" aria-label="${label}">
      <span class="ic">${icon(ic)}${badge ? `<span class="badge">${badge}</span>` : ""}</span>${label}
    </button>`;
  $nav.innerHTML =
    tab("plan", "calendar", "Woche", state.plan.length || "") +
    tab("recipes", "book", "Rezepte") +
    tab("add", "plus", "Neu") +
    tab("list", "cart", "Einkauf", open || "");
  $nav.hidden = false;
}

function viewLogin() {
  return `
  <section class="login">
    <img class="logo" src="icons/icon-192.png" alt="">
    <p class="eyebrow">Willkommen</p>
    <h1>Unsere Rezepte</h1>
    <form id="login-form" style="margin-top:24px">
      <label for="email">E-Mail</label>
      <input id="email" name="email" type="email" autocomplete="username" required>
      <label for="password">Passwort</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required>
      <div id="login-error" class="error" hidden></div>
      <button class="btn primary full" style="margin-top:20px" type="submit">Anmelden</button>
    </form>
  </section>`;
}

function viewPlan() {
  const entries = state.plan
    .map((e) => ({ entry: e, recipe: recipeById(e.recipe_id) }))
    .filter((x) => x.recipe);
  const open = state.items.filter((i) => !i.checked).length;
  const total = state.items.length;

  const header = `
    <p class="eyebrow">KW ${weekNumber()} · ${entries.length} ${entries.length === 1 ? "Rezept" : "Rezepte"}</p>
    <h1>Diese Woche</h1>`;

  if (!entries.length) {
    return `${header}
      <div class="empty card" style="margin-top:20px">
        <h3>Plant eure Woche</h3>
        <p>Wählt Rezepte aus, die ihr diese Woche kochen wollt. Die Einkaufsliste entsteht automatisch.</p>
        <button class="btn primary" data-action="nav" data-to="recipes">Rezepte auswählen</button>
      </div>`;
  }

  const cards = entries.map(({ entry, recipe }) => {
    const kcal = kcalText(recipe);
    return `
      <div class="card row">
        <button class="row grow" style="text-align:left" data-action="open" data-id="${recipe.id}">
          ${thumb(recipe)}
          <div class="grow">
            <div class="title-line">${esc(recipe.title)}</div>
            <div class="meta">${kcal ? `${kcal} pro Portion` : `${recipe.ingredients.length} Zutaten`}</div>
          </div>
        </button>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px">
          <button class="icon-btn plain" data-action="unplan" data-id="${entry.id}" aria-label="Aus der Woche entfernen" style="width:28px;height:28px;color:var(--faint)">${icon("x", "s")}</button>
          <div class="stepper">
            <button data-action="plan-servings" data-id="${entry.id}" data-d="-1" aria-label="Weniger Portionen">−</button>
            <span>${entry.servings} P.</span>
            <button data-action="plan-servings" data-id="${entry.id}" data-d="1" aria-label="Mehr Portionen">+</button>
          </div>
        </div>
      </div>`;
  }).join("");

  return `${header}
    <div class="stack" style="margin-top:18px">${cards}</div>
    <button class="card row" style="width:100%;margin-top:18px;text-align:left" data-action="nav" data-to="list">
      <span class="icon-btn" style="display:grid;place-items:center">${icon("cart")}</span>
      <span class="grow">
        <span style="display:block;font-family:var(--serif);font-size:17px">Einkaufsliste</span>
        <span class="meta">${open} offen · ${total - open} erledigt</span>
      </span>
    </button>
    <div class="row" style="margin-top:12px;gap:8px">
      <button class="btn grow" data-action="nav" data-to="recipes">${icon("plus", "s")} Rezept</button>
      <button class="btn ghost danger" data-action="clear-week">Woche leeren</button>
    </div>`;
}

function viewRecipes() {
  const q = state.search.trim().toLowerCase();
  const planned = new Set(state.plan.map((p) => p.recipe_id));
  const list = state.recipes.filter((r) =>
    !q || r.title.toLowerCase().includes(q) || r.ingredients.some((i) => i.name.toLowerCase().includes(q)));

  const header = `<p class="eyebrow">${state.recipes.length} gespeichert</p><h1>Rezepte</h1>`;

  if (!state.recipes.length) {
    return `${header}
      <div class="empty card" style="margin-top:20px">
        <h3>Euer erstes Rezept</h3>
        <p>Fügt einen Pinterest-Link, einen Screenshot oder ein eigenes Rezept hinzu.</p>
        <button class="btn primary" data-action="nav" data-to="add">Rezept hinzufügen</button>
      </div>`;
  }

  const rows = list.map((r) => `
    <button class="card row" style="width:100%;text-align:left" data-action="open" data-id="${r.id}">
      ${thumb(r)}
      <div class="grow">
        <div class="title-line">${esc(r.title)}</div>
        <div class="meta">${[`${r.servings} Portionen`, kcalText(r)].filter(Boolean).join(" · ")}</div>
      </div>
      ${planned.has(r.id) ? `<span class="chip on">${icon("check", "s")}</span>` : ""}
    </button>`).join("");

  return `${header}
    <div class="search"><input id="search" type="search" placeholder="Rezept oder Zutat suchen" value="${esc(state.search)}" autocomplete="off"></div>
    <div class="stack" id="recipe-list">${rows || `<p class="muted center">Nichts gefunden.</p>`}</div>`;
}

function viewRecipe(r) {
  if (!r) return `<p class="muted">Rezept nicht gefunden.</p>`;
  const entry = state.plan.find((p) => p.recipe_id === r.id);
  const servings = state.addServings[r.id] ?? r.servings;
  const k = estimateKcal(r);

  const kcalInfo = k.perServing !== null
    ? `<div class="chip" style="display:inline-flex;align-items:center;gap:6px">${icon("flame", "s")} ca. ${Math.round(k.perServing / 10) * 10} kcal pro Portion</div>
       ${k.known < k.total ? `<p class="small muted" style="margin:6px 0 0">Schätzung aus ${k.known} von ${k.total} Zutaten</p>` : ""}`
    : `<p class="small muted" style="margin:0">Keine Kalorienschätzung möglich</p>`;

  const planBox = entry
    ? `<div class="card row between">
         <span class="row" style="gap:8px;color:var(--sage-dark)">${icon("check", "s")} In dieser Woche · ${entry.servings} P.</span>
         <button class="btn ghost danger" style="min-height:36px;padding:0 8px" data-action="unplan" data-id="${entry.id}">Entfernen</button>
       </div>`
    : `<div class="card row between">
         <div class="stepper">
           <button data-action="add-servings" data-id="${r.id}" data-d="-1" aria-label="Weniger Portionen">−</button>
           <span>${servings} P.</span>
           <button data-action="add-servings" data-id="${r.id}" data-d="1" aria-label="Mehr Portionen">+</button>
         </div>
         <button class="btn primary" data-action="plan" data-id="${r.id}">Zur Woche</button>
       </div>`;

  const ings = r.ingredients.map((i) => `
    <li><span class="ing-amt">${esc(formatAmount(i.amount, i.unit))}</span><span>${esc(i.name)}</span></li>`).join("");
  const steps = r.steps.map((s) => `<li><span>${esc(s)}</span></li>`).join("");

  let host = "";
  try { host = r.source_url ? new URL(r.source_url).hostname.replace(/^www\./, "") : ""; } catch { /* ignorieren */ }

  return `
    <button class="btn ghost back" data-action="nav" data-to="recipes">${icon("back", "s")} Rezepte</button>
    ${r.image_url ? `<img class="hero" src="${esc(r.image_url)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : ""}
    <h1 style="margin-top:18px">${esc(r.title)}</h1>
    <p class="meta" style="margin:6px 0 12px">${r.servings} Portionen · ${r.ingredients.length} Zutaten</p>
    ${kcalInfo}
    <div style="margin-top:16px">${planBox}</div>
    <h2>Zutaten</h2>
    ${ings ? `<div class="card" style="padding:4px 14px"><ul class="ing-list">${ings}</ul></div>` : `<p class="muted">Keine Zutaten eingetragen.</p>`}
    ${steps ? `<h2>Zubereitung</h2><ol class="step-list">${steps}</ol>` : ""}
    ${host ? `<p style="margin-top:20px"><a href="${esc(r.source_url)}" target="_blank" rel="noopener" class="muted small" style="display:inline-flex;gap:6px;align-items:center">${icon("ext", "s")} Original auf ${esc(host)}</a></p>` : ""}
    <div class="row" style="margin-top:24px;gap:8px">
      <button class="btn grow" data-action="edit" data-id="${r.id}">${icon("edit", "s")} Bearbeiten</button>
      <button class="btn ghost danger" data-action="delete" data-id="${r.id}">${icon("trash", "s")} Löschen</button>
    </div>`;
}

function viewAdd() {
  if (state.busy) {
    const p = state.busy.progress;
    return `
      <h1>Neues Rezept</h1>
      <div class="card center" style="margin-top:24px;padding:32px 20px">
        <p style="margin:0">${esc(state.busy.text)}</p>
        ${p !== undefined ? `<div class="progress"><div style="width:${Math.round(p * 100)}%"></div></div>` : ""}
      </div>`;
  }
  return `
    <p class="eyebrow">Hinzufügen</p>
    <h1>Neues Rezept</h1>

    <form id="link-form" class="card" style="margin-top:20px">
      <div class="row">
        <span class="icon-btn" style="display:grid;place-items:center">${icon("link")}</span>
        <div class="grow"><h3>Aus einem Link</h3><div class="meta">Pinterest oder Rezeptseite</div></div>
      </div>
      <div class="add-row">
        <input id="link" type="url" inputmode="url" placeholder="https://pin.it/…" autocomplete="off">
        <button type="button" class="btn" data-action="paste" style="padding:0 14px">Einfügen</button>
      </div>
      <button class="btn primary full" style="margin-top:10px" type="submit">Importieren</button>
      <div id="link-error" class="error" hidden></div>
    </form>

    <label class="card option" for="shot" style="margin:12px 0 0;color:inherit;font-size:inherit">
      <span class="icon-btn" style="display:grid;place-items:center">${icon("camera")}</span>
      <span class="grow"><h3>Aus einem Screenshot</h3><span class="meta">Text wird auf dem Handy erkannt</span></span>
    </label>
    <input id="shot" class="file-input" type="file" accept="image/*">

    <button class="card option" style="margin-top:12px" data-action="manual">
      <span class="icon-btn" style="display:grid;place-items:center">${icon("pencil")}</span>
      <span class="grow"><h3>Selbst eingeben</h3><span class="meta">Eigenes Rezept abtippen</span></span>
    </button>`;
}

function viewEdit() {
  const d = state.draft;
  if (!d) return viewAdd();
  return `
    <button class="btn ghost back" data-action="cancel-edit">${icon("back", "s")} Abbrechen</button>
    <h1>${d.id ? "Rezept bearbeiten" : "Rezept prüfen"}</h1>
    ${d.hint ? `<p class="muted small" style="margin:8px 0 0">${esc(d.hint)}</p>` : ""}
    ${state.previewUrl ? `<img class="preview" style="margin-top:16px" src="${state.previewUrl}" alt="Screenshot">` : ""}
    <form id="edit-form">
      <label for="f-title">Titel</label>
      <input id="f-title" name="title" required value="${esc(d.title)}" placeholder="Ofengemüse mit Feta">
      <label for="f-servings">Portionen</label>
      <input id="f-servings" name="servings" type="number" min="1" max="50" inputmode="numeric" required value="${esc(d.servings)}">
      <label for="f-ing">Zutaten – eine pro Zeile</label>
      <textarea id="f-ing" name="ingredients" placeholder="200 g Feta&#10;2 Zucchini&#10;1 EL Olivenöl">${esc(d.ingredients)}</textarea>
      <label for="f-steps">Zubereitung – ein Schritt pro Zeile</label>
      <textarea id="f-steps" name="steps" placeholder="Ofen auf 200 °C vorheizen.">${esc(d.steps)}</textarea>
      <label for="f-url">Link zum Original (optional)</label>
      <input id="f-url" name="source_url" type="url" value="${esc(d.source_url)}" placeholder="https://…">
      <label for="f-img">Bild-Link (optional)</label>
      <input id="f-img" name="image_url" type="url" value="${esc(d.image_url)}" placeholder="https://…">
      <div id="edit-error" class="error" hidden></div>
      <button class="btn primary full" style="margin-top:22px" type="submit">Speichern</button>
    </form>`;
}

function viewList() {
  const items = state.items;
  const done = items.filter((i) => i.checked).length;
  const groups = CATEGORIES
    .map((cat) => ({
      cat,
      items: items
        .filter((i) => (CATEGORIES.includes(i.category) ? i.category : "Sonstiges") === cat)
        .sort((a, b) => a.checked - b.checked || a.name.localeCompare(b.name, "de")),
    }))
    .filter((g) => g.items.length);

  const row = (i) => `
    <button class="item ${i.checked ? "done" : ""}" data-action="toggle" data-id="${i.id}">
      <span class="check">${i.checked ? icon("check", "s") : ""}</span>
      <span class="item-text grow">${esc(i.name)}</span>
      <span class="item-amt">${esc(formatAmount(i.amount === null ? null : Number(i.amount), i.unit))}</span>
    </button>`;

  const body = groups.length
    ? groups.map((g) => `<div class="group-title">${esc(g.cat)}</div><div class="list-card">${g.items.map(row).join("")}</div>`).join("")
    : `<div class="empty card" style="margin-top:16px"><h3>Liste ist leer</h3><p>Plant Rezepte für die Woche oder fügt unten eigene Artikel hinzu.</p></div>`;

  return `
    <p class="eyebrow">KW ${weekNumber()}</p>
    <div class="row between"><h1>Einkaufsliste</h1>${items.length ? `<span class="muted small">${done}/${items.length}</span>` : ""}</div>
    ${items.length ? `<div class="bar" style="margin-top:12px"><div style="width:${Math.round(done / items.length * 100)}%"></div></div>` : ""}
    <form id="item-form" class="add-row">
      <input id="new-item" placeholder="Artikel hinzufügen, z. B. 1 l Milch" autocomplete="off">
      <button class="icon-btn" type="submit" aria-label="Hinzufügen" style="width:48px;height:48px">${icon("plus")}</button>
    </form>
    ${body}
    ${items.length ? `
    <div class="row" style="margin-top:20px;gap:8px">
      ${done ? `<button class="btn grow" data-action="clear-done">Erledigte entfernen</button>` : ""}
      <button class="btn ghost grow" data-action="regen">Neu berechnen</button>
    </div>` : ""}
    <p class="center" style="margin-top:28px"><button class="btn ghost small muted" data-action="logout">${icon("out", "s")} Abmelden</button></p>`;
}

// ---------- Aktionen ----------

function recipeToDraft(r) {
  return {
    id: r.id,
    title: r.title,
    servings: r.servings,
    ingredients: r.ingredients.map(formatIngredient).join("\n"),
    steps: r.steps.join("\n"),
    source_url: r.source_url ?? "",
    image_url: r.image_url ?? "",
  };
}

async function saveDraft(form) {
  const fd = new FormData(form);
  const $err = document.getElementById("edit-error");
  const title = String(fd.get("title")).trim();
  const servings = Math.max(1, parseInt(fd.get("servings"), 10) || 1);
  const ingredients = String(fd.get("ingredients"))
    .split("\n").map(parseIngredient).filter(Boolean)
    .map((i) => ({ ...i, category: categorize(i.name) }));
  const steps = String(fd.get("steps")).split("\n").map((s) => s.trim()).filter(Boolean);

  if (!title) {
    $err.textContent = "Gib dem Rezept einen Titel.";
    $err.hidden = false;
    return;
  }

  const row = {
    title,
    servings,
    ingredients,
    steps,
    source_url: String(fd.get("source_url")).trim() || null,
    image_url: String(fd.get("image_url")).trim() || null,
  };

  const id = state.draft.id;
  const res = id
    ? await sb.from("recipes").update(row).eq("id", id).select().single()
    : await sb.from("recipes").insert(row).select().single();

  if (res.error) {
    $err.textContent = "Speichern hat nicht geklappt. Prüfe deine Verbindung.";
    $err.hidden = false;
    return;
  }
  await loadAll();
  if (id && state.plan.some((p) => p.recipe_id === id)) await regenerateList();
  toast("Gespeichert");
  go("recipe", { id: res.data.id });
}

async function importLink(url) {
  state.busy = { text: "Rezept wird gelesen …" };
  render();
  const { data, error } = await sb.functions.invoke("import-recipe", { body: { url } });
  state.busy = null;

  if (error || data?.error) {
    go("add");
    const $e = document.getElementById("link-error");
    $e.textContent = data?.error || "Link konnte nicht gelesen werden. Versuch es mit einem Screenshot.";
    $e.hidden = false;
    document.getElementById("link").value = url;
    return;
  }

  state.draft = {
    title: data.title || "",
    servings: data.servings || 2,
    ingredients: (data.ingredients || []).join("\n"),
    steps: (data.steps || []).join("\n"),
    source_url: data.source_url || url,
    image_url: data.image || "",
    hint: data.found
      ? "Prüft kurz die Zutaten und speichert dann."
      : "Auf der Seite stehen keine Rezeptdaten. Ergänzt Zutaten und Schritte selbst oder nehmt einen Screenshot.",
  };
  go("edit");
}

let tesseractLoading;
function loadTesseract() {
  if (window.Tesseract) return Promise.resolve();
  tesseractLoading ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
    s.onload = resolve;
    s.onerror = () => { tesseractLoading = null; reject(new Error("Texterkennung konnte nicht geladen werden")); };
    document.head.appendChild(s);
  });
  return tesseractLoading;
}

async function importScreenshot(file) {
  const preview = URL.createObjectURL(file);
  state.busy = { text: "Texterkennung wird geladen …", progress: 0 };
  render();
  try {
    await loadTesseract();
    const result = await window.Tesseract.recognize(file, "deu+eng", {
      logger: (m) => {
        if (m.status === "recognizing text") {
          state.busy = { text: "Text wird erkannt …", progress: m.progress };
          if (state.view.name === "add") render();
        }
      },
    });
    const parsed = splitRecipeText(result.data.text);
    state.busy = null;
    state.draft = {
      title: parsed.title,
      servings: parsed.servings || 2,
      ingredients: parsed.ingredients.join("\n"),
      steps: parsed.steps.join("\n"),
      source_url: "",
      image_url: "",
      hint: "Die Texterkennung ist nicht perfekt. Vergleicht mit dem Screenshot und korrigiert, wo nötig.",
    };
    go("edit");
    state.previewUrl = preview;
    render();
  } catch (e) {
    console.error(e);
    URL.revokeObjectURL(preview);
    state.busy = null;
    go("add");
    toast(e.message || "Texterkennung fehlgeschlagen");
  }
}

async function addManualItem(text) {
  const p = parseIngredient(text);
  if (!p) return;
  const { error } = await sb.from("shopping_items").insert({
    name: p.name, amount: p.amount, unit: p.unit, category: categorize(p.name), manual: true,
  });
  if (error) return toast("Artikel konnte nicht hinzugefügt werden");
  await loadAll();
  render();
  document.getElementById("new-item")?.focus();
}

const actions = {
  nav: (el) => go(el.dataset.to),
  open: (el) => go("recipe", { id: el.dataset.id }),
  manual: () => {
    state.draft = { title: "", servings: 2, ingredients: "", steps: "", source_url: "", image_url: "" };
    go("edit");
  },
  edit: (el) => {
    state.draft = recipeToDraft(recipeById(el.dataset.id));
    go("edit");
  },
  "cancel-edit": () => (state.draft?.id ? go("recipe", { id: state.draft.id }) : go("add")),
  async delete(el) {
    const r = recipeById(el.dataset.id);
    if (!confirm(`„${r.title}“ wirklich löschen?`)) return;
    const wasPlanned = state.plan.some((p) => p.recipe_id === r.id);
    const { error } = await sb.from("recipes").delete().eq("id", r.id);
    if (error) return toast("Löschen hat nicht geklappt");
    await loadAll();
    if (wasPlanned) await regenerateList();
    toast("Rezept gelöscht");
    go("recipes");
  },
  "add-servings": (el) => {
    const r = recipeById(el.dataset.id);
    const cur = state.addServings[r.id] ?? r.servings;
    state.addServings[r.id] = Math.max(1, Math.min(20, cur + Number(el.dataset.d)));
    render();
  },
  async plan(el) {
    const r = recipeById(el.dataset.id);
    const servings = state.addServings[r.id] ?? r.servings;
    const { error } = await sb.from("plan_entries").insert({ recipe_id: r.id, servings });
    if (error) return toast("Hat nicht geklappt");
    await loadAll();
    await regenerateList();
    render();
    toast("Zur Woche hinzugefügt");
  },
  async unplan(el) {
    const { error } = await sb.from("plan_entries").delete().eq("id", el.dataset.id);
    if (error) return toast("Hat nicht geklappt");
    await loadAll();
    await regenerateList();
    render();
  },
  async "plan-servings"(el) {
    const e = state.plan.find((p) => p.id === el.dataset.id);
    const servings = Math.max(1, Math.min(20, e.servings + Number(el.dataset.d)));
    if (servings === e.servings) return;
    e.servings = servings;
    render();
    const { error } = await sb.from("plan_entries").update({ servings }).eq("id", e.id);
    if (error) return toast("Hat nicht geklappt");
    await regenerateList();
    render();
  },
  async "clear-week"() {
    if (!confirm("Alle Rezepte aus dieser Woche entfernen? Die Einkaufsliste wird mit geleert, eigene Artikel bleiben.")) return;
    const { error } = await sb.from("plan_entries").delete().not("id", "is", null);
    if (error) return toast("Hat nicht geklappt");
    await loadAll();
    await regenerateList();
    render();
  },
  async toggle(el) {
    const i = state.items.find((x) => x.id === el.dataset.id);
    i.checked = !i.checked;
    render();
    const { error } = await sb.from("shopping_items").update({ checked: i.checked }).eq("id", i.id);
    if (error) {
      i.checked = !i.checked;
      render();
      toast("Hat nicht geklappt");
    }
  },
  async "clear-done"() {
    const { error } = await sb.from("shopping_items").delete().eq("checked", true);
    if (error) return toast("Hat nicht geklappt");
    await loadAll();
    render();
  },
  async regen() {
    await regenerateList();
    render();
    toast("Liste neu berechnet");
  },
  async paste() {
    try {
      const text = await navigator.clipboard.readText();
      document.getElementById("link").value = text.trim();
    } catch {
      toast("Einfügen nicht erlaubt – lang drücken und Einfügen wählen");
    }
  },
  async logout() {
    if (!confirm("Abmelden?")) return;
    await sb.auth.signOut();
  },
};

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  if (!el) return;
  e.preventDefault();
  actions[el.dataset.action]?.(el);
});

document.addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  if (form.id === "login-form") {
    const fd = new FormData(form);
    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    const { error } = await sb.auth.signInWithPassword({
      email: String(fd.get("email")).trim(),
      password: String(fd.get("password")),
    });
    btn.disabled = false;
    if (error) {
      const $e = document.getElementById("login-error");
      $e.textContent = "E-Mail oder Passwort stimmt nicht.";
      $e.hidden = false;
    }
  } else if (form.id === "edit-form") {
    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    await saveDraft(form);
    if (document.body.contains(btn)) btn.disabled = false;
  } else if (form.id === "link-form") {
    const url = document.getElementById("link").value.trim();
    const $e = document.getElementById("link-error");
    if (!/^https?:\/\/\S+$/i.test(url)) {
      $e.textContent = "Füge einen Link ein, der mit https:// beginnt.";
      $e.hidden = false;
      return;
    }
    importLink(url);
  } else if (form.id === "item-form") {
    const input = document.getElementById("new-item");
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    addManualItem(text);
  }
});

document.addEventListener("input", (e) => {
  if (e.target.id === "search") {
    state.search = e.target.value;
    const pos = e.target.selectionStart;
    render();
    const s = document.getElementById("search");
    s.focus();
    s.setSelectionRange(pos, pos);
  }
  if (e.target.id === "link") document.getElementById("link-error").hidden = true;
  if (e.target.id === "f-title") document.getElementById("edit-error").hidden = true;
});

document.addEventListener("change", (e) => {
  if (e.target.id === "shot" && e.target.files?.[0]) importScreenshot(e.target.files[0]);
});

// ---------- Start ----------

// Supabase-Aufrufe nicht direkt im Callback abwarten (kann sonst blockieren)
sb.auth.onAuthStateChange((event, session) => {
  setTimeout(() => handleAuth(session), 0);
});

async function handleAuth(session) {
  const wasLoggedIn = !!state.session;
  state.session = session;
  state.authReady = true;
  if (session && !wasLoggedIn) {
    state.loaded = false;
    render();
    await loadAll();
    subscribe();
    render();
  } else if (!session) {
    if (channel) sb.removeChannel(channel);
    channel = null;
    Object.assign(state, { loaded: false, recipes: [], plan: [], items: [], view: { name: "plan" } });
    render();
  }
}

render();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
