const $ = (q, r = document) => r.querySelector(q);
const $$ = (q, r = document) => [...r.querySelectorAll(q)];
const state = {
  db: null,
  meta: null,
  view: "catalog",
  query: "",
  limit: 40,
  filtersOpen: false,
  filters: { family: "", supplier: "", brand: "", status: "", sort: "relevance" },
  historyQuery: "",
  historyLimit: 50,
  reviewMode: "quality",
  reviewLimit: 20,
  qualityFilter: "all",
  supplierQuery: "",
  quickQuery: "",
  quickQueue: [],
  recent: [],
  modalOpen: false,
};
const NAV = [
  ["catalog", "⌕", "Buscar"],
  ["quick", "⚡", "Registrar vários"],
  ["history", "◷", "Histórico"],
  ["suppliers", "♟", "Fornecedores"],
  ["copilot", "◈", "Copiloto"],
];
const FAMILY_MARKS = {
  pipe: "TU",
  box: "CX",
  bolt: "EL",
  shield: "EX",
  flame: "SO",
  screw: "FI",
  wheel: "RO",
  sheet: "CH",
  mesh: "AR",
  angle: "CA",
  bar: "BA",
  hook: "ES",
  profile: "PT",
  fan: "HE",
  valve: "CO",
  air: "CL",
};
const UNIT_NAMES = {
  un: "unidade",
  m: "metro",
  kg: "quilo",
  par: "par",
  cx: "caixa",
  pc: "peça",
  pç: "peça",
  "m²": "m²",
  rolo: "rolo",
};
const STOP_WORDS = new Set([
  "de",
  "da",
  "do",
  "das",
  "dos",
  "e",
  "em",
  "para",
  "por",
  "com",
  "a",
  "o",
  "x",
]);
// Ligas metálicas: tokens com peso extra na busca — ausência penaliza mais
const KNOWN_ALLOYS = new Set([
  "304","316","316l","430","202","201","310","310s","321","409","410","420","440",
  "1020","1045","4140","4340","8620","1010","1018","a36",
  "5052","6061","6063","7075","3003","2024",
  "astm","abnt","din","aisi",
]);
// Marcas/fabricantes conhecidos — usados para preencher manufacturer vs supplier
const KNOWN_BRANDS = new Set([
  "3m","scotch","adere","tigre","tramontina","tork","bosch","siemens",
  "weg","schneider","legrand","abnt","haste","vonder","vonder","schulz",
  "gerdau","usiminas","arcelor","csn","voturantim","villares","tekno",
  "wurth","norton","makita","dewalt","skf","ntn","timken","fag",
  "parker","swagelok","dn","inox",
]);
const ISSUE_GROUPS = {
  duplicate: { label: "Códigos repetidos", severity: "critical" },
  date: { label: "Datas a conferir", severity: "critical" },
  name: { label: "Nome/medida a conferir", severity: "warning" },
  missingPrice: { label: "Sem compra registrada", severity: "info" },
  missingCode: { label: "Código não informado", severity: "info" },
  other: { label: "Outros pontos", severity: "warning" },
};
function esc(v = "") {
  return String(v ?? "").replace(
    /[&<>'"]/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[
        c
      ],
  );
}
function clean(v = "") {
  return String(v ?? "")
    .replace(/\s+/g, " ")
    .trim();
}
function norm(v = "") {
  let s = clean(v)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[“”″]/g, '"')
    .replace(/[’]/g, "'");
  s = s
    .replace(/(?<=\d),(?=\d)/g, ".")
    .replace(/\b(\d+)\.(\d+)\/(\d+)(?=["\s]|$)/g, "$1 $2/$3")
    .replace(/\b(\d+)-(\d+)\/(\d+)(?=["\s]|$)/g, "$1 $2/$3");
  s = s.replace(/×/g, " x ").replace(/(\d|["'])\s*[xX]\s*(?=\d|M)/g, "$1 x ");
  s = s
    .replace(/(\d)\s*ton(?:eladas?)?\b/g, "$1 t")
    .replace(/\btoneladas?\b|\btons?\b/g, "t")
    .replace(/\bmetros?\b|\bmt\b/g, "m")
    .replace(/\bmilimetros?\b/g, "mm")
    .replace(/\bpolegadas?\b|\bpol\b/g, '"');
  s = s.replace(/(\d)\s*(mm2|mm|cm|kv|kg|v|a|t|m)\b/g, "$1 $2");
  return s
    .replace(/[^a-z0-9#/+.\-" ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function fractionAliases(value) {
  const s = norm(value), out = [];
  let m;
  // Frações compostas com ponto: "1.1/2"" → 1 + 1/2 = 38,1 mm
  const re_dot = /(\d+)\.(\d+)\/(\d+)\s*"/g;
  while ((m = re_dot.exec(s))) {
    const whole = Number(m[1]), num = Number(m[2]), den = Number(m[3]);
    if (den) {
      const inch = whole + num / den, mm = inch * 25.4;
      out.push(
        inch.toFixed(4).replace(/0+$/, "").replace(/\.$/, ""),
        mm.toFixed(2).replace(/0+$/, "").replace(/\.$/, ""),
        `${mm.toFixed(2)} mm`,
        `${mm.toFixed(1)} mm`,
      );
    }
  }
  // Frações compostas com espaço: "1 1/2"" (original)
  const re = /(\d+\s+)?(\d+)\/(\d+)\s*"/g;
  while ((m = re.exec(s))) {
    const whole = Number((m[1] || "").trim() || 0), num = Number(m[2]), den = Number(m[3]);
    if (den) {
      const inch = whole + num / den, mm = inch * 25.4;
      out.push(
        inch.toFixed(4).replace(/0+$/, "").replace(/\.$/, ""),
        mm.toFixed(2).replace(/0+$/, "").replace(/\.$/, ""),
        `${mm.toFixed(2)} mm`,
      );
    }
  }
  // Milímetros para polegadas (original)
  const mmre = /(\d+(?:\.\d+)?)\s*mm/g;
  while ((m = mmre.exec(s))) {
    const mm = Number(m[1]);
    if (mm > 0) {
      const inch = mm / 25.4;
      out.push(inch.toFixed(4).replace(/0+$/, "").replace(/\.$/, ""));
    }
  }
  // Aliases de Schedule de tubos
  if (/\bsch(?:edule)?\s*40\b/.test(s)) { out.push("sch 40"); out.push("schedule 40"); }
  if (/\bsch(?:edule)?\s*80\b/.test(s)) { out.push("sch 80"); out.push("schedule 80"); }
  if (/\bsch(?:edule)?\s*10\b/.test(s)) { out.push("sch 10"); out.push("schedule 10"); }
  if (/\bsch(?:edule)?\s*20\b/.test(s)) { out.push("sch 20"); out.push("schedule 20"); }
  // Aliases de aço inox
  if (/\binox\b/.test(s)) { out.push("aco inox"); out.push("inoxidavel"); out.push("stainless"); }
  return out.join(" ");
}
function queryTokens(q) {
  return norm(q)
    .split(" ")
    .filter(Boolean)
    .filter((t, i, a) => a.indexOf(t) === i)
    .filter((t) => !STOP_WORDS.has(t) || t.length > 3);
}
function money(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0
    ? new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "BRL",
      }).format(n)
    : "Preço não informado";
}
function dateBR(v, raw = "") {
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(v || ""))) {
    const d = new Date(`${v}T12:00:00`);
    if (!Number.isNaN(d.getTime())) return d.toLocaleDateString("pt-BR");
  }
  return "Data não informada";
}
function daysSince(v) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v || ""))) return null;
  const d = new Date(`${v}T12:00:00`);
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
}
function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}
function familyMark(p) {
  return (
    FAMILY_MARKS[p.icon] || clean(p.family).slice(0, 2).toUpperCase() || "MA"
  );
}
function unitText(u) {
  return UNIT_NAMES[String(u || "").toLowerCase()] || u || "unidade";
}
function validExternalCode(x) {
  const s = clean(x);
  return (
    s.length >= 4 &&
    /[A-Za-z]/.test(s) &&
    /\d/.test(s) &&
    !/^\d+[A-Za-z]?$/.test(s)
  );
}
function sortedOffers(p) {
  return [...(p.offers || [])]
    .filter((o) => Number(o.finalPrice) > 0)
    .sort((a, b) => {
      const av = /^\d{4}-/.test(a.updatedAt || ""),
        bv = /^\d{4}-/.test(b.updatedAt || "");
      if (av !== bv) return bv - av;
      if (av && bv) {
        const d = String(b.updatedAt).localeCompare(String(a.updatedAt));
        if (d) return d;
      }
      return Number(b.source?.row || 0) - Number(a.source?.row || 0);
    });
}
function currentOffer(p) {
  return sortedOffers(p)[0] || null;
}
function statusOf(p) {
  const o = currentOffer(p);
  if (!o)
    return {
      key: "missing",
      label: "Sem compra registrada",
      class: "neutral",
    };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(o.updatedAt || "")))
    return {
      key: "undated",
      label: "Data não informada",
      class: "neutral",
    };
  // Verifica se o preço está antigo conhecido (> staleDays)
  const staleDays = state.db?.settings?.staleDays ?? 180;
  const d = daysSince(o.updatedAt);
  if (d !== null && d > staleDays)
    return {
      key: "stale",
      label: `Último preço conhecido há ${d} dias`,
      class: "known-old",
    };
  return {
    key: "dated",
    label: `Atualizado em ${dateBR(o.updatedAt)}`,
    class: "good",
  };
}

function normalizeSpecsList(list = []) {
  const out = [];
  const measureValues = [];
  const seen = new Set();
  const add = (label, value, extra = {}) => {
    label = clean(label || "Característica");
    value = clean(value || "");
    if (!value) return;
    const key = `${norm(label)}::${norm(value)}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ label, value, ...extra });
  };
  for (const raw of Array.isArray(list) ? list : []) {
    if (!raw) continue;
    const label = clean(raw.label || "Característica");
    const value = clean(raw.value || raw.text || "");
    if (!value) continue;
    if (/^medida$/i.test(label) && /^\d+(?:[.,]\d+)?\s*(?:mm|cm|m|\"|pol)?$/i.test(value)) {
      if (!measureValues.some(x => norm(x) === norm(value))) measureValues.push(value);
      continue;
    }
    add(label, value, Object.fromEntries(Object.entries(raw).filter(([k]) => !["label","value","text"].includes(k))));
  }
  if (measureValues.length >= 2) add("Medida", measureValues.join(" × "), { confidence: "média", evidence: "medidas agrupadas" });
  else measureValues.forEach(v => add("Medida", v));
  return out;
}
function strongCategoryHint(text = "") {
  const n = norm(text);
  const has = (...keys) => keys.some((key) => n.includes(norm(key)));
  if (has("flange") && !has("aço", "aco", "inox", "alumínio", "aluminio", "dn", "ansi", "npt", "rosca", "tubo", "solda", "alta pressao", "alta pressão", "industrial")) return "";
  return null;
}
function sourceBadge(c = {}) {
  const type = c.source_type || "reference";
  if (type === "manufacturer") return { label: "Fonte do fabricante", tone: "good" };
  if (type === "marketplace") return { label: "Marketplace — conferir", tone: "warn" };
  if (type === "retailer" || type === "distributor") return { label: "Loja/distribuidor — conferir", tone: "warn" };
  return { label: "Referência web — conferir", tone: "neutral" };
}
function safeCandidateFields(candidate = {}) {
  const confidence = candidate.confidence || candidate.field_confidence?.name || "baixa";
  const riskySource = ["marketplace", "retailer", "distributor"].includes(candidate.source_type);
  return { confidence, riskySource, allowAutoSupplier: false, allowCategory: confidence === "alta" && !riskySource };
}

function priceChange(cur, prev) {
  const a = Number(cur?.finalPrice),
    b = Number(prev?.finalPrice);
  return a > 0 && b > 0 ? ((a - b) / b) * 100 : null;
}
function issueGroup(reason = "") {
  const n = norm(reason);
  if (n.includes("codigo aparece")) return "duplicate";
  if (n.includes("data")) return "date";
  if (n.includes("nome") || n.includes("medida") || n.includes("polos incomum"))
    return "name";
  if (n.includes("sem preco")) return "missingPrice";
  if (n.includes("sem codigo")) return "missingCode";
  return "other";
}
function unresolvedReasons(p) {
  const resolved = new Set(p.resolvedQualityIssues || []);
  return (p.quality?.reasons || []).filter((x) => !resolved.has(x));
}
function criticalIssueCount() {
  return (state.db?.products || []).reduce(
    (n, p) =>
      n +
      unresolvedReasons(p).filter((r) =>
        ["critical", "warning"].includes(ISSUE_GROUPS[issueGroup(r)].severity),
      ).length,
    0,
  );
}
function productHaystack(p) {
  const raw = [
    p.name,
    p.subtitle,
    p.technicalName,
    p.code,
    p.family,
    p.group,
    p.subcategory,
    p.searchText,
    p.manufacturer,         // Melhoria #2: fabricante/marca indexado na busca
    p.manufacturerAlias,
    ...(p.externalCodes || []),
    ...(p.aliases || []),
    ...(p.originalLines || []),
    ...(p.specs || []).flatMap((x) => [x.label, x.value]),
    ...(p.supplierLinks || []).map((x) => x.name),
    ...(p.offers || []).map((x) => x.supplierName),
  ].join(" ");
  return `${norm(raw)} ${fractionAliases(raw)}`;
}
function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 1) return 9;
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const old = dp[j];
      dp[j] = Math.min(
        dp[j] + 1,
        dp[j - 1] + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      prev = old;
    }
  }
  return dp[b.length];
}
function tokenInHay(hay, t) {
  if (hay.includes(t)) return true;
  if (t.length < 5) return false;
  const words = hay.split(" ");
  return words.some(
    (w) => Math.abs(w.length - t.length) <= 1 && editDistance(w, t) <= 1,
  );
}
let industrialSearchCache = { query: null, revision: null, products: null, scores: new Map() };
function productScore(p, q) {
  if (typeof VesperIntelligence === "undefined") {
    const nq = norm(q);
    if (!nq) return 1;
    return productHaystack(p).includes(nq) ? 100 : 0;
  }
  const query = clean(q);
  if (!query) return 1;
  const products = state.db?.products || [];
  const revision = `${state.db?.revision ?? 0}:${products.length}`;
  if (industrialSearchCache.query !== query || industrialSearchCache.revision !== revision || industrialSearchCache.products !== products) {
    const results = VesperIntelligence.searchProducts(products, query);
    industrialSearchCache = { query, revision, products, scores: new Map(results.map((r, index) => [r.product.id, r.score + Math.max(0, 1000 - index)])) };
  }
  return industrialSearchCache.scores.get(p.id) || 0;
}
function matchesFilters(p) {
  if (state.filters.family && p.familyKey !== state.filters.family)
    return false;
  if (
    state.filters.supplier &&
    !(
      (p.supplierLinks || []).some(
        (x) => x.supplierId === state.filters.supplier,
      ) || (p.offers || []).some((o) => o.supplierId === state.filters.supplier)
    )
  )
    return false;
  // Melhoria #2: filtro por marca/fabricante
  if (state.filters.brand) {
    const nb = norm(state.filters.brand);
    const pm = norm(p.manufacturer || "");
    if (!pm || !pm.includes(nb)) return false;
  }
  if (state.filters.status && statusOf(p).key !== state.filters.status)
    return false;
  return true;
}
function filteredProducts() {
  let arr = (state.db.products || []).filter(
    (p) => !p.archived && matchesFilters(p),
  );
  const q = clean(state.query);
  if (q) {
    const nq = norm(q),
      exact = arr.filter(
        (p) =>
          norm(p.code) === nq ||
          (p.externalCodes || [])
            .filter(validExternalCode)
            .some((x) => norm(x) === nq),
      );
    arr = (exact.length ? exact : arr)
      .map((p) => ({ p, score: productScore(p, q) }))
      .filter((x) => x.score > 0)
      .sort(
        (a, b) =>
          b.score - a.score || a.p.name.localeCompare(b.p.name, "pt-BR"),
      )
      .map((x) => x.p);
  }
  if (!q || state.filters.sort !== "relevance")
    arr.sort((a, b) => {
      const oa = currentOffer(a),
        ob = currentOffer(b);
      switch (state.filters.sort) {
        case "name":
          return a.name.localeCompare(b.name, "pt-BR");
        case "newest":
          return String(ob?.updatedAt || "").localeCompare(
            String(oa?.updatedAt || ""),
          );
        case "oldest":
          return String(oa?.updatedAt || "9999").localeCompare(
            String(ob?.updatedAt || "9999"),
          );
        case "price":
          return (
            (Number(oa?.finalPrice) || Infinity) -
            (Number(ob?.finalPrice) || Infinity)
          );
        default:
          return a.name.localeCompare(b.name, "pt-BR");
      }
    });
  return arr;
}
function ensureShape(p) {
  p.name = p.displayName || p.name || "Material sem nome";
  p.displayName = p.name;
  p.technicalName = p.technicalName || p.name;
  p.subtitle = p.subtitle || "";
  p.family = p.family || p.category || "Outros";
  p.familyKey = p.familyKey || p.category || "Outros";
  p.group = p.group || p.subcategory || p.family;
  p.specs = Array.isArray(p.specs) ? p.specs : [];
  p.offers = Array.isArray(p.offers) ? p.offers : [];
  p.supplierLinks = Array.isArray(p.supplierLinks) ? p.supplierLinks : [];
  p.manufacturer = p.manufacturer || "";       // Melhoria #2: fabricante/marca
  p.manufacturerAlias = p.manufacturerAlias || "";
  p.quality = p.quality || { needsReview: false, reasons: [] };
  p.resolvedQualityIssues = Array.isArray(p.resolvedQualityIssues)
    ? p.resolvedQualityIssues
    : [];
  p.searchText =
    p.searchText || [p.name, p.technicalName, p.code, p.family].join(" ");
  return p;
}
function rebuildCategories() {
  const map = new Map();
  (state.db.products || []).forEach((p) => {
    const key = p.familyKey || p.family;
    const old = map.get(key) || {
      id: `cat_${key}`,
      key,
      name: p.family || key,
      count: 0,
      icon: p.icon || "box",
    };
    old.count++;
    map.set(key, old);
  });
  state.db.categories = [...map.values()].sort((a, b) =>
    a.name.localeCompare(b.name, "pt-BR"),
  );
}
function supplierRelations(s) {
  const all = [],
    quoted = [],
    listed = [];
  (state.db.products || []).forEach((p) => {
    const kinds = new Set(
      (p.supplierLinks || [])
        .filter((x) => x.supplierId === s.id)
        .map((x) => x.kind),
    );
    if ((p.offers || []).some((o) => o.supplierId === s.id))
      kinds.add("quoted");
    if (kinds.size) {
      all.push(p);
      if (kinds.has("quoted")) quoted.push(p);
      if (kinds.has("listed")) listed.push(p);
    }
  });
  return { all, quoted, listed };
}
function refreshSupplierCounts() {
  (state.db.suppliers || []).forEach((s) => {
    const r = supplierRelations(s);
    s.productCount = r.all.length;
    s.quotedProductCount = r.quoted.length;
    s.listedProductCount = r.listed.length;
  });
}
function addActivity(
  message,
  type = "edit",
  entityType = "",
  entityId = "",
  details = {},
) {
  state.db.activity = state.db.activity || [];
  state.db.auditLog = state.db.auditLog || [];
  const at = new Date().toISOString(),
    entry = {
      id: uid("act"),
      type,
      message,
      at,
      entityType,
      entityId,
      details,
    };
  state.db.activity.unshift(entry);
  state.db.activity = state.db.activity.slice(0, 200);
  state.db.auditLog.unshift(entry);
  state.db.auditLog = state.db.auditLog.slice(0, 1500);
}
function toast(message, type = "") {
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = message;
  $("#toastHost").appendChild(el);
  setTimeout(() => el.remove(), 4200);
}
async function persist(message, opts = {}) {
  try {
    if (typeof VesperIntelligence !== "undefined" && VesperIntelligence.invalidateAll) VesperIntelligence.invalidateAll(state.db?.products);
    industrialSearchCache = { query: null, revision: null, products: null, scores: new Map() };
    state._catalogSearchCache = null;
    if (opts.backup && window.vesper.createAutomaticBackup)
      await window.vesper.createAutomaticBackup(opts.backup);
    const r = await window.vesper.save(state.db);
    if (r?.conflict) {
      showConflict(r.current);
      return false;
    }
    if (r?.data) state.db = r.data;
    if (message) toast(message, "good");
    renderNav();
    updateStorageUi(r?.storage || state.meta?.storage);
    return true;
  } catch (e) {
    toast(e.message || "Não foi possível salvar.", "bad");
    return false;
  }
}
function showConflict(current) {
  const m = modal(
    `<div class="modal-head"><div><h2>Os dados mudaram em outro computador</h2><p>Para evitar perder alterações, recarregue a base compartilhada.</p></div><button class="modal-close" data-close>×</button></div><div class="modal-body"><div class="warning-box">Outra pessoa salvou uma alteração depois que esta tela foi aberta. A alteração atual não foi gravada.</div></div><div class="modal-foot"><button class="button" data-close>Cancelar</button><button class="button primary" id="reloadConflict">Recarregar dados</button></div>`,
  );
  $("#reloadConflict", m.host).onclick = async () => {
    state.db = current || (await window.vesper.load()).data;
    prepareDb();
    m.close();
    render();
    toast("Dados recarregados. Faça novamente a alteração.", "warn");
  };
}
function setTopTitle(t) {
  $("#topTitle").textContent = t;
}
function updateStorageUi(storage = state.meta?.storage) {
  if (!storage) return;
  state.meta = state.meta || {};
  state.meta.storage = storage;
  const shared = storage.mode === "shared" || storage.mode === "server";
  const sync = $("#syncBtn");
  if (sync) sync.hidden = !shared;
}
function modal(html, cls = "") {
  const host = $("#modalHost");
  state.modalOpen = true;
  host.innerHTML = `<div class="modal-backdrop"><div class="modal ${cls}" role="dialog" aria-modal="true">${html}</div></div>`;
  const close = () => {
    host.innerHTML = "";
    state.modalOpen = false;
  };
  host.querySelector(".modal-backdrop").addEventListener("mousedown", (e) => {
    if (e.target === e.currentTarget) close();
  });
  host.querySelectorAll("[data-close]").forEach((b) => (b.onclick = close));
  const fn = (e) => {
    if (e.key === "Escape") {
      close();
      document.removeEventListener("keydown", fn);
    }
  };
  document.addEventListener("keydown", fn);
  setTimeout(() => host.querySelector("input,select,button")?.focus(), 20);
  return { host, close };
}
function pageHead(title, subtitle = "", actions = "") {
  return `<div class="page-head"><div><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div><div class="page-actions">${actions}</div></div>`;
}
function emptyState(title, text, action = "") {
  return `<div class="empty-state"><div class="empty-icon">⌕</div><h3>${esc(title)}</h3><p>${esc(text)}</p>${action ? `<div style="margin-top:14px">${action}</div>` : ""}</div>`;
}
function renderNav() {
  $("#nav").innerHTML = NAV.map(
    ([id, icon, label]) =>
      `<button class="nav-item ${state.view === id ? "active" : ""}" data-nav="${id}"><span class="nav-symbol">${icon}</span><span>${label}</span></button>`,
  ).join("");
  $$('[data-nav]').forEach((b) => (b.onclick = () => go(b.dataset.nav)));
}
function go(v) {
  state.view = v;
  state.limit = 40;
  state.historyLimit = 50;
  state.reviewLimit = 20;
  renderNav();
  render();
}
function rememberProduct(id) {
  state.recent = [id, ...state.recent.filter((x) => x !== id)].slice(0, 8);
  state.db.settings.recentProductIds = state.recent;
  window.vesper.save(state.db).catch(() => {});
}
function externalCodes(p) {
  return (p.externalCodes || []).filter(validExternalCode).slice(0, 4);
}
function groupKey(p) {
  return `${norm(p.familyKey || p.family)}|${norm(p.name)}`;
}
function groupProducts(list) {
  const map = new Map();
  list.forEach((p) => {
    const key = groupKey(p);
    const g = map.get(key) || { key, name: p.name, family: p.family, products: [] };
    g.products.push(p);
    map.set(key, g);
  });
  return [...map.values()];
}
function variantLine(p) {
  const specs = (p.specs || []).slice(0, 3).map((x) => x.value).filter(Boolean);
  return clean(p.subtitle || specs.join(" • ") || p.code || "Variação sem descrição");
}
function legacyGroupedCard(group) {
  if (group.products.length === 1) return productCard(group.products[0]);
  const variants = group.products.slice(0, 3);
  const best = [...group.products].sort((a, b) => (productScore(b, state.query) || 0) - (productScore(a, state.query) || 0))[0];
  return `<article class="product-group-card" data-product-group="${esc(group.key)}"><div class="group-head"><div class="family-icon">${esc(familyMark(best))}</div><div class="group-title"><span>${esc(group.family)}</span><h3>${esc(group.name)}</h3><small>${group.products.length} variações encontradas</small></div></div><div class="variant-list">${variants.map((p) => { const o=currentOffer(p); return `<div class="variant-row" data-product-card="${p.id}"><div class="variant-copy"><b>${esc(variantLine(p))}</b><small>${p.code ? esc(p.code) : "Código não informado"}</small></div><div class="variant-price"><b>${money(o?.finalPrice)}</b><small>${o ? esc(o.supplierName || "Fornecedor não informado") : "Sem preço cadastrado"}</small></div><div class="variant-actions"><button class="button small" data-detail="${p.id}">Ver</button><button class="button small primary" data-price="${p.id}">Registrar</button></div></div>`; }).join("")}</div>${group.products.length > 3 ? `<button class="group-more" data-more-variants="${esc(group.key)}">Ver todas as ${group.products.length} variações</button>` : ""}</article>`;
}
function openVariants(key) {
  const products = state.db.products.filter((p) => groupKey(p) === key);
  if (!products.length) return;
  const m = modal(`<div class="modal-head"><div><h2>${esc(products[0].name)}</h2><p>Escolha a medida ou variação correta.</p></div><button class="modal-close" data-close>×</button></div><div class="modal-body"><div class="results-list">${products.map(productCard).join("")}</div></div><div class="modal-foot"><button class="button primary" data-close>Fechar</button></div>`, "xwide");
  bindCommonActions(m.host);
}
function legacyProductCard(p) {
  const offers = sortedOffers(p),
    o = offers[0],
    prev = offers[1],
    s = statusOf(p),
    chips = (p.specs || []).slice(0, 3);
  return `<article class="product-card" data-product-card="${p.id}"><div class="family-icon">${esc(familyMark(p))}</div><div class="product-main"><div class="product-kicker"><span>${esc(p.family)}</span>${p.code ? `<span class="code-mini">${esc(p.code)}</span>` : ""}${externalCodes(p)[0] ? `<span class="code-mini">${esc(externalCodes(p)[0])}</span>` : ""}</div><div class="product-title">${esc(p.name)}</div>${p.subtitle ? `<div class="product-subtitle">${esc(p.subtitle)}</div>` : ""}${chips.length ? `<div class="spec-chips">${chips.map((x) => `<span class="spec-chip">${esc(x.label)}: ${esc(x.value)}</span>`).join("")}</div>` : ""}</div><div class="price-block"><strong>${money(o?.finalPrice)}</strong><small>${o ? `${esc(o.supplierName || "Fornecedor não informado")} • ${dateBR(o.updatedAt, o.updatedAtRaw)}` : "Registre a primeira compra"}</small>${prev ? `<div class="previous-price">Anterior: ${money(prev.finalPrice)} • ${esc(prev.supplierName || "")}</div>` : ""}<span class="status ${s.class}">${esc(s.label)}</span></div><div class="card-actions"><button class="button small" data-detail="${p.id}">Ver material</button><button class="button small primary" data-price="${p.id}">Registrar compra</button></div></article>`;
}
function bindCommonActions(root = document) {
  $$("[data-detail]", root).forEach(
    (b) =>
      (b.onclick = (e) => {
        e.stopPropagation();
        openDetail(b.dataset.detail);
      }),
  );
  $$("[data-price]", root).forEach(
    (b) =>
      (b.onclick = (e) => {
        e.stopPropagation();
        openPrice(b.dataset.price);
      }),
  );
  $$("[data-edit]", root).forEach(
    (b) =>
      (b.onclick = (e) => {
        e.stopPropagation();
        openEdit(b.dataset.edit);
      }),
  );
  $$("[data-create]", root).forEach((b) => (b.onclick = openCreate));
  $$("[data-product-card]", root).forEach(
    (c) => (c.ondblclick = () => openDetail(c.dataset.productCard)),
  );
}
function familyChips() {
  const cats = [...(state.db.categories || [])]
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);
  return `<div class="category-strip"><button class="category-chip ${!state.filters.family ? "active" : ""}" data-family="">Todas</button>${cats.map((c) => `<button class="category-chip ${state.filters.family === c.key ? "active" : ""}" data-family="${esc(c.key)}">${esc(c.name)} <small>${c.count}</small></button>`).join("")}</div>`;
}
function filterPanel() {
  const cats = state.db.categories || [],
    sups = [...(state.db.suppliers || [])]
      .filter((s) => s.productCount > 0)
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  // Melhoria #2: marcas/fabricantes únicos do catálogo
  const brands = [...new Set(
    (state.db.products || [])
      .map((p) => p.manufacturer)
      .filter(Boolean)
  )].sort((a, b) => a.localeCompare(b, "pt-BR"));
  return `<div class="filter-panel card"><div class="field"><label>Família</label><select id="filterFamily"><option value="">Todas as famílias</option>${cats.map((c) => `<option value="${esc(c.key)}" ${state.filters.family === c.key ? "selected" : ""}>${esc(c.name)} (${c.count})</option>`).join("")}</select></div><div class="field"><label>Fornecedor relacionado</label><select id="filterSupplier"><option value="">Todos os fornecedores</option>${sups.map((s) => `<option value="${s.id}" ${state.filters.supplier === s.id ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select></div>${brands.length ? `<div class="field"><label>Marca / Fabricante</label><select id="filterBrand"><option value="">Todas as marcas</option>${brands.map((b) => `<option value="${esc(b)}" ${state.filters.brand === b ? "selected" : ""}>${esc(b)}</option>`).join("")}</select></div>` : ""}<div class="field"><label>Preço</label><select id="filterStatus"><option value="">Com ou sem compra</option><option value="dated" ${state.filters.status === "dated" ? "selected" : ""}>Com histórico</option><option value="missing" ${state.filters.status === "missing" ? "selected" : ""}>Sem compra registrada</option><option value="undated" ${state.filters.status === "undated" ? "selected" : ""}>Data não informada</option><option value="stale" ${state.filters.status === "stale" ? "selected" : ""}>Último preço conhecido antigo</option></select></div><div class="field"><label>Ordem</label><select id="filterSort"><option value="relevance" ${state.filters.sort === "relevance" ? "selected" : ""}>Mais relevantes</option><option value="name" ${state.filters.sort === "name" ? "selected" : ""}>Nome A–Z</option><option value="newest" ${state.filters.sort === "newest" ? "selected" : ""}>Compra mais recente</option><option value="oldest" ${state.filters.sort === "oldest" ? "selected" : ""}>Compra mais antiga</option><option value="price" ${state.filters.sort === "price" ? "selected" : ""}>Menor preço</option></select></div><button class="button" id="clearFilters">Limpar</button></div>`;
}
function activeFiltersHtml() {
  const tags = [];
  if (state.filters.family)
    tags.push(
      `Família: ${state.db.categories.find((c) => c.key === state.filters.family)?.name || state.filters.family}`,
    );
  if (state.filters.supplier)
    tags.push(
      `Fornecedor: ${state.db.suppliers.find((s) => s.id === state.filters.supplier)?.name || ""}`,
    );
  if (state.filters.status) tags.push("Situação filtrada");
  return tags.length
    ? `<div class="active-filters">${tags.map((x) => `<span class="filter-tag">${esc(x)}</span>`).join("")}</div>`
    : "";
}
function legacyRenderCatalog() {
  setTopTitle("Buscar");
  $("#content").innerHTML = `<section class="search-shell simple-home"><h1>Encontre qualquer material</h1><p>Digite como aparece no boleto, na nota, na embalagem ou no cadastro.</p><div class="search-field"><span class="search-icon">⌕</span><input id="mainSearch" value="${esc(state.query)}" placeholder="Nome, código, medida, aplicação ou fornecedor" autocomplete="off" spellcheck="false" aria-label="Pesquisar materiais"><button class="clear-search" id="clearSearch" aria-label="Limpar pesquisa" ${state.query ? "" : "hidden"}>×</button></div><div class="search-meta"><span>Exemplos: <b>tela peneira</b>, <b>18,1 t</b>, <b>GHG5147407R0001</b></span><span id="searchState"></span></div></section><div id="catalogBody"></div>`;
  let timer;
  const input = $("#mainSearch");
  input.oninput = (e) => {
    state.query = e.target.value;
    state.limit = 30;
    $("#clearSearch").hidden = !state.query;
    clearTimeout(timer);
    timer = setTimeout(updateCatalogBody, 90);
  };
  $("#clearSearch").onclick = () => {
    state.query = "";
    input.value = "";
    state.limit = 30;
    $("#clearSearch").hidden = true;
    updateCatalogBody();
    input.focus();
  };
  updateCatalogBody();
}
function legacyUpdateCatalogBody() {
  const root = $("#catalogBody");
  if (!root) return;
  const q = clean(state.query);
  if (q.length === 1) {
    $("#searchState").textContent = "Digite mais um caractere";
    root.innerHTML = emptyState("Continue digitando", "Use pelo menos 2 caracteres.");
    return;
  }
  if (!q && !state.filters.family && !state.filters.supplier && !state.filters.brand && !state.filters.status) {
    $("#searchState").textContent = `${state.db.products.length} materiais`;
    const recent = state.recent.map((id) => state.db.products.find((p) => p.id === id)).filter(Boolean).slice(0, 4);
    root.innerHTML = `<section class="start-section"><h2>O que você precisa fazer?</h2><div class="task-grid"><button class="task-card primary-task" id="startQuick"><span>⚡</span><b>Atualizar preços</b><small>Um item, uma lista ou XML da NF-e.</small></button><button class="task-card" id="startHistory"><span>◷</span><b>Consultar histórico</b><small>Veja o preço atual e os dois anteriores.</small></button><button class="task-card" id="startCreate"><span>＋</span><b>Cadastrar material</b><small>Cole o nome e salve em poucos segundos.</small></button></div></section>${recent.length ? `<section class="recent-section"><div class="section-bar"><div><h2>Consultados recentemente</h2><p>Abra novamente sem pesquisar.</p></div></div><div class="recent-grid">${recent.map(productCard).join("")}</div></section>` : `<div class="welcome-note">A pesquisa entende nomes, códigos, fornecedores, polegadas e milímetros.</div>`}`;
    $("#startQuick").onclick = () => go("quick");
    $("#startHistory").onclick = () => go("history");
    $("#startCreate").onclick = openCreate;
    bindCommonActions(root);
    return;
  }
  const list = filteredProducts();
  const groups = groupProducts(list);
  const show = groups.slice(0, state.limit);
  $("#searchState").textContent = `${list.length} material${list.length === 1 ? "" : "is"} em ${groups.length} resultado${groups.length === 1 ? "" : "s"}`;
  root.innerHTML = `<div class="result-toolbar"><div><h2>${q ? `Resultados para “${esc(q)}”` : "Materiais"}</h2><p>${list.length} material${list.length === 1 ? "" : "is"} encontrado${list.length === 1 ? "" : "s"}.</p></div><button class="button" id="toggleFilters">${state.filtersOpen ? "Fechar filtros" : "Filtrar"}</button></div>${state.filtersOpen ? filterPanel() : ""}${activeFiltersHtml()}<div class="results-list">${show.length ? show.map(groupedCard).join("") : emptyState("Nenhum material encontrado", "Tente menos palavras, outra medida ou limpe os filtros.")}</div>${show.length < groups.length ? '<button class="button load-more" id="moreProducts">Mostrar mais</button>' : ""}`;
  $("#toggleFilters").onclick = () => { state.filtersOpen = !state.filtersOpen; updateCatalogBody(); };
  if (state.filtersOpen) bindFilters();
  $("#moreProducts")?.addEventListener("click", () => { state.limit += 30; updateCatalogBody(); });
  $$('[data-more-variants]', root).forEach((b) => b.onclick = () => openVariants(b.dataset.moreVariants));
  bindCommonActions(root);
}
function bindFilters() {
  [
    ["filterFamily", "family"],
    ["filterSupplier", "supplier"],
    ["filterBrand", "brand"],   // Melhoria #2
    ["filterStatus", "status"],
    ["filterSort", "sort"],
  ].forEach(([id, key]) => {
    const el = $(`#${id}`);
    if (el)
      el.onchange = () => {
        state.filters[key] = el.value;
        state.limit = 40;
        updateCatalogBody();
      };
  });
  $("#clearFilters").onclick = () => {
    state.filters = { family: "", supplier: "", brand: "", status: "", sort: "relevance" };
    updateCatalogBody();
  };
}
function offerTile(o, index) {
  return `<div class="price-tile ${index === 0 ? "current" : ""}"><span>${index === 0 ? "Preço atual" : index === 1 ? "Preço anterior" : "3º preço"}</span><b>${o ? money(o.finalPrice) : "Sem registro"}</b><small>${o ? `${esc(o.supplierName || "Fornecedor não informado")}<br>${dateBR(o.updatedAt, o.updatedAtRaw)}` : "Ainda não há outro preço salvo"}</small></div>`;
}
function offerRows(offers) {
  return offers.length
    ? offers
        .map((o, i) => {
          const quantity = Number(o.quantity ?? o.divisor ?? 1);
          const adjustments = [
            Number(o.ipi || 0) ? `IPI ${Number(o.ipi).toLocaleString("pt-BR")}%` : "",
            Number(o.adjustment || 0) ? `ajuste ${Number(o.adjustment).toLocaleString("pt-BR")}%` : "",
          ].filter(Boolean).join(" • ");
          return `<tr><td><b>${i === 0 ? "Atual" : i === 1 ? "Anterior" : `${i + 1}º`}</b></td><td>${esc(o.supplierName || "Não informado")}</td><td>${dateBR(o.updatedAt, o.updatedAtRaw)}</td><td>${money(o.basePrice)}${quantity !== 1 ? `<small>Quantidade: ${quantity.toLocaleString("pt-BR")}</small>` : ""}${adjustments ? `<small>${esc(adjustments)}</small>` : ""}</td><td><b>${money(o.finalPrice)}</b></td></tr>`;
        })
        .join("")
    : `<tr><td colspan="5">Nenhum preço registrado</td></tr>`;
}
function technicalOfferRows(offers) {
  return offers.length
    ? offers.map((o, i) => `<tr><td><b>${i === 0 ? "Atual" : i === 1 ? "Anterior" : `${i + 1}º`}</b></td><td>${esc(o.supplierName || "Não informado")}</td><td>${dateBR(o.updatedAt, o.updatedAtRaw)}</td><td>${money(o.basePrice)}</td><td>${o.ipi || 0}%</td><td>${o.adjustment || 0}%</td><td>${o.quantity ?? o.divisor ?? 1}</td><td>${money(o.finalPrice)}</td></tr>`).join("")
    : `<tr><td colspan="8">Nenhum preço registrado</td></tr>`;
}
function openDetail(id) {
  const p = state.db.products.find((x) => x.id === id);
  if (!p) return;
  rememberProduct(id);
  const offers = sortedOffers(p),
    o = offers[0],
    currentSupplier = o ? state.db.suppliers.find((x) => x.id === o.supplierId) : null,
    s = statusOf(p),
    source = p.source || {},
    reasons = unresolvedReasons(p),
    usedSupplierIds = [...new Set(offers.map((x) => x.supplierId).filter(Boolean))],
    usedSuppliers = usedSupplierIds.map((sid) => state.db.suppliers.find((x) => x.id === sid)).filter(Boolean),
    otherRelated = (p.supplierLinks || [])
      .filter((l) => !usedSupplierIds.includes(l.supplierId))
      .map((l) => state.db.suppliers.find((x) => x.id === l.supplierId))
      .filter(Boolean);
  const m = modal(
    `<div class="modal-head"><div><h2>Material</h2><p>${p.code ? `Código ${esc(p.code)}` : esc(p.family)}</p></div><button class="modal-close" data-close>×</button></div><div class="modal-body"><div class="detail-hero"><div><h2>${esc(p.name)}</h2>${p.subtitle ? `<p>${esc(p.subtitle)}</p>` : ""}<div class="spec-chips" style="margin-top:10px"><span class="status ${s.class}">${esc(s.label)}</span>${p.manufacturer ? `<span class="spec-chip" style="background:#e8f5e9;border-color:#c8e6c9;color:#2e7d32">&#127981; ${esc(p.manufacturer)}</span>` : ""}${externalCodes(p).map((x) => `<span class="code-mini">${esc(x)}</span>`).join("")}</div></div><div class="detail-price"><strong>${money(o?.finalPrice)}</strong><small>${o ? `por ${esc(unitText(p.unit))}` : "Aguardando primeiro preço"}</small></div></div><div class="price-trio">${[0, 1, 2].map((i) => offerTile(offers[i], i)).join("")}</div><div class="detail-grid"><div class="detail-panel"><h3>Características</h3>${p.manufacturer ? `<div class="key-row" style="margin-bottom:10px;padding:8px 10px;background:#e8f5e9;border-radius:6px;border:1px solid #c8e6c9"><span style="color:#2e7d32;font-size:11px;text-transform:uppercase;font-weight:700">Fabricante</span><b style="color:#1b5e20">${esc(p.manufacturer)}</b></div>` : ""}${p.specs?.length ? `<div class="spec-grid">${p.specs.slice(0, 8).map((x) => `<div class="spec-box"><span>${esc(x.label)}</span><b>${esc(x.value)}</b></div>`).join("")}</div>` : `<p style="color:var(--muted)">${esc(p.subtitle || "Nenhuma característica separada foi cadastrada.")}</p>`}</div><div class="detail-panel"><h3>${o ? "Último fornecedor" : "Preço"}</h3>${o ? `<div class="key-values"><div class="key-row"><span>Fornecedor</span><b>${esc(o.supplierName || "Não informado")}</b></div><div class="key-row"><span>Data</span><b>${dateBR(o.updatedAt, o.updatedAtRaw)}</b></div>${currentSupplier?.email ? `<div class="key-row"><span>E-mail</span><b>${esc(currentSupplier.email)}</b></div>` : ""}${currentSupplier?.phone ? `<div class="key-row"><span>Telefone</span><b>${esc(currentSupplier.phone)}</b></div>` : ""}</div>` : `<p style="color:var(--muted)">Quando este material for comprado, clique em <b>Registrar compra</b> para registrar a primeira compra.</p>`}</div></div><div class="trace-section"><h3>Histórico de preços</h3><table class="trace-table simple-trace"><thead><tr><th>Registro</th><th>Fornecedor</th><th>Data</th><th>Valor pago</th><th>Preço por ${esc(unitText(p.unit))}</th></tr></thead><tbody>${offerRows(offers)}</tbody></table></div>${usedSuppliers.length > 1 ? `<details class="technical-details"><summary>Ver outros fornecedores já utilizados</summary><div class="related-list">${usedSuppliers.map((sup) => `<div class="related-item"><div><b>${esc(sup.name)}</b><small>${esc(sup.email || sup.phone || "Contato não informado")}</small></div></div>`).join("")}</div></details>` : ""}<details class="technical-details"><summary>Mais informações do cadastro</summary><div class="key-values"><div class="key-row"><span>Categoria</span><b>${esc(p.family)}</b></div><div class="key-row"><span>Grupo</span><b>${esc(p.group || p.subcategory || "Não informado")}</b></div><div class="key-row"><span>Unidade</span><b>${esc(unitText(p.unit))}</b></div><div class="key-row"><span>Origem</span><b>${esc(source.sheet || "Aplicativo")} • linha ${esc(source.row || "—")}</b></div></div><h4>Descrição original</h4><div class="technical-copy">${esc(p.technicalName || p.name)}</div>${otherRelated.length ? `<h4>Outros contatos encontrados na planilha</h4><div class="related-list">${otherRelated.map((sup) => `<div class="related-item"><div><b>${esc(sup.name)}</b><small>${esc(sup.email || sup.phone || "Contato não informado")}</small></div></div>`).join("")}</div>` : ""}${reasons.length ? `<h4>Observações para revisão do cadastro</h4><div class="technical-copy">${reasons.map((x) => `• ${esc(x)}`).join("\n")}</div>` : ""}${offers.length ? `<h4>Cálculo completo dos preços</h4><div class="trace-scroll"><table class="trace-table"><thead><tr><th>Registro</th><th>Fornecedor</th><th>Data</th><th>Valor informado</th><th>IPI</th><th>Ajuste</th><th>Quantidade</th><th>Preço final</th></tr></thead><tbody>${technicalOfferRows(offers)}</tbody></table></div>` : ""}</details></div><div class="modal-foot"><button class="button" data-edit="${p.id}">Editar cadastro</button><button class="button primary" data-price-modal="${p.id}">Registrar compra</button></div>`,
    "xwide",
  );
  m.host.querySelector("[data-price-modal]").onclick = () => {
    m.close();
    openPrice(id);
  };
  m.host.querySelector("[data-edit]").onclick = () => {
    m.close();
    openEdit(id);
  };
}
function supplierOptions(selected = "") {
  return `<option value="">Selecione um fornecedor</option>${[
    ...(state.db.suppliers || []),
  ]
    .filter(
      (s) =>
        s.productCount > 0 || s.sources?.some((x) => /Aplicativo/i.test(x)),
    )
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
    .map(
      (s) =>
        `<option value="${s.id}" ${s.id === selected ? "selected" : ""}>${esc(s.name)}</option>`,
    )
    .join("")}`;
}
function priceFormula(base, ipi, adj, div, manual) {
  const m = Number(manual || 0);
  if (m > 0) return m;
  return div > 0
    ? (Number(base || 0) *
        (1 + Number(ipi || 0) / 100 + Number(adj || 0) / 100)) /
        Number(div)
    : 0;
}
function legacyOpenPrice(id) {
  const p = state.db.products.find((x) => x.id === id);
  if (!p) return;
  const o = currentOffer(p),
    today = new Date().toISOString().slice(0, 10);
  const m = modal(
    `<form id="priceForm"><div class="modal-head"><div><h2>Registrar compra</h2><p>${esc(p.name)}</p></div><button type="button" class="modal-close" data-close>×</button></div><div class="modal-body"><div class="success-box">O preço anterior continuará guardado no histórico.</div><div class="form-grid" style="margin-top:14px"><div class="field span-2"><label>Fornecedor *</label><select name="supplierId" required>${supplierOptions(o?.supplierId || "")}</select></div><div class="field"><label>Valor pago (R$) *</label><input type="number" name="basePrice" min="0.0001" step="0.0001" value="" placeholder="Ex.: 838,20" required><small>Informe o total pago por esta quantidade.</small></div><div class="field"><label>Quantidade comprada</label><input type="number" name="quantity" min="0.0001" step="0.0001" value="1"><small>Se o valor já for unitário, deixe 1.</small></div><div class="field"><label>Data</label><input type="date" name="updatedAt" value="${today}"><small>Já vem preenchida com hoje.</small></div><div class="field"><label>Preço por ${esc(unitText(p.unit))}</label><input id="calculatedPrice" readonly></div><details class="optional-details span-2"><summary>Impostos ou ajuste especial — opcional</summary><div class="form-grid"><div class="field"><label>IPI (%)</label><input type="number" name="ipi" step="0.01" value="0"></div><div class="field"><label>Ajuste (%)</label><input type="number" name="adjustment" step="0.01" value="0"></div><div class="field span-2"><label>Preço unitário manual</label><input type="number" name="manualFinal" min="0.0001" step="0.0001" placeholder="Use somente quando o cálculo comum não se aplicar"></div></div><small>O aplicativo calcula (valor pago + ajustes) ÷ quantidade.</small></details><div class="field span-2"><label>Observação — opcional</label><textarea name="notes" placeholder="Ex.: número da nota, prazo ou condição especial"></textarea></div></div></div><div class="modal-foot"><button type="button" class="button" data-close>Cancelar</button><button class="button primary" type="submit">Salvar preço</button></div></form>`,
  );
  const f = $("#priceForm", m.host),
    calc = () => {
      const fd = new FormData(f);
      $("#calculatedPrice", m.host).value = money(
        priceFormula(
          fd.get("basePrice"),
          fd.get("ipi"),
          fd.get("adjustment"),
          fd.get("quantity") || 1,
          fd.get("manualFinal"),
        ),
      );
    };
  ["input", "change"].forEach((ev) => f.addEventListener(ev, calc));
  calc();
  f.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(f),
      sid = fd.get("supplierId"),
      sup = state.db.suppliers.find((s) => s.id === sid);
    if (!sup) {
      toast("Escolha um fornecedor.", "bad");
      return;
    }
    const base = Number(fd.get("basePrice")),
      ipi = Number(fd.get("ipi") || 0),
      adjustment = Number(fd.get("adjustment") || 0),
      quantity = Number(fd.get("quantity") || 1),
      manualFinal = Number(fd.get("manualFinal") || 0),
      finalPrice = priceFormula(base, ipi, adjustment, quantity, manualFinal),
      offer = {
        id: uid("off"),
        supplierId: sid,
        supplierName: sup.name,
        basePrice: base,
        ipi,
        adjustment,
        quantity,
        finalPrice,
        updatedAt: fd.get("updatedAt") || today,
        updatedAtRaw: "",
        email: sup.email || "",
        phone: sup.phone || "",
        notes: clean(fd.get("notes")),
        source: { sheet: "Aplicativo", row: "" },
        qualityIssues: [],
        calculationMode: manualFinal > 0 ? "manual" : "standard",
        manualFinal: manualFinal || undefined,
        percentUnit: "percent",
      };
    p.offers.push(offer);
    if (
      !(p.supplierLinks || []).some(
        (x) => x.supplierId === sid && x.kind === "quoted",
      )
    )
      p.supplierLinks.push({
        supplierId: sid,
        name: sup.name,
        kind: "quoted",
        source: "Aplicativo",
      });
    addActivity(
      `Preço de ${p.name} atualizado para ${money(finalPrice)}`,
      "price",
      "product",
      p.id,
      { offerId: offer.id },
    );
    refreshSupplierCounts();
    if (
      await persist("Preço salvo. O histórico anterior foi mantido.", {
        backup: "antes-atualizar-preco",
      })
    ) {
      m.close();
      render();
    }
  };
  setTimeout(() => f.elements.basePrice.focus(), 60);
}
function similarProducts(name, code = "", exclude = "") {
  const q = norm(name),
    c = norm(code);
  return state.db.products
    .filter(
      (p) =>
        p.id !== exclude &&
        ((c && norm(p.code) === c) ||
          (q.length > 4 &&
            (norm(p.name).includes(q) || q.includes(norm(p.name))))),
    )
    .slice(0, 5);
}
function specsText(p) {
  return (p.specs || []).map((x) => `${x.label}: ${x.value}`).join("\n");
}
function parseSpecs(text) {
  return String(text || "")
    .split(/\n+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => {
      const i = x.indexOf(":");
      return i > 0
        ? { label: x.slice(0, i).trim(), value: x.slice(i + 1).trim() }
        : { label: "Característica", value: x };
    });
}
function categoryByNameHint(text) {
  const hard = strongCategoryHint(text);
  if (hard !== null) return hard;
  const n = norm(text);
  const has = (...keys) => keys.some((key) => n.includes(norm(key)));
  const available = (key) => state.db.categories.some((c) => c.key === key);
  const choose = (...keys) => keys.find(available) || "";

  // Primeiro resolve combinações específicas. "Inox" sozinho nunca define a família.
  if (has("inox", "aço inox", "aco inox")) {
    if (has("parafuso", "porca", "arruela", "rebite", "grampo", "chumbador"))
      return choose("Fixadores Inox", "Fixadores");
    if (has("cantoneira")) return choose("Cantoneira Inox", "Cantoneira");
    if (has("barra chata", "barra redonda", "barra"))
      return choose("Barra Chata Inox", "Barra Chata e Redonda");
    if (has("tela", "arame"))
      return choose("Arame e Tela Inox", "Arame e Tela");
    if (has("chapa", "tubo")) return choose("Chapa e Tubo Inox", "Chapas");
    if (has("rodizio", "rodízio", "roda"))
      return choose("Rodizios Inox", "Rodizios");
    if (has("eslinga", "tarugo")) return choose("Tarugo - Eslinga Inox");
  }

  const rules = [
    [/flange.*(?:inox|aço|aco|alum[ií]nio|dn|ansi|npt|rosca|tubo|solda|industrial)|(?:inox|aço|aco|alum[ií]nio|dn|ansi|npt|rosca|tubo|solda|industrial).*flange/, "Tubo e Tarugo - Flange"],
    [/parafuso|porca|arruela|rebite|grampo|chumbador/, "Fixadores"],
    [/chapa/, "Chapas"],
    [/cantoneira/, "Cantoneira"],
    [/tela|arame/, "Arame e Tela"],
    [/rod[ií]zio|roda/, "Rodizios"],
    [
      /plugue|tomada|prensa.?cabo|painel.*(?:ex|explos)|(?:exd|ex db|atex|ip66)/,
      "Mat. Elétrico Ex",
    ],
    [
      /cabo|tomada|plugue|disjuntor|rele|relé|capacitor|painel/,
      "Mat. Elétrico",
    ],
    [/solda|eletrodo|mig|tig/, "Mat. p Solda"],
    [/pvc|borracha|mangueira/, "PVC"],
    [/hélice|helice|ventilador/, "Hélice FM"],
    [/eslinga|tarugo inox/, "Tarugo - Eslinga Inox"],
    [/conex[aã]o|niple|luva|cotovelo|valvula|válvula/, "Conexões Alta Pressão"],
    [/caixa|pallet|embalagem|saco|filme stretch/, "Embalagem"],
    [/climatizador|filtro.*climat/, "CLIMATIZADORES"],
  ];
  for (const [re, key] of rules) if (re.test(n) && available(key)) return key;

  return "";
}
function extractSpecsFromName(text) {
  const s = clean(text),
    out = [];
  const add = (label, value) => {
    if (value && !out.some((x) => norm(x.label) === norm(label) && norm(x.value) === norm(value)))
      out.push({ label, value });
  };
  const dimension = s.match(
    /(?:\d+[.,]?\d*\s*(?:mm|cm|m|"|”|″))(?:\s*[x×]\s*\d+[.,]?\d*\s*(?:mm|cm|m|"|”|″)?){1,2}/i,
  );
  if (dimension) add("Medida", dimension[0].replace(/x/gi, "×"));
  const voltage = s.match(/\b\d+(?:[\/.-]\d+)?\s*(?:V|kV)\b/i);
  if (voltage) add("Tensão", voltage[0]);
  const current = s.match(/\b\d+(?:[.,]\d+)?\s*A\b/i);
  if (current) add("Corrente", current[0]);
  const capacity = s.match(/\b\d+(?:[.,]\d+)?\s*(?:kg|t|ton(?:eladas?)?)\b/i);
  if (capacity) add("Capacidade", capacity[0]);
  const protection = s.match(/\bIP\s*\d{2}(?:\/\d{2})?\b/i);
  if (protection) add("Proteção", protection[0].replace(/\s/g, ""));
  const poles = s.match(/\b\d+P(?:\+T)?\b/i);
  if (poles) add("Polos", poles[0]);
  const length = s.match(/\b\d+(?:[.,]\d+)?\s*m\b/i);
  if (length && !dimension) add("Comprimento", length[0]);

  // Extração de cor local
  const colors = ["preta", "preto", "prata", "branco", "branca", "azul", "amarela", "amarelo", "verde", "vermelha", "vermelho", "cinza", "marrom"];
  const textNorm = norm(s);
  for (const c of colors) {
    if (new RegExp(`\\b${c}\\b`, "i").test(textNorm)) {
      add("Cor", c);
      break;
    }
  }

  // Identificação de marcas locais cruzando com fornecedores cadastrados
  if (state.db && state.db.suppliers) {
    for (const sup of state.db.suppliers) {
      const supNorm = norm(sup.name);
      if (supNorm.length > 2 && new RegExp(`\\b${supNorm}\\b`, "i").test(textNorm)) {
        add("Marca", sup.name);
        break;
      }
    }
  }

  return normalizeSpecsList(out);
}
function onlineResearchUrl(query) {
  const q = clean(query);
  if (/^\d{8}$|^\d{12,14}$/.test(q.replace(/\D/g, "")))
    return "https://www.gs1br.org/consulta-gtin";
  return `https://www.google.com/search?q=${encodeURIComponent(`ficha técnica fabricante ${q}`)}`;
}
function openOnlineResearch(query) {
  const url = onlineResearchUrl(query);
  if (window.vesper.openExternal) window.vesper.openExternal(url);
  else window.open(url, "_blank", "noopener");
}
function legacyOpenCreate() {
  const today=new Date().toISOString().slice(0,10);
  const m=modal(`<form id="createForm"><div class="modal-head"><div><h2>Cadastrar material</h2><p>Cole o nome da nota, boleto ou embalagem. Só o nome é obrigatório.</p></div><button type="button" class="modal-close" data-close>×</button></div><div class="modal-body"><div class="field"><label>Nome ou descrição *</label><textarea class="create-main-input" name="name" rows="2" placeholder="Ex.: Parafuso Philips inox M5 × 16 mm" required></textarea><small>Escreva do seu jeito. O aplicativo sugere a organização.</small></div><div class="form-grid"><div class="field"><label>Código — opcional</label><input name="code" placeholder="Código interno, fabricante ou GTIN"></div><div class="field"><label>Unidade</label><select name="unit"><option value="un">Unidade</option><option value="m">Metro</option><option value="m²">Metro quadrado</option><option value="kg">Quilo</option><option value="par">Par</option><option value="rolo">Rolo</option><option value="cx">Caixa</option></select></div></div><div id="createAssistant"></div><details class="optional-details"><summary>Completar ficha — opcional</summary><div class="form-grid"><div class="field"><label>Categoria sugerida</label><select name="familyKey"><option value="">Detectar automaticamente</option>${[...(state.db.categories||[])].sort((a,b)=>a.name.localeCompare(b.name,"pt-BR")).map((c)=>`<option value="${esc(c.key)}">${esc(c.name)}</option>`).join("")}</select></div><div class="field"><label>Uso ou resumo</label><input name="subtitle" placeholder="Ex.: para grade de ventilador"></div><div class="field span-2"><label>Descrição técnica original</label><textarea name="technicalName" placeholder="Cole a descrição completa, se precisar preservá-la."></textarea></div></div></details><details class="optional-details"><summary>Adicionar o primeiro preço — opcional</summary><div class="form-grid"><div class="field span-2"><label>Fornecedor</label><select name="supplierId">${supplierOptions("")}</select></div><div class="field"><label>Valor pago</label><input name="total" type="number" min="0" step="0.0001" placeholder="0,00"></div><div class="field"><label>Quantidade comprada</label><input name="quantity" type="number" min="0.0001" step="0.0001" value="1"></div><div class="field"><label>Data</label><input name="updatedAt" type="date" value="${today}"></div><div class="field"><label>Preço calculado</label><input id="createCalculated" value="Preço não informado" readonly></div></div></details></div><div class="modal-foot"><button type="button" class="button" data-close>Cancelar</button><button class="button primary">Salvar material</button></div></form>`,"wide");
  const form=$("#createForm",m.host), assistant=$("#createAssistant",m.host);
  function updateAssistant(){
    const name=clean(form.elements.name.value), code=clean(form.elements.code.value), suggested=categoryByNameHint(`${name} ${code}`), inferred=extractSpecsFromName(name), similar=name.length>=3?state.db.products.map((p)=>({p,score:productScore(p,`${name} ${code}`)})).filter((x)=>x.score>220).sort((a,b)=>b.score-a.score).slice(0,3).map((x)=>x.p):[];
    if(suggested&&!form.elements.familyKey.value)form.elements.familyKey.value=suggested;
    assistant.innerHTML=(suggested||inferred.length||similar.length)?`<div class="assistant-card compact-assistant"><div><b>${suggested?`Categoria sugerida: ${esc(state.db.categories.find((c)=>c.key===suggested)?.name||suggested)}`:"Sugestões"}</b>${inferred.length?`<small>Reconhecido: ${esc(inferred.map((x)=>`${x.label} ${x.value}`).join(" • "))}</small>`:""}</div>${similar.length?`<div class="similar-list"><span>Confira se já existe:</span>${similar.map((p)=>`<button type="button" data-open-existing="${p.id}"><b>${esc(p.name)}</b><small>${esc(variantLine(p))}</small></button>`).join("")}</div>`:""}<button type="button" class="button small" id="researchOnline" ${name||code?"":"disabled"}>Pesquisar referência local/web</button></div>`:"";
    $$('[data-open-existing]',assistant).forEach((b)=>b.onclick=()=>{m.close();openDetail(b.dataset.openExisting);});
    $("#researchOnline",assistant)?.addEventListener("click",()=>openOnlineResearch(code||name));
  }
  let timer; form.elements.name.oninput=form.elements.code.oninput=()=>{clearTimeout(timer);timer=setTimeout(updateAssistant,120);};
  const calc=()=>{const total=Number(form.elements.total.value||0),qty=Number(form.elements.quantity.value||1);$("#createCalculated",m.host).value=total>0&&qty>0?money(total/qty):"Preço não informado";};
  form.elements.total.oninput=form.elements.quantity.oninput=calc;
  form.onsubmit=async(e)=>{
    e.preventDefault(); const fd=new FormData(form), name=clean(fd.get("name")), code=clean(fd.get("code")); if(!name)return toast("Informe o nome do material.","bad");
    const exact=state.db.products.find((p)=>(code&&([p.code,...(p.externalCodes||[])].some((x)=>norm(x)===norm(code))))||norm(p.name)===norm(name));
    if(exact&&confirm(`Este material parece já existir:\n\n${exact.name}\n${variantLine(exact)}\n\nAbrir o cadastro existente?`)){m.close();openDetail(exact.id);return;}
    const familyKey=fd.get("familyKey")||categoryByNameHint(`${name} ${code}`)||"Outros", cat=state.db.categories.find((c)=>c.key===familyKey)||{key:familyKey,name:familyKey,icon:"box"}, specs=extractSpecsFromName(name), total=Number(fd.get("total")||0), quantity=Number(fd.get("quantity")||1), supplierId=fd.get("supplierId")||"";
    if(total>0&&!supplierId)return toast("Escolha o fornecedor do preço informado.","bad");
    const p={id:uid("prd"),code,name,displayName:name,technicalName:clean(fd.get("technicalName"))||name,description:"",category:cat.key,familyKey:cat.key,family:cat.name,subcategory:"Cadastrado no aplicativo",group:"Cadastrado no aplicativo",sectionPath:[],subtitle:clean(fd.get("subtitle")),unit:fd.get("unit")||"un",notes:"",icon:cat.icon||"box",specs,quality:{needsReview:false,reasons:[]},resolvedQualityIssues:[],favorite:false,archived:false,contacts:[],aliases:[name],externalCodes:code?[code]:[],source:{sheet:"Aplicativo",row:""},sources:[{sheet:"Aplicativo",row:""}],supplierLinks:[],searchText:[name,code,fd.get("subtitle"),fd.get("technicalName"),...specs.flatMap((x)=>[x.label,x.value])].join(" "),offers:[]};
    if(total>0&&supplierId){const sup=state.db.suppliers.find((x)=>x.id===supplierId);p.offers.push({id:uid("off"),supplierId:sup.id,supplierName:sup.name,basePrice:total,ipi:0,adjustment:0,quantity:quantity||1,finalPrice:total/(quantity||1),updatedAt:fd.get("updatedAt")||today,updatedAtRaw:"",email:sup.email||"",phone:sup.phone||"",notes:"Cadastro inicial",source:{sheet:"Aplicativo",row:""},qualityIssues:[],calculationMode:"standard",percentUnit:"percent"});p.supplierLinks.push({supplierId:sup.id,name:sup.name,kind:"quoted",source:"Aplicativo"});}
    state.db.products.unshift(p);rebuildCategories();refreshSupplierCounts();addActivity(`Material ${p.name} cadastrado`,"create","product",p.id);if(await persist("Material cadastrado.",{backup:"antes-cadastrar-material"})){m.close();state.query=p.name;go("catalog");}
  };
  setTimeout(()=>form.elements.name.focus(),20);
}
function openEdit(id) {
  const p = state.db.products.find((x) => x.id === id);
  if (!p) return;
  const m = modal(
    `<form id="editForm"><div class="modal-head"><div><h2>Editar cadastro</h2><p>Altere somente informações confirmadas.</p></div><button type="button" class="modal-close" data-close>×</button></div><div class="modal-body"><div class="form-grid"><div class="field span-2"><label>Nome simples *</label><input name="name" value="${esc(p.name)}" required></div><div class="field"><label>Código interno</label><input name="code" value="${esc(p.code || "")}"></div><div class="field"><label>Unidade</label><select name="unit"><option value="un" ${p.unit === "un" ? "selected" : ""}>Unidade</option><option value="m" ${p.unit === "m" ? "selected" : ""}>Metro</option><option value="m²" ${p.unit === "m²" ? "selected" : ""}>Metro quadrado</option><option value="kg" ${p.unit === "kg" ? "selected" : ""}>Quilo</option><option value="par" ${p.unit === "par" ? "selected" : ""}>Par</option><option value="rolo" ${p.unit === "rolo" ? "selected" : ""}>Rolo</option></select></div><div class="field span-2"><label>Fabricante / Marca <span style="font-weight:400;color:var(--muted)">— Melhoria #2</span></label><input name="manufacturer" value="${esc(p.manufacturer || "")}" placeholder="Ex.: 3M, Tramontina, Tigre, WEG"><small>Distinto do fornecedor que vende. Usado para filtrar por marca.</small></div><div class="field span-2"><label>Resumo</label><input name="subtitle" value="${esc(p.subtitle || "")}"></div><div class="field span-2"><label>Especificações (uma por linha: Nome: valor)</label><textarea name="specs">${esc(specsText(p))}</textarea></div><div class="field span-2"><label>Descrição técnica original</label><textarea name="technicalName">${esc(p.technicalName || "")}</textarea></div><div class="field span-2"><label>Observações</label><textarea name="notes">${esc(p.notes || "")}</textarea></div></div></div><div class="modal-foot"><button type="button" class="button" data-close>Cancelar</button><button class="button primary">Salvar alterações</button></div></form>`,
    "wide",
  );
  $("#editForm", m.host).onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget),
      before = {
        name: p.name,
        code: p.code,
        subtitle: p.subtitle,
        specs: p.specs,
      };
    p.name = clean(fd.get("name"));
    p.displayName = p.name;
    p.code = clean(fd.get("code"));
    p.unit = fd.get("unit");
    p.subtitle = clean(fd.get("subtitle"));
    p.specs = parseSpecs(fd.get("specs"));
    p.technicalName = clean(fd.get("technicalName")) || p.name;
    p.notes = clean(fd.get("notes"));
    p.manufacturer = clean(fd.get("manufacturer") || "");  // Melhoria #2
    p.searchText = [
      p.searchText,
      p.name,
      p.code,
      p.subtitle,
      p.technicalName,
      ...p.specs.flatMap((x) => [x.label, x.value]),
    ].join(" ");
    addActivity(`Cadastro de ${p.name} editado`, "edit", "product", p.id, {
      before,
      after: {
        name: p.name,
        code: p.code,
        subtitle: p.subtitle,
        specs: p.specs,
      },
    });
    if (
      await persist("Cadastro atualizado.", { backup: "antes-editar-material" })
    ) {
      m.close();
      render();
    }
  };
}
function quickSearchResults() {
  const q = clean(state.quickQuery);
  if (q.length < 2) return [];
  return state.db.products
    .map((p) => ({ p, score: productScore(p, q) }))
    .filter(
      (x) =>
        x.score > 0 && !state.quickQueue.some((y) => y.productId === x.p.id),
    )
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map((x) => x.p);
}
function legacyAddQuickProduct(id) {
  const p = state.db.products.find((x) => x.id === id);
  if (!p || state.quickQueue.some((x) => x.productId === id)) return;
  const o = currentOffer(p);
  state.quickQueue.push({
    productId: id,
    supplierId: o?.supplierId || "",
    basePrice: "",
    ipi: 0,
    adjustment: 0,
    quantity: 1,
    updatedAt: new Date().toISOString().slice(0, 10),
    notes: "",
  });
  state.quickQuery = "";
  renderQuick();
  setTimeout(() => $$("[data-quick-base]").at(-1)?.focus(), 40);
}
function renderQuickPickerResults() {
  const root = $("#quickPickerResults");
  if (!root) return;
  const results = quickSearchResults();
  root.innerHTML =
    state.quickQuery.length < 2
      ? '<div class="queue-empty compact">Digite pelo menos 2 caracteres.</div>'
      : results.length
        ? results
            .map((p) => {
              const o = currentOffer(p);
              return `<button class="picker-item" data-add-quick="${p.id}"><div><b>${esc(p.name)}</b><small>${esc(p.subtitle || p.family)}${p.code ? ` • ${esc(p.code)}` : ""}</small></div><span>${money(o?.finalPrice)}</span></button>`;
            })
            .join("")
        : '<div class="queue-empty compact">Nenhum material encontrado. Tente menos palavras ou confira o código.</div>';
  $$("[data-add-quick]", root).forEach(
    (b) => (b.onclick = () => addQuickProduct(b.dataset.addQuick)),
  );
}
function parseInvoiceMoney(line) {
  const matches = [
    ...String(line).matchAll(
      /(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*|\d+)[,.](\d{2,4})/g,
    ),
  ];
  if (!matches.length) return { price: "", query: clean(line) };
  const m = matches[matches.length - 1],
    raw = m[0];
  const price = Number(`${m[1].replace(/\./g, "")}.${m[2]}`);
  return {
    price: Number.isFinite(price) ? price : "",
    query: clean(String(line).replace(raw, " ")),
  };
}
function topProductsForText(text, limit = 5) {
  return state.db.products
    .map((p) => ({ p, score: productScore(p, text) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.p);
}
function openPasteInvoice() {
  const m = modal(
    `<div class="modal-head"><div><h2>Colar itens do boleto ou nota</h2><p>Cole uma linha por item. O aplicativo separa o último valor e sugere o material.</p></div><button class="modal-close" data-close>×</button></div><div class="modal-body"><div class="field"><label>Itens copiados</label><textarea id="invoicePaste" rows="8" placeholder="Ex.: VPC6070019 Tela Peneira 4x22  R$ 38,00
PFI4PP1005G Parafuso Philips M5x16  R$ 0,24"></textarea></div><div class="info-box">Nada será salvo automaticamente. Você revisará o material e o preço antes de adicionar à lista.</div><div id="invoicePreview"></div></div><div class="modal-foot"><button class="button" data-close>Cancelar</button><button class="button" id="previewInvoice">Analisar linhas</button><button class="button primary" id="applyInvoice" disabled>Adicionar selecionados</button></div>`,
    "wide",
  );
  let parsed = [];
  $("#previewInvoice", m.host).onclick = () => {
    parsed = $("#invoicePaste", m.host)
      .value.split(/\n+/)
      .map(clean)
      .filter(Boolean)
      .map((line, index) => {
        const x = parseInvoiceMoney(line),
          options = topProductsForText(x.query, 5);
        return {
          index,
          line,
          query: x.query,
          price: x.price,
          options,
          productId: options[0]?.id || "",
        };
      });
    $("#invoicePreview", m.host).innerHTML = parsed.length
      ? `<div class="invoice-preview">${parsed.map((x) => `<div class="invoice-line"><div><b>${esc(x.line)}</b><small>${x.options.length ? "Confira a sugestão" : "Nenhum material sugerido"}</small></div><select data-invoice-product="${x.index}"><option value="">Não adicionar</option>${x.options.map((p) => `<option value="${p.id}" ${p.id === x.productId ? "selected" : ""}>${esc(p.name)}${p.code ? ` — ${esc(p.code)}` : ""}</option>`).join("")}</select><input data-invoice-price="${x.index}" type="number" min="0" step="0.0001" value="${x.price || ""}" placeholder="Preço"></div>`).join("")}</div>`
      : emptyState(
          "Nenhuma linha",
          "Cole ao menos uma linha do boleto ou da nota.",
        );
    $("#applyInvoice", m.host).disabled = !parsed.length;
  };
  $("#applyInvoice", m.host).onclick = () => {
    parsed.forEach((x) => {
      const pid = $(`[data-invoice-product="${x.index}"]`, m.host)?.value;
      const price = Number(
        $(`[data-invoice-price="${x.index}"]`, m.host)?.value || 0,
      );
      if (!pid) return;
      const p = state.db.products.find((z) => z.id === pid),
        o = currentOffer(p);
      let q = state.quickQueue.find((z) => z.productId === pid);
      if (!q) {
        q = {
          productId: pid,
          supplierId: o?.supplierId || "",
          basePrice: "",
          ipi: 0,
          adjustment: 0,
          quantity: 1,
          updatedAt: new Date().toISOString().slice(0, 10),
          notes: "Boleto/nota",
        };
        state.quickQueue.push(q);
      }
      if (price > 0) q.basePrice = String(price);
    });
    m.close();
    renderQuick();
    setTimeout(
      () =>
        $$("[data-quick-base]")
          .find((x) => !x.value)
          ?.focus(),
      40,
    );
  };
}
function textOf(node, tag) {
  return clean(node?.getElementsByTagName(tag)?.[0]?.textContent || "");
}
function parseNfeXmlText(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("O XML não pôde ser lido.");
  const emit = doc.getElementsByTagName("emit")[0];
  const ide = doc.getElementsByTagName("ide")[0];
  const supplier = { name: textOf(emit, "xNome"), cnpj: textOf(emit, "CNPJ"), email: textOf(emit, "email") };
  const supplierObj = ensureNfeSupplier(supplier);
  const rawDate = textOf(ide, "dhEmi") || textOf(ide, "dEmi");
  const date = /^\d{4}-\d{2}-\d{2}/.test(rawDate) ? rawDate.slice(0,10) : new Date().toISOString().slice(0,10);
  const items = [...doc.getElementsByTagName("det")].map((det, index) => {
    const prod = det.getElementsByTagName("prod")[0];
    const code = textOf(prod, "cProd");
    const gtin = textOf(prod, "cEAN") || textOf(prod, "cEANTrib");
    const name = textOf(prod, "xProd");
    const quantity = Number(textOf(prod, "qCom").replace(",", ".")) || 1;
    const unitPrice = Number(textOf(prod, "vUnCom").replace(",", ".")) || 0;
    const total = Number(textOf(prod, "vProd").replace(",", ".")) || unitPrice * quantity;

    // Busca na calibração automática de códigos do fornecedor
    const mapKey = `${supplierObj.id}:${code}`;
    const mappedProductId = state.db.supplierCodes ? state.db.supplierCodes[mapKey] : null;
    let exact = null;
    if (mappedProductId) {
      exact = state.db.products.find((p) => p.id === mappedProductId);
    }
    if (!exact) {
      exact = state.db.products.find((p) => [p.code, ...(p.externalCodes || [])].some((x) => x && [code,gtin].includes(clean(x))));
    }

    const options = exact ? [exact] : topProductsForText(`${code} ${gtin} ${name}`, 5);
    return { index, code, gtin, name, quantity, unit: textOf(prod,"uCom"), total, unitPrice, options, productId: options[0]?.id || "" };
  }).filter((x) => x.name || x.code);
  return { supplier, date, items };
}
function ensureNfeSupplier(info) {
  const key = norm(info.name);
  let s = state.db.suppliers.find((x) => (info.cnpj && x.cnpj === info.cnpj) || norm(x.name) === key);
  if (!s) {
    s = { id: uid("sup"), name: info.name || "Fornecedor da NF-e", email: info.email || "", phone: "", cnpj: info.cnpj || "", aliases: [], sources: ["NF-e"], productCount: 0, quotedProductCount: 0, listedProductCount: 0 };
    state.db.suppliers.push(s);
  }
  return s;
}
function openNfeXml() {
  const m = modal(`<div class="modal-head"><div><h2>Importar XML da NF-e</h2><p>O aplicativo lê os itens, quantidades, preços e fornecedor. Nada é salvo antes da sua conferência.</p></div><button class="modal-close" data-close>×</button></div><div class="modal-body"><div class="upload-zone"><input type="file" id="nfeFile" accept=".xml,text/xml,application/xml"><b>Escolha o XML da nota fiscal</b><small>O arquivo fica somente neste computador.</small></div><div id="nfePreview"></div></div><div class="modal-foot"><button class="button" data-close>Cancelar</button><button class="button primary" id="applyNfe" disabled>Adicionar itens à lista</button></div>`, "xwide");
  let parsed = null;
  $("#nfeFile", m.host).onchange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      parsed = parseNfeXmlText(await file.text());
      $("#nfePreview", m.host).innerHTML = parsed.items.length ? `<div class="nfe-summary"><b>${esc(parsed.supplier.name || "Fornecedor não informado")}</b><span>${parsed.items.length} item${parsed.items.length===1?"":"s"} • ${dateBR(parsed.date)}</span></div><div class="invoice-preview">${parsed.items.map((x) => `<div class="invoice-line"><div><b>${esc(x.name)}</b><small>${esc([x.code,x.gtin].filter(Boolean).join(" • "))} • ${x.quantity} ${esc(x.unit)} • total ${money(x.total)}</small></div><select data-nfe-product="${x.index}"><option value="">Não adicionar</option>${x.options.map((p) => `<option value="${p.id}" ${p.id===x.productId?"selected":""}>${esc(p.name)}${p.subtitle?` — ${esc(p.subtitle)}`:""}</option>`).join("")}</select></div>`).join("")}</div>` : emptyState("Nenhum item encontrado", "Confira se o arquivo é um XML de NF-e válido.");
      $("#applyNfe", m.host).disabled = !parsed.items.length;
    } catch (err) { toast(err.message || "Não foi possível ler o XML.", "bad"); }
  };
  $("#applyNfe", m.host).onclick = () => {
    if (!parsed) return;
    const supplier = ensureNfeSupplier(parsed.supplier);

    // Inicializa tabela de calibração se não existir
    state.db.supplierCodes = state.db.supplierCodes || {};

    parsed.items.forEach((x) => {
      const pid = $(`[data-nfe-product="${x.index}"]`, m.host)?.value;
      if (!pid) return;

      // Calibração automática: aprende a associação
      if (x.code) {
        const mapKey = `${supplier.id}:${x.code}`;
        state.db.supplierCodes[mapKey] = pid;
      }

      let q = state.quickQueue.find((z) => z.productId === pid);
      if (!q) { q = { productId: pid, supplierId: supplier.id, basePrice: "", ipi: 0, adjustment: 0, quantity: 1, updatedAt: parsed.date, notes: "Importado de XML da NF-e" }; state.quickQueue.push(q); }
      q.supplierId = supplier.id;
      q.basePrice = String(x.total || x.unitPrice || "");
      q.quantity = x.quantity || 1;
      q.updatedAt = parsed.date;
    });

    // Persiste no banco de dados local a calibração
    persist("Importação da NF-e concluída. Códigos de produtos vinculados salvos.", { backup: "antes-importacao-nfe" });

    m.close(); renderQuick();
  };
}
function legacyQuickRow(q, i) {
  const p = state.db.products.find((x) => x.id === q.productId), o=currentOffer(p), final=priceFormula(q.basePrice,q.ipi,q.adjustment,q.quantity ?? q.divisor ?? 1), change=Number(o?.finalPrice)>0&&Number(final)>0?((Number(final)-Number(o.finalPrice))/Number(o.finalPrice))*100:null;
  return `<article class="quick-row" data-quick-row="${i}"><div class="quick-product"><b>${esc(p.name)}</b><small>${esc(variantLine(p))}${o?` • último ${money(o.finalPrice)}`:" • primeiro preço"}</small></div><div class="quick-main-fields"><div class="field supplier-field"><label>Fornecedor</label><select data-q="supplierId">${supplierOptions(q.supplierId)}</select></div><div class="field"><label>Valor pago</label><input data-q="basePrice" data-quick-base inputmode="decimal" type="number" min="0.0001" step="0.0001" value="${esc(q.basePrice)}" placeholder="0,00"></div><div class="field quantity-field"><label>Quantidade</label><input data-q="quantity" type="number" min="0.0001" step="0.0001" value="${q.quantity ?? q.divisor ?? 1}"></div><div class="field date-field"><label>Data</label><input data-q="updatedAt" type="date" value="${q.updatedAt}"></div><div class="quick-result"><span>Preço por ${esc(unitText(p.unit))}</span><b data-final>${money(final)}</b><small data-change>${change===null?"":`${change>=0?"+":""}${change.toFixed(1).replace(".",",")}%`}</small></div><button class="icon-button" data-remove-quick="${i}" title="Remover">×</button></div><details class="quick-adjustments"><summary>Impostos, reajuste e observação — opcional</summary><div class="form-grid"><div class="field"><label>IPI %</label><input data-q="ipi" type="number" step="0.01" value="${q.ipi}"></div><div class="field"><label>Reajuste %</label><input data-q="adjustment" type="number" step="0.01" value="${q.adjustment}"></div><div class="field span-2"><label>Observação</label><input data-q="notes" value="${esc(q.notes||"")}" placeholder="Número da nota, prazo ou condição"></div></div></details></article>`;
}
function bindQuickRows() {
  $$("[data-quick-row]").forEach((row) => {
    const i = Number(row.dataset.quickRow);
    $$("[data-q]", row).forEach((el) => {
      el.oninput = el.onchange = () => {
        const k = el.dataset.q;
        state.quickQueue[i][k] = el.value;
        const final = priceFormula(
          state.quickQueue[i].basePrice,
          state.quickQueue[i].ipi,
          state.quickQueue[i].adjustment,
          state.quickQueue[i].quantity ?? state.quickQueue[i].divisor ?? 1,
        );
        $("[data-final]", row).textContent = money(final);
        const p = state.db.products.find(
            (x) => x.id === state.quickQueue[i].productId,
          ),
          old = Number(currentOffer(p)?.finalPrice || 0);
        $("[data-change]", row).textContent =
          old > 0 && final > 0
            ? `${((final - old) / old) * 100 >= 0 ? "+" : ""}${(((final - old) / old) * 100).toFixed(1).replace(".", ",")}%`
            : "";
      };
    });
    $("[data-quick-base]", row).onkeydown = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const next = $$("[data-quick-base]")[i + 1];
        (next || $("#quickSearch")).focus();
      }
    };
  });
  $$("[data-remove-quick]").forEach(
    (b) =>
      (b.onclick = () => {
        state.quickQueue.splice(Number(b.dataset.removeQuick), 1);
        renderQuick();
      }),
  );
}
async function saveQuickQueue() {
  const invalid = state.quickQueue.find(
    (q) => !q.supplierId || !(Number(q.basePrice) > 0),
  );
  if (invalid) {
    toast("Preencha fornecedor e preço em todas as linhas.", "bad");
    return;
  }
  const offerIds = [];
  for (const q of state.quickQueue) {
    const p = state.db.products.find((x) => x.id === q.productId),
      sup = state.db.suppliers.find((x) => x.id === q.supplierId),
      offer = {
        id: uid("off"),
        supplierId: sup.id,
        supplierName: sup.name,
        basePrice: Number(q.basePrice),
        ipi: Number(q.ipi || 0),
        adjustment: Number(q.adjustment || 0),
        quantity: Number(q.quantity ?? q.divisor ?? 1),
        finalPrice: priceFormula(q.basePrice, q.ipi, q.adjustment, q.quantity ?? q.divisor ?? 1),
        updatedAt: q.updatedAt || new Date().toISOString().slice(0, 10),
        updatedAtRaw: "",
        email: sup.email || "",
        phone: sup.phone || "",
        notes: q.notes || "Atualização rápida",
        source: { sheet: "Aplicativo", row: "" },
        qualityIssues: [],
        calculationMode: "standard",
        percentUnit: "percent",
      };
    p.offers.push(offer);
    offerIds.push({ productId: p.id, offerId: offer.id });
    if (
      !(p.supplierLinks || []).some(
        (x) => x.supplierId === sup.id && x.kind === "quoted",
      )
    )
      p.supplierLinks.push({
        supplierId: sup.id,
        name: sup.name,
        kind: "quoted",
        source: "Aplicativo",
      });
  }
  state.db.lastBatchUndo = { offerIds, at: new Date().toISOString() };
  addActivity(
    `${offerIds.length} preços atualizados em lote`,
    "bulk-price",
    "batch",
    "",
    { offerIds },
  );
  refreshSupplierCounts();
  if (
    await persist(
      `${offerIds.length} preços salvos. O histórico foi mantido.`,
      { backup: "antes-atualizacao-rapida" },
    )
  ) {
    state.quickQueue = [];
    renderQuick();
  }
}
async function undoLastBatch() {
  const u = state.db.lastBatchUndo;
  if (!u?.offerIds?.length) return;
  if (!confirm(`Remover os ${u.offerIds.length} preços do último lote?`))
    return;
  for (const x of u.offerIds) {
    const p = state.db.products.find((y) => y.id === x.productId);
    if (p) p.offers = p.offers.filter((o) => o.id !== x.offerId);
  }
  addActivity(
    `Último lote de ${u.offerIds.length} preços desfeito`,
    "undo",
    "batch",
    "",
    { offerIds: u.offerIds },
  );
  state.db.lastBatchUndo = null;
  await persist("Último lote desfeito.", { backup: "antes-desfazer-lote" });
  renderQuick();
}
function legacyRenderHistory() {
  setTopTitle("Histórico");
  const q=clean(state.historyQuery);
  let list=state.db.products.filter((p)=>sortedOffers(p).length);
  if(q) list=list.map((p)=>({p,score:productScore(p,q)})).filter((x)=>x.score>0).sort((a,b)=>b.score-a.score).map((x)=>x.p);
  else list.sort((a,b)=>String(currentOffer(b)?.updatedAt||"").localeCompare(String(currentOffer(a)?.updatedAt||"")));
  const show=list.slice(0,q?state.historyLimit:10);
  $("#content").innerHTML=`${pageHead("Histórico de preços","Pesquise um material para comparar o último preço conhecido com os anteriores.")}<div class="simple-search history-search"><span>⌕</span><input id="historySearch" value="${esc(state.historyQuery)}" placeholder="Nome, código, medida ou fornecedor"></div><div class="section-bar"><div><h2>${q?`${list.length} resultado${list.length===1?"":"s"}`:"Atualizados recentemente"}</h2><p>${q?"Os preços anteriores permanecem guardados. Preço antigo não é erro; é último preço conhecido.":"Digite acima para localizar qualquer material."}</p></div></div><div class="history-list">${show.length?show.map(historyRow).join(""):emptyState("Nenhum histórico encontrado","Confira o nome, a medida ou o código.")}</div>${q&&show.length<list.length?'<button class="button load-more" id="moreHistory">Mostrar mais</button>':""}`;
  let timer; const input=$("#historySearch");
  input.oninput=(e)=>{state.historyQuery=e.target.value;clearTimeout(timer);timer=setTimeout(renderHistory,100);};
  $("#moreHistory")?.addEventListener("click",()=>{state.historyLimit+=40;renderHistory();});
  bindCommonActions();
}
function legacyHistoryRow(p) {
  const os = sortedOffers(p),
    change = priceChange(os[0], os[1]);
  return `<article class="history-row"><div class="history-product"><b>${esc(p.name)}</b><small>${esc(p.code || p.family)}${p.subtitle ? ` • ${esc(p.subtitle)}` : ""}</small>${change !== null ? `<span class="trend ${change > 0 ? "up" : "down"}">${change > 0 ? "▲" : "▼"} ${Math.abs(change).toFixed(1).replace(".", ",")}% desde o anterior</span>` : ""}</div>${[0, 1, 2].map((i) => `<div class="history-price"><span>${i === 0 ? "Atual" : i === 1 ? "Anterior" : "3º preço"}</span><b>${os[i] ? money(os[i].finalPrice) : "Sem registro"}</b><small>${os[i] ? `${esc(os[i].supplierName || "")} • ${dateBR(os[i].updatedAt, os[i].updatedAtRaw)}` : "—"}</small></div>`).join("")}<button class="button small" data-detail="${p.id}">Ver material</button></article>`;
}
function renderReview() {
  setTopTitle("Revisar cadastros");
  $("#content").innerHTML = `${pageHead("Revisar cadastros", "Área de manutenção: confirme somente dados realmente ambíguos.", '<button class="button" id="backSettings">Voltar às configurações</button>')}<div id="reviewBody"></div>`;
  $("#backSettings").onclick=()=>go("tools");
  renderQualityReview();
}
function qualityProducts() {
  return state.db.products
    .map((p) => ({ p, reasons: unresolvedReasons(p) }))
    .filter((x) => x.reasons.length)
    .filter(
      (x) =>
        state.qualityFilter === "all" ||
        x.reasons.some((r) =>
          state.qualityFilter === "critical"
            ? ISSUE_GROUPS[issueGroup(r)].severity === "critical"
            : issueGroup(r) === state.qualityFilter,
        ),
    );
}
function renderQualityReview() {
  const root = $("#reviewBody"),
    counts = { all: 0, duplicate: 0, date: 0, name: 0, other: 0 };
  state.db.products.forEach((p) =>
    unresolvedReasons(p).forEach((r) => {
      counts.all++;
      const g = issueGroup(r);
      counts[g] = (counts[g] || 0) + 1;
    }),
  );
  if (
    !["all", "duplicate", "date", "name", "other"].includes(state.qualityFilter)
  )
    state.qualityFilter = "all";
  const list = qualityProducts(),
    show = list.slice(0, state.reviewLimit);
  root.innerHTML = `<div class="issue-summary"><button class="issue-card ${state.qualityFilter === "all" ? "active" : ""}" data-quality-filter="all"><b>${counts.all}</b><small>Todos para conferir</small></button><button class="issue-card ${state.qualityFilter === "duplicate" ? "active" : ""}" data-quality-filter="duplicate"><b>${counts.duplicate}</b><small>Códigos repetidos</small></button><button class="issue-card ${state.qualityFilter === "name" ? "active" : ""}" data-quality-filter="name"><b>${counts.name}</b><small>Nome ou medida</small></button><button class="issue-card ${state.qualityFilter === "other" ? "active" : ""}" data-quality-filter="other"><b>${counts.other}</b><small>Regras especiais</small></button></div><div class="review-explainer card"><b>Não são erros automáticos.</b><span>Abra o material, compare com a descrição original e marque como conferido quando estiver correto.</span></div><div class="results-list">${show.length ? show.map(({ p, reasons }) => issueRow(p, reasons)).join("") : emptyState("Nenhuma conferência neste filtro", "Todos os itens deste grupo já foram revisados.")}</div>${show.length < list.length ? '<button class="button load-more" id="moreQuality">Mostrar mais</button>' : ""}`;
  $$("[data-quality-filter]").forEach(
    (b) =>
      (b.onclick = () => {
        state.qualityFilter = b.dataset.qualityFilter;
        state.reviewLimit = 20;
        renderQualityReview();
      }),
  );
  $("#moreQuality")?.addEventListener("click", () => {
    state.reviewLimit += 20;
    renderQualityReview();
  });
  $$("[data-resolve-issue]").forEach(
    (b) =>
      (b.onclick = () =>
        resolveIssue(b.dataset.resolveIssue, b.dataset.reason)),
  );
  bindCommonActions(root);
}
function issueRow(p, reasons) {
  return `<article class="issue-row" data-issue-product="${p.id}"><div><h3>${esc(p.name)}</h3><p>${esc(p.family)}${p.code ? ` • ${esc(p.code)}` : ""} • origem ${esc(p.source?.sheet || "Aplicativo")} linha ${esc(p.source?.row || "—")}</p></div><div class="issue-reasons">${reasons.map((r) => `<span class="issue-reason">${esc(r)}</span>`).join("")}</div><div class="issue-actions"><button class="button small" data-detail="${p.id}">Ver</button>${reasons.length === 1 ? `<button class="button small primary" data-resolve-issue="${p.id}" data-reason="${esc(reasons[0])}">Marcar conferido</button>` : `<button class="button small" data-edit="${p.id}">Editar</button>`}</div></article>`;
}
async function resolveIssue(id, reason) {
  const p = state.db.products.find((x) => x.id === id);
  if (!p) return;
  if (!confirm(`Marcar como conferido?\n\n${reason}`)) return;
  p.resolvedQualityIssues = p.resolvedQualityIssues || [];
  if (!p.resolvedQualityIssues.includes(reason))
    p.resolvedQualityIssues.push(reason);
  p.lastReviewedAt = new Date().toISOString();
  addActivity(
    `Pendência conferida em ${p.name}: ${reason}`,
    "review",
    "product",
    p.id,
    { reason },
  );
  await persist("Pendência marcada como conferida.");
  renderQualityReview();
}
function legacyRenderSuppliers() {
  setTopTitle("Fornecedores"); refreshSupplierCounts();
  const q=norm(state.supplierQuery);
  let list=[...(state.db.suppliers||[])].filter((x)=>x.productCount>0).filter((x)=>!q||norm([x.name,x.email,x.phone,...(x.aliases||[])].join(" ")).includes(q));
  list.sort((a,b)=>b.productCount-a.productCount||a.name.localeCompare(b.name,"pt-BR"));
  const show=list.slice(0,q?100:20);
  $("#content").innerHTML=`${pageHead("Fornecedores","Encontre contato e materiais comprados de cada empresa.",'<button class="button" id="newSupplier">＋ Novo fornecedor</button>')}<div class="simple-search"><span>⌕</span><input id="supplierSearch" value="${esc(state.supplierQuery)}" placeholder="Nome, e-mail ou telefone"></div><div class="section-bar"><div><h2>${q?`${list.length} resultado${list.length===1?"":"s"}`:"Fornecedores mais usados"}</h2><p>${q?"":"Pesquise acima para encontrar qualquer outro fornecedor."}</p></div></div><div class="supplier-list">${show.map(supplierRow).join("")}</div>`;
  let timer; $("#supplierSearch").oninput=(e)=>{state.supplierQuery=e.target.value;clearTimeout(timer);timer=setTimeout(renderSuppliers,100);};
  $$('[data-supplier-detail]').forEach((b)=>b.onclick=()=>openSupplier(b.dataset.supplierDetail));
  $("#newSupplier").onclick=openSupplierCreate;
}
function supplierRow(s) {
  return `<div class="supplier-row"><div class="supplier-name"><div class="supplier-avatar">${esc(s.name.slice(0,1).toUpperCase())}</div><div><b>${esc(s.name)}</b><small>${s.productCount} material${s.productCount===1?"":"is"} • ${s.quotedProductCount} com preço cadastrado</small></div></div><div class="supplier-contact">${s.email?`<a href="mailto:${esc(s.email)}">✉ ${esc(s.email)}</a>`:"<small>E-mail não informado</small>"}${s.phone?`<small>☎ ${esc(s.phone)}</small>`:"<small>Telefone não informado</small>"}</div><button class="button small" data-supplier-detail="${s.id}">Ver materiais</button></div>`;
}
function openSupplier(id) {
  const s=state.db.suppliers.find((x)=>x.id===id); if(!s)return; const r=supplierRelations(s);
  const m=modal(`<div class="modal-head"><div><h2>${esc(s.name)}</h2><p>${r.all.length} material${r.all.length===1?"":"is"} relacionado${r.all.length===1?"":"s"}</p></div><button class="modal-close" data-close>×</button></div><div class="modal-body"><div class="contact-card"><div><span>E-mail</span><b>${esc(s.email||"Não informado")}</b></div><div><span>Telefone</span><b>${esc(s.phone||"Não informado")}</b></div></div><div class="trace-section"><h3>Materiais</h3><div class="results-list">${groupProducts(r.all).slice(0,20).map(groupedCard).join("")}</div></div></div><div class="modal-foot">${s.email?'<button class="button" id="emailSupplier">Enviar e-mail</button>':""}<button class="button primary" id="filterSupplierProducts">Ver todos na busca</button></div>`,"xwide");
  $("#filterSupplierProducts",m.host).onclick=()=>{m.close();state.filters.supplier=s.id;state.filtersOpen=true;state.query="";go("catalog");};
  $("#emailSupplier",m.host)?.addEventListener("click",()=>window.vesper.email(s.email));
  $$('[data-more-variants]',m.host).forEach((b)=>b.onclick=()=>openVariants(b.dataset.moreVariants));
  bindCommonActions(m.host);
}
function openSupplierCreate() {
  const m = modal(
    `<form id="supplierForm"><div class="modal-head"><div><h2>Novo fornecedor</h2><p>Ele poderá ser escolhido ao atualizar preços.</p></div><button type="button" class="modal-close" data-close>×</button></div><div class="modal-body"><div class="form-grid"><div class="field span-2"><label>Nome *</label><input name="name" required></div><div class="field"><label>E-mail</label><input type="email" name="email"></div><div class="field"><label>Telefone</label><input name="phone"></div></div></div><div class="modal-foot"><button type="button" class="button" data-close>Cancelar</button><button class="button primary">Salvar fornecedor</button></div></form>`,
  );
  $("#supplierForm", m.host).onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget),
      name = clean(fd.get("name"));
    if (state.db.suppliers.some((s) => norm(s.name) === norm(name))) {
      toast("Este fornecedor já existe.", "bad");
      return;
    }
    const s = {
      id: uid("sup"),
      name,
      email: clean(fd.get("email")),
      phone: clean(fd.get("phone")),
      emails: [],
      phones: [],
      aliases: [name],
      sources: ["Aplicativo"],
      productCount: 0,
      quotedProductCount: 0,
      listedProductCount: 0,
    };
    state.db.suppliers.push(s);
    addActivity(`Fornecedor ${name} cadastrado`, "create", "supplier", s.id);
    if (
      await persist("Fornecedor cadastrado.", {
        backup: "antes-cadastrar-fornecedor",
      })
    ) {
      m.close();
      renderSuppliers();
    }
  };
}
function showImportPreview(r) {
  const p = r.preview || r,
    updates = p.updates || [],
    newProducts = p.newProducts || [],
    skipped = p.skipped || [],
    newSuppliers = p.newSuppliers || [],
    reviewItems = p.reviewItems || [];

  const quarantinedList = [];
  const normalUpdates = [];
  const normalNewProducts = [];

  for (const u of updates) {
    if (u.offer && u.offer.quarantined) {
      quarantinedList.push({ type: "update", id: u.offer.id, productName: u.productName, productCode: u.offer.sourceCode || "", offer: u.offer, rawItem: u });
    } else {
      normalUpdates.push(u);
    }
  }

  for (const np of newProducts) {
    const off = np.offers?.[0];
    if (off && off.quarantined) {
      quarantinedList.push({ type: "new", id: off.id, productName: np.name, productCode: np.code || "", offer: off, rawItem: np });
    } else {
      normalNewProducts.push(np);
    }
  }

  const m = modal(
    `<div class="modal-head"><div><h2>Prévia da importação</h2><p>${esc(r.fileName || r.file || "Planilha selecionada")}${p.mode === "vesper-legacy-aligned" ? " • planilha Vesper reconhecida" : ""}</p></div><button class="modal-close" data-close>×</button></div>
     <div class="modal-body" style="max-height: 70vh; overflow-y: auto;">
       <div class="metric-grid" style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; margin-bottom: 20px;">
         <div class="metric card"><span>Preços normais</span><b>${normalUpdates.length}</b></div>
         <div class="metric card"><span>Novos materiais</span><b>${normalNewProducts.length}</b></div>
         <div class="metric card"><span>Novos fornecedores</span><b>${newSuppliers.length}</b></div>
         <div class="metric card" style="background:#fff8e8; border:1px solid #efd294;"><span style="color:#755100;">Itens para revisar</span><b style="color:#c62828;">${quarantinedList.length}</b></div>
         <div class="metric card"><span>Erros / Revisão manual</span><b>${skipped.length + reviewItems.length}</b></div>
       </div>

       <div class="warning-box">Revise a prévia antes de aplicar. Um backup automático será criado e a operação poderá ser desfeita restaurando esse backup.</div>

       <!-- 1. Alertas de qualidade de dados -->
       <div class="quality-issues-section" style="margin-top:20px; border-top:1px solid #ccc; padding-top:15px;">
         <h3 style="margin-bottom:8px;">🔍 Auditoria de Qualidade de Dados (qualityIssues)</h3>
         <p style="font-size:12px; color:#666; margin-bottom:10px;">Abaixo estão os alertas e os ajustes feitos automaticamente nas colunas identificadas.</p>
         <table class="trace-table" style="font-size:12px;">
           <thead>
             <tr>
               <th>Material / Linha</th>
               <th>Campo</th>
               <th>Valor Original</th>
               <th>Valor Interpretado</th>
               <th>Alerta / Inconsistência</th>
               <th>Ação Tomada</th>
             </tr>
           </thead>
           <tbody>
             ${(p.qualityIssuesDetailed || []).map(x => `
               <tr>
                 <td><b>${esc(x.productName)}</b><br><small>Linha ${x.row} (Aba ${esc(x.sheet)})</small></td>
                 <td><span style="background:#e0f7fa; color:#006064; padding:2px 6px; border-radius:4px; font-size:11px;">${esc(x.field)}</span></td>
                 <td><del style="color:#c62828;">${esc(String(x.original))}</del></td>
                 <td><ins style="color:#2e7d32; text-decoration:none; font-weight:bold;">${esc(String(x.interpreted))}</ins></td>
                 <td style="color:#755100;">${esc(x.alert)}</td>
                 <td><span style="color:#1565c0; font-weight:500;">${esc(x.action)}</span></td>
               </tr>
             `).join("") || '<tr><td colspan="6" style="text-align:center; color:#999; padding:15px;">Nenhuma inconsistência de qualidade detectada na planilha.</td></tr>'}
           </tbody>
         </table>
       </div>

       <!-- 2. Seção de itens que exigem confirmação -->
       ${quarantinedList.length ? `
       <div class="quarantine-section" style="margin-top:25px; border-top:2px solid #efd294; padding-top:15px;">
         <h3 style="color:#c62828; display:flex; align-items:center; gap:8px;">
           <span>⚠️</span> Itens que precisam de confirmação
         </h3>
         <p style="font-size:12px; color:#666; margin-bottom:10px;">
           Estes itens têm preço, data ou outra informação que exige conferência. Eles vêm <b>desmarcados por padrão</b>. Para importá-los, marque a caixa, corrija a data quando necessário e escreva uma justificativa.
         </p>
         <table class="trace-table" style="font-size:12px;">
           <thead>
             <tr>
               <th style="width:50px; text-align:center;">Importar?</th>
               <th>Material / Código</th>
               <th>Fornecedor</th>
               <th>Preço interpretado</th>
               <th>Data da compra</th>
               <th>Motivo da revisão</th>
               <th>Justificativa obrigatória</th>
             </tr>
           </thead>
           <tbody>
             ${quarantinedList.map(x => `
               <tr data-quarantine-id="${x.id}">
                 <td style="text-align:center;">
                   <input type="checkbox" class="quarantine-approve-check" data-off-id="${x.id}">
                 </td>
                 <td>
                   <b>${esc(x.productName)}</b>
                   <br><small>${esc(x.productCode || "Sem código")}</small>
                 </td>
                 <td>${esc(x.offer?.supplierName || "")}</td>
                 <td style="color:#c62828; font-weight:bold;">${money(x.offer?.finalPrice)}</td>
                 <td><input type="date" class="quarantine-date-input" data-off-id="${x.id}" value="${esc(x.offer?.updatedAt || "")}" disabled style="width:135px; padding:4px; font-size:12px;"></td>
                 <td style="color:#755100;"><i>${esc(x.offer?.quarantineReason || "Informação precisa ser confirmada")}</i></td>
                 <td>
                   <input type="text" class="quarantine-justification-input" data-off-id="${x.id}" placeholder="Ex.: conferido na cotação do fornecedor" disabled minlength="${Number(p.validation?.minimumJustificationLength || 8)}" style="width:100%; padding:4px; font-size:12px; border:1px solid #ccc; border-radius:4px;">
                 </td>
               </tr>
             `).join("")}
           </tbody>
         </table>
       </div>
       ` : ""}

       ${reviewItems.length ? `
       <div class="review-section" style="margin-top:25px; border-top:2px solid #d7dce5; padding-top:15px;">
         <h3>🧭 Linhas que não podem ser associadas automaticamente</h3>
         <p style="font-size:12px;color:#666">Nenhum histórico dessas linhas será gravado. Complete a descrição na planilha ou abra o cadastro manualmente para escolher a variação correta.</p>
         <table class="trace-table" style="font-size:12px"><thead><tr><th>Aba / linha</th><th>Código</th><th>Descrição</th><th>Motivo</th></tr></thead><tbody>
           ${reviewItems.map(x=>`<tr><td>${esc(x.sheet)} • ${x.row}</td><td>${esc(x.code||"")}</td><td>${esc(x.name||"")}</td><td>${esc(x.reason)}</td></tr>`).join("")}
         </tbody></table>
       </div>` : ""}

       <!-- 3. Amostra normal -->
       <div class="trace-section" style="margin-top:25px; border-top:1px solid #ccc; padding-top:15px;">
         <h3>Amostra dos Materiais e Preços Normais</h3>
         <table class="trace-table" style="font-size:12px;">
           <thead>
             <tr>
               <th>Tipo</th>
               <th>Material</th>
               <th>Fornecedor</th>
               <th>Preço</th>
             </tr>
           </thead>
           <tbody>
             ${normalUpdates.slice(0, 10).map(x => `<tr><td>Registrar</td><td>${esc(x.productName)}</td><td>${esc(x.offer?.supplierName || "")}</td><td>${money(x.offer?.finalPrice)}</td></tr>`).join("")}
             ${normalNewProducts.slice(0, 10).map(x => `<tr><td>Novo</td><td>${esc(x.name)}</td><td>${esc(x.offers?.[0]?.supplierName || "")}</td><td>${money(x.offers?.[0]?.finalPrice)}</td></tr>`).join("")}
             ${!normalUpdates.length && !normalNewProducts.length ? '<tr><td colspan="4" style="text-align:center; color:#999; padding:15px;">Nenhum item normal na planilha (todos foram para a quarentena ou foram ignorados).</td></tr>' : ""}
           </tbody>
         </table>
       </div>
     </div>
     <div class="modal-foot">
       <button class="button" data-close>Cancelar</button>
       <button class="button primary" id="applyImport">Aplicar importação</button>
     </div>`,
    "wide"
  );

  // Listener para habilitar/desabilitar justificativa
  m.host.addEventListener("change", (e) => {
    if (e.target && e.target.classList.contains("quarantine-approve-check")) {
      const offId = e.target.dataset.offId;
      const input = m.host.querySelector(`.quarantine-justification-input[data-off-id="${offId}"]`);
      const dateInput = m.host.querySelector(`.quarantine-date-input[data-off-id="${offId}"]`);
      if (input) {
        input.disabled = !e.target.checked;
        if (e.target.checked) input.focus();
        else input.value = "";
      }
      if (dateInput) dateInput.disabled = !e.target.checked;
    }
  });

  $("#applyImport", m.host).onclick = async () => {
    // Validar justificativas da quarentena
    const approvedQuarantinedIds = new Set();
    const justifications = new Map();
    const correctedDates = new Map();
    const minimumJustificationLength = Number(p.validation?.minimumJustificationLength || 8);
    let validationError = false;
    let dateValidationError = false;

    $$(".quarantine-approve-check", m.host).forEach((check) => {
      const offId = check.dataset.offId;
      if (check.checked) {
        approvedQuarantinedIds.add(offId);
        const input = m.host.querySelector(`.quarantine-justification-input[data-off-id="${offId}"]`);
        const val = (input?.value || "").trim();
        const dateInput = m.host.querySelector(`.quarantine-date-input[data-off-id="${offId}"]`);
        const dateValue = (dateInput?.value || "").trim();
        if (val.length < minimumJustificationLength) validationError = true;
        else justifications.set(offId, val);
        const item = quarantinedList.find((x) => x.id === offId);
        if (!dateValue && /data/i.test(item?.offer?.quarantineReason || "")) dateValidationError = true;
        if (dateValue) correctedDates.set(offId, dateValue);
      }
    });

    if (validationError || dateValidationError) {
      alert(validationError
        ? `Escreva uma justificativa com pelo menos ${minimumJustificationLength} caracteres para cada item marcado.`
        : "Informe a data real da compra para cada item marcado que chegou sem data.");
      return;
    }

    // Filtrar e preparar updates e newProducts baseados na aprovação da quarentena
    const finalUpdates = [];
    for (const u of updates) {
      if (u.offer.quarantined) {
        if (approvedQuarantinedIds.has(u.offer.id)) {
          if (correctedDates.has(u.offer.id)) u.offer.updatedAt = correctedDates.get(u.offer.id);
          u.offer.reviewApproval = { reason: justifications.get(u.offer.id), approvedAt: new Date().toISOString(), originalReason: u.offer.quarantineReason };
          u.offer.notes = `[Aprovado após revisão: ${justifications.get(u.offer.id)}] ${u.offer.notes}`;
          // Registrar auditoria local para preço forçado
          addActivity(`Item em revisão de ${u.productName} aprovado sob justificativa: "${justifications.get(u.offer.id)}"`, "quarantine-approval", "product", u.productId);
          finalUpdates.push(u);
        }
      } else {
        finalUpdates.push(u);
      }
    }

    const finalNewProducts = [];
    for (const np of newProducts) {
      const off = np.offers?.[0];
      if (off && off.quarantined) {
        if (approvedQuarantinedIds.has(off.id)) {
          if (correctedDates.has(off.id)) off.updatedAt = correctedDates.get(off.id);
          off.reviewApproval = { reason: justifications.get(off.id), approvedAt: new Date().toISOString(), originalReason: off.quarantineReason };
          off.notes = `[Aprovado após revisão: ${justifications.get(off.id)}] ${off.notes}`;
          addActivity(`Novo material em revisão ${np.name} aprovado sob justificativa: "${justifications.get(off.id)}"`, "quarantine-approval", "product", np.id);
          finalNewProducts.push(np);
        }
      } else {
        finalNewProducts.push(np);
      }
    }

    // Continuar processo de importação original
    for (const s of newSuppliers) {
      if (!state.db.suppliers.some((x) => norm(x.name) === norm(s.name)))
        state.db.suppliers.push(s);
    }
    for (const u of finalUpdates) {
      const prod = state.db.products.find((x) => x.id === u.productId);
      if (prod && u.offer) {
        if (u.patch && typeof u.patch === "object") Object.assign(prod, u.patch);
        prod.offers.push(u.offer);
        if (u.offer.supplierId && !prod.supplierLinks.some((x) => x.supplierId === u.offer.supplierId && x.kind === "quoted")) {
          prod.supplierLinks.push({
            supplierId: u.offer.supplierId,
            name: u.offer.supplierName,
            kind: "quoted",
            source: "Importação",
          });
        }
      }
    }
    state.db.products.push(...finalNewProducts.map(ensureShape));
    rebuildCategories();
    refreshSupplierCounts();
    addActivity(
      `Importação aplicada: ${finalUpdates.length} preços e ${finalNewProducts.length} materiais`,
      "import",
      "file",
      "",
      { file: r.fileName || r.file },
    );
    if (await persist("Importação concluída.", { backup: "antes-importacao" })) {
      m.close();
      renderTools();
    }
  };
}
function storageCard() {
  const s = state.meta?.storage || { mode: "local" };
  return `<article class="tool-card card"><h3>Onde os dados ficam</h3><p>${s.mode === "server" ? "A base está centralizada no servidor local 24h. Os outros computadores acessam pelo navegador." : s.mode === "shared" ? "A base está em uma pasta compartilhada da empresa. Outros computadores podem abrir o mesmo arquivo." : "A base está salva somente neste computador. É o modo mais seguro para teste individual."}</p><div class="info-row">${esc(s.path || s.name || "Dados internos do aplicativo")}</div><div class="tool-actions"><button class="button" id="configureStorage">Configurar armazenamento</button>${s.mode === "shared" || s.mode === "server" ? '<button class="button" id="openDataFolder">Abrir pasta</button>' : ""}</div></article>`;
}
function renderTools() {
  setTopTitle("Configurações");
  // Melhoria #10C: Dashboard de Saúde do Catálogo
  const prods = state.db.products || [];
  const staleDays = state.db.settings?.staleDays ?? 180;
  const withPrice = prods.filter(p => currentOffer(p) && /^\d{4}-/.test(currentOffer(p).updatedAt || ""));
  const staleProds = withPrice.filter(p => (daysSince(currentOffer(p).updatedAt) ?? 0) > staleDays);
  const freshProds = withPrice.filter(p => (daysSince(currentOffer(p).updatedAt) ?? 0) <= staleDays);
  const noPrice = prods.filter(p => !currentOffer(p));
  const familyStale = {};
  staleProds.forEach(p => { familyStale[p.family] = (familyStale[p.family] || 0) + 1; });
  const topStale = Object.entries(familyStale).sort((a,b)=>b[1]-a[1]).slice(0,5);
  const threshold = state.db.settings?.priceAlertThreshold ?? 30;
  // Melhoria #7: detectar fornecedores possívelmente duplicados
  const sups = state.db.suppliers || [];
  const dupSups = [];
  for (let i = 0; i < sups.length; i++) {
    for (let j = i+1; j < sups.length; j++) {
      const na = norm(sups[i].name), nb = norm(sups[j].name);
      if (na.length >= 4 && (na === nb || editDistance(na.slice(0,15), nb.slice(0,15)) <= 2))
        dupSups.push([sups[i], sups[j]]);
    }
  }
  $("#content").innerHTML=`${pageHead("Configurações","Funções usadas somente quando necessário.",'<button class="button" id="backSearch">Voltar para a busca</button>')}<div class="settings-list">
<!-- Card Saúde do Catálogo -->
<article class="settings-card" style="grid-column:1/-1">
  <div style="display:flex;justify-content:space-between;align-items:start;flex-wrap:wrap;gap:12px">
    <div><h3>📊 Saúde do Catálogo</h3><p>Visão geral do estado dos preços.</p></div>
    <div style="display:flex;gap:20px;text-align:center">
      <div><b style="font-size:22px;color:var(--primary)">${freshProds.length}</b><br><small>Comprados nos últimos ${staleDays}d</small></div>
      <div><b style="font-size:22px;color:#f59e0b">${staleProds.length}</b><br><small>Preços antigos</small></div>
      <div><b style="font-size:22px;color:var(--muted)">${noPrice.length}</b><br><small>Sem compra</small></div>
      <div><b style="font-size:22px">${prods.length}</b><br><small>Total</small></div>
    </div>
  </div>
  ${topStale.length ? `<div style="margin-top:12px"><b style="font-size:12px;text-transform:uppercase;color:var(--muted)">Famílias com mais preços antigos</b><div style="display:flex;flex-direction:column;gap:4px;margin-top:6px">${topStale.map(([f,n])=>`<div style="display:flex;justify-content:space-between;font-size:13px"><span>${esc(f)}</span><b style="color:#f59e0b">${n} materiais</b></div>`).join('')}</div></div>` : ''}
  <div class="tool-actions" style="margin-top:12px"><button class="button" id="goReview2">Ver materiais para revisar</button><button class="button" id="goStale">Ver preços antigos</button></div>
</article>
<!-- Card Alertas -->
<article class="settings-card">
  <div><h3>⚠️ Alertas de Preço</h3><p>Configura o limiar de variação de preço e dias para sinalizar como antigo.</p></div>
  <div class="form-grid" style="margin-top:12px">
    <div class="field"><label>Alertar quando preço variar mais de (%)</label>
      <input type="number" id="settingThreshold" value="${threshold}" min="5" max="200" step="1">
      <small>Padrão: 30%. Aplicado no moment de registrar uma compra.</small>
    </div>
    <div class="field"><label>Dias para sinalizar preço antigo</label>
      <input type="number" id="settingStaleDays" value="${staleDays}" min="30" max="730" step="1">
      <small>Padrão: 180 dias. Afeta o badge ⏰ nos cards de busca.</small>
    </div>
  </div>
  <div class="tool-actions" style="margin-top:8px"><button class="button primary" id="saveAlertSettings">Salvar configurações</button></div>
</article>
<!-- Card Backup -->
<article class="settings-card"><div><h3>Proteger os dados</h3><p>Crie ou restaure uma cópia completa.</p></div><div><button class="button primary" id="backupNow">Criar backup</button><button class="button" id="restoreBackup">Restaurar</button></div></article>
<!-- Card Excel com Drag-Drop -->
<article class="settings-card">
  <div><h3>Trocar dados com o Excel</h3><p>Exporte o catálogo ou importe uma lista simples.</p></div>
  <div><button class="button primary" id="exportExcel">Exportar</button><button class="button" id="importExcel">Importar</button></div>
  <div id="dropZoneSettings" class="drop-zone" style="margin-top:12px;border:2px dashed var(--border);border-radius:8px;padding:16px 12px;text-align:center;color:var(--muted);font-size:13px;cursor:pointer;">
    📂 Arraste uma planilha Excel aqui para importar
  </div>
</article>
<!-- Card Fornecedores Duplicados -->
${dupSups.length ? `<article class="settings-card" style="grid-column:1/-1">
  <div><h3>🔗 Possíveis Fornecedores Duplicados</h3><p>O sistema detectou ${dupSups.length} par${dupSups.length!==1?'es':''} com nomes similares. Verificar e unificar evita históricos espalhados.</p></div>
  <div id="dupSupList" style="display:flex;flex-direction:column;gap:8px;margin-top:10px">
    ${dupSups.slice(0,10).map(([a,b],i)=>`<div style="display:flex;align-items:center;gap:10px;padding:8px;background:var(--bg-hover);border-radius:6px;">
      <span style="flex:1;font-size:13px"><b>${esc(a.name)}</b> <span style="color:var(--muted)">e</span> <b>${esc(b.name)}</b></span>
      <button class="button small" data-merge-a="${a.id}" data-merge-b="${b.id}">Unificar (manter 1º)</button>
    </div>`).join('')}
  </div>
</article>` : ''}
<!-- Card Revisar cadastros -->
<article class="settings-card"><div><h3>Revisar cadastros</h3><p>Confira códigos repetidos, nomes duvidosos e regras especiais.</p></div><div><button class="button" id="openReview">Abrir revisão</button></div></article>
${storageCard()}
<details class="activity-details"><summary>Ver histórico de alterações</summary><table class="trace-table"><thead><tr><th>Data</th><th>Ação</th><th>Descrição</th></tr></thead><tbody>${(state.db.auditLog||state.db.activity||[]).slice(0,50).map((a)=>`<tr><td>${new Date(a.at).toLocaleString("pt-BR")}</td><td>${esc(a.type)}</td><td>${esc(a.message)}</td></tr>`).join("")||'<tr><td colspan="3">Nenhuma atividade registrada.</td></tr>'}</tbody></table></details>
<button class="text-danger" id="resetBase">Restaurar base inicial</button>
</div>`;
  // Bind eventos
  $("#backSearch").onclick=()=>go("catalog"); $("#openReview").onclick=()=>go("review");
  $("#goReview2")?.addEventListener("click",()=>go("review"));
  $("#goStale")?.addEventListener("click",()=>{ state.filters.status="stale"; state.filtersOpen=true; go("catalog"); });
  $("#backupNow").onclick=async()=>{const r=await window.vesper.createBackup();if(!r?.canceled)toast("Backup criado.","good");};
  $("#restoreBackup").onclick=async()=>{try{const r=await window.vesper.restoreBackup();if(r?.data){state.db=r.data;prepareDb();toast("Backup restaurado.","good");render();}}catch(e){toast(e.message,"bad");}};
  $("#exportExcel").onclick=async()=>{try{const r=await window.vesper.exportXlsx(state.db);if(!r?.canceled)toast("Arquivo exportado.","good");}catch(e){toast(e.message,"bad");}};
  $("#importExcel").onclick=async()=>{try{const r=await window.vesper.importXlsx(state.db);if(r&&!r.canceled)showImportPreview(r);}catch(e){toast(e.message,"bad");}};
  $("#resetBase").onclick=async()=>{const r=await window.vesper.resetData();if(r?.data){state.db=r.data;prepareDb();toast("Base inicial restaurada.","good");go("catalog");}};
  $("#configureStorage").onclick=openStorageSettings; $("#openDataFolder")?.addEventListener("click",()=>window.vesper.openFolder(state.meta?.storage?.path||""));
  // Melhoria #10A: salvar configurações de alerta
  $("#saveAlertSettings")?.addEventListener("click", async () => {
    const t = Number($("#settingThreshold").value);
    const sd = Number($("#settingStaleDays").value);
    if (t > 0) state.db.settings.priceAlertThreshold = t;
    if (sd > 0) state.db.settings.staleDays = sd;
    if (await persist("Configurações salvas.", {})) toast("Configurações de alertas salvas.", "good");
  });
  // Melhoria #8: Drag-and-Drop na zona de import
  const dropZone = $("#dropZoneSettings");
  if (dropZone) {
    dropZone.ondragover = (e) => { e.preventDefault(); dropZone.style.background = "var(--bg-hover)"; dropZone.style.borderColor = "var(--primary)"; };
    dropZone.ondragleave = () => { dropZone.style.background = ""; dropZone.style.borderColor = "var(--border)"; };
    dropZone.ondrop = async (e) => {
      e.preventDefault();
      dropZone.style.background = ""; dropZone.style.borderColor = "var(--border)";
      const file = e.dataTransfer.files[0];
      if (!file || !file.name.match(/\.xlsx?$/i)) return toast("Apenas arquivos .xlsx são aceitos.", "bad");
      toast("Processando planilha...", "good");
      try {
        const r = await window.vesper.importXlsxFile(file.path || file.name);
        if (r && !r.canceled) showImportPreview(r);
      } catch(e) { toast(e.message || "Erro ao importar planilha.", "bad"); }
    };
    dropZone.onclick = async () => { try { const r=await window.vesper.importXlsx(state.db); if(r&&!r.canceled)showImportPreview(r); } catch(e){toast(e.message,"bad");} };
  }
  // Melhoria #7: Merge de fornecedores duplicados
  $$("[data-merge-a]").forEach(btn => {
    btn.onclick = async () => {
      const a = state.db.suppliers.find(s => s.id === btn.dataset.mergeA);
      const b = state.db.suppliers.find(s => s.id === btn.dataset.mergeB);
      if (!a || !b) return;
      if (!confirm(`Unificar "${b.name}" em "${a.name}"?\n\nTodos os históricos de "${b.name}" serão transferidos para "${a.name}". Esta ação não pode ser desfeita sem restaurar um backup.`)) return;
      // Reatribuir offers e supplierLinks do secundário para o principal
      state.db.products.forEach(p => {
        p.offers = (p.offers||[]).map(o => o.supplierId === b.id ? {...o, supplierId: a.id, supplierName: a.name} : o);
        p.supplierLinks = (p.supplierLinks||[]).map(l => l.supplierId === b.id ? {...l, supplierId: a.id, name: a.name} : l);
      });
      state.db.suppliers = state.db.suppliers.filter(s => s.id !== b.id);
      refreshSupplierCounts();
      addActivity(`Fornecedor ${b.name} unificado em ${a.name}`, "merge", "supplier", a.id);
      if (await persist(`Fornecedor ${b.name} unificado.`, {backup: "antes-merge-fornecedor"})) { toast("Fornecedores unificados com sucesso.", "good"); renderTools(); }
    };
  });
}
function openStorageSettings() {
  const s = state.meta?.storage || { mode: "local" },
    canShared = typeof window.vesper.chooseSharedFolder === "function";
  const m = modal(
    `<div class="modal-head"><div><h2>Armazenamento dos dados</h2><p>Escolha como os computadores da empresa usarão a base.</p></div><button class="modal-close" data-close>×</button></div><div class="modal-body"><div class="detail-grid"><div class="detail-panel"><h3>Neste computador</h3><p style="color:var(--muted)">Ideal para teste individual. Não sincroniza automaticamente com outros PCs.</p><button class="button ${s.mode === "local" ? "primary" : ""}" id="useLocal">Usar base local</button></div><div class="detail-panel"><h3>Pasta compartilhada</h3><p style="color:var(--muted)">Use uma pasta de rede, servidor ou pasta sincronizada. O aplicativo bloqueia salvamentos conflitantes.</p><button class="button ${s.mode === "shared" ? "primary" : ""}" id="chooseShared" ${canShared ? "" : "disabled"}>Escolher pasta da empresa</button></div></div>${!canShared ? '<div class="warning-box" style="margin-top:12px">A escolha de pasta compartilhada funciona na versão Electron instalada. No modo portátil do navegador, os dados ficam locais.</div>' : ""}</div><div class="modal-foot"><button class="button primary" data-close>Fechar</button></div>`,
    "wide",
  );
  $("#useLocal", m.host).onclick = async () => {
    const r = await window.vesper.useLocalStorage();
    if (r?.data) state.db = r.data;
    state.meta.storage = r?.storage || { mode: "local" };
    updateStorageUi();
    m.close();
    renderTools();
    toast("Base local ativada.", "good");
  };
  $("#chooseShared", m.host).onclick = async () => {
    const r = await window.vesper.chooseSharedFolder();
    if (r?.data) {
      state.db = r.data;
      prepareDb();
      state.meta.storage = r.storage;
      updateStorageUi();
      m.close();
      renderTools();
      toast("Pasta compartilhada configurada.", "good");
    }
  };
}


/* ===== Copiloto de Compras 1.9.0 ===== */
function copilotMoney(v){
  const n=Number(v||0);
  return n>0?new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(n):"—";
}
function copilotMetric(label,value,sub="",tone=""){
  return `<article class="copilot-metric ${tone}"><b>${esc(value)}</b><span>${esc(label)}</span>${sub?`<small>${esc(sub)}</small>`:""}</article>`;
}

function exportBossCsv(rows){
  const header = ["Material","Código","Família","Último preço conhecido","Fornecedor","Data","Qtd. preços","Situação"];
  const csv = [header, ...rows.map((p)=>{
    const o=currentOffer(p), status=statusOf(p);
    return [p.name||"", p.code||"", p.family||"", o?.finalPrice ? String(o.finalPrice).replace(".", ",") : "", o?.supplierName||"", o?.updatedAt||"", String((p.offers||[]).length), status.label||""];
  })].map(row=>row.map(v=>`"${String(v??"").replace(/"/g,'""')}"`).join(";")).join("\n");
  const blob = new Blob(["\ufeff"+csv], {type:"text/csv;charset=utf-8"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href=url; a.download=`vesper-chefia-historico-${new Date().toISOString().slice(0,10)}.csv`; a.click();
  setTimeout(()=>URL.revokeObjectURL(url), 500);
}
function renderBoss(){
  setTopTitle("Chefia");
  const products=(state.db.products||[]).filter(p=>!p.archived);
  const withPrice=products.filter(p=>currentOffer(p));
  const noPrice=products.length-withPrice.length;
  const events=products.flatMap(p=>(p.offers||[]).map(o=>({p,o}))).filter(x=>Number(x.o.finalPrice)>0);
  const totalValue=events.reduce((s,x)=>s+Number(x.o.finalPrice||0),0);
  const byFamily=new Map();
  products.forEach(p=>{ const cur=byFamily.get(p.family)||{family:p.family,count:0,withPrice:0,last:""}; cur.count++; if(currentOffer(p)) cur.withPrice++; const d=currentOffer(p)?.updatedAt||""; if(d>cur.last)cur.last=d; byFamily.set(p.family,cur); });
  const ranked=[...products].sort((a,b)=>String(currentOffer(b)?.updatedAt||"").localeCompare(String(currentOffer(a)?.updatedAt||""))).slice(0,80);
  const familyRows=[...byFamily.values()].sort((a,b)=>b.count-a.count).slice(0,20).map(f=>`<tr><td>${esc(f.family||"Sem família")}</td><td>${f.count}</td><td>${f.withPrice}</td><td>${f.count-f.withPrice}</td><td>${f.last?dateBR(f.last):"—"}</td></tr>`).join("");
  const priceRows=ranked.map(p=>{ const o=currentOffer(p), prev=sortedOffers(p)[1], ch=priceChange(o,prev); const st=statusOf(p); return `<tr><td><button class="linklike" data-detail="${p.id}">${esc(p.name)}</button><small>${esc(p.code||p.family||"")}</small></td><td>${money(o?.finalPrice)}</td><td>${esc(o?.supplierName||"—")}</td><td>${o?.updatedAt?dateBR(o.updatedAt):"—"}</td><td>${prev?money(prev.finalPrice):"—"}</td><td>${ch!==null?`${ch>0?"+":""}${ch.toFixed(1).replace(".",",")}%`:"—"}</td><td><span class="status ${st.class}">${esc(st.label)}</span></td></tr>`; }).join("");
  const supplierUse=new Map();
  events.forEach(({p,o})=>{ const k=o.supplierName||"Fornecedor não informado"; const cur=supplierUse.get(k)||{name:k,events:0,products:new Set(),total:0,last:""}; cur.events++; cur.products.add(p.id); cur.total+=Number(o.finalPrice||0); if((o.updatedAt||"")>cur.last)cur.last=o.updatedAt; supplierUse.set(k,cur); });
  const supplierRows=[...supplierUse.values()].sort((a,b)=>b.events-a.events).slice(0,15).map(s=>`<tr><td>${esc(s.name)}</td><td>${s.events}</td><td>${s.products.size}</td><td>${money(s.total)}</td><td>${s.last?dateBR(s.last):"—"}</td></tr>`).join("");
  $("#content").innerHTML=`${pageHead("Visão da chefia","Histórico completo e último preço conhecido. Preço antigo não é erro: só muda quando comprar de novo.",'<button class="button" id="exportBossCsv">Exportar CSV</button>')}
  <div class="kpi-grid boss-kpis"><article class="kpi"><span>Materiais ativos</span><b>${products.length}</b><small>Catálogo disponível para busca</small></article><article class="kpi"><span>Com preço conhecido</span><b>${withPrice.length}</b><small>${Math.round((withPrice.length/products.length)*100)||0}% do catálogo</small></article><article class="kpi"><span>Sem compra registrada</span><b>${noPrice}</b><small>Não é erro; falta primeira compra</small></article><article class="kpi"><span>Eventos de preço</span><b>${events.length}</b><small>Histórico preservado</small></article></div>
  <article class="card boss-card"><div class="section-bar"><div><h2>Últimos preços conhecidos</h2><p>Painel da Chefia — compare variação, fornecedor e data sem abrir planilha.</p></div></div><div class="table-wrap"><table class="trace-table boss-table"><thead><tr><th>Material</th><th>Preço atual</th><th>Fornecedor</th><th>Data</th><th>Anterior</th><th>Δ</th><th>Situação</th></tr></thead><tbody>${priceRows||'<tr><td colspan="7">Sem histórico.</td></tr>'}</tbody></table></div></article>
  <div class="two-col"><article class="card"><h2>Cobertura por família</h2><div class="table-wrap"><table class="trace-table"><thead><tr><th>Família</th><th>Total</th><th>Com preço</th><th>Sem preço</th><th>Última compra</th></tr></thead><tbody>${familyRows}</tbody></table></div></article><article class="card"><h2>Fornecedores mais usados</h2><div class="table-wrap"><table class="trace-table"><thead><tr><th>Fornecedor</th><th>Eventos</th><th>Materiais</th><th>Soma histórica</th><th>Última</th></tr></thead><tbody>${supplierRows}</tbody></table></div></article></div>`;
  bindCommonActions();
  $("#exportBossCsv").onclick=()=>exportBossCsv(products);
}

function renderCopilot(){
  setTopTitle("Copiloto");
  const audit=window.VesperCopilot?.auditCatalog?.(state.db) || {metrics:{},queue:[],priceAlerts:[],supplierDupes:[],supplierCoverage:[],score:0};
  const m=audit.metrics||{};
  const scoreTone=audit.score>=85?"good":audit.score>=70?"warn":"bad";
  const priceRows=(audit.priceAlerts||[]).slice(0,8).map(x=>`<tr><td><button class="linkish" data-open-product="${esc(x.product.id)}">${esc(x.product.name)}</button><small>${esc(x.product.family||"")}</small></td><td>${copilotMoney(x.previous?.finalPrice)}</td><td>${copilotMoney(x.current?.finalPrice)}</td><td><b class="${x.delta>0?'danger-text':'success-text'}">${Math.round(x.delta)}%</b></td></tr>`).join("");
  const queueRows=(audit.queue||[]).slice(0,18).map(x=>`<div class="copilot-task ${x.priority.toLowerCase()}"><span>${esc(x.priority)}</span><div><b>${esc(x.type)}</b><button class="linkish" data-open-product="${esc(x.product?.id||"")}">${esc(x.product?.name||"Material")}</button><small>${esc(x.reason||"")}</small></div></div>`).join("");
  const supplierRows=(audit.supplierDupes||[]).slice(0,8).map(x=>`<div class="copilot-dupe"><div><b>${esc(x.a.name)}</b><small>possível duplicado de</small><b>${esc(x.b.name)}</b></div><span>${x.score}%</span></div>`).join("");
  const coverageRows=(audit.supplierCoverage||[]).slice(0,8).map(x=>`<tr><td>${esc(x.supplier.name)}</td><td>${x.offers}</td><td>${x.productCount}</td><td>${copilotMoney(x.total)}</td></tr>`).join("");
  const duplicateRows=(audit.duplicateCodes||[]).slice(0,6).map(x=>`<div class="copilot-dupe"><div><b>Código ${esc(x.code)}</b><small>${x.products.map(p=>p.name).slice(0,3).join(" • ")}</small></div><span>${x.count}x</span></div>`).join("");
  $("#content").innerHTML=`${pageHead("Copiloto de compras","Auditoria local para decidir o que revisar primeiro, sem substituir a decisão humana.",'<button class="button" id="copilotRefresh">Atualizar análise</button><button class="button" id="copilotReview">Revisão</button>')}
  <section class="copilot-hero card"><div><small>Score operacional</small><strong class="${scoreTone}">${audit.score}/100</strong><p>O score combina revisão de cadastro, materiais sem compra, códigos repetidos e variações fora do padrão. Preço antigo é apenas o último preço conhecido.</p></div><div class="copilot-metrics">${copilotMetric("Materiais",m.products||0)}${copilotMetric("Fornecedores",m.suppliers||0)}${copilotMetric("Últimos preços antigos",m.stale||0,"fora da janela","warn")}${copilotMetric("Sem histórico",m.noPrice||0,"sem compra registrada","warn")}${copilotMetric("Alertas preço",m.priceAlerts||0,"variação incomum",m.priceAlerts?"bad":"")}${copilotMetric("Duplicidades",(m.duplicateCodes||0)+(m.duplicateNames||0)+(m.supplierDupes||0),"código/nome/fornecedor",m.supplierDupes||m.duplicateCodes?"bad":"")}</div></section>
  <div class="copilot-grid">
    <article class="card copilot-panel"><div class="section-bar"><div><h2>Fila sugerida</h2><p>Prioridade por risco operacional.</p></div></div><div class="copilot-list">${queueRows||emptyState("Nada crítico agora","O catálogo não gerou tarefas prioritárias.")}</div></article>
    <article class="card copilot-panel"><div class="section-bar"><div><h2>Variações de preço</h2><p>Compara preço atual com a compra anterior.</p></div></div><div class="table-wrap"><table class="trace-table"><thead><tr><th>Material</th><th>Anterior</th><th>Atual</th><th>Δ</th></tr></thead><tbody>${priceRows||'<tr><td colspan="4">Sem variações fora da janela configurado.</td></tr>'}</tbody></table></div></article>
    <article class="card copilot-panel"><div class="section-bar"><div><h2>Fornecedores duplicados</h2><p>Nomes parecidos para unificar manualmente.</p></div><button class="button" id="copilotTools">Configurações</button></div><div class="copilot-list">${supplierRows||emptyState("Nenhum duplicado forte","A base não mostra nomes muito semelhantes.")}</div></article>
    <article class="card copilot-panel"><div class="section-bar"><div><h2>Códigos repetidos</h2><p>Pontos que podem confundir a busca.</p></div></div><div class="copilot-list">${duplicateRows||emptyState("Sem código repetido crítico","A auditoria não encontrou códigos duplicados relevantes.")}</div></article>
    <article class="card copilot-panel wide"><div class="section-bar"><div><h2>Fornecedores mais usados</h2><p>Ajuda a priorizar atualização de contatos e negociação.</p></div></div><div class="table-wrap"><table class="trace-table"><thead><tr><th>Fornecedor</th><th>Compras</th><th>Materiais</th><th>Total histórico</th></tr></thead><tbody>${coverageRows||'<tr><td colspan="4">Sem compras registradas.</td></tr>'}</tbody></table></div></article>
  </div>`;
  $("#copilotRefresh").onclick=renderCopilot;
  $("#copilotReview").onclick=()=>go("review");
  $("#copilotTools")?.addEventListener("click",()=>go("tools"));
  $$('[data-open-product]').forEach(b=>b.onclick=()=>{ if(b.dataset.openProduct) openDetail(b.dataset.openProduct); });
}

function render() {
  switch (state.view) {
    case "quick":
      return renderQuick();
    case "history":
      return renderHistory();
    case "copilot":
      return renderCopilot();
    case "boss":
      return renderBoss();
    case "review":
      return renderReview();
    case "suppliers":
      return renderSuppliers();
    case "tools":
      return renderTools();
    default:
      return renderCatalog();
  }
}
function help() {
  modal(`<div class="modal-head"><div><h2>Como usar</h2><p>Três passos para o trabalho do dia a dia.</p></div><button class="modal-close" data-close>×</button></div><div class="modal-body"><div class="help-steps"><div><span>1</span><b>Procure</b><p>Digite o nome, código, medida ou fornecedor.</p></div><div><span>2</span><b>Confira</b><p>Escolha a variação correta e veja o último preço.</p></div><div><span>3</span><b>Atualize</b><p>Informe valor pago, quantidade, fornecedor e salve.</p></div></div><div class="info-box">Atalho: <b>Ctrl + K</b> volta para a busca.</div></div><div class="modal-foot"><button class="button primary" data-close>Entendi</button></div>`,"wide");
}
function prepareDb() {
  state.db.products = (state.db.products || []).map(ensureShape);
  state.db.suppliers = state.db.suppliers || [];
  state.db.brands = state.db.brands || [];          // Melhoria #2: lista de marcas
  state.db.settings = state.db.settings || {};
  // Garantir defaults de settings sem sobrescrever valores salvos
  state.db.settings.staleDays = state.db.settings.staleDays ?? 180;
  state.db.settings.priceAlertThreshold = state.db.settings.priceAlertThreshold ?? 30; // Melhoria #10A
  state.db.settings.recentProductIds = state.db.settings.recentProductIds || [];
  state.db.auditLog = state.db.auditLog || [];
  rebuildCategories();
  refreshSupplierCounts();
  state.recent = state.db.settings.recentProductIds || [];
}
async function syncData(opts = {}) {
  try {
    const r = await window.vesper.sync();
    if (
      r?.data &&
      Number(r.data.revision || 0) > Number(state.db.revision || 0)
    ) {
      state.db = r.data;
      prepareDb();
      render();
      if (!opts.silent) toast("Dados atualizados a partir da base central.", "good");
    } else if (!opts.silent) toast("Você já está com os dados mais recentes.", "good");
  } catch (e) {
    if (!opts.silent) toast(e.message, "bad");
  }
}
async function init() {
  try {
    const loaded=await window.vesper.load();state.db=loaded.data;state.meta=loaded;prepareDb();renderNav();render();updateStorageUi(loaded.storage);
    $("#createBtn").onclick=openCreate; $("#helpBtn").onclick=help; $("#settingsBtn").onclick=()=>go("tools"); $("#helpTop").onclick=help; $("#syncBtn").onclick=syncData;
    document.addEventListener("keydown",(e)=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="k"){e.preventDefault();if(state.view!=="catalog")go("catalog");setTimeout(()=>$("#mainSearch")?.focus(),40);}});
    window.addEventListener("focus",()=>{if((state.meta?.storage?.mode==="shared"||state.meta?.storage?.mode==="server")&&!state.modalOpen)syncData({silent:true});});
    setInterval(()=>{if((state.meta?.storage?.mode==="shared"||state.meta?.storage?.mode==="server")&&!state.modalOpen)syncData({silent:true});},30000);
  } catch(e){console.error(e);$("#content").innerHTML=emptyState("Não foi possível abrir a base",e.message||"Erro desconhecido.");}
}

/* ===== Experiência simplificada 1.3.0 ===== */
NAV.splice(0, NAV.length,
  ["catalog", "⌕", "Buscar"],
  ["copilot", "◈", "Copiloto"],
  ["history", "◷", "Histórico"],
  ["suppliers", "♟", "Fornecedores"],
);

function supplierByName(value="") {
  const n=norm(value);
  return (state.db.suppliers||[]).find(s=>norm(s.name)===n || (s.aliases||[]).some(a=>norm(a)===n)) || null;
}
function ensureSupplierByName(value="") {
  const name=clean(value);
  if(!name) return null;
  const old=supplierByName(name);
  if(old) return old;
  const s={id:uid("sup"),name,email:"",phone:"",aliases:[],sources:["Aplicativo"],productCount:0,quotedProductCount:0,relatedProductCount:0};
  state.db.suppliers.push(s);
  addActivity(`Fornecedor ${name} cadastrado durante uma compra`,"create","supplier",s.id);
  return s;
}
function suppliersForProduct(p, query="") {
  const usedIds=[...new Set(sortedOffers(p).map(o=>o.supplierId).filter(Boolean))];
  const q=norm(query);
  const all=(state.db.suppliers||[]).filter(s=>!q || norm([s.name,s.email,s.phone,...(s.aliases||[])].join(" ")).includes(q));
  return all.sort((a,b)=>{
    const au=usedIds.includes(a.id)?0:1, bu=usedIds.includes(b.id)?0:1;
    if(au!==bu) return au-bu;
    return (b.quotedProductCount||0)-(a.quotedProductCount||0) || a.name.localeCompare(b.name,"pt-BR");
  }).slice(0,5);
}
function supplierSuggestHtml(p, query="") {
  const list=suppliersForProduct(p,query);
  if(!clean(query) && !list.length) return "";
  return `<div class="supplier-suggestions">${list.map(s=>`<button type="button" class="supplier-suggestion" data-pick-supplier="${s.id}"><b>${esc(s.name)}</b><small>${(p.offers||[]).some(o=>o.supplierId===s.id)?"Já usado neste material":esc(s.email||s.phone||"Fornecedor cadastrado")}</small></button>`).join("")}${clean(query)&&!supplierByName(query)?`<button type="button" class="supplier-suggestion create" data-create-supplier="${esc(query)}"><b>＋ Usar “${esc(query)}”</b><small>O fornecedor será criado ao salvar.</small></button>`:""}</div>`;
}
function bindSupplierInput(root,p,input,box){
  const paint=()=>{box.innerHTML=supplierSuggestHtml(p,input.value); $$('[data-pick-supplier]',box).forEach(b=>b.onclick=()=>{const s=state.db.suppliers.find(x=>x.id===b.dataset.pickSupplier);input.value=s?.name||"";box.innerHTML="";input.focus();}); $$('[data-create-supplier]',box).forEach(b=>b.onclick=()=>{input.value=b.dataset.createSupplier;box.innerHTML="";input.focus();});};
  input.oninput=paint;
  input.onfocus=paint;
  input.onkeydown=e=>{if(e.key==="Escape")box.innerHTML="";};
  root.addEventListener("focusin",e=>{if(e.target!==input&&!box.contains(e.target))box.innerHTML="";});
  root.addEventListener("click",e=>{if(e.target!==input&&!box.contains(e.target))box.innerHTML="";});
}
function simpleOfferSummary(p){
  const os=sortedOffers(p).slice(0,3);
  return `<div class="purchase-history-mini"><h3>Últimos preços</h3>${[0,1,2].map((i)=>{const o=os[i];return `<div class="purchase-history-line"><span>${i===0?"Atual":i===1?"Anterior":"3º preço"}</span><b>${o?money(o.finalPrice):"Sem registro"}</b><small>${o?`${esc(o.supplierName||"Fornecedor não informado")} • ${dateBR(o.updatedAt,o.updatedAtRaw)}`:"—"}</small></div>`}).join("")}</div>`;
}
function maybeWarnPrice(p,value,root){
  const old=Number(currentOffer(p)?.finalPrice||0), now=Number(value||0), el=$("#priceDifference",root);
  if(!el)return;
  if(!(old>0&&now>0)){el.hidden=true;return;}
  const change=((now-old)/old)*100;
  // Melhoria #10A: threshold configurável em vez de fixo em 30%
  const threshold = Number(state.db?.settings?.priceAlertThreshold ?? 30);
  el.hidden=Math.abs(change)<threshold;
  if(!el.hidden) el.innerHTML=`<b>${change>0?"Aumento":"Redução"} de ${Math.abs(change).toFixed(1).replace(".",",")}%</b><span>Confira a quantidade e a unidade antes de salvar.</span>`;
}
function openPrice(id) {
  const p=state.db.products.find(x=>x.id===id); if(!p)return;
  const today=new Date().toISOString().slice(0,10), unit=unitText(p.unit);
  const m=modal(`<form id="priceForm"><div class="modal-head"><div><h2>Registrar nova compra</h2><p>${esc(p.name)}${p.subtitle?` • ${esc(p.subtitle)}`:""}</p></div><button type="button" class="modal-close" data-close>×</button></div><div class="modal-body purchase-modal-grid"><section class="purchase-form"><div class="field supplier-combo"><label>Fornecedor desta compra <span>— opcional</span></label><input name="supplierName" id="purchaseSupplier" autocomplete="off" placeholder="Digite ou escolha um fornecedor"><div id="purchaseSupplierSuggestions"></div><small>Nenhum fornecedor é escolhido automaticamente.</small></div><div class="purchase-numbers"><div class="field"><label>Valor pago (R$) *</label><input type="number" inputmode="decimal" name="basePrice" min="0.0001" step="0.0001" placeholder="0,00" required></div><div class="field"><label>Quantidade comprada</label><input type="number" inputmode="decimal" name="quantity" min="0.0001" step="0.0001" value="1"><small>Deixe 1 quando o valor já for por ${esc(unit)}.</small></div></div><div class="purchase-result"><span>Preço calculado por ${esc(unit)}</span><strong id="calculatedPrice">Preço não informado</strong></div><div class="field"><label>Data da compra</label><input type="date" name="updatedAt" value="${today}"></div><div id="priceDifference" class="price-difference" hidden></div><details class="optional-details"><summary>Nota, impostos ou observação — opcional</summary><div class="form-grid"><div class="field"><label>IPI (%)</label><input type="number" name="ipi" step="0.01" value="0"></div><div class="field"><label>Outro ajuste (%)</label><input type="number" name="adjustment" step="0.01" value="0"></div><div class="field span-2"><label>Número da nota ou observação</label><input name="notes" placeholder="Ex.: NF 8296, prazo 30 dias"></div></div></details></section><aside class="purchase-side">${simpleOfferSummary(p)}<div class="purchase-tip"><b>O histórico é preservado</b><span>Este registro será adicionado. Nenhum preço anterior será apagado.</span></div></aside></div><div class="modal-foot"><button type="button" class="button" data-close>Cancelar</button><button class="button primary" type="submit">Salvar compra</button></div></form>`,"xwide");
  const f=$("#priceForm",m.host), supInput=$("#purchaseSupplier",m.host), supBox=$("#purchaseSupplierSuggestions",m.host);
  bindSupplierInput(m.host,p,supInput,supBox);
  const calc=()=>{const fd=new FormData(f), final=priceFormula(fd.get("basePrice"),fd.get("ipi"),fd.get("adjustment"),fd.get("quantity")||1,0); $("#calculatedPrice",m.host).textContent=money(final); maybeWarnPrice(p,final,m.host);};
  f.addEventListener("input",calc); f.addEventListener("change",calc); calc();
  f.onsubmit=async e=>{e.preventDefault(); const fd=new FormData(f), base=Number(fd.get("basePrice")),div=Number(fd.get("quantity")||1),ipi=Number(fd.get("ipi")||0),adjustment=Number(fd.get("adjustment")||0); if(!(base>0&&div>0))return toast("Informe um valor e uma quantidade válidos.","bad"); const finalPrice=priceFormula(base,ipi,adjustment,div), old=Number(currentOffer(p)?.finalPrice||0); if(old>0&&Math.abs((finalPrice-old)/old)>=1 && !confirm(`O novo preço é ${Math.abs(((finalPrice-old)/old)*100).toFixed(1)}% diferente do anterior. Deseja salvar mesmo assim?`))return; const sup=ensureSupplierByName(fd.get("supplierName")); const offer={id:uid("off"),supplierId:sup?.id||"",supplierName:sup?.name||"Não informado",basePrice:base,ipi,adjustment,quantity:div,finalPrice,updatedAt:fd.get("updatedAt")||today,updatedAtRaw:"",email:sup?.email||"",phone:sup?.phone||"",notes:clean(fd.get("notes")),source:{sheet:"Aplicativo",row:""},qualityIssues:[],calculationMode:"standard",percentUnit:"percent"}; p.offers.push(offer); if(sup&&!(p.supplierLinks||[]).some(x=>x.supplierId===sup.id&&x.kind==="quoted"))p.supplierLinks.push({supplierId:sup.id,name:sup.name,kind:"quoted",source:"Aplicativo"}); addActivity(`Nova compra de ${p.name}: ${money(finalPrice)}`,"price","product",p.id,{offerId:offer.id}); refreshSupplierCounts(); if(await persist("Compra registrada. O histórico anterior foi mantido.",{backup:"antes-registrar-compra"})){m.close();render();toast("Compra registrada.","good");}};
  setTimeout(()=>supInput.focus(),40);
}

function productCard(p) {
  const offers=sortedOffers(p),o=offers[0],prev=offers[1],chips=(p.specs||[]).slice(0,3);
  return `<article class="product-card simple-product-card" data-product-card="${p.id}"><div class="family-icon">${esc(familyMark(p))}</div><div class="product-main"><div class="product-kicker"><span>${esc(p.family)}</span>${p.code?`<span class="code-mini">${esc(p.code)}</span>`:""}</div><div class="product-title">${esc(p.name)}</div>${p.subtitle?`<div class="product-subtitle">${esc(p.subtitle)}</div>`:""}${chips.length?`<div class="spec-chips">${chips.map(x=>`<span class="spec-chip">${esc(x.value)}</span>`).join("")}</div>`:""}</div><div class="price-block"><strong>${money(o?.finalPrice)}</strong><small>${o?`${esc(o.supplierName||"Fornecedor não informado")} • ${dateBR(o.updatedAt,o.updatedAtRaw)}`:"Ainda não há compra registrada"}</small>${prev?`<div class="previous-price">Anterior: ${money(prev.finalPrice)}</div>`:""}</div><div class="card-actions"><button class="button small" data-detail="${p.id}">Ver histórico</button><button class="button small primary" data-price="${p.id}">Registrar compra</button></div></article>`;
}
function groupedCard(group){
  if(group.products.length===1)return productCard(group.products[0]);
  const variants=group.products.slice(0,4),best=group.products[0];
  return `<article class="product-group-card"><div class="group-head"><div class="family-icon">${esc(familyMark(best))}</div><div class="group-title"><span>${esc(group.family)}</span><h3>${esc(group.name)}</h3><small>Escolha a variação correta</small></div></div><div class="variant-list">${variants.map(p=>{const o=currentOffer(p);return `<div class="variant-row"><div class="variant-copy"><b>${esc(variantLine(p))}</b><small>${esc(p.code||"Código não informado")}</small></div><div class="variant-price"><b>${money(o?.finalPrice)}</b><small>${o?esc(o.supplierName||"Fornecedor não informado"):"Sem compra registrada"}</small></div><div class="variant-actions"><button class="button small" data-detail="${p.id}">Histórico</button><button class="button small primary" data-price="${p.id}">Registrar</button></div></div>`}).join("")}</div>${group.products.length>4?`<button class="group-more" data-more-variants="${esc(group.key)}">Ver as ${group.products.length} variações</button>`:""}</article>`;
}

function renderCatalog(){
  setTopTitle("Buscar");
  $("#content").innerHTML=`<section class="search-shell purchase-home"><div class="purchase-home-title"><h1>O que você comprou?</h1><p>Digite como aparece na nota, boleto ou embalagem.</p></div><div class="search-field"><span class="search-icon">⌕</span><input id="mainSearch" value="${esc(state.query)}" placeholder="Nome, código, medida ou fornecedor" autocomplete="off" spellcheck="false"><button class="clear-search" id="clearSearch" ${state.query?"":"hidden"}>×</button><button class="icon-button" type="button" id="startCameraBtn" title="Ler código de barras pela câmera" style="margin-left:8px; border:none; background:none; font-size:18px; cursor:pointer;">📷</button></div><div id="barcodeScannerArea" style="width: 100%; text-align: center;"></div><div class="home-actions"><button class="button" id="openMany">Registrar vários itens ou importar NF-e</button><span id="searchState"></span></div></section><div id="catalogBody"></div>`;
  const input=$("#mainSearch"); let timer;
  input.oninput=e=>{state.query=e.target.value;state.limit=30;$("#clearSearch").hidden=!state.query;clearTimeout(timer);const q=clean(state.query);if(q.length<=1){updateCatalogBody();return;}$("#searchState").textContent="Digitando...";timer=setTimeout(()=>requestAnimationFrame(updateCatalogBody),180);};
  $("#clearSearch").onclick=()=>{state.query="";input.value="";$("#clearSearch").hidden=true;updateCatalogBody();input.focus();};
  $("#openMany").onclick=()=>go("quick");

  let html5QrcodeScanner = null;
  $("#startCameraBtn").onclick = () => {
    const area = $("#barcodeScannerArea");
    if (html5QrcodeScanner) {
      html5QrcodeScanner.stop().then(() => {
        area.innerHTML = "";
        html5QrcodeScanner = null;
        $("#startCameraBtn").textContent = "📷";
      });
    } else {
      area.innerHTML = `<div id="reader" style="width: 100%; max-width: 500px; margin: 15px auto; border: 1px solid var(--border); border-radius: 8px; overflow: hidden;"></div>`;
      $("#startCameraBtn").textContent = "❌";
      html5QrcodeScanner = new Html5Qrcode("reader");
      html5QrcodeScanner.start(
        { facingMode: "environment" },
        {
          fps: 10,
          qrbox: { width: 300, height: 150 }
        },
        (decodedText, decodedResult) => {
          html5QrcodeScanner.stop().then(() => {
            area.innerHTML = "";
            html5QrcodeScanner = null;
            $("#startCameraBtn").textContent = "📷";
            state.query = decodedText;
            input.value = decodedText;
            $("#clearSearch").hidden = false;
            updateCatalogBody();

            // Busca correspondência exata
            const p = state.db.products.find(x => x.code === decodedText || (x.externalCodes || []).includes(decodedText));
            if (p) {
              openPrice(p.id);
            } else {
              toast(`Código ${decodedText} lido. Procurando no catálogo...`, "good");
            }
          });
        },
        (err) => {}
      ).catch(err => {
        toast("Não foi possível acessar a câmera. Verifique as permissões.", "bad");
        area.innerHTML = "";
        html5QrcodeScanner = null;
        $("#startCameraBtn").textContent = "📷";
      });
    }
  };

  updateCatalogBody();
}
function updateCatalogBody(){
  const root=$("#catalogBody");if(!root)return;const q=clean(state.query);
  if(q.length===1){$("#searchState").textContent="Continue digitando";root.innerHTML="";return;}
  if(!q&&!state.filters.family&&!state.filters.supplier&&!state.filters.brand&&!state.filters.status){const recent=state.recent.map(id=>state.db.products.find(p=>p.id===id)).filter(p=>p&&!p.archived).slice(0,4);$("#searchState").textContent="";root.innerHTML=recent.length?`<section class="recent-section"><div class="section-bar"><div><h2>Comprados recentemente</h2><p>Escolha um item para registrar uma nova compra.</p></div></div><div class="results-list compact-results">${recent.map(productCard).join("")}</div></section>`:`<div class="welcome-note simple-welcome"><b>Comece pela busca.</b><span>Ela entende códigos, fornecedores, polegadas, milímetros e descrições copiadas da nota.</span></div>`;bindCommonActions(root);return;}
  const list=filteredProducts(),groups=groupProducts(list),show=groups.slice(0,state.limit);$("#searchState").textContent=`${list.length} encontrado${list.length===1?"":"s"}`;root.innerHTML=`<div class="result-toolbar"><div><h2>${q?`Resultados para “${esc(q)}”`:"Materiais"}</h2><p>${list.length?"Escolha a variação correta para registrar a compra.":""}</p></div><button class="button" id="toggleFilters">${state.filtersOpen?"Fechar filtros":"Mais filtros"}</button></div>${state.filtersOpen?filterPanel():""}<div class="results-list">${show.length?show.map(groupedCard).join(""):emptyState("Não encontramos esse material","Tente menos palavras ou cadastre usando o texto informado.",`<button class="button primary" data-create>Novo material: ${esc(q)}</button>`)}</div>${show.length<groups.length?'<button class="button load-more" id="moreProducts">Mostrar mais</button>':""}`;$("#toggleFilters").onclick=()=>{state.filtersOpen=!state.filtersOpen;updateCatalogBody();};if(state.filtersOpen)bindFilters();$("#moreProducts")?.addEventListener("click",()=>{state.limit+=30;updateCatalogBody();});$$('[data-more-variants]',root).forEach(b=>b.onclick=()=>openVariants(b.dataset.moreVariants));$$('[data-create]',root).forEach(b=>b.onclick=()=>openCreate(q));bindCommonActions(root);
}

function addQuickProduct(id){const p=state.db.products.find(x=>x.id===id);if(!p||state.quickQueue.some(x=>x.productId===id))return;state.quickQueue.push({productId:id,supplierName:"",basePrice:"",ipi:0,adjustment:0,quantity:1,updatedAt:new Date().toISOString().slice(0,10),notes:""});state.quickQuery="";renderQuick();setTimeout(()=>$$('[data-quick-base]').at(-1)?.focus(),40);}
function quickRow(q,i){const p=state.db.products.find(x=>x.id===q.productId),o=currentOffer(p),final=priceFormula(q.basePrice,q.ipi,q.adjustment,q.quantity ?? q.divisor ?? 1),change=Number(o?.finalPrice)>0&&Number(final)>0?((Number(final)-Number(o.finalPrice))/Number(o.finalPrice))*100:null;const listId=`supplier-list-${i}`;return `<article class="quick-row simple-quick-row" data-quick-row="${i}"><div class="quick-product"><b>${esc(p.name)}</b><small>${esc(variantLine(p))}${o?` • último ${money(o.finalPrice)}`:" • primeira compra"}</small></div><div class="quick-main-fields"><div class="field supplier-field"><label>Fornecedor <span>opcional</span></label><input name="supplierName" data-q="supplierName" list="${listId}" value="${esc(q.supplierName||"")}" placeholder="Digite ou escolha"><datalist id="${listId}">${(state.db.suppliers||[]).slice().sort((a,b)=>a.name.localeCompare(b.name,"pt-BR")).map(s=>`<option value="${esc(s.name)}"></option>`).join("")}</datalist></div><div class="field"><label>Valor pago</label><input name="basePrice" data-q="basePrice" data-quick-base inputmode="decimal" type="number" min="0.0001" step="0.0001" value="${esc(q.basePrice)}" placeholder="0,00"></div><div class="field quantity-field"><label>Quantidade</label><input name="quantity" data-q="quantity" type="number" min="0.0001" step="0.0001" value="${q.quantity ?? q.divisor ?? 1}"></div><div class="field date-field"><label>Data</label><input data-q="updatedAt" type="date" value="${q.updatedAt}"></div><div class="quick-result"><span>Por ${esc(unitText(p.unit))}</span><b data-final>${money(final)}</b><small data-change>${change===null?"":`${change>=0?"+":""}${change.toFixed(1).replace(".",",")}%`}</small></div><button class="icon-button" data-remove-quick="${i}">×</button></div><details class="quick-adjustments"><summary>Nota ou ajustes — opcional</summary><div class="form-grid"><div class="field"><label>IPI %</label><input data-q="ipi" type="number" step="0.01" value="${q.ipi}"></div><div class="field"><label>Outro ajuste %</label><input data-q="adjustment" type="number" step="0.01" value="${q.adjustment}"></div><div class="field span-2"><label>Número da nota ou observação</label><input data-q="notes" value="${esc(q.notes||"")}"></div></div></details></article>`;}
function renderQuick(){setTopTitle("Registrar vários itens");const undo=state.db.lastBatchUndo;$("#content").innerHTML=`${pageHead("Registrar vários itens","Adicione os produtos, confira os valores e salve tudo de uma vez.",'<button class="button" id="backToSearch">Voltar</button>')}<div class="update-methods"><button class="method-card active" id="focusQuick"><span>⌕</span><b>Procurar itens</b><small>Digite nome, código ou medida.</small></button><button class="method-card" id="pasteInvoice"><span>≡</span><b>Colar da nota</b><small>Uma linha para cada item.</small></button><button class="method-card" id="importNfe"><span>XML</span><b>Importar NF-e</b><small>Preenche quantidade e fornecedor.</small></button></div><section class="quick-picker card full-picker"><div class="simple-search"><span>⌕</span><input id="quickSearch" value="${esc(state.quickQuery)}" placeholder="Procure um material" autocomplete="off"></div><div class="picker-results horizontal-results" id="quickPickerResults"></div></section><section class="quick-workspace card simple-workspace"><div class="section-bar quick-head"><div><h2>Itens para registrar</h2><p>${state.quickQueue.length?`${state.quickQueue.length} item${state.quickQueue.length===1?"":"s"}`:"Adicione um material acima"}</p></div><div class="section-actions">${undo?.offerIds?.length?'<button class="button" id="undoBatch">Desfazer último lote</button>':""}<button class="button" id="clearQueue" ${state.quickQueue.length?"":"disabled"}>Limpar</button><button class="button primary" id="saveQueue" ${state.quickQueue.length?"":"disabled"}>Salvar compras</button></div></div><div id="quickRows">${state.quickQueue.length?state.quickQueue.map((q,i)=>quickRow(q,i)).join(""):'<div class="queue-empty"><b>Nenhum item adicionado.</b><br>Procure um material, cole uma lista ou importe o XML.</div>'}</div></section>`;let timer;const input=$("#quickSearch");input.oninput=e=>{state.quickQuery=e.target.value;clearTimeout(timer);timer=setTimeout(renderQuickPickerResults,90);};input.onkeydown=e=>{if(e.key==="Enter"){const first=$("#quickPickerResults [data-add-quick]");if(first){e.preventDefault();first.click();}}};renderQuickPickerResults();$("#backToSearch").onclick=()=>go("catalog");$("#focusQuick").onclick=()=>input.focus();$("#pasteInvoice").onclick=openPasteInvoice;$("#importNfe").onclick=openNfeXml;$("#clearQueue").onclick=()=>{if(confirm("Limpar a lista?")){state.quickQueue=[];renderQuick();}};$("#saveQueue").onclick=saveQuickQueue;$("#undoBatch")?.addEventListener("click",undoLastBatch);bindQuickRows();requestAnimationFrame(()=>input.focus());}
async function saveQuickQueue(){const invalid=state.quickQueue.find(q=>!(Number(q.basePrice)>0)||!(Number(q.quantity ?? q.divisor ?? 1)>0));if(invalid)return toast("Preencha valor e quantidade em todas as linhas.","bad");const offerIds=[];for(const q of state.quickQueue){const p=state.db.products.find(x=>x.id===q.productId),sup=ensureSupplierByName(q.supplierName),offer={id:uid("off"),supplierId:sup?.id||"",supplierName:sup?.name||"Não informado",basePrice:Number(q.basePrice),ipi:Number(q.ipi||0),adjustment:Number(q.adjustment||0),quantity:Number(q.quantity ?? q.divisor ?? 1),finalPrice:priceFormula(q.basePrice,q.ipi,q.adjustment,q.quantity ?? q.divisor ?? 1),updatedAt:q.updatedAt||new Date().toISOString().slice(0,10),updatedAtRaw:"",email:sup?.email||"",phone:sup?.phone||"",notes:q.notes||"Registro em lote",source:{sheet:"Aplicativo",row:""},qualityIssues:[],calculationMode:"standard",percentUnit:"percent"};p.offers.push(offer);offerIds.push({productId:p.id,offerId:offer.id});if(sup&&!(p.supplierLinks||[]).some(x=>x.supplierId===sup.id&&x.kind==="quoted"))p.supplierLinks.push({supplierId:sup.id,name:sup.name,kind:"quoted",source:"Aplicativo"});}state.db.lastBatchUndo={offerIds,at:new Date().toISOString()};addActivity(`${offerIds.length} compras registradas em lote`,"bulk-price","batch","",{offerIds});refreshSupplierCounts();if(await persist(`${offerIds.length} compras registradas.`,{backup:"antes-registro-em-lote"})){state.quickQueue=[];renderQuick();}}

function historyRow(p){const os=sortedOffers(p),change=priceChange(os[0],os[1]);return `<article class="history-row simple-history-row"><div class="history-product"><b>${esc(p.name)}</b><small>${esc(p.subtitle||p.code||p.family)}</small>${change!==null?`<span class="trend ${change>0?"up":"down"}">${change>0?"▲":"▼"} ${Math.abs(change).toFixed(1).replace(".",",")}% desde a compra anterior</span>`:""}</div>${[0,1,2].map(i=>`<div class="history-price"><span>${i===0?"Atual":i===1?"Anterior":"3º preço"}</span><b>${os[i]?money(os[i].finalPrice):"Sem registro"}</b><small>${os[i]?`${esc(os[i].supplierName||"Não informado")} • ${dateBR(os[i].updatedAt,os[i].updatedAtRaw)}`:"—"}</small></div>`).join("")}<div class="history-actions"><button class="button small" data-detail="${p.id}">Detalhes</button><button class="button small primary" data-price="${p.id}">Nova compra</button></div></article>`;}
function updateHistoryResults(){const root=$("#historyResults"),count=$("#historyCount");if(!root)return;const q=clean(state.historyQuery);let list=(state.db.products||[]).filter(p=>sortedOffers(p).length).map(p=>({p,score:q?productScore(p,q):0})).filter(x=>!q||x.score>0).sort((a,b)=>q?b.score-a.score:String(currentOffer(b.p)?.updatedAt||"").localeCompare(String(currentOffer(a.p)?.updatedAt||""))).map(x=>x.p);const show=list.slice(0,q?state.historyLimit:10);count.textContent=q?`${list.length} resultado${list.length===1?"":"s"}`:"Compras recentes";root.innerHTML=show.length?show.map(historyRow).join(""):emptyState("Nenhum histórico encontrado","Tente o nome, código, medida ou fornecedor.");bindCommonActions(root);const more=$("#moreHistory");if(more)more.hidden=!(q&&show.length<list.length);}
function renderHistory(){setTopTitle("Histórico");$("#content").innerHTML=`${pageHead("Histórico de preços","Procure um material para ver o preço atual e os anteriores.")}<div class="simple-search history-search"><span>⌕</span><input id="historySearch" value="${esc(state.historyQuery)}" placeholder="Nome, código, medida ou fornecedor" autocomplete="off"></div><div class="section-bar"><div><h2 id="historyCount"></h2><p>Nenhum preço anterior é apagado.</p></div></div><div class="history-list" id="historyResults"></div><button class="button load-more" id="moreHistory" hidden>Mostrar mais</button>`;const input=$("#historySearch");let timer;input.oninput=e=>{state.historyQuery=e.target.value;state.historyLimit=50;clearTimeout(timer);timer=setTimeout(updateHistoryResults,100);};$("#moreHistory").onclick=()=>{state.historyLimit+=40;updateHistoryResults();};updateHistoryResults();}

function updateSupplierResults(){const root=$("#supplierResults"),heading=$("#supplierHeading");if(!root)return;const q=norm(state.supplierQuery);let list=[...(state.db.suppliers||[])].filter(x=>x.productCount>0).filter(x=>!q||norm([x.name,x.email,x.phone,...(x.aliases||[])].join(" ")).includes(q)).sort((a,b)=>q?a.name.localeCompare(b.name,"pt-BR"):(b.quotedProductCount||0)-(a.quotedProductCount||0)||(b.productCount||0)-(a.productCount||0));const show=list.slice(0,q?80:12);heading.textContent=q?`${list.length} resultado${list.length===1?"":"s"}`:"Fornecedores mais usados";root.innerHTML=show.length?show.map(supplierRow).join(""):emptyState("Fornecedor não encontrado","Você pode cadastrá-lo ao registrar uma compra.");$$('[data-supplier-detail]',root).forEach(b=>b.onclick=()=>openSupplier(b.dataset.supplierDetail));}
function renderSuppliers(){setTopTitle("Fornecedores");$("#content").innerHTML=`${pageHead("Fornecedores","Consulte contatos e materiais comprados de cada empresa.",'<button class="button" id="newSupplier">＋ Novo fornecedor</button>')}<div class="simple-search"><span>⌕</span><input id="supplierSearch" value="${esc(state.supplierQuery)}" placeholder="Nome, e-mail ou telefone" autocomplete="off"></div><div class="section-bar"><div><h2 id="supplierHeading"></h2><p>Fornecedores novos também podem ser criados durante uma compra.</p></div></div><div class="supplier-list" id="supplierResults"></div>`;const input=$("#supplierSearch");let timer;input.oninput=e=>{state.supplierQuery=e.target.value;clearTimeout(timer);timer=setTimeout(updateSupplierResults,100);};$("#newSupplier").onclick=openSupplierCreate;updateSupplierResults();}

function extractSpecsFromResearch(text){const out=[...extractSpecsFromName(text)];String(text||"").split(/\n+/).forEach(line=>{const m=line.match(/^\s*([^:]{2,40}):\s*(.{1,100})\s*$/);if(m&&!out.some(x=>norm(x.label)===norm(m[1])))out.push({label:clean(m[1]),value:clean(m[2])});});return out.slice(0,12);}
let cachedBackendPort = localStorage.getItem("vesper_backend_port") || "8008";

async function getBackendUrl() {
  // Se estamos acessando pelo navegador diretamente na rede/servidor, o backend é a própria origem da página
  if (window.location.origin && window.location.origin.startsWith("http")) {
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 1500);
      const res = await fetch(`${window.location.origin}/health`, { signal: controller.signal });
      clearTimeout(id);
      if (res.ok) {
        const data = await res.json();
        if (data.status === "online") {
          return window.location.origin;
        }
      }
    } catch (e) {}
  }

  // Testar a porta em cache primeiro com timeout de 1500ms para evitar travamentos
  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 1500);
    const res = await fetch(`http://127.0.0.1:${cachedBackendPort}/`, { signal: controller.signal });
    clearTimeout(id);
    if (res.ok) {
      const data = await res.json();
      if (data.status === "online") {
        return `http://127.0.0.1:${cachedBackendPort}`;
      }
    }
  } catch (e) {}

  // Se falhar, faz escaneamento rápido de portas concorrentes (8008 a 8018)
  const ports = ["8008", "8009", "8010", "8011", "8012", "8013", "8014", "8015", "8016", "8017", "8018"];
  const promises = ports.map(async (port) => {
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 3000); // timeout seguro de 3000ms para handshake local
      const res = await fetch(`http://127.0.0.1:${port}/`, { signal: controller.signal });
      clearTimeout(id);
      if (res.ok) {
        const data = await res.json();
        if (data.status === "online") {
          return port;
        }
      }
    } catch (e) {}
    throw new Error("offline");
  });

  try {
    const activePort = await Promise.any(promises);
    localStorage.setItem("vesper_backend_port", activePort);
    cachedBackendPort = activePort;
    return `http://127.0.0.1:${activePort}`;
  } catch (e) {
    throw new Error("Backend offline");
  }
}

function openCreate(prefill=""){
  if(typeof prefill!=="string")prefill="";
  const m=modal(`
    <form id="createForm">
      <div class="modal-head">
        <div>
          <h2>Novo material</h2>
          <p>Cole como veio na nota, boleto, WhatsApp ou embalagem. O app ajuda, mas você só confirma o que estiver claro.</p>
        </div>
        <button type="button" class="modal-close" data-close>×</button>
      </div>
      <div class="modal-body purchase-modal-grid">
        <section class="purchase-form" id="createFormLeft">
          <div class="field">
            <label>Nome ou descrição *</label>
            <textarea class="create-main-input" name="name" rows="3" required placeholder="Ex.: Fita Silver Tape Preta Adere 45mmx5m">${esc(prefill)}</textarea>
          </div>

          <div id="localAssistant" class="local-assistant" style="margin-top: 10px;"></div>

          <div class="create-main-actions" style="margin-top: 15px; display: flex; gap: 10px;">
            <button type="button" class="button" id="searchOnlineBtn">Ajudar a preencher</button>
            <button type="submit" class="button primary" id="saveLocalOnlyBtn">Salvar só com o texto</button>
          </div>

          <div id="searchProgress" class="search-progress" hidden style="margin-top: 15px; padding: 12px; background: var(--bg-hover); border-radius: 6px;">
            <div class="spinner-small" style="display:inline-block; vertical-align:middle; margin-right:8px; width:16px; height:16px; border:2px solid var(--border); border-top-color:var(--primary); border-radius:50%; animation:spin 0.8s linear infinite;"></div>
            <span id="searchProgressText" style="font-weight: 500;">Procurando o produto...</span>
          </div>

          <details class="optional-details" id="manualDetails" style="margin-top: 20px;">
            <summary>Adicionar código ou detalhes manualmente</summary>
            <div class="form-grid" style="margin-top: 10px;">
              <div class="field"><label>Código</label><input name="code" placeholder="Código interno, fabricante ou GTIN"></div>
              <div class="field">
                <label>Como é comprado?</label>
                <select name="unit">
                  <option value="un">Unidade</option>
                  <option value="m">Metro</option>
                  <option value="m²">Metro quadrado</option>
                  <option value="kg">Quilo</option>
                  <option value="par">Par</option>
                  <option value="rolo">Rolo</option>
                  <option value="cx">Caixa</option>
                </select>
              </div>
              <div class="field span-2"><label>Resumo ou aplicação</label><input name="subtitle" placeholder="Ex.: para grade de ventilador • 1 m"></div>
            </div>
          </details>
        </section>

        <aside class="purchase-side" id="createFormRight" style="min-width: 380px; max-width: 420px; display: none; padding-left: 20px; border-left: 1px solid var(--border);">
          <div id="webCandidatesSection">
            <h3 style="margin-top:0;">Possíveis referências</h3>
            <div id="webCandidatesList" class="web-candidates-list" style="display:flex; flex-direction:column; gap:10px; margin-top:10px;"></div>
          </div>

          <div id="webConfirmSection" style="display: none;">
            <div id="webConfirmHeader"></div>
            <div id="webConfirmFields" class="key-values" style="margin-top:10px; display:flex; flex-direction:column; gap:8px; padding: 10px; background: #f9fbfd; border-radius: 6px; border: 1px solid #eef2f7;"></div>
            <button type="button" class="button primary" id="applyWebInfoBtn" style="width: 100%; margin-top: 15px;">Aplicar somente os campos marcados</button>
            <button type="button" class="button" id="backToCandidatesBtn" style="width: 100%; margin-top: 5px;">Voltar para as opções</button>
          </div>
        </aside>
      </div>
      <div class="modal-foot">
        <button type="button" class="button" data-close>Cancelar</button>
      </div>
    </form>
  `,"xwide");

  const form=$("#createForm",m.host), assistant=$("#localAssistant",m.host), progress=$("#searchProgress",m.host), progressText=$("#searchProgressText",m.host), searchBtn=$("#searchOnlineBtn",m.host), sidePanel=$("#createFormRight",m.host);
  let researchedSpecs=[];
  let researchedMeta={};
  let webCandidates=[];
  let selectedCandidate=null;

  const updateLocalAssistant = () => {
    const name = clean(form.elements.name.value);
    const code = clean(form.elements.code.value);
    const similar = similarProducts(name, code);
    const cat = categoryByNameHint(`${name} ${code}`);
    const specs = normalizeSpecsList(extractSpecsFromName(name));

    let specsText = specs.length
      ? specs.map(x => `<span class="spec-chip" style="display:inline-block; background:var(--bg-hover); padding:3px 8px; border-radius:12px; font-size:12px; margin-right:5px; margin-bottom:5px; border:1px solid var(--border);">${esc(x.label)}: <b>${esc(x.value)}</b></span>`).join("")
      : "Nenhuma medida/código claro identificado ainda.";

    assistant.innerHTML = name ? `
      <div class="assistant-summary" style="margin-top:10px; padding:12px; background:#f4f7fb; border-radius:6px; border:1px dashed var(--border);">
        <div>
          <span style="font-size:12px; text-transform:uppercase; color:var(--muted); font-weight:600; display:block; margin-bottom:5px;">O app entendeu</span>
          <div style="margin-bottom:8px;">${specsText}</div>
          <small style="color:var(--muted);">Categoria sugerida: <b style="color:var(--text);">${esc(state.db.categories.find(c=>c.key===cat)?.name || "Geral")}</b></small>
        </div>
      </div>
      ${similar.length ? `
        <div class="possible-duplicates" style="margin-top:10px; padding:12px; border:1px solid #ffeeba; background:#fff3cd; border-radius:6px;">
          <b style="color:#856404; font-size:13px; display:block; margin-bottom:6px;">Confira se já existe:</b>
          <div style="display:flex; flex-direction:column; gap:5px;">
            ${similar.map(p => `<button type="button" data-open-existing="${p.id}" class="button text-button" style="text-align:left; padding:4px 8px; display:flex; justify-content:between; width:100%;"><span style="font-weight:600;">${esc(p.name)}</span><small style="color:var(--muted);">${esc(variantLine(p))}</small></button>`).join("")}
          </div>
        </div>
      ` : ""}
    ` : "";

    $$('[data-open-existing]', assistant).forEach(b => b.onclick = () => {
      m.close();
      openDetail(b.dataset.openExisting);
    });
  };

  let timer;
  form.elements.name.oninput = form.elements.code.oninput = () => {
    clearTimeout(timer);
    timer = setTimeout(updateLocalAssistant, 100);
  };

  const renderWebCandidates = () => {
    progress.hidden = true;
    searchBtn.disabled = false;
    sidePanel.style.display = "block";
    $("#webCandidatesSection", m.host).style.display = "block";
    $("#webConfirmSection", m.host).style.display = "none";
    const listEl = $("#webCandidatesList", m.host);
    listEl.innerHTML = webCandidates.map((rawCandidate, i) => {
      const c = window.VesperIntelligence?.normalizeCandidate ? window.VesperIntelligence.normalizeCandidate(rawCandidate, clean(form.elements.name.value)) : rawCandidate;
      webCandidates[i] = c;
      const { confidence, riskySource } = safeCandidateFields(c);
      const badge = sourceBadge(c);
      const confText = confidence === "alta" ? "Confiança alta" : confidence === "média" ? "Conferir antes" : "Baixa confiança";
      const confColor = confidence === "alta" ? "#166534" : confidence === "média" ? "#854d0e" : "#991b1b";
      const confBg = confidence === "alta" ? "#dcfce7" : confidence === "média" ? "#fef9c3" : "#fee2e2";
      const specs = Array.isArray(c.specs) ? c.specs : [];
      const specLines = [];
      if (c.manufacturer) specLines.push(`Fabricante: ${c.manufacturer}`);
      if (c.brand || c.product_line) specLines.push(`Marca/linha: ${c.brand || c.product_line}`);
      if (c.manufacturer_code || c.model) specLines.push(`Código do fabricante: ${c.manufacturer_code || c.model}`);
      if (c.unit) specLines.push(`Como é comprado: ${c.unit}${c.unit_confidence && c.unit_confidence !== "alta" ? " (sugerido)" : ""}`);
      if (c.supplier_suggestion) specLines.push(`Fornecedor sugerido: ${c.supplier_suggestion}`);
      specs.slice(0, 5).forEach(sp => specLines.push(`${sp.label}: ${sp.value}`));
      const sourceUrl = c.source_url || c.url || "";
      const sourceName = c.source_name || c.source || "Fonte consultada";
      const differences = Array.isArray(c.differences) ? c.differences : [];
      return `<div class="web-candidate-card" style="padding:14px;border:1px solid var(--border);border-radius:8px;background:#fff;display:flex;flex-direction:column;gap:8px;margin-bottom:12px;box-shadow:0 2px 4px rgba(0,0,0,.02)">
        <div style="display:flex;align-items:start;gap:8px"><span style="display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;background:var(--text);color:#fff;font-size:10px;font-weight:700">${i+1}</span><strong style="font-size:14px;line-height:1.25">${esc(c.canonical_name || c.name || c.title || "Produto encontrado")}</strong></div>
        <div style="font-size:12px;display:flex;flex-direction:column;gap:3px;padding-left:26px">${specLines.map(line=>`<span>• ${esc(line)}</span>`).join("") || "<span>• Sem campos estruturados suficientes</span>"}</div>
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;font-size:11px;color:var(--muted);padding-left:26px"><span>Fonte: <b>${esc(sourceName)}</b></span><span class="source-pill ${badge.tone}">${esc(badge.label)}</span><span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:12px;color:${confColor};background:${confBg};text-transform:uppercase">${confText}</span></div>
        ${differences.length ? `<div style="font-size:11px;color:#c62828;padding-left:26px">${differences.map(d=>`<span style="display:block">⚠ ${esc(d)}</span>`).join("")}</div>` : ""}
        <div style="display:flex;gap:8px;margin-top:6px;padding-left:26px"><button type="button" class="button small primary" data-pick-web="${i}" style="flex:1">Usar como referência</button>${sourceUrl ? `<button type="button" class="button small" data-open-source="${i}">Ver fonte</button>` : ""}</div>
      </div>`;
    }).join("");
    $$('[data-pick-web]', listEl).forEach(b => b.onclick = () => showConfirmSection(webCandidates[Number(b.dataset.pickWeb)], Number(b.dataset.pickWeb)));
    $$('[data-open-source]', listEl).forEach(b => b.onclick = () => { const c=webCandidates[Number(b.dataset.openSource)]; const u=c?.source_url||c?.url; if(u) window.vesper.openExternal?.(u); });
  };

  // Clique para pesquisar online
  searchBtn.onclick = async () => {
    const query = clean(form.elements.name.value);
    if (!query) return toast("Digite o nome ou descrição primeiro.", "bad");

    progress.hidden = false;
    searchBtn.disabled = true;
    sidePanel.style.display = "none";
    progressText.textContent = "Consultando somente recursos gratuitos ou o servidor local configurado...";

    try {
      const direct = await window.vesper.researchProduct?.(query);
      if (direct?.available && Array.isArray(direct.candidates) && direct.candidates.length) {
        webCandidates = direct.candidates.map(c => window.VesperIntelligence?.normalizeCandidate ? window.VesperIntelligence.normalizeCandidate(c, query) : c);
        renderWebCandidates();
        return;
      }
      const backendUrl = await getBackendUrl();

      // 1. Fallback local: busca e extração pelo backend da empresa
      const searchRes = await fetch(`${backendUrl}/search?q=${encodeURIComponent(query)}`);
      if (!searchRes.ok) throw new Error("Erro na busca do servidor local.");

      const searchData = await searchRes.json();
      if (!searchData.success || !searchData.results || searchData.results.length === 0) {
        throw new Error("Nenhum link encontrado pelo motor de busca.");
      }

      progressText.textContent = "Extraindo dados estruturados das páginas...";
      const scrapings = [];

      // 2. Scrape das páginas candidatas (pega as 3 primeiras para performance)
      const candidates = searchData.results.slice(0, 3);
      for (const cand of candidates) {
        try {
          const scrapeRes = await fetch(`${backendUrl}/scrape`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: cand.url })
          });
          if (scrapeRes.ok) {
            const scrapeData = await scrapeRes.json();
            if (scrapeData.success) {
              scrapings.push(scrapeData);
            }
          }
        } catch (err) {
          console.warn("Scrape de URL falhou: " + cand.url);
        }
      }

      if (scrapings.length === 0) {
        throw new Error("Não foi possível extrair dados estruturados das páginas.");
      }

      progressText.textContent = "Classificando e pontuando opções...";

      // 3. Fazer o match das opções
      const matchRes = await fetch(`${backendUrl}/match`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: query, candidates: scrapings })
      });
      if (!matchRes.ok) throw new Error("Erro de correspondência no servidor local.");

      const matchData = await matchRes.json();
      webCandidates = matchData.candidates || [];

      if (webCandidates.length === 0) {
        throw new Error("Nenhum produto correspondente estruturado foi identificado.");
      }

      webCandidates = webCandidates.map(c => window.VesperIntelligence?.normalizeCandidate ? window.VesperIntelligence.normalizeCandidate(c, query) : c);
      renderWebCandidates();

    } catch (e) {
      console.error("Erro na pesquisa online: ", e);
      progress.hidden = true;
      searchBtn.disabled = false;
      toast("Não foi possível pesquisar na internet. Certifique-se de que o Servidor-Backend local está em execução.", "bad");
    }
  };

  const showConfirmSection = (candidate, index) => {
    selectedCandidate = candidate;
    $("#webCandidatesSection", m.host).style.display = "none";
    $("#webConfirmSection", m.host).style.display = "block";

    // Titulo dinâmico indicando qual opcao foi escolhida (ex: Ao escolher a primeira)
    const headerEl = $("#webConfirmHeader", m.host);
    const ordinals = ["primeira", "segunda", "terceira", "quarta", "quinta"];
    const labelOrdinal = ordinals[index] || `${index + 1}ª`;

    headerEl.innerHTML = `
      <h3 style="margin-top:0; margin-bottom:8px;">Ao escolher a ${labelOrdinal}:</h3>
      <strong style="color:var(--primary); font-size:13px; display:block; margin-bottom:12px; line-height:1.3;">"${esc(candidate.name)}"</strong>
      <span style="font-weight:600; color:var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:0.5px; display:block; margin-bottom:8px;">Campos sugeridos — confirme antes de aplicar:</span>
    `;

    const fieldsEl = $("#webConfirmFields", m.host);

    // Mapeia os campos sugeridos do candidato
    const fields = [
      { key: "name", label: "Nome organizado", value: candidate.canonical_name || candidate.name || candidate.title, default: !safeCandidateFields(candidate).riskySource && (candidate.confidence === "alta") },
      { key: "manufacturer", label: "Fabricante", value: candidate.manufacturer, default: true },
      { key: "brand", label: "Marca / linha", value: candidate.brand || candidate.product_line, default: true },
      { key: "product_type", label: "Tipo do material", value: candidate.product_type_label || candidate.product_type, default: safeCandidateFields(candidate).allowCategory },
      { key: "manufacturer_code", label: "Código do fabricante", value: candidate.manufacturer_code || candidate.model, default: true },
      { key: "gtin", label: "GTIN / EAN", value: candidate.gtin, default: true },
      { key: "unit", label: "Como é comprado", value: candidate.unit, default: candidate.unit_confidence === "alta" },
      { key: "supplier_suggestion", label: "Fornecedor sugerido", value: candidate.supplier_suggestion, default: false }
    ];

    // Adiciona especificações extraídas
    normalizeSpecsList(candidate.specs || []).forEach(x => {
      fields.push({
        key: `spec_${x.label}`,
        label: x.label,
        value: x.value,
        default: candidate.confidence === "alta" || !(candidate.differences || []).some(d => d.includes(x.label))
      });
    });

    // Lista de itens formatados com checkbox (ativos ou indisponíveis)
    const htmlLines = [];
    fields.forEach(f => {
      if (f.value) {
        htmlLines.push(`
          <div style="display:flex; align-items:start; gap:8px; padding:2px 0;">
            <input type="checkbox" id="chk_${f.key}" data-key="${f.key}" data-val="${esc(f.value)}" ${f.default ? "checked" : ""} style="margin-top:2px; cursor:pointer;">
            <label for="chk_${f.key}" style="cursor:pointer; flex:1; font-size:13px; line-height:1.2; color:var(--text);">
              <b>${esc(f.label)}:</b> <span style="opacity:0.85;">${esc(f.value)}</span>
            </label>
          </div>
        `);
      } else {
        htmlLines.push(`
          <div style="display:flex; align-items:start; gap:8px; padding:2px 0; opacity:0.5;">
            <input type="checkbox" disabled style="margin-top:2px;">
            <span style="flex:1; font-size:13px; line-height:1.2; color:var(--text);">
              <b>${esc(f.label)}</b> <i style="font-size:11px;">(não disponível)</i>
            </span>
          </div>
        `);
      }
    });

    // Adiciona o item de "Descrição completa" que o crawler não preenche no formulário básico
    htmlLines.push(`
      <div style="display:flex; align-items:start; gap:8px; padding:2px 0; opacity:0.5;">
        <input type="checkbox" disabled style="margin-top:2px;">
        <span style="flex:1; font-size:13px; line-height:1.2; color:var(--text);">
          <b>Descrição completa</b> <i style="font-size:11px;">(não disponível)</i>
        </span>
      </div>
    `);

    fieldsEl.innerHTML = htmlLines.join("");
  };

  $("#backToCandidatesBtn", m.host).onclick = () => {
    $("#webCandidatesSection", m.host).style.display = "block";
    $("#webConfirmSection", m.host).style.display = "none";
    selectedCandidate = null;
  };

  $("#applyWebInfoBtn", m.host).onclick = () => {
    if (!selectedCandidate) return;

    const checks = $$("#webConfirmFields input[type='checkbox']", m.host);
    researchedSpecs = [];
    researchedMeta = { sourceName: selectedCandidate.source_name || "", sourceUrl: selectedCandidate.source_url || selectedCandidate.url || "", sourceType: selectedCandidate.source_type || "reference", confidence: selectedCandidate.confidence || "baixa" };
    checks.forEach(chk => {
      if (!chk.checked) return;
      const key = chk.dataset.key, val = chk.dataset.val;
      if (key === "name") form.elements.name.value = val;
      else if (["manufacturer","brand","product_type","manufacturer_code","gtin","unit","supplier_suggestion"].includes(key)) researchedMeta[key] = val;
      else if (key.startsWith("spec_")) researchedSpecs.push({ label: key.replace("spec_", ""), value: val, source: researchedMeta.sourceUrl, confidence: selectedCandidate.confidence || "média" });
    });
    if (researchedMeta.unit && form.elements.unit) form.elements.unit.value = researchedMeta.unit;

    // Abre a área de detalhes manuais
    $("#manualDetails", m.host).open = true;
    sidePanel.style.display = "none";
    updateLocalAssistant();
    toast("Informações aplicadas ao cadastro.", "good");
  };

  // Envio do cadastro
  form.onsubmit=async e=>{
    e.preventDefault();
    if(form.dataset.saving==="1")return;
    form.dataset.saving="1";
    const submitButton=form.querySelector('button[type="submit"]');if(submitButton)submitButton.disabled=true;
    const fd=new FormData(form),name=clean(fd.get("name")),code=clean(fd.get("code"));
    if(!name){form.dataset.saving="";if(submitButton)submitButton.disabled=false;return toast("Informe o nome do material.","bad");}

    const exact=state.db.products.find(p=>(code&&[p.code,...(p.externalCodes||[])].some(x=>norm(x)===norm(code)))||norm(p.name)===norm(name));
    if(exact&&confirm(`Este material parece já existir:\n\n${exact.name}\n\nAbrir o existente?`)){
      form.dataset.saving="";if(submitButton)submitButton.disabled=false;
      m.close();
      openDetail(exact.id);
      return;
    }

    const familyKey=categoryByNameHint(`${name} ${code}`)||"Outros",
      cat=state.db.categories.find(c=>c.key===familyKey)||{key:familyKey,name:familyKey,icon:"box"},
      specs=normalizeSpecsList([...extractSpecsFromName(name)]);

    researchedSpecs.forEach(x=>{
      if(!specs.some(y=>norm(y.label)===norm(x.label)&&norm(y.value)===norm(x.value)))
        specs.push(x);
    });
    const finalSpecs = normalizeSpecsList(specs);

    const p={
      id:uid("prd"),
      code,
      manufacturerCode: researchedMeta.manufacturer_code || "",
      gtin: researchedMeta.gtin || "",
      manufacturer: researchedMeta.manufacturer || "",
      brand: researchedMeta.brand || "",
      productLine: researchedMeta.brand || "",
      productType: selectedCandidate?.product_type || "",
      name,
      displayName:name,
      technicalName:name,
      description:"",
      category:cat.key,
      familyKey:cat.key,
      family:cat.name,
      subcategory:"Cadastrado no aplicativo",
      group:"Cadastrado no aplicativo",
      sectionPath:[],
      subtitle:clean(fd.get("subtitle")),
      unit:fd.get("unit")||"un",
      notes:"",
      icon:cat.icon||"box",
      specs: finalSpecs,
      quality:{needsReview:false,reasons:[]},
      resolvedQualityIssues:[],
      favorite:false,
      archived:false,
      contacts:[],
      aliases:[name],
      externalCodes:[code, researchedMeta.manufacturer_code, researchedMeta.gtin].filter(Boolean),
      source:researchedMeta.sourceUrl?{sheet:"Pesquisa online",row:"",url:researchedMeta.sourceUrl,name:researchedMeta.sourceName,confidence:researchedMeta.confidence}:{sheet:"Aplicativo",row:""},
      sources:researchedMeta.sourceUrl?[{sheet:"Pesquisa online",row:"",url:researchedMeta.sourceUrl,name:researchedMeta.sourceName,type:researchedMeta.sourceType,confidence:researchedMeta.confidence}]:[{sheet:"Aplicativo",row:""}],
      supplierLinks:researchedMeta.supplier_suggestion?[{supplierId:"",name:researchedMeta.supplier_suggestion,kind:"suggested",source:researchedMeta.sourceUrl||"Pesquisa online",confirmed:false}]:[],
      searchText:[name,code,fd.get("subtitle"),...finalSpecs.flatMap(x=>[x.label,x.value])].join(" "),
      offers:[]
    };

    state.db.products.unshift(p);
    rebuildCategories();
    addActivity(`Material ${p.name} cadastrado`,"create","product",p.id);

    if(await persist("Material cadastrado.",{backup:"antes-cadastrar-material"})){
      m.close();
      state.query=p.name;
      renderCatalog();
      setTimeout(()=>{
        if(confirm("Material salvo. Deseja registrar a compra agora?"))
          openPrice(p.id);
      },60);
    } else {
      form.dataset.saving="";if(submitButton)submitButton.disabled=false;
    }
  };

  updateLocalAssistant();
  setTimeout(()=>form.elements.name.focus(),30);
}

init();
