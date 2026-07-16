/* ProcureFlow — catálogo demonstrativo, auditável e simples para compras */
(() => {
  const APP_VERSION = "1.0.0-demo";
  const BUILD_ID = "portfolio-demo";
  console.log("Iniciando ProcureFlow v" + APP_VERSION + " [Build " + BUILD_ID + "]");
  const Intelligence = window.VesperIntelligence;
  Object.assign(UNIT_NAMES, { pct: "pacote", barra: "barra", bobina: "bobina", l: "litro", lt: "litro" });
  const asNumber = (value, fallback = 0) => {
    if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
    let s = clean(value);
    if (!s) return fallback;
    s = s.replace(/R\$|\s/g, "");
    if (s.includes(",") && s.includes(".")) {
      if (s.lastIndexOf(",") > s.lastIndexOf(".")) s = s.replace(/\./g, "").replace(",", ".");
      else s = s.replace(/,/g, "");
    } else if (s.includes(",")) s = s.replace(",", ".");
    const n = Number(s);
    return Number.isFinite(n) ? n : fallback;
  };
  const uniqueBy = (list, key) => [...new Map(list.map((item) => [key(item), item])).values()];
  const readableBytes = (bytes = 0) => {
    const n = Number(bytes) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1024 ** 2) return `${(n / 1024).toFixed(1).replace(".", ",")} KB`;
    return `${(n / 1024 ** 2).toFixed(1).replace(".", ",")} MB`;
  };
  const normalizeCompany = (value = "") => norm(value)
    .replace(/\b(ltda|limitada|me|epp|eireli|sa|s a|s\/a|comercio|comercial|industria|industrial|distribuidora|distribuidor)\b/g, " ")
    .replace(/\s+/g, " ").trim();
  const companyTokens = (value) => new Set(normalizeCompany(value).split(" ").filter((x) => x.length > 2));
  const jaccard = (a, b) => {
    const aa = companyTokens(a), bb = companyTokens(b);
    const union = new Set([...aa, ...bb]);
    if (!union.size) return 0;
    return [...aa].filter((x) => bb.has(x)).length / union.size;
  };
  const inputValue = (form, name) => clean(form.elements[name]?.value || "");
  const todayIso = () => new Date().toISOString().slice(0, 10);

  // ---------- Modelo e migração tolerante ----------
  const baseEnsureShape = ensureShape;
  ensureShape = function enhancedEnsureShape(product) {
    const p = baseEnsureShape(product);
    p.manufacturer = clean(p.manufacturer || p.brand || "");
    p.manufacturerId = clean(p.manufacturerId || "");
    p.aliases = Array.isArray(p.aliases) ? p.aliases : [];
    p.externalCodes = Array.isArray(p.externalCodes) ? p.externalCodes : [];
    p.originalLines = Array.isArray(p.originalLines) ? p.originalLines : [];
    p.unit = p.unit || "un";
    p.schemaVersion = Number(p.schemaVersion || 9);
    p.brand = clean(p.brand || p.productLine || "");
    p.productLine = clean(p.productLine || p.brand || "");
    p.productType = clean(p.productType || "");
    p.manufacturerCode = clean(p.manufacturerCode || "");
    p.gtin = clean(p.gtin || "");
    p.sourceEvidence = Array.isArray(p.sourceEvidence) ? p.sourceEvidence : [];
    p.archivedAt = clean(p.archivedAt || "");
    p.archiveReason = clean(p.archiveReason || "");
    return p;
  };

  function ensureCategory(key, name, icon = "box") {
    state.db.categories = Array.isArray(state.db.categories) ? state.db.categories : [];
    let found = state.db.categories.find((c) => c.key === key || norm(c.name) === norm(name));
    if (!found) {
      found = { key, name, icon, count: 0 };
      state.db.categories.push(found);
    }
    return found;
  }

  function structuredCategoryKey(productType = "", text = "") {
    const n = norm(text);
    if (productType === "fita" || productType === "adesivo") return ensureCategory("Adesivos e Fitas", "Adesivos e fitas", "tape").key;
    if (["parafuso", "porca", "arruela", "rebite", "chumbador", "abracadeira"].includes(productType)) return categoryByNameHint(text) || (n.includes("inox") ? "Fixadores Inox" : "Fixadores");
    if (["chapa", "tubo", "barra_chata", "barra_redonda", "cantoneira", "arame", "tela", "rodizio", "solda", "conexao", "flange", "cabo", "plugue", "tomada", "prensa_cabo", "painel", "capacitor", "rele", "mangueira", "embalagem", "helice"].includes(productType)) return categoryByNameHint(text);
    return categoryByNameHint(text);
  }

  function ensureBrand(name = "") {
    const value = clean(name);
    if (!value) return null;
    state.db.brands = Array.isArray(state.db.brands) ? state.db.brands : [];
    let found = state.db.brands.find((b) => norm(typeof b === "string" ? b : b.name) === norm(value));
    if (typeof found === "string") {
      const converted = { id: uid("brand"), name: found, aliases: [], productCount: 0 };
      state.db.brands[state.db.brands.indexOf(found)] = converted;
      found = converted;
    }
    if (!found) {
      found = { id: uid("brand"), name: value, aliases: [], productCount: 0 };
      state.db.brands.push(found);
    }
    return found;
  }

  const basePrepareDb = prepareDb;
  prepareDb = function enhancedPrepareDb() {
    basePrepareDb();
    state._catalogSearchCache = null;
    state._lastFilteredProducts = [];
    state._searchProfilesReady = false;
    state.db.schemaVersion = Math.max(11, Number(state.db.schemaVersion || state.db.version || 0));
    state.db.version = Math.max(10, Number(state.db.version || 0));
    state.db.appVersion = APP_VERSION;
    state.db.settings = state.db.settings || {};
    state.db.settings.staleDays = Math.max(30, asNumber(state.db.settings.staleDays, 180));
    state.db.settings.priceAlertThreshold = Math.max(5, asNumber(state.db.settings.priceAlertThreshold, 30));
    state.db.searchAnalytics = state.db.searchAnalytics || {};
    state.db.searchAnalytics.queries = Array.isArray(state.db.searchAnalytics.queries) ? state.db.searchAnalytics.queries : [];
    state.db.searchAnalytics.selections = Array.isArray(state.db.searchAnalytics.selections) ? state.db.searchAnalytics.selections : [];
    const oldBrands = Array.isArray(state.db.brands) ? state.db.brands : [];
    state.db.brands = oldBrands.map((b) => typeof b === "string" ? { id: uid("brand"), name: clean(b), aliases: [], productCount: 0 } : {
      id: b.id || uid("brand"), name: clean(b.name), aliases: Array.isArray(b.aliases) ? b.aliases : [], productCount: 0,
    }).filter((b) => b.name);
    state.db.products.forEach((p) => {
      if (!p.manufacturer) return;
      const brand = ensureBrand(p.manufacturer);
      p.manufacturerId = brand.id;
    });
    state.db.brands.forEach((b) => {
      b.productCount = state.db.products.filter((p) => p.manufacturerId === b.id || norm(p.manufacturer) === norm(b.name)).length;
    });
    state.db.brands.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    warmSearchProfiles();
  };

  // ---------- Busca industrial orientada a intenção e atributos ----------
  function rememberSearch(query, count) {
    const q = clean(query);
    if (!q || !state.db?.searchAnalytics) return;
    const item = { query: q, normalized: Intelligence.normalize(q), count, at: new Date().toISOString() };
    const last = state.db.searchAnalytics.queries.at(-1);
    if (!last || last.normalized !== item.normalized || Math.abs(new Date(item.at) - new Date(last.at)) > 30000) {
      state.db.searchAnalytics.queries.push(item);
      state.db.searchAnalytics.queries = state.db.searchAnalytics.queries.slice(-300);
    }
  }

  let warmSearchProfilesToken = 0;
  function scheduleIdleTask(fn, timeout = 2200) {
    if (typeof requestIdleCallback === "function") return requestIdleCallback(fn, { timeout });
    return setTimeout(() => fn({ timeRemaining: () => 4 }), 120);
  }

  function warmSearchProfiles() {
    const token = ++warmSearchProfilesToken;
    const products = (state.db?.products || []).filter((p) => !p.archived);
    if (!products.length || !Intelligence?.buildProductProfile) return;
    let index = 0;
    const run = (deadline) => {
      if (token !== warmSearchProfilesToken) return;
      if (clean(state.query)) {
        setTimeout(() => scheduleIdleTask(run), 900);
        return;
      }
      const started = performance.now();
      let chunk = 0;
      while (index < products.length && chunk < 1 && performance.now() - started < 3 && ((deadline?.timeRemaining?.() || 0) > 1 || chunk === 0)) {
        Intelligence.buildProductProfile(products[index++]);
        chunk++;
      }
      if (index < products.length) setTimeout(() => scheduleIdleTask(run), 220);
      else state._searchProfilesReady = true;
    };
    setTimeout(() => scheduleIdleTask(run), 1800);
  }

  function catalogSearchCacheKey(query) {
    const f = state.filters || {};
    return [
      state.db?.revision || 0,
      (state.db?.products || []).length,
      clean(query),
      f.family || "",
      f.supplier || "",
      f.brand || "",
      f.status || "",
      f.sort || "relevance",
    ].join("¦");
  }

  queryTokens = function intelligentQueryTokens(query) {
    return Intelligence.tokenise(query);
  };

  productScore = function intelligentProductScore(product, query) {
    return Intelligence.scoreProduct(product, query).score;
  };

  similarProducts = function intelligentSimilarProducts(name, code = "", exclude = "") {
    const probe = ensureShape({ name: clean(name), code: clean(code), specs: Intelligence.extractStructuredText(name).specs, externalCodes: code ? [code] : [] });
    return (state.db.products || [])
      .filter((p) => p.id !== exclude && !p.archived)
      .map((p) => ({ p, score: Intelligence.duplicateSimilarity(probe, p) }))
      .filter((x) => x.score >= 0.58 || (code && [x.p.code, ...(x.p.externalCodes || [])].some((c) => Intelligence.normalize(c) === Intelligence.normalize(code))))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((x) => x.p);
  };

  extractSpecsFromName = function intelligentExtractSpecs(text) {
    return Intelligence.extractStructuredText(text).specs.map((s) => ({ label: s.label, value: s.value }));
  };

  const CATEGORY_BY_TYPE = {
    chapa: ["Chapa e Tubo Inox", "Chapas"], tubo: ["Chapa e Tubo Inox", "Tubo e Tarugo - Flange"], barra_chata: ["Barra Chata Inox", "Barra Chata e Redonda"], barra_redonda: ["Barra Chata e Redonda"], cantoneira: ["Cantoneira Inox", "Cantoneira"], parafuso: ["Fixadores Inox", "Fixadores"], porca: ["Fixadores Inox", "Fixadores"], arruela: ["Fixadores Inox", "Fixadores"], rebite: ["Fixadores Inox", "Fixadores"], chumbador: ["Fixadores", "Fixadores Inox"], arame: ["Arame e Tela Inox", "Arame e Tela", "Mat. p Solda"], tela: ["Arame e Tela Inox", "Arame e Tela"], rodizio: ["Rodizios Inox", "Rodizios"], cabo: ["Mat. Elétrico Ex", "Mat. Elétrico"], plugue: ["Mat. Elétrico Ex", "Mat. Elétrico"], tomada: ["Mat. Elétrico Ex", "Mat. Elétrico"], prensa_cabo: ["Mat. Elétrico Ex", "Mat. Elétrico"], eletroduto: ["Mat. Elétrico Ex", "Mat. Elétrico"], painel: ["Mat. Elétrico Ex", "Mat. Elétrico"], capacitor: ["Mat. Elétrico"], contator: ["Mat. Elétrico"], rele: ["Mat. Elétrico"], chave: ["Mat. Elétrico"], fita: ["Embalagem", "PVC"], embalagem: ["Embalagem"], solda: ["Mat. p Solda"], conexao: ["Conexões Alta Pressão"], mangueira: ["PVC", "Conexões Alta Pressão"], helice: ["Hélice FM", "Hélice MW"], perfil: ["Perfil T"], tarugo: ["Tarugo - Eslinga Inox", "Tubo e Tarugo - Flange"], flange: ["Tubo e Tarugo - Flange"], filtro: ["CLIMATIZADORES", "Conexões Alta Pressão"]
  };

  categoryByNameHint = function intelligentCategoryByNameHint(text) {
    const parsed = Intelligence.extractStructuredText(text);
    const options = CATEGORY_BY_TYPE[parsed.productType] || [];
    const inox = parsed.material === "inox";
    const ordered = inox ? options : [...options].reverse();
    for (const key of ordered) if ((state.db.categories || []).some((c) => c.key === key)) return key;
    const direct = (state.db.categories || []).find((c) => Intelligence.normalize(text).includes(Intelligence.normalize(c.name)));
    return direct?.key || "";
  };

  filteredProducts = function intelligentFilteredProducts() {
    const query = clean(state.query);
    const cacheKey = catalogSearchCacheKey(query);
    if (state._catalogSearchCache?.key === cacheKey) {
      state.searchMeta = state._catalogSearchCache.meta;
      state._lastFilteredProducts = state._catalogSearchCache.products;
      return state._catalogSearchCache.products;
    }
    let products = (state.db.products || []).filter((p) => !p.archived && matchesFilters(p));
    state.searchMeta = new Map();
    if (query) {
      const ranked = Intelligence.searchProducts(products, query);
      ranked.forEach((r) => state.searchMeta.set(r.product.id, r));
      products = ranked.map((r) => r.product);
      rememberSearch(query, products.length);
    }
    if (state.filters.sort === "name") products.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    if (state.filters.sort === "newest") products.sort((a, b) => String(currentOffer(b)?.updatedAt || "").localeCompare(String(currentOffer(a)?.updatedAt || "")));
    if (state.filters.sort === "oldest") products.sort((a, b) => String(currentOffer(a)?.updatedAt || "9999").localeCompare(String(currentOffer(b)?.updatedAt || "9999")));
    if (state.filters.sort === "price") products.sort((a, b) => Number(currentOffer(a)?.finalPrice || Infinity) - Number(currentOffer(b)?.finalPrice || Infinity));
    state._lastFilteredProducts = products;
    state._catalogSearchCache = { key: cacheKey, products, meta: state.searchMeta };
    return products;
  };

  priceFormula = function enhancedPriceFormula(base, ipi, adj, div, manual) {
    const override = asNumber(manual, 0);
    if (override > 0) return override;
    const value = asNumber(base, 0), tax = asNumber(ipi, 0), adjustment = asNumber(adj, 0), quantity = asNumber(div, 0);
    return quantity > 0 ? (value * (1 + tax / 100 + adjustment / 100)) / quantity : 0;
  };

  // ---------- Cartões e tela inicial ----------
  const baseProductCard = productCard;
  productCard = function enhancedProductCard(p) {
    let html = baseProductCard(p);
    const status = statusOf(p);
    const manufacturer = clean(p.manufacturer);
    const meta = state.searchMeta?.get?.(p.id);
    const reasons = meta?.matches?.slice(0, 4) || [];
    const extras = `${manufacturer ? `<span class="catalog-extra brand-extra" title="Fabricante">🏭 ${esc(manufacturer)}</span>` : ""}${status.key === "stale" ? `<span class="catalog-extra stale-extra" title="Último preço conhecido; atualize somente quando houver nova compra.">🕘 Último preço conhecido</span>` : ""}`;
    const why = reasons.length ? `<div class="match-reason" title="Por que este resultado apareceu">${reasons.map((x) => `<span>${esc(x)}</span>`).join("")}</div>` : "";
    if (why) html = html.replace(/(<div class="spec-chips|<div class="product-actions|<div class="card-actions)/, `${why}$1`);
    if (extras) html = html.replace(/(<div class="product-actions|<div class="card-actions)/, `<div class="catalog-extras">${extras}</div>$1`);
    return html;
  };

  async function importDroppedFile(file) {
    if (!file) return;
    if (!/\.xlsx$/i.test(file.name || "")) return toast("Use uma planilha Excel .xlsx.", "bad");
    if (Number(file.size || 0) > 50 * 1024 * 1024) return toast("A planilha é grande demais. O limite é 50 MB.", "bad");
    try {
      const result = await window.vesper.importXlsxFile(file, state.db);
      if (result && !result.canceled) showImportPreview(result);
    } catch (error) {
      toast(error.message || "Não foi possível ler a planilha.", "bad");
    }
  }

  function bindDropZone(zone) {
    if (!zone) return;
    zone.addEventListener("dragover", (event) => { event.preventDefault(); zone.classList.add("drag-active"); });
    zone.addEventListener("dragleave", () => zone.classList.remove("drag-active"));
    zone.addEventListener("drop", (event) => {
      event.preventDefault(); zone.classList.remove("drag-active");
      importDroppedFile(event.dataTransfer?.files?.[0]);
    });
    zone.addEventListener("click", async () => {
      try {
        const result = await window.vesper.importXlsx(state.db);
        if (result && !result.canceled) showImportPreview(result);
      } catch (error) { toast(error.message || "Não foi possível abrir a planilha.", "bad"); }
    });
  }

  const baseUpdateCatalogBody = updateCatalogBody;
  updateCatalogBody = function enhancedUpdateCatalogBody() {
    baseUpdateCatalogBody();
    const body = $("#catalogBody");
    if (!body) return;
    const query = clean(state.query);
    if (query) {
      const intent = Intelligence.interpretQuery(query);
      const labels = [intent.type ? `Tipo: ${Intelligence.TYPE_LABELS[intent.type] || intent.type}` : "", intent.material ? `Material: ${intent.material === "inox" ? "Aço inoxidável" : intent.material.replace(/_/g, " ")}` : "", intent.alloys.length ? `Liga: ${intent.alloys.join(", ")}` : "", intent.threads.length ? `Rosca: ${intent.threads.join(", ")}` : ""].filter(Boolean);
      const toolbar = body.querySelector(".result-toolbar");
      if (toolbar && (labels.length || intent.notes.length)) {
        toolbar.insertAdjacentHTML("afterend", `<div class="search-interpretation"><div><b>Busca interpretada</b><span>${esc(labels.join(" • ") || "Correspondência textual")}</span></div>${intent.notes.length ? `<small>${esc(intent.notes.join(" "))}</small>` : ""}</div>`);
      }

      // Exibir aviso se todos os produtos retornados possuírem incompatibilidade técnica
      const products = state._lastFilteredProducts || [];
      if (products.length) {
        const searchRows = [...(state.searchMeta || new Map()).values()];
        const allMismatched = searchRows.length > 0 && searchRows.slice(0, Math.min(80, searchRows.length)).every((res) => res.mismatches?.length);
        if (allMismatched) {
          const interpretation = body.querySelector(".search-interpretation");
          const warningHTML = `<div class="warning-box" id="warningMismatch" style="margin: 12px 0; padding: 14px; background: #fff8e8; border: 1px solid #efd294; border-radius: 12px; color: #755100; font-size: 13px; line-height: 1.5;">⚠️ <b>Nenhum item corresponde completamente.</b> Encontramos produtos relacionados com diferenças técnicas. Veja os alertas de especificações diferentes indicados em vermelho nos produtos abaixo.</div>`;
          if (interpretation) {
            interpretation.insertAdjacentHTML("afterend", warningHTML);
          } else if (toolbar) {
            toolbar.insertAdjacentHTML("afterend", warningHTML);
          }
        }
      }
    }
    const noContext = !query && !state.filters.family && !state.filters.supplier && !state.filters.brand && !state.filters.status;
    if (query && !(state._lastFilteredProducts || []).length && !$("#emptySearchHelp150")) {
      const intent = Intelligence.interpretQuery(query);
      body.insertAdjacentHTML("beforeend", `<div id="emptySearchHelp150" class="empty-search-help"><h3>Nenhum material compatível foi encontrado</h3><p>${intent.type || intent.material || intent.alloys.length ? "Os filtros técnicos foram respeitados para evitar mostrar um produto diferente do solicitado." : "Tente o tipo do material, a medida, o código ou uma palavra mais completa."}</p><div class="tool-actions"><button class="button" id="clearSearch150">Limpar busca</button><button class="button primary" id="createFromSearch150">Cadastrar este material</button></div></div>`);
      $("#clearSearch150").onclick = () => { state.query = ""; const input = $("#mainSearch"); if (input) input.value = ""; updateCatalogBody(); };
      $("#createFromSearch150").onclick = () => openCreate(query);
    }
    if (noContext && !$("#catalogDropZone")) {
      body.insertAdjacentHTML("beforeend", `<button type="button" id="catalogDropZone" class="drop-zone catalog-drop-zone"><b>Solte uma planilha de preços aqui</b><span>ou clique para escolher um arquivo Excel</span><small>Você verá uma conferência antes de aplicar qualquer alteração.</small></button>`);
      bindDropZone($("#catalogDropZone"));
    }
  };

  // ---------- Cadastro assistido com extração estruturada ----------
  async function researchCandidates(query, allowBackend = true) {
    // --- ETAPA 1: Busca interna local (instantânea via backend SQLite) ---
    if (allowBackend) {
      try {
        const backend = await getBackendUrl();
        const searchResponse = await fetch(`${backend}/search?q=${encodeURIComponent(query)}`);
        if (searchResponse.ok) {
          const searchData = await searchResponse.json();
          const internal = (searchData.candidates || [])
            .map((x) => Intelligence.normalizeCandidate(x, query))
            .filter((x) => candidateRelevantToQuery(x, query));
          // Se achou resultados internos, retorna imediatamente — rápido e confiável
          if (internal.length) return internal.slice(0, 6);
          // Não achou internamente: tenta busca externa com os URLs do /search
          const webResults = (searchData.results || []).filter((x) => x?.url);
          if (webResults.length) {
            const scraped = [];
            const scrapePromises = webResults.slice(0, 3).map(async (item) => {
              try {
                const resp = await fetch(`${backend}/scrape`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ url: item.url }),
                });
                if (resp.ok) {
                  const c = await resp.json();
                  if (c.success && c.name) scraped.push(c);
                }
              } catch (_) {}
            });
            await Promise.all(scrapePromises);
            if (scraped.length) {
              try {
                const matchResp = await fetch(`${backend}/match`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ query, candidates: scraped }),
                });
                if (matchResp.ok) {
                  const data = await matchResp.json();
                  const ranked = (data.candidates || data.results || [])
                    .map((x) => Intelligence.normalizeCandidate(x, query))
                    .filter((x) => candidateRelevantToQuery(x, query));
                  if (ranked.length) return ranked.slice(0, 6);
                }
              } catch (_) {}
              const fallback = scraped
                .map((x) => Intelligence.normalizeCandidate(x, query))
                .filter((x) => candidateRelevantToQuery(x, query));
              if (fallback.length) return fallback.slice(0, 6);
            }
            // Nenhum scrape teve sucesso: retorna os links sem scraping como rascunho
            const rawLinks = webResults
              .map((x) => Intelligence.normalizeCandidate(x, query))
              .filter((x) => candidateRelevantToQuery(x, query));
            if (rawLinks.length) return rawLinks.slice(0, 6);
          }
        }
      } catch (_) {}
      return [];
    }
    // --- ETAPA 2: Fallback via window.vesper (modo offline/Electron) ---
    try {
      const direct = await window.vesper.researchProduct?.(query);
      const internal = (direct?.candidates || [])
        .map((x) => Intelligence.normalizeCandidate(x, query))
        .filter((x) => candidateRelevantToQuery(x, query));
      if (internal.length) return internal.slice(0, 6);
      const webResults = (direct?.results || []).filter((x) => x?.url && !x.id);
      if (webResults.length) {
        return webResults
          .map((x) => Intelligence.normalizeCandidate(x, query))
          .filter((x) => candidateRelevantToQuery(x, query))
          .slice(0, 6);
      }
      if (direct && direct.available === false) return [];
    } catch (_) {}
    return [];
  }


  function candidateRelevantToQuery(candidate, query) {
    const intent = Intelligence.interpretQuery(query);
    const text = Intelligence.normalize([
      candidate.canonical_name,
      candidate.name,
      candidate.title,
      candidate.description,
      candidate.product_type_label,
      candidate.manufacturer,
      candidate.brand,
      ...(candidate.specs || []).flatMap((x) => [x.label, x.value]),
    ].filter(Boolean).join(" "));
    if (intent.type && candidate.product_type && candidate.product_type !== intent.type) return false;
    if (intent.alloys?.length && !intent.alloys.some((x) => text.includes(Intelligence.normalize(x)))) return false;
    if (intent.material && !text.includes(Intelligence.normalize(intent.material).replace(/_/g, " ")) && !text.includes("inox")) return false;
    const qTokens = new Set(Intelligence.tokenise(query));
    const cTokens = new Set(Intelligence.tokenise(text));
    const overlap = [...qTokens].filter((x) => cTokens.has(x)).length;
    // Resultados internos exigem match maior; resultados externos (web/scraping) aceitam qualquer overlap
    const isExternal = candidate.source_type !== "internal";
    const minOverlap = isExternal ? Math.min(1, qTokens.size) : Math.min(2, qTokens.size);
    return overlap >= minOverlap || Boolean(intent.type || intent.material || intent.alloys?.length);
  }


  function confidenceLabel(value = "baixa") {
    const v = clean(value).toLowerCase();
    return v === "alta" ? "Alta" : v === "média" || v === "media" ? "Média" : "A conferir";
  }

  function candidateCard(candidate, index) {
    const confidence = candidate.confidence || (candidate.source_type === "internal" ? "alta" : Number(candidate.score) >= 75 ? "alta" : Number(candidate.score) >= 40 ? "média" : "baixa");
    const details = [candidate.product_type_label, candidate.manufacturer, candidate.brand, candidate.manufacturer_code, ...(candidate.specs || []).slice(0, 3).map((s) => `${s.label}: ${s.value}`)].filter(Boolean);
    const source = candidate.source_type === "internal" ? "Base demonstrativa" : candidate.source_type === "manufacturer" ? "Fonte oficial/fabricante" : candidate.source_type === "marketplace" ? "Marketplace — confira o vendedor" : candidate.source_type === "retailer" ? "Loja/distribuidor" : "Fonte de referência";
    const sourceParts = [source, candidate.source_name || candidate.source_host || "", candidate.current_supplier_name ? `último fornecedor: ${candidate.current_supplier_name}` : ""].filter(Boolean);
    const sourceText = [...new Set(sourceParts)].join(" • ");
    const price = candidate.current_price || candidate.price;
    const sourceLink = candidate.url
      ? `<em>${esc(sourceText || "Fonte consultada")} • <a href="${candidate.url}" target="_blank" class="source-external-link" onclick="event.stopPropagation()" style="color: #2563eb; text-decoration: underline; font-weight: bold; cursor: pointer; display: inline-flex; align-items: center; gap: 2px;">Abrir site ↗</a></em>`
      : `<em>${esc(sourceText || "Fonte consultada")}</em>`;
    return `<button type="button" class="candidate-card candidate-card-150" data-candidate="${index}"><span class="candidate-confidence ${esc(confidence)}">Confiança ${esc(confidenceLabel(confidence))}</span><b>${esc(candidate.canonical_name || candidate.name)}</b><small>${esc(details.join(" • ") || "Informações parciais")}</small>${sourceLink}${price ? `<strong class="candidate-price">${money(price)}</strong>` : ""}${candidate.differences?.length ? `<span class="candidate-warning">Confira: ${esc(candidate.differences.slice(0, 2).join("; "))}</span>` : ""}</button>`;
  }

  openCreate = function enhancedOpenCreate(prefill = "") {
    if (typeof prefill !== "string") prefill = "";
    const lastSupplierId = state.db.settings?.lastSupplierId || "";
    ensureCategory("Adesivos e Fitas", "Adesivos e fitas", "tape");
    const familyOptions = [...(state.db.categories || [])].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")).map((c) => `<option value="${esc(c.key)}">${esc(c.name)}</option>`).join("");
    const m = modal(`<form id="createForm150"><div class="modal-head"><div><h2>Novo material</h2><p>Digite como aparece na nota ou embalagem. O sistema separa cada informação no campo correto.</p></div><button type="button" class="modal-close" data-close>×</button></div><div class="modal-body create-layout-140 create-layout-150"><section class="create-primary"><div class="field"><label>Nome do material *</label><textarea name="name" rows="3" required placeholder="Ex.: Fita Silver Tape Scotch 3M 45 mm x 25 m">${esc(prefill)}</textarea><small>O nome ficará limpo; medidas, marca e códigos serão guardados separadamente.</small></div><div id="duplicateWarning150"></div><div class="form-grid"><div class="field"><label>Fornecedor desta compra</label><select name="supplierId">${supplierOptions(lastSupplierId)}</select><small>Quem vendeu o material. Um site do fabricante não vira fornecedor automaticamente.</small></div><div class="field"><label>Fabricante</label><input name="manufacturer" list="brandList150" placeholder="Ex.: 3M, WEG, Tigre"><datalist id="brandList150">${(state.db.brands || []).map((b) => `<option value="${esc(b.name || b)}"></option>`).join("")}</datalist></div><div class="field"><label>Marca / linha</label><input name="brand" placeholder="Ex.: Scotch, Silver Tape"></div><div class="field"><label>Categoria</label><select name="familyKey"><option value="">Detectar automaticamente</option>${familyOptions}</select></div><div class="field"><label>Código interno</label><input name="code" placeholder="Código usado pela Vesper"></div><div class="field"><label>Código do fabricante</label><input name="manufacturerCode" placeholder="MPN, modelo ou referência"></div><div class="field"><label>GTIN / EAN</label><input name="gtin" inputmode="numeric" maxlength="14" placeholder="8, 12, 13 ou 14 dígitos"></div><div class="field"><label>Como é comprado?</label><select name="unit"><option value="un">Unidade</option><option value="m">Metro</option><option value="m²">Metro quadrado</option><option value="kg">Quilo</option><option value="par">Par</option><option value="rolo">Rolo</option><option value="cx">Caixa</option><option value="pct">Pacote</option><option value="barra">Barra</option><option value="bobina">Bobina</option><option value="l">Litro</option></select><small id="unitHint150"></small></div><div class="field span-2"><label>Resumo ou aplicação — opcional</label><input name="subtitle" placeholder="Ex.: uso externo, pacote com 100, para linha de ar"></div></div><div class="spec-editor"><div class="spec-editor-head"><div><b>Especificações</b><small>Medida, liga, cor, rosca, tensão e outros dados ficam separados.</small></div><button type="button" class="button small" id="addSpec150">＋ Adicionar</button></div><div id="specRows150"></div></div><div class="recommended-action"><button type="button" class="button primary big-action" id="research150">Buscar e preencher automaticamente <span id="researchBadge150"></span></button><p>O sistema compara fontes e mostra a confiança de cada campo antes de aplicar.</p></div><button type="submit" class="button secondary-save">Cadastrar somente com estes dados</button></section><aside class="create-research" id="researchPanel150"><div class="research-placeholder"><b>Sugestões da pesquisa</b><p>Escolha o produto correto e confira campo por campo.</p></div></aside></div><div class="modal-foot"><button type="button" class="button" data-close>Cancelar</button><button type="submit" class="button primary">Salvar material</button></div></form>`, "xwide");
    const form = $("#createForm150", m.host), panel = $("#researchPanel150", m.host), researchButton = $("#research150", m.host), badge = $("#researchBadge150", m.host), specRoot = $("#specRows150", m.host);
    $("input[name=code]", form)?.setAttribute("placeholder", "Código interno do catálogo");
    let candidates = [], selected = null, prefetchedFor = "", timer = null, sourceEvidence = [], appliedLowConfidence = false;
    let specs = Intelligence.extractStructuredText(prefill).specs.map((s) => ({ label: s.label, value: s.value, confidence: s.confidence || "alta", evidence: "texto digitado" }));

    const renderSpecs = () => {
      specRoot.innerHTML = specs.length ? specs.map((s, i) => `<div class="spec-edit-row" data-spec-row="${i}"><input data-spec-label value="${esc(s.label)}" aria-label="Nome da especificação"><input data-spec-value value="${esc(s.value)}" aria-label="Valor da especificação"><span class="field-confidence ${esc(s.confidence || "alta")}">${esc(confidenceLabel(s.confidence || "alta"))}</span><button type="button" class="icon-button" data-remove-spec="${i}" title="Remover">×</button></div>`).join("") : `<div class="spec-empty">Nenhuma especificação adicionada.</div>`;
      $$('[data-spec-row]', specRoot).forEach((row) => {
        const i = Number(row.dataset.specRow);
        $("[data-spec-label]", row).oninput = (e) => { specs[i].label = clean(e.target.value); };
        $("[data-spec-value]", row).oninput = (e) => { specs[i].value = clean(e.target.value); };
      });
      $$('[data-remove-spec]', specRoot).forEach((button) => button.onclick = () => { specs.splice(Number(button.dataset.removeSpec), 1); renderSpecs(); });
    };
    $("#addSpec150", m.host).onclick = () => { specs.push({ label: "Característica", value: "", confidence: "alta", evidence: "informado manualmente" }); renderSpecs(); setTimeout(() => $$('[data-spec-value]', specRoot).at(-1)?.focus(), 20); };

    const renderDuplicates = () => {
      const name = inputValue(form, "name"), code = inputValue(form, "code") || inputValue(form, "manufacturerCode") || inputValue(form, "gtin");
      const found = name.length >= 3 ? similarProducts(name, code) : [];
      const box = $("#duplicateWarning150", m.host);
      box.innerHTML = found.length ? `<div class="duplicate-warning"><b>Este material talvez já exista.</b><p>Abra e confira antes de criar outro cadastro.</p>${found.slice(0, 3).map((p) => `<button type="button" class="duplicate-choice" data-open-existing="${p.id}"><span>${esc(p.name)}</span><small>${esc(variantLine(p))}</small></button>`).join("")}</div>` : "";
      $$('[data-open-existing]', box).forEach((button) => button.onclick = () => { m.close(); openDetail(button.dataset.openExisting); });
    };

    const applyCandidate = (candidate, selectedKeys) => {
      const apply = (key) => selectedKeys.has(key);
      if (apply("name") && candidate.canonical_name) form.elements.name.value = candidate.canonical_name;
      if (apply("manufacturer")) form.elements.manufacturer.value = candidate.manufacturer || "";
      if (apply("brand")) form.elements.brand.value = candidate.brand || "";
      if (apply("manufacturerCode")) form.elements.manufacturerCode.value = candidate.manufacturer_code || "";
      if (apply("gtin")) form.elements.gtin.value = candidate.gtin || "";
      if (apply("unit") && candidate.unit) { form.elements.unit.value = candidate.unit; $("#unitHint150", m.host).textContent = `${confidenceLabel(candidate.unit_confidence)}: ${candidate.unit_evidence || "sugerido pela pesquisa"}`; }
      if (apply("family")) { const key = structuredCategoryKey(candidate.product_type || "", `${candidate.canonical_name} ${candidate.product_type_label}`); if (key) form.elements.familyKey.value = key; }
      const chosenSpecs = (candidate.specs || []).filter((_, i) => selectedKeys.has(`spec:${i}`));
      if (chosenSpecs.some((item) => ["Largura", "Comprimento", "Espessura", "Diâmetro", "Altura"].includes(Intelligence.canonicalSpecLabel(item.label)))) {
        specs = specs.filter((item) => Intelligence.canonicalSpecLabel(item.label) !== "Medida");
      }
      for (const item of chosenSpecs) {
        const normalized = { label: Intelligence.canonicalSpecLabel(item.label), value: clean(item.value), confidence: item.confidence || candidate.field_confidence?.specs || "média", evidence: item.evidence || candidate.source_name || "fonte online" };
        const old = specs.find((s) => Intelligence.normalize(s.label) === Intelligence.normalize(normalized.label));
        if (old) Object.assign(old, normalized); else specs.push(normalized);
        if ((normalized.confidence || "").toLowerCase().startsWith("baix")) appliedLowConfidence = true;
      }
      if (specs.some((item) => ["Largura", "Comprimento", "Espessura", "Diâmetro", "Altura"].includes(Intelligence.canonicalSpecLabel(item.label)))) {
        specs = specs.filter((item) => Intelligence.canonicalSpecLabel(item.label) !== "Medida");
      }
      if (candidate.supplier_suggestion && apply("supplier")) {
        const supplier = ensureSupplierByName(candidate.supplier_suggestion);
        form.elements.supplierId.innerHTML = supplierOptions(supplier.id); form.elements.supplierId.value = supplier.id;
      }
      sourceEvidence = [{ url: candidate.url || "", sourceName: candidate.source_name || "", sourceType: candidate.source_type || "reference", capturedAt: new Date().toISOString(), rawName: candidate.raw_name || candidate.name || "", fields: [...selectedKeys] }];
      renderSpecs();
      if (typeof scheduleDuplicates === "function") scheduleDuplicates(); else renderDuplicates();
      const summarySpecs = chosenSpecs.slice(0, 5).map((item) => `<li><b>${esc(Intelligence.canonicalSpecLabel(item.label))}</b><span>${esc(item.value)}</span></li>`).join("");
      const candidatePrice = candidate.current_price || candidate.price;
      const originHtml = candidate.url
        ? `<a href="${candidate.url}" target="_blank" style="color: #2563eb; text-decoration: underline; font-weight: bold; cursor: pointer;">${esc(candidate.source_type === "internal" ? "Base demonstrativa" : candidate.source_name || "Fonte consultada")} ↗</a>`
        : esc(candidate.source_type === "internal" ? "Base demonstrativa" : candidate.source_name || "Fonte consultada");
      const priceLabel = candidate.source_type === "internal" ? "Último preço" : "Preço de referência";
      panel.innerHTML = `<div class="success-box"><b>Informações distribuídas nos campos corretos.</b><p>Revise os campos destacados e salve somente quando estiverem de acordo com a nota ou embalagem.</p></div><div class="applied-summary"><h3>Conferência rápida</h3><ul><li><b>Nome</b><span>${esc(candidate.canonical_name || candidate.name || "Conferir")}</span></li><li><b>Origem</b><span>${originHtml}</span></li>${candidate.current_supplier_name ? `<li><b>Último fornecedor</b><span>${esc(candidate.current_supplier_name)}</span></li>` : ""}${candidatePrice ? `<li><b>${priceLabel}</b><span>${money(candidatePrice)}</span></li>` : ""}${summarySpecs}</ul><p>Campos não preenchidos devem ser completados manualmente antes de salvar.</p></div>`;
      $$("input,select,textarea", form).forEach((el) => { if (el.value) { el.classList.add("field-applied"); setTimeout(() => el.classList.remove("field-applied"), 2200); } });
    };

    const showConfirm = (candidate) => {
      selected = candidate;
      const fields = [
        ["name", "Nome organizado", candidate.canonical_name, candidate.field_confidence?.name, "Título limpo, sem nome do site"],
        ["manufacturer", "Fabricante", candidate.manufacturer, candidate.field_confidence?.manufacturer, "Quem fabrica"],
        ["brand", "Marca / linha", candidate.brand, candidate.field_confidence?.brand, "Linha comercial, quando diferente do fabricante"],
        ["family", "Tipo / categoria", candidate.product_type_label, candidate.field_confidence?.product_type, "Classificação do material"],
        ["manufacturerCode", "Código do fabricante", candidate.manufacturer_code, candidate.field_confidence?.manufacturer_code, "MPN, modelo ou referência"],
        ["gtin", "GTIN / EAN", candidate.gtin, candidate.field_confidence?.gtin, "Código validado pelo dígito verificador"],
        ["unit", "Como é comprado", candidate.unit ? unitText(candidate.unit) : "", candidate.field_confidence?.unit, candidate.unit_evidence],
        ["supplier", "Fornecedor sugerido", candidate.supplier_suggestion, "média", "Somente quando a fonte identifica o vendedor/distribuidor"]
      ].filter((x) => x[2]);
      const sourceHtml = candidate.url
        ? `<a href="${candidate.url}" target="_blank" style="color: #2563eb; text-decoration: underline; font-weight: bold; cursor: pointer;">${esc(candidate.source_name || "pesquisa online")} ↗</a>`
        : esc(candidate.source_name || "pesquisa online");
      panel.innerHTML = `<div class="research-title"><h3>Confirmar informações</h3><p>A fonte não será confundida com fornecedor. Desmarque qualquer dado que não esteja confirmado.</p></div><div class="candidate-confirm candidate-confirm-150"><b>${esc(candidate.canonical_name || candidate.name)}</b><div class="source-note"><b>Fonte:</b> ${sourceHtml} • ${esc(candidate.source_type === "internal" ? "base interna" : candidate.source_type === "manufacturer" ? "fabricante/oficial" : candidate.source_type === "marketplace" ? "marketplace" : candidate.source_type === "retailer" ? "loja/distribuidor" : "referência")}</div><div class="field-review-list">${fields.map(([key,label,value,confidence,evidence],i) => `<label class="field-review"><input type="checkbox" data-apply-key="${esc(key)}" checked><span><b>${esc(label)}</b><em>${esc(value)}</em><small>${esc(confidenceLabel(confidence))}${evidence ? ` • ${esc(evidence)}` : ""}</small></span></label>`).join("")}${(candidate.specs || []).map((item,i) => `<label class="field-review"><input type="checkbox" data-apply-key="spec:${i}" checked><span><b>${esc(Intelligence.canonicalSpecLabel(item.label))}</b><em>${esc(item.value)}</em><small>${esc(confidenceLabel(item.confidence || "média"))} • ${esc(item.evidence || "extraído da fonte")}</small></span></label>`).join("")}</div><button type="button" class="button primary" id="applyCandidate150">Aplicar informações selecionadas</button><button type="button" class="button" id="backCandidates150">Voltar às opções</button></div>`;
      $("#backCandidates150", panel).onclick = showCandidates;
      $("#applyCandidate150", panel).onclick = () => applyCandidate(candidate, new Set($$('[data-apply-key]:checked', panel).map((x) => x.dataset.applyKey)));
    };

    const showCandidates = () => {
      panel.innerHTML = candidates.length ? `<div class="research-title"><h3>Referências compatíveis</h3><p>Somente fontes com relação técnica mínima aparecem aqui. Confira tipo, liga, medida, modelo e fonte.</p></div><div class="candidate-list">${candidates.map(candidateCard).join("")}</div>` : `<div class="warning-box"><b>Nenhuma opção confiável foi encontrada.</b><p>Continue manualmente. O sistema não inventará os campos ausentes.</p></div>`;
      $$('[data-candidate]', panel).forEach((button) => {
        button.onclick = async () => {
          const candidate = candidates[Number(button.dataset.candidate)];
          if (candidate.url && candidate.source_type !== "internal" && !candidate.structured) {
            panel.innerHTML = `<div class="loading-panel"><div class="spinner"></div><p>Lendo dados e preços do site...</p></div>`;
            try {
              const backend = await getBackendUrl();
              const response = await fetch(`${backend}/scrape`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ url: candidate.url })
              });
              if (response.ok) {
                const scrapedData = await response.json();
                if (scrapedData.success) {
                  Object.assign(candidate, scrapedData, { structured: true });
                }
              }
            } catch (err) {
              console.error("Falha ao raspar candidato:", err);
            }
          }
          showConfirm(candidate);
        };
      });
    };

    const runResearch = async (silent = false) => {
      const query = inputValue(form, "name");
      if (query.length < 5) { if (!silent) toast("Digite uma descrição um pouco mais completa.", "warn"); return; }
      if (!silent) { researchButton.disabled = true; panel.innerHTML = `<div class="loading-panel"><div class="spinner"></div><p>Consultando fontes e separando fabricante, códigos e medidas.</p></div>`; }
      candidates = await researchCandidates(query, !silent); prefetchedFor = query; badge.textContent = candidates.length ? `(${candidates.length} opções)` : "";
      if (!silent || candidates.length) showCandidates(); researchButton.disabled = false;
    };

    const localParse = () => {
      const name = inputValue(form, "name");
      const parsed = Intelligence.extractStructuredText(name);
      const key = categoryByNameHint(name); if (key && !form.elements.familyKey.value) form.elements.familyKey.value = key;
      if (parsed.productType && !form.elements.unit.dataset.touched) { const unit = Intelligence.inferUnit(parsed.productType, name, parsed.specs); if (unit.confidence !== "baixa") { form.elements.unit.value = unit.value; $("#unitHint150", m.host).textContent = `${confidenceLabel(unit.confidence)}: ${unit.evidence}`; } }
      const manualKeys = new Set(specs.filter((s) => s.evidence !== "texto digitado").map((s) => `${Intelligence.normalize(s.label)}|${Intelligence.normalize(s.value)}`));
      specs = [...specs.filter((s) => s.evidence !== "texto digitado"), ...parsed.specs.filter((s) => !manualKeys.has(`${Intelligence.normalize(s.label)}|${Intelligence.normalize(s.value)}`)).map((s) => ({...s,evidence:"texto digitado"}))];
      renderSpecs();
    };

    let duplicateTimer = null;
    const scheduleDuplicates = () => {
      clearTimeout(duplicateTimer);
      duplicateTimer = setTimeout(renderDuplicates, 250);
    };

    const schedulePrefetch = () => {
      clearTimeout(timer);
      const query = inputValue(form, "name");
      if (query.split(/\s+/).filter((x) => x.length > 1).length >= 4 && query !== prefetchedFor)
        timer = setTimeout(() => runResearch(true), 1200);
    };

    let inputDebounceTimer = null;
    form.elements.name.addEventListener("input", () => {
      clearTimeout(inputDebounceTimer);
      inputDebounceTimer = setTimeout(() => {
        localParse();
        schedulePrefetch();
        scheduleDuplicates();
      }, 350);
    });
    form.elements.code.addEventListener("input", scheduleDuplicates);
    form.elements.manufacturerCode.addEventListener("input", scheduleDuplicates);
    form.elements.gtin.addEventListener("input", scheduleDuplicates);
    form.elements.unit.addEventListener("change", () => {
      form.elements.unit.dataset.touched = "1";
      $("#unitHint150", m.host).textContent = "Definido manualmente.";
    });
    researchButton.onclick = () => prefetchedFor === inputValue(form, "name") && candidates.length ? showCandidates() : runResearch(false);

    form.onsubmit = async (event) => {
      event.preventDefault();
      if (form.dataset.saving === "1") return;
      form.dataset.saving = "1";
      const submitButtons = $$('button[type="submit"]', form); submitButtons.forEach((button) => button.disabled = true);
      const unlock = () => { form.dataset.saving = ""; submitButtons.forEach((button) => button.disabled = false); };
      const name = inputValue(form, "name"), code = inputValue(form, "code"), manufacturerCode = inputValue(form, "manufacturerCode"), gtin = inputValue(form, "gtin").replace(/\D/g, "");
      if (name.length < 3) { unlock(); return toast("Informe um nome com pelo menos 3 caracteres.", "bad"); }
      if (gtin && !Intelligence.validateGtin(gtin)) { unlock(); return toast("O GTIN/EAN não passou na validação do dígito verificador. Confira ou deixe o campo vazio.", "bad"); }
      const duplicates = similarProducts(name, code || manufacturerCode || gtin);
      if (duplicates.length && !confirm(`Há ${duplicates.length} cadastro(s) muito parecido(s). Deseja criar outro mesmo assim?`)) { unlock(); return; }
      const allCodes = [code, manufacturerCode, gtin].filter(Boolean).map(Intelligence.normalize);
      if (allCodes.some((c) => state.db.products.some((p) => [p.code,p.manufacturerCode,p.gtin,...(p.externalCodes||[])].filter(Boolean).map(Intelligence.normalize).includes(c)))) { unlock(); return toast("Um dos códigos já está sendo usado por outro material.", "bad"); }
      const manufacturer = inputValue(form, "manufacturer"), brandName = inputValue(form, "brand"), brandEntity = ensureBrand(manufacturer);
      const parsed = Intelligence.extractStructuredText(`${name} ${specs.map((s) => `${s.label} ${s.value}`).join(" ")}`);
      const familyKey = inputValue(form, "familyKey") || structuredCategoryKey(parsed.productType, `${name} ${manufacturer} ${brandName}`) || "Outros";
      const category = state.db.categories.find((c) => c.key === familyKey);
      const finalSpecs = uniqueBy(specs.filter((s) => clean(s.label) && clean(s.value)).map((s) => ({ label: Intelligence.canonicalSpecLabel(s.label), value: clean(s.value), confidence: s.confidence || "alta", evidence: s.evidence || "cadastro manual" })), (s) => `${Intelligence.normalize(s.label)}|${Intelligence.normalize(s.value)}`);
      const product = ensureShape({ id: uid("prd"), name, canonicalName: name, displayName: name, technicalName: sourceEvidence[0]?.rawName || name, subtitle: inputValue(form, "subtitle"), code, manufacturerCode, gtin, unit: inputValue(form, "unit") || "un", familyKey, family: category?.name || familyKey || "Outros", group: category?.name || familyKey || "Outros", productType: parsed.productType, manufacturer, manufacturerId: brandEntity?.id || "", brand: brandName, productLine: brandName, specs: finalSpecs, offers: [], supplierLinks: [], aliases: uniqueBy([name, sourceEvidence[0]?.rawName].filter(Boolean), Intelligence.normalize), externalCodes: [manufacturerCode, gtin].filter(Boolean), quality: { needsReview: appliedLowConfidence || !parsed.productType, reasons: [appliedLowConfidence ? "Há informações online de baixa confiança para conferir." : "", !parsed.productType ? "Tipo do material não foi identificado." : ""].filter(Boolean) }, source: { sheet: "Aplicativo", row: "" }, sources: [{ sheet: "Aplicativo", row: "" }], sourceEvidence, searchText: [name,manufacturer,brandName,code,manufacturerCode,gtin,inputValue(form,"subtitle"),...finalSpecs.flatMap((s)=>[s.label,s.value])].join(" ") });
      const supplierId = inputValue(form, "supplierId"), supplier = state.db.suppliers.find((s) => s.id === supplierId);
      if (supplier) { product.supplierLinks.push({ supplierId: supplier.id, name: supplier.name, kind: "listed", source: "Cadastro" }); state.db.settings.lastSupplierId = supplier.id; }
      state.db.products.push(product); addActivity(`Material ${name} cadastrado`, "create", "product", product.id, { manufacturer, brand: brandName, researched: Boolean(sourceEvidence.length), sourceEvidence }); refreshSupplierCounts();
      if (sourceEvidence.length) {
        state.db.searchAnalytics = state.db.searchAnalytics || { queries: [], selections: [] };
        state.db.searchAnalytics.selections = Array.isArray(state.db.searchAnalytics.selections) ? state.db.searchAnalytics.selections : [];
        state.db.searchAnalytics.selections.push({ query: prefill || name, productId: product.id, source: sourceEvidence[0].sourceName, at: new Date().toISOString() });
      }
      if (await persist("Material cadastrado.", { backup: "antes-cadastrar-material" })) { m.close(); state.query = name; go("catalog"); if (confirm("Material cadastrado. Deseja registrar a compra agora?")) openPrice(product.id); } else unlock();
    };

    renderSpecs(); localParse(); schedulePrefetch(); setTimeout(() => form.elements.name.focus(), 30);
  };

  // ---------- Edição estruturada e arquivamento seguro ----------
  async function archiveProduct(product, closeModal = true) {
    if (!product || product.archived) return;
    const purchases = (product.offers || []).length;
    if (!confirm(`Arquivar "${product.name}"?\n\nO histórico de ${purchases} compra(s) será preservado e o material poderá ser restaurado nas Configurações.`)) return;
    const reason = clean(prompt("Motivo do arquivamento — opcional:", "Cadastro não deve mais aparecer nas novas compras") || "");
    product.archived = true;
    product.archivedAt = new Date().toISOString();
    product.archiveReason = reason || "Arquivado pelo usuário";
    addActivity(`Material ${product.name} arquivado`, "archive", "product", product.id, { reason: product.archiveReason, purchases });
    if (await persist("Material arquivado. O histórico foi preservado.", { backup: "antes-arquivar-material" })) {
      if (closeModal) {
        $("#modalHost").innerHTML = "";
        state.modalOpen = false;
      }
      // Limpar a query de busca para que o catálogo não reexiba o item arquivado
      state.query = "";
      render();
    }
  }

  const baseOpenEdit = openEdit;
  openEdit = function enhancedOpenEdit(id) {
    baseOpenEdit(id);
    const form = $("#editForm");
    if (!form) return;
    form.id = "editForm150";
    const p = state.db.products.find((x) => x.id === id);
    if (!p) return;
    const grid = form.querySelector(".form-grid");
    const manufacturerInput = form.elements.manufacturer;
    manufacturerInput?.setAttribute("list", "editManufacturerList150");
    manufacturerInput?.insertAdjacentHTML("afterend", `<datalist id="editManufacturerList150">${(state.db.brands || []).map((b) => `<option value="${esc(b.name)}"></option>`).join("")}</datalist>`);
    const familyOptions = [...(state.db.categories || [])].sort((a,b)=>a.name.localeCompare(b.name,"pt-BR")).map((c)=>`<option value="${esc(c.key)}" ${c.key===p.familyKey?"selected":""}>${esc(c.name)}</option>`).join("");
    grid?.insertAdjacentHTML("beforeend", `<div class="field"><label>Marca / linha</label><input name="brand150" value="${esc(p.brand || p.productLine || "")}" placeholder="Ex.: Scotch"></div><div class="field"><label>Categoria</label><select name="familyKey150">${familyOptions}</select></div><div class="field"><label>Código do fabricante</label><input name="manufacturerCode150" value="${esc(p.manufacturerCode || "")}" placeholder="MPN, modelo ou referência"></div><div class="field"><label>GTIN / EAN</label><input name="gtin150" inputmode="numeric" maxlength="14" value="${esc(p.gtin || "")}" placeholder="8, 12, 13 ou 14 dígitos"></div>`);
    const foot = form.querySelector(".modal-foot");
    foot?.insertAdjacentHTML("afterbegin", `<button type="button" class="button danger-soft" id="archiveProduct150">Arquivar material</button>`);
    $("#archiveProduct150", form)?.addEventListener("click", () => archiveProduct(p));
    const originalSubmit = form.onsubmit;
    form.onsubmit = async (event) => {
      const gtin = inputValue(form, "gtin150").replace(/\D/g, "");
      if (gtin && !Intelligence.validateGtin(gtin)) { event.preventDefault(); return toast("O GTIN/EAN não passou na validação. Confira ou deixe vazio.", "bad"); }
      const manufacturer = clean(manufacturerInput?.value || "");
      p.manufacturer = manufacturer;
      p.manufacturerId = ensureBrand(manufacturer)?.id || "";
      p.brand = inputValue(form, "brand150"); p.productLine = p.brand;
      p.manufacturerCode = inputValue(form, "manufacturerCode150"); p.gtin = gtin;
      const familyKey = inputValue(form, "familyKey150"); const category = state.db.categories.find((c)=>c.key===familyKey);
      if (category) { p.familyKey = familyKey; p.family = category.name; p.group = category.name; }
      p.externalCodes = [...new Set([...(p.externalCodes || []), p.manufacturerCode, p.gtin].filter(Boolean))];
      p.productType = Intelligence.extractStructuredText(`${form.elements.name?.value || p.name} ${(p.specs||[]).map((x)=>`${x.label} ${x.value}`).join(" ")}`).productType || p.productType;
      p.searchText = [p.name,p.manufacturer,p.brand,p.code,p.manufacturerCode,p.gtin,p.subtitle,p.technicalName,...(p.specs||[]).flatMap((x)=>[x.label,x.value])].filter(Boolean).join(" ");
      return originalSubmit.call(form, event);
    };
  };

  function productCompleteness(product) {
    const p = product || {}, fields = [
      ["nome", clean(p.name)], ["família", clean(p.family || p.familyKey)], ["unidade de compra", clean(p.unit)],
      ["fabricante", clean(p.manufacturer)], ["código, MPN ou GTIN", clean(p.code || p.manufacturerCode || p.gtin)],
      ["especificações", Array.isArray(p.specs) && p.specs.some((x)=>clean(x.value))],
      ["fonte ou origem", clean(p.source?.sheet) || (Array.isArray(p.sourceEvidence) && p.sourceEvidence.length)],
      ["histórico de compra", Array.isArray(p.offers) && p.offers.length]
    ];
    const completed = fields.filter(([, value]) => Boolean(value)).length;
    return { percent: Math.round((completed / fields.length) * 100), missing: fields.filter(([, value]) => !value).map(([label]) => label) };
  }

  const baseOpenDetail150 = openDetail;
  openDetail = function enhancedOpenDetail(id) {
    const p = state.db.products.find((x)=>x.id===id);
    if (!p) return;
    baseOpenDetail150(id);
    const host = $("#modalHost");
    const detailPanels = host ? [...host.querySelectorAll(".technical-details")] : [];
    const details = detailPanels.at(-1) || null;
    const more = details?.querySelector(".key-values");
    const completeness = productCompleteness(p);
    if (more) more.insertAdjacentHTML("beforeend", `${p.brand ? `<div class="key-row"><span>Marca / linha</span><b>${esc(p.brand)}</b></div>` : ""}${p.manufacturerCode ? `<div class="key-row"><span>Código do fabricante</span><b>${esc(p.manufacturerCode)}</b></div>` : ""}${p.gtin ? `<div class="key-row"><span>GTIN / EAN</span><b>${esc(p.gtin)}</b></div>` : ""}${p.productType ? `<div class="key-row"><span>Tipo identificado</span><b>${esc(Intelligence.TYPE_LABELS[p.productType] || p.productType)}</b></div>` : ""}<div class="key-row"><span>Completude do cadastro</span><b>${completeness.percent}%</b></div>`);
    const characteristics = host?.querySelector(".detail-grid .detail-panel");
    if (characteristics && !characteristics.querySelector(".completeness-card150")) characteristics.insertAdjacentHTML("beforeend", `<div class="completeness-card150"><span>Completude do cadastro</span><b>${completeness.percent}%</b><small>${completeness.missing.length ? `Falta conferir: ${esc(completeness.missing.join(", "))}` : "Campos essenciais preenchidos"}</small></div>`);
    if (details && completeness.missing.length) details.insertAdjacentHTML("beforeend", `<div class="warning-box compact-warning"><b>Cadastro ${completeness.percent}% completo</b><span>Para melhorar a busca e evitar duplicidade, confira: ${esc(completeness.missing.join(", "))}.</span></div>`);
    if (details && p.sourceEvidence?.length) details.insertAdjacentHTML("beforeend", `<h4>Fontes usadas no cadastro</h4><div class="related-list">${p.sourceEvidence.map((e)=>`<div class="related-item"><div><b>${esc(e.sourceName || e.sourceType || "Fonte online")}</b><small>${esc(e.sourceType || "referência")} • ${e.capturedAt ? new Date(e.capturedAt).toLocaleString("pt-BR") : "data não informada"}</small></div></div>`).join("")}</div>`);
    const foot = host?.querySelector(".modal-foot");
    if (foot && !host.querySelector("#archiveDetail150")) {
      foot.insertAdjacentHTML("afterbegin", `<button type="button" class="button danger-soft" id="archiveDetail150">Arquivar</button>`);
      $("#archiveDetail150", host).onclick = () => archiveProduct(p);
    }
    if (clean(state.query)) {
      state.db.searchAnalytics = state.db.searchAnalytics || { queries: [], selections: [] };
      state.db.searchAnalytics.selections = Array.isArray(state.db.searchAnalytics.selections) ? state.db.searchAnalytics.selections : [];
      state.db.searchAnalytics.selections.push({ query: state.query, productId: p.id, at: new Date().toISOString() });
      state.db.searchAnalytics.selections = state.db.searchAnalytics.selections.slice(-500);
    }
  };

  // ---------- Preço: valores brasileiros, alerta configurável e OCR opcional ----------
  const baseOpenPrice = openPrice;
  openPrice = function enhancedOpenPrice(id) {
    const product = state.db.products.find((p) => p.id === id);
    baseOpenPrice(id);
    const form = $("#priceForm");
    if (!form || !product) return;
    const priceField = form.elements.basePrice;
    priceField.type = "text";
    priceField.inputMode = "decimal";
    priceField.placeholder = "Ex.: 838,20";
    const container = priceField.closest(".field");
    container?.insertAdjacentHTML("beforeend", `<div id="ocrActions140" hidden><button type="button" class="button small" id="ocrPrice140">📷 Ler valor de uma foto</button><input type="file" id="ocrFile140" accept="image/*" capture="environment" hidden><small id="ocrStatus140">O valor será sugerido para você conferir.</small></div>`);
    const ocrActions = $("#ocrActions140"), ocrButton = $("#ocrPrice140"), ocrFile = $("#ocrFile140"), ocrStatus = $("#ocrStatus140");
    getBackendUrl().then(async (url) => {
      try {
        const health = await fetch(`${url}/`).then((r) => r.json());
        if (health.tesseract_available || health.tesseract_loaded) ocrActions.hidden = false;
      } catch (_) {}
    }).catch(() => {});
    ocrButton?.addEventListener("click", () => ocrFile.click());
    ocrFile?.addEventListener("change", async () => {
      const file = ocrFile.files?.[0];
      if (!file) return;
      ocrButton.disabled = true; ocrStatus.textContent = "Lendo a imagem...";
      try {
        const backend = await getBackendUrl();
        const fd = new FormData(); fd.append("file", file);
        const result = await fetch(`${backend}/ocr/extract`, { method: "POST", body: fd }).then((r) => r.json());
        if (!result.success || !result.suggested_amount) throw new Error(result.error || "Nenhum valor legível foi encontrado.");
        priceField.value = String(result.suggested_amount).replace(".", ",");
        priceField.dispatchEvent(new Event("input", { bubbles: true }));
        ocrStatus.textContent = `Sugestão: ${money(result.suggested_amount)}. Confira antes de salvar.`;
      } catch (error) { ocrStatus.textContent = error.message || "Não foi possível ler o valor."; }
      ocrButton.disabled = false;
    });
    const originalSubmit = form.onsubmit;
    form.onsubmit = async (event) => {
      const newPrice = priceFormula(priceField.value, form.elements.ipi?.value || 0, form.elements.adjustment?.value || 0, (form.elements.quantity?.value || form.elements.divisor?.value || 1), form.elements.manualFinal?.value || 0);
      const oldPrice = Number(currentOffer(product)?.finalPrice || 0);
      const threshold = Number(state.db.settings?.priceAlertThreshold || 30);
      if (oldPrice > 0 && newPrice > 0) {
        const change = Math.abs(((newPrice - oldPrice) / oldPrice) * 100);
        if (change >= threshold && change < 100 && !confirm(`O preço variou ${change.toFixed(1).replace(".", ",")}% em relação ao anterior. Deseja salvar mesmo assim?`)) return;
      }
      priceField.value = String(asNumber(priceField.value, 0));
      return originalSubmit.call(form, event);
    };
  };

  // ---------- Scanner contínuo ----------
  async function openContinuousScanner() {
    if (typeof Html5Qrcode === "undefined") return toast("O leitor de códigos não está disponível nesta instalação.", "bad");
    const m = modal(`<div class="modal-head"><div><h2>Escanear vários itens</h2><p>A câmera permanece aberta. Cada código válido é adicionado uma única vez.</p></div><button class="modal-close" data-close>×</button></div><div class="modal-body"><div id="continuousReader" class="scanner-box"></div><div id="scannerFeed140" class="scanner-feed"><p>Aponte a câmera para o primeiro código.</p></div></div><div class="modal-foot"><button class="button" id="stopScanner140">Parar scanner</button><button class="button primary" id="finishScanner140">Concluir e revisar itens</button></div>`, "wide");
    const reader = new Html5Qrcode("continuousReader"), feed = $("#scannerFeed140", m.host);
    let stopped = false, lastCode = "", lastAt = 0;
    const stop = async () => {
      if (stopped) return; stopped = true;
      try { if (reader.isScanning) await reader.stop(); } catch (_) {}
      try { await reader.clear(); } catch (_) {}
    };
    const baseClose = m.close;
    m.close = async () => { await stop(); baseClose(); };
    $("#stopScanner140", m.host).onclick = m.close;
    $("#finishScanner140", m.host).onclick = async () => { await m.close(); renderQuick(); };
    try {
      await reader.start({ facingMode: "environment" }, { fps: 8, qrbox: { width: 260, height: 140 } }, (decoded) => {
        const code = clean(decoded); const now = Date.now();
        if (!code || (code === lastCode && now - lastAt < 2500)) return;
        lastCode = code; lastAt = now;
        const p = state.db.products.find((x) => norm(x.code) === norm(code) || (x.externalCodes || []).some((c) => norm(c) === norm(code)));
        if (p) {
          if (!state.quickQueue.some((x) => x.productId === p.id)) {
            state.quickQueue.push({ productId: p.id, supplierName: "", basePrice: "", ipi: 0, adjustment: 0, quantity: 1, updatedAt: todayIso(), notes: `Código ${code}` });
            feed.insertAdjacentHTML("afterbegin", `<div class="scan-success">✓ ${esc(p.name)} adicionado. Continue escaneando.</div>`);
          } else feed.insertAdjacentHTML("afterbegin", `<div class="scan-info">${esc(p.name)} já está na lista.</div>`);
        } else {
          feed.insertAdjacentHTML("afterbegin", `<div class="scan-warning"><span>Código ${esc(code)} não encontrado.</span><button type="button" class="button small" data-create-code="${esc(code)}">Cadastrar</button></div>`);
          const button = feed.querySelector(`[data-create-code="${CSS.escape(code)}"]`);
          if (button) button.onclick = async () => { await m.close(); openCreate(code); };
        }
      }, () => {});
    } catch (error) {
      feed.innerHTML = `<div class="warning-box">Não foi possível abrir a câmera. Verifique a permissão do Windows e se outra aplicação está usando a câmera.<br><small>${esc(error.message || error)}</small></div>`;
    }
  }

  const baseRenderQuick = renderQuick;
  renderQuick = function enhancedRenderQuick() {
    baseRenderQuick();
    const methods = $(".update-methods");
    if (methods && !$("#continuousScan140")) {
      methods.insertAdjacentHTML("beforeend", `<button class="method-card" id="continuousScan140"><span>▣</span><b>Escanear em série</b><small>Leia vários códigos sem fechar a câmera.</small></button>`);
      $("#continuousScan140").onclick = openContinuousScanner;
    }
    const rows = $("#quickRows");
    if (rows && !rows.id) rows.id = "quickTable140";
    const saveQ = $("#saveQueue");
    if (saveQ) saveQ.id = "saveQuick140";
    const undoQ = $("#undoBatch");
    if (undoQ) undoQ.id = "undoQuick140";
  };

  // ---------- Qualidade, códigos em lote e merge seguro ----------
  function dynamicIssues(p) {
    const issues = [...unresolvedReasons(p)];
    if (!clean(p.code)) issues.push("Sem código informado");
    if (!currentOffer(p)) issues.push("Sem preço registrado");
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(currentOffer(p).updatedAt || "")) issues.push("Data não informada ou inválida");
    return [...new Set(issues)];
  }
  function reviewGroup(reason) {
    const n = norm(reason);
    if (n.includes("codigo") && n.includes("repet")) return "duplicate";
    if (n.includes("data")) return "date";
    if (n.includes("sem codigo")) return "missingCode";
    if (n.includes("sem preco")) return "missingPrice";
    if (n.includes("nome") || n.includes("medida")) return "name";
    return "other";
  }
  function generateCodesForFamily(family) {
    const products = state.db.products.filter((p) => p.family === family || p.familyKey === family);
    const missing = products.filter((p) => !clean(p.code));
    if (!missing.length) return toast("Esta família não tem materiais sem código.", "good");
    const existing = new Set(state.db.products.map((p) => norm(p.code)).filter(Boolean));
    const codes = products.map((p) => clean(p.code)).filter(Boolean);
    const common = codes.map((code) => code.match(/^([A-Za-z]{1,6})[-_. ]?(\d+)$/)).filter(Boolean);
    const prefixCounts = new Map(); common.forEach((m) => prefixCounts.set(m[1].toUpperCase(), (prefixCounts.get(m[1].toUpperCase()) || 0) + 1));
    const prefix = [...prefixCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || familyMark(products[0]);
    let next = common.filter((m) => m[1].toUpperCase() === prefix).reduce((max, m) => Math.max(max, Number(m[2]) || 0), 0) + 1;
    const plan = missing.map((p) => {
      let code; do { code = `${prefix}-${String(next++).padStart(3, "0")}`; } while (existing.has(norm(code)));
      existing.add(norm(code)); return { p, code };
    });
    const m = modal(`<div class="modal-head"><div><h2>Gerar códigos em sequência</h2><p>Confira antes de aplicar à família ${esc(family)}.</p></div><button class="modal-close" data-close>×</button></div><div class="modal-body"><div class="preview-list">${plan.map(({ p, code }) => `<div><span>${esc(p.name)}</span><b>${esc(code)}</b></div>`).join("")}</div></div><div class="modal-foot"><button class="button" data-close>Cancelar</button><button class="button primary" id="applyCodes140">Aplicar ${plan.length} códigos</button></div>`, "wide");
    $("#applyCodes140", m.host).onclick = async () => {
      plan.forEach(({ p, code }) => { p.code = code; p.searchText = `${p.searchText || ""} ${code}`; });
      addActivity(`${plan.length} códigos gerados para ${family}`, "bulk-code", "family", family);
      if (await persist("Códigos gerados.", { backup: "antes-gerar-codigos" })) { m.close(); renderQualityReview(); }
    };
  }

  renderQualityReview = function enhancedRenderQualityReview() {
    setTopTitle("Revisar cadastros");
    const filter = state.qualityFilter || "all";
    const rows = state.db.products.map((p) => ({ p, issues: dynamicIssues(p) })).filter((x) => x.issues.length && (filter === "all" || x.issues.some((r) => reviewGroup(r) === filter)));
    const counts = Object.keys(ISSUE_GROUPS).reduce((obj, key) => ({ ...obj, [key]: state.db.products.filter((p) => dynamicIssues(p).some((r) => reviewGroup(r) === key)).length }), {});
    const families = [...new Set(rows.map((x) => x.p.family))].sort((a, b) => a.localeCompare(b, "pt-BR"));
    $("#content").innerHTML = `${pageHead("Revisar cadastros", "Corrija pendências em grupo sem apagar o histórico.", '<button class="button" id="backTools140">Voltar às configurações</button>')}<div id="reviewBody"><div class="quality-filters"><button class="filter-pill ${filter === "all" ? "active" : ""}" data-quality="all">Todas (${rows.length})</button>${Object.entries(ISSUE_GROUPS).map(([key, info]) => `<button class="filter-pill ${filter === key ? "active" : ""}" data-quality="${key}">${esc(info.label)} (${counts[key] || 0})</button>`).join("")}</div><div class="bulk-bar"><label><input type="checkbox" id="selectAllReview140"> Selecionar visíveis</label><button class="button" id="markReviewed140" disabled>Marcar selecionados como conferidos</button><select id="familyCodes140"><option value="">Gerar códigos por família...</option>${families.map((f) => `<option value="${esc(f)}">${esc(f)}</option>`).join("")}</select></div><div class="review-list">${rows.slice(0, state.reviewLimit || 40).map(({ p, issues }) => `<article class="review-row"><input type="checkbox" class="review-check140" value="${p.id}"><div><b>${esc(p.name)}</b><small>${esc([p.code || "Sem código", p.family, p.manufacturer].filter(Boolean).join(" • "))}</small><div class="issue-tags">${issues.map((r) => `<span>${esc(r)}</span>`).join("")}</div></div><div class="history-actions"><button class="button small" data-detail="${p.id}">Abrir</button><button class="button small" data-edit="${p.id}">Editar</button></div></article>`).join("") || emptyState("Nenhuma pendência neste grupo", "Os cadastros filtrados já estão conferidos.")}</div>${rows.length > (state.reviewLimit || 40) ? '<button class="button load-more" id="moreReview140">Mostrar mais</button>' : ""}</div>`;
    $("#backTools140").onclick = () => go("tools");
    $$('[data-quality]').forEach((b) => b.onclick = () => { state.qualityFilter = b.dataset.quality; state.reviewLimit = 40; renderQualityReview(); });
    bindCommonActions($("#content"));
    const updateBulk = () => { const n = $$(".review-check140:checked").length; const b = $("#markReviewed140"); b.disabled = !n; b.textContent = n ? `Marcar ${n} como conferido${n > 1 ? "s" : ""}` : "Marcar selecionados como conferidos"; };
    $$(".review-check140").forEach((c) => c.onchange = updateBulk);
    $("#selectAllReview140").onchange = (e) => { $$(".review-check140").forEach((c) => { c.checked = e.target.checked; }); updateBulk(); };
    $("#markReviewed140").onclick = async () => {
      const ids = new Set($$(".review-check140:checked").map((c) => c.value));
      if (!ids.size || !confirm(`Marcar ${ids.size} cadastro(s) como conferidos? Os dados não serão alterados.`)) return;
      state.db.products.filter((p) => ids.has(p.id)).forEach((p) => {
        p.resolvedQualityIssues = [...new Set([...(p.resolvedQualityIssues || []), ...dynamicIssues(p)])];
        p.quality.needsReview = false;
      });
      addActivity(`${ids.size} cadastros marcados como conferidos`, "bulk-review", "product", "", { ids: [...ids] });
      if (await persist("Cadastros conferidos.", { backup: "antes-revisao-em-lote" })) renderQualityReview();
    };
    $("#familyCodes140").onchange = (e) => { if (e.target.value) generateCodesForFamily(e.target.value); };
    $("#moreReview140")?.addEventListener("click", () => { state.reviewLimit = (state.reviewLimit || 40) + 40; renderQualityReview(); });
  };

  function duplicateSupplierPairs() {
    const suppliers = state.db.suppliers || [], pairs = [];
    for (let i = 0; i < suppliers.length; i++) for (let j = i + 1; j < suppliers.length; j++) {
      const a = suppliers[i], b = suppliers[j], na = normalizeCompany(a.name), nb = normalizeCompany(b.name);
      const sameContact = (a.email && b.email && norm(a.email) === norm(b.email)) || (a.phone && b.phone && String(a.phone).replace(/\D/g, "") === String(b.phone).replace(/\D/g, ""));
      const similar = na && nb && (na === nb || jaccard(a.name, b.name) >= 0.75 || (Math.abs(na.length - nb.length) <= 2 && editDistance(na, nb) <= 2));
      if (sameContact || similar) pairs.push([a, b]);
    }
    return pairs;
  }

  async function mergeSuppliers(primary, secondary) {
    if (!primary || !secondary || primary.id === secondary.id) return;
    state.db.products.forEach((p) => {
      p.offers = (p.offers || []).map((o) => o.supplierId === secondary.id ? { ...o, supplierId: primary.id, supplierName: primary.name } : o);
      p.supplierLinks = uniqueBy((p.supplierLinks || []).map((link) => link.supplierId === secondary.id ? { ...link, supplierId: primary.id, name: primary.name } : link), (link) => `${link.supplierId}|${link.kind || ""}`);
    });
    primary.aliases = [...new Set([...(primary.aliases || []), secondary.name, ...(secondary.aliases || [])])].filter((x) => norm(x) !== norm(primary.name));
    primary.email = primary.email || secondary.email || "";
    primary.phone = primary.phone || secondary.phone || "";
    primary.sources = [...new Set([...(primary.sources || []), ...(secondary.sources || [])])];
    state.db.suppliers = state.db.suppliers.filter((s) => s.id !== secondary.id);
    refreshSupplierCounts();
    addActivity(`Fornecedor ${secondary.name} unificado em ${primary.name}`, "merge", "supplier", primary.id);
    return persist("Fornecedores unificados.", { backup: "antes-merge-fornecedor" });
  }

  // ---------- Configurações, saúde, diagnósticos e backups ----------
  async function loadBackupList() {
    const root = $("#backupList140");
    if (!root) return;
    try {
      const result = await window.vesper.listBackups();
      const backups = Array.isArray(result) ? result : (result?.backups || []);
      root.innerHTML = backups.slice(0, 20).map((b) => `<div class="backup-row"><div><b>${esc(b.label || b.filename)}</b><small>${new Date(b.date || b.mtime || Date.now()).toLocaleString("pt-BR")} • ${readableBytes(b.sizeBytes)}</small></div><button class="button small" data-restore-file="${esc(b.filename)}">Restaurar</button>${b.manual ? `<button class="button small danger" data-delete-backup="${esc(b.filename)}">Excluir</button>` : ""}</div>`).join("") || `<p class="muted">Nenhum backup encontrado.</p>`;
      $$('[data-restore-file]', root).forEach((button) => button.onclick = async () => {
        if (!confirm(`Restaurar o backup "${button.dataset.restoreFile}"? Um backup do estado atual será criado antes.`)) return;
        try {
          const result = await window.vesper.restoreBackupFile(button.dataset.restoreFile);
          if (result?.data) { state.db = result.data; prepareDb(); toast("Backup restaurado.", "good"); renderTools(); go("catalog"); }
        } catch (error) { toast(error.message || "Não foi possível restaurar.", "bad"); }
      });
      $$('[data-delete-backup]', root).forEach((button) => button.onclick = async () => {
        if (!confirm("Excluir este backup manual?")) return;
        try { await window.vesper.deleteBackup(button.dataset.deleteBackup); loadBackupList(); } catch (error) { toast(error.message, "bad"); }
      });
    } catch (error) { root.innerHTML = `<div class="warning-box">Não foi possível listar os backups: ${esc(error.message || error)}</div>`; }
  }

  renderTools = function enhancedRenderTools() {
    setTopTitle("Configurações");
    const allProducts = state.db.products || [], archived = allProducts.filter((p)=>p.archived), products = allProducts.filter((p)=>!p.archived), staleDays = Number(state.db.settings?.staleDays || 180), threshold = Number(state.db.settings?.priceAlertThreshold || 30);
    const fresh = products.filter((p) => currentOffer(p) && (daysSince(currentOffer(p).updatedAt) ?? Infinity) <= staleDays);
    const stale = products.filter((p) => currentOffer(p) && (daysSince(currentOffer(p).updatedAt) ?? -1) > staleDays);
    const missing = products.filter((p) => !currentOffer(p));
    const topFamilies = Object.entries(stale.reduce((map, p) => ({ ...map, [p.family]: (map[p.family] || 0) + 1 }), {})).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const duplicates = duplicateSupplierPairs();
    $("#content").innerHTML = `${pageHead("Configurações", "Proteção, revisão e comportamento do catálogo.", '<button class="button" id="backSearch140">Voltar para a busca</button>')}<div class="settings-list"><article class="settings-card health-card"><div><h3>Saúde do catálogo</h3><p>Indicadores calculados diretamente da base.</p></div><div class="health-numbers"><button data-health="fresh"><b>${fresh.length}</b><span>Preços atuais</span></button><button data-health="stale"><b>${stale.length}</b><span>Preços antigos</span></button><button data-health="missing"><b>${missing.length}</b><span>Sem compra</span></button><div><b>${products.length}</b><span>Ativos</span></div><div><b>${archived.length}</b><span>Arquivados</span></div></div>${topFamilies.length ? `<div class="family-health">${topFamilies.map(([family, count]) => `<button data-stale-family="${esc(family)}"><span>${esc(family)}</span><b>${count}</b></button>`).join("")}</div>` : ""}<div class="tool-actions"><button class="button" id="openReview140">Revisar cadastros</button></div></article><article class="settings-card"><div><h3>Alertas fáceis de entender</h3><p>O sistema confirma variações grandes e sinaliza preços antigos.</p></div><div class="form-grid"><div class="field"><label>Confirmar variação acima de</label><input id="threshold140" type="number" min="5" max="300" value="${threshold}"><small>Percentual. Padrão: 30%.</small></div><div class="field"><label>Avisar preço antigo após</label><input id="staleDays140" type="number" min="30" max="1095" value="${staleDays}"><small>Dias. Padrão: 180.</small></div></div><button class="button primary" id="saveSettings140">Salvar</button></article><article class="settings-card backup-card"><div><h3>Backups de segurança</h3><p>Restaure sem procurar arquivos no Explorer.</p></div><div class="tool-actions"><button class="button primary" id="backupNow140">Criar backup manual</button><button class="button" id="refreshBackups140">Atualizar lista</button></div><div id="backupList140" class="backup-list"><div class="loading-line">Carregando backups...</div></div></article><article class="settings-card"><div><h3>Planilhas Excel</h3><p>Importe com prévia ou exporte uma cópia do catálogo.</p></div><div class="tool-actions"><button class="button primary" id="export140">Exportar</button><button class="button" id="import140">Escolher planilha</button></div><button type="button" id="settingsDrop140" class="drop-zone"><b>Arraste uma planilha aqui</b><span>.xlsx, com conferência antes de aplicar</span></button></article>${duplicates.length ? `<article class="settings-card duplicate-suppliers"><div><h3>Possíveis fornecedores duplicados</h3><p>Revise antes de unificar. Um backup é criado automaticamente.</p></div>${duplicates.slice(0, 10).map(([a, b]) => `<div class="duplicate-supplier-row"><span><b>${esc(a.name)}</b><small>${esc(b.name)}</small></span><button class="button small" data-merge-primary="${a.id}" data-merge-secondary="${b.id}">Unificar</button></div>`).join("")}</article>` : ""}${archived.length ? `<article class="settings-card health-card"><div><h3>Lixeira de materiais</h3><p>O histórico foi preservado. Restaure um cadastro quando necessário.</p></div><div class="archive-list">${archived.slice(0,30).map((p)=>`<div class="archive-row"><span><b>${esc(p.name)}</b><small>${esc(p.archiveReason || "Sem motivo informado")} • ${p.archivedAt ? new Date(p.archivedAt).toLocaleString("pt-BR") : "data não informada"}</small></span><button class="button small" data-restore-product="${p.id}">Restaurar</button></div>`).join("")}</div></article>` : ""}<article class="settings-card"><div><h3>Armazenamento e sincronização</h3><p>${state.meta?.storage?.mode === "shared" ? "Base compartilhada com gravação incremental e compactação automática." : "Base local deste computador."}</p></div><div class="info-row">${esc(state.meta?.storage?.path || state.meta?.storage?.name || "Dados internos do aplicativo")}</div><div id="diagnostics140" class="diagnostics-line">Carregando diagnóstico...</div><div class="tool-actions"><button class="button" id="configureStorage140">Configurar armazenamento</button>${state.meta?.storage?.mode === "shared" ? '<button class="button" id="syncNow140">Atualizar agora</button>' : ""}</div></article><details class="activity-details"><summary>Histórico de alterações</summary><table class="trace-table"><thead><tr><th>Data</th><th>Ação</th><th>Descrição</th></tr></thead><tbody>${(state.db.auditLog || state.db.activity || []).slice(0, 80).map((a) => `<tr><td>${new Date(a.at).toLocaleString("pt-BR")}</td><td>${esc(a.type)}</td><td>${esc(a.message)}</td></tr>`).join("") || '<tr><td colspan="3">Nenhuma atividade registrada.</td></tr>'}</tbody></table></details><button class="text-danger" id="reset140">Restaurar base inicial</button></div>`;
    const searchRows = (state.db.searchAnalytics?.queries || []).slice(-300);
    const searchGroups = new Map();
    searchRows.forEach((item) => { const key = item.normalized || norm(item.query); const row = searchGroups.get(key) || { query: item.query, uses: 0, zero: 0, broad: 0, lastAt: item.at }; row.uses += 1; if (Number(item.count) === 0) row.zero += 1; if (Number(item.count) >= 100) row.broad += 1; row.lastAt = item.at; searchGroups.set(key, row); });
    const searchInsights = [...searchGroups.values()].sort((a,b)=>(b.zero*10+b.broad+b.uses)-(a.zero*10+a.broad+a.uses)).slice(0,10);
    $(".settings-list")?.insertAdjacentHTML("beforeend", `<article class="settings-card search-insights-card"><div><h3>Buscas que precisam de atenção</h3><p>Consultas sem resultado ou amplas demais ajudam a criar novos nomes alternativos.</p></div>${searchInsights.length ? `<div class="search-insights-list">${searchInsights.map((x)=>`<div class="info-row"><span><b>${esc(x.query)}</b><small>${x.zero ? `${x.zero} sem resultado` : ""}${x.zero&&x.broad ? " • " : ""}${x.broad ? `${x.broad} com 100+ resultados` : ""}</small></span><b>${x.uses}×</b></div>`).join("")}</div><button class="button small" id="clearSearchInsights150">Limpar histórico de buscas</button>` : `<p class="muted">Os dados aparecerão conforme a busca for usada.</p>`}</article>`);
    $(".settings-list")?.insertAdjacentHTML("beforeend", `<article class="settings-card about-card"><div><h3>Sobre o ProcureFlow</h3><p>Detalhes técnicos da demonstração instalada.</p></div><div class="spec-grid" style="margin-top:10px;"><div class="spec-box"><span>Versão</span><b id="aboutVersion">1.0.0-demo</b></div><div class="spec-box"><span>Build ID</span><b id="aboutBuildId">portfolio-demo</b></div><div class="spec-box"><span>Schema</span><b id="aboutSchema">16</b></div><div class="spec-box"><span>Modo</span><b id="aboutMode">Local</b></div><div class="spec-box"><span>Produtos</span><b id="aboutProducts">—</b></div><div class="spec-box"><span>Fornecedores</span><b id="aboutSuppliers">—</b></div><div class="spec-box span-2"><span>Localização</span><b id="aboutPath" style="word-break:break-all; font-size:11px;">Dados demonstrativos</b></div></div><div class="tool-actions" style="margin-top:12px;"><button class="button" id="copyDiagnostics140">Copiar diagnóstico</button></div></article>`);
    $("#clearSearchInsights150")?.addEventListener("click", async () => { if (!confirm("Limpar somente o histórico de consultas? Os materiais não serão alterados.")) return; state.db.searchAnalytics.queries = []; state.db.searchAnalytics.selections = []; if (await persist("Histórico de buscas limpo.")) renderTools(); });
    $("#backSearch140").onclick = () => go("catalog");
    $("#openReview140").onclick = () => go("review");
    $("#saveSettings140").onclick = async () => {
      const t = asNumber($("#threshold140").value, 30), d = asNumber($("#staleDays140").value, 180);
      if (t < 5 || t > 300 || d < 30 || d > 1095) return toast("Use de 5% a 300% e de 30 a 1095 dias.", "bad");
      state.db.settings.priceAlertThreshold = t; state.db.settings.staleDays = d;
      if (await persist("Configurações salvas.")) renderTools();
    };
    $("#backupNow140").onclick = async () => { const r = await window.vesper.createBackup(); if (!r?.canceled) { toast("Backup criado.", "good"); loadBackupList(); } };
    $("#refreshBackups140").onclick = loadBackupList;
    $("#export140").onclick = async () => { try { const r = await window.vesper.exportXlsx(state.db); if (!r?.canceled) toast("Planilha exportada.", "good"); } catch (e) { toast(e.message, "bad"); } };
    $("#import140").onclick = async () => { try { const r = await window.vesper.importXlsx(state.db); if (r && !r.canceled) showImportPreview(r); } catch (e) { toast(e.message, "bad"); } };
    bindDropZone($("#settingsDrop140"));
    $("#configureStorage140").onclick = openStorageSettings;
    $("#syncNow140")?.addEventListener("click", syncData);
    $("#reset140").onclick = async () => { if (!confirm("Restaurar a base inicial? Um backup será criado antes.")) return; await window.vesper.createAutomaticBackup?.("antes-restaurar-base"); const r = await window.vesper.resetData(); if (r?.data) { state.db = r.data; prepareDb(); go("catalog"); } };
    $$('[data-health="stale"]').forEach((b) => b.onclick = () => { state.filters.status = "stale"; state.filtersOpen = true; go("catalog"); });
    $$('[data-health="missing"]').forEach((b) => b.onclick = () => { state.filters.status = "missing"; state.filtersOpen = true; go("catalog"); });
    $$('[data-health="fresh"]').forEach((b) => b.onclick = () => { state.filters.status = "dated"; state.filtersOpen = true; go("catalog"); });
    $$('[data-stale-family]').forEach((b) => b.onclick = () => { state.filters.family = b.dataset.staleFamily; state.filters.status = "stale"; state.filtersOpen = true; go("catalog"); });
    $$('[data-merge-primary]').forEach((button) => button.onclick = async () => {
      const a = state.db.suppliers.find((s) => s.id === button.dataset.mergePrimary), b = state.db.suppliers.find((s) => s.id === button.dataset.mergeSecondary);
      if (!a || !b || !confirm(`Manter "${a.name}" e transferir todo o histórico de "${b.name}"?`)) return;
      if (await mergeSuppliers(a, b)) renderTools();
    });
    $$('[data-restore-product]').forEach((button)=>button.onclick=async()=>{
      const p=state.db.products.find((x)=>x.id===button.dataset.restoreProduct); if(!p)return;
      p.archived=false; p.archivedAt=""; p.archiveReason=""; addActivity(`Material ${p.name} restaurado`,"restore","product",p.id);
      if(await persist("Material restaurado.",{backup:"antes-restaurar-material"}))renderTools();
    });
    loadBackupList();
    let diagData = null;
    window.vesper.diagnostics?.().then((d) => {
      diagData = d;
      const el = $("#diagnostics140"); if (el) {
        el.innerHTML = `Revisão ${esc(d.revision ?? state.db.revision ?? 0)} • log incremental ${d.deltaLines || 0} operações (${readableBytes(d.deltaBytes)})${d.lastBackup ? ` • último backup ${new Date(d.lastBackup).toLocaleString("pt-BR")}` : ""}`;
      }
      if ($("#aboutVersion")) $("#aboutVersion").textContent = d.appVersion || "1.7.0";
      if ($("#aboutBuildId")) $("#aboutBuildId").textContent = d.buildId || "162-20260702-c8a1f";
      if ($("#aboutSchema")) $("#aboutSchema").textContent = d.schemaVersion || "11";
      if ($("#aboutMode")) $("#aboutMode").textContent = d.storage?.mode === "shared" ? "Compartilhado" : "Local";
      if ($("#aboutPath")) $("#aboutPath").textContent = d.storage?.path || "Dados internos";
      if ($("#aboutProducts")) $("#aboutProducts").textContent = (state.db.products || []).filter(p => !p.archived).length + " ativos";
      if ($("#aboutSuppliers")) $("#aboutSuppliers").textContent = (state.db.suppliers || []).length;
    }).catch((e) => {
      const el = $("#diagnostics140"); if (el) el.textContent = `Diagnóstico indisponível: ${e.message}`;
    });

    $("#copyDiagnostics140")?.addEventListener("click", () => {
      const info = [
        `Aplicativo: ProcureFlow`,
        `Versão: ${diagData?.appVersion || "1.7.0"}`,
        `Build ID: ${diagData?.buildId || "162-20260702-c8a1f"}`,
        `Schema: ${diagData?.schemaVersion || "11"}`,
        `Modo de Armazenamento: ${diagData?.storage?.mode === "shared" ? "Compartilhado" : "Local"}`,
        `Localização da Base: ${diagData?.storage?.path || "Dados internos do aplicativo"}`,
        `Revisão do Banco: ${diagData?.revision ?? state.db.revision ?? 0}`,
        `Produtos Ativos: ${(state.db.products || []).filter(p=>!p.archived).length}`,
        `Fornecedores: ${(state.db.suppliers || []).length}`
      ].join("\n");
      navigator.clipboard.writeText(info).then(() => {
        toast("Diagnóstico copiado para a área de transferência!", "good");
      }).catch(() => {
        toast("Erro ao copiar diagnóstico.", "bad");
      });
    });
  };

  // --- CONTROLE DE ALTERAÇÕES NÃO SALVAS (DIRTY CONFIRMATION) ---
  modal = function enhancedModal(html, cls = "") {
    const host = $("#modalHost");
    state.modalOpen = true;
    host.innerHTML = `<div class="modal-backdrop"><div class="modal ${cls}" role="dialog" aria-modal="true">${html}</div></div>`;

    let userEdited = false;

    setTimeout(() => {
      host.querySelectorAll("form").forEach((form) => {
        form.addEventListener("input", (e) => { if (e.isTrusted) userEdited = true; });
        form.addEventListener("change", (e) => { if (e.isTrusted) userEdited = true; });
      });
    }, 50);

    const confirmClose = () => {
      if (userEdited && !confirm("Deseja descartar as alterações não salvas?")) {
        return false;
      }
      return true;
    };

    const forceClose = () => {
      host.innerHTML = "";
      state.modalOpen = false;
      document.removeEventListener("keydown", fn);
    };

    const close = () => {
      if (!confirmClose()) return;
      forceClose();
    };

    host.querySelector(".modal-backdrop").addEventListener("mousedown", (e) => {
      if (e.target === e.currentTarget) close();
    });

    host.querySelectorAll("[data-close]").forEach((b) => {
      b.onclick = (e) => {
        e.preventDefault();
        close();
      };
    });

    const fn = (e) => {
      if (e.key === "Escape") {
        close();
      }
    };
    document.addEventListener("keydown", fn);
    setTimeout(() => host.querySelector("input,select,textarea,button")?.focus(), 20);

    host.querySelectorAll("form").forEach((f) => {
      f.addEventListener("submit", () => {
        userEdited = false;
      });
    });

    return {
      host,
      close: forceClose,
    };
  };

  // Reúne variações repetidas na apresentação sem apagar nenhum histórico.
  const baseGroupedCard150 = groupedCard;
  const baseProductCard150 = productCard;
  productCard = function enhancedProductCard(p) {
    let html = baseProductCard150(p);
    const q = state.query;
    if (q && typeof VesperIntelligence !== "undefined") {
      const res = state.searchMeta?.get?.(p.id);
      let explanation = "";
      if (res?.matches && res.matches.length) {
        explanation += `<div class="search-match-reasons" style="font-size:11px; color:#2e7d32; margin-top:4px;">✓ Corresponde a: ${res.matches.join(", ")}</div>`;
      }
      if (res?.mismatches && res.mismatches.length) {
        explanation += `<div class="search-mismatch-warning" style="font-size:11px; color:#c62828; margin-top:4px; font-weight:bold;">⚠️ Especificação diferente: ${res.mismatches.join(", ")}</div>`;
      }
      if (explanation) {
        html = html.replace('</div><div class="price-block">', `${explanation}</div><div class="price-block">`);
      }
    }
    return html;
  };

  groupedCard = function deduplicatedGroupedCard(group) {
    const bySignature = new Map();
    (group.products || []).forEach((p) => {
      const signature = `${norm(p.code || "")}|${norm(variantLine(p))}`;
      const current = bySignature.get(signature);
      const rank = (x) => ((x.offers || []).length * 1000000) + (Date.parse(currentOffer(x)?.updatedAt || "") || 0);
      if (!current || rank(p) > rank(current)) bySignature.set(signature, p);
    });
    const products = [...bySignature.values()], hidden = Math.max(0, (group.products || []).length - products.length);
    if (products.length === 1) return productCard(products[0]);
    const best = products[0];
    const variants = products.slice(0, 4);

    let html = `<article class="product-group-card"><div class="group-head"><div class="family-icon">${esc(familyMark(best))}</div><div class="group-title"><span>${esc(group.family)}</span><h3>${esc(group.name)}</h3><small>Escolha a variação correta</small></div></div><div class="variant-list">${variants.map(p=>{
      const o=currentOffer(p);
      let matchInfo = "";
      const q = state.query;
      if (q && typeof VesperIntelligence !== "undefined") {
        const res = state.searchMeta?.get?.(p.id);
        if (res?.matches && res.matches.length) {
          matchInfo += `<div class="search-match-reasons" style="font-size:10px; color:#2e7d32; margin-top:2px;">✓ ${res.matches.join(", ")}</div>`;
        }
        if (res?.mismatches && res.mismatches.length) {
          matchInfo += `<div class="search-mismatch-warning" style="font-size:10px; color:#c62828; margin-top:2px; font-weight:bold;">⚠️ ${res.mismatches.join(", ")}</div>`;
        }
      }
      return `<div class="variant-row"><div class="variant-copy"><b>${esc(variantLine(p))}</b><small>${esc(p.code||"Código não informado")}</small>${matchInfo}</div><div class="variant-price"><b>${money(o?.finalPrice)}</b><small>${o?esc(o.supplierName||"Fornecedor não informado"):"Sem compra registrada"}</small></div><div class="variant-actions"><button class="button small" data-detail="${p.id}">Histórico</button><button class="button small primary" data-price="${p.id}">Registrar</button></div></div>`
    }).join("")}</div>${products.length>4?`<button class="group-more" data-more-variants="${esc(group.key)}">Ver as ${products.length} variações</button>`:""}`;

    if (hidden) {
      html += `<div class="duplicate-note">${hidden} cadastro${hidden===1?"":"s"} repetido${hidden===1?"":"s"} reunido${hidden===1?"":"s"} nesta visualização. O histórico foi preservado.</div>`;
    }
    html += `</article>`;
    return html;
  };

  // --- PARSER DE TEXTOS SUJOS (WhatsApp, E-mail, OCR) ---
  const baseRenderCatalog150 = renderCatalog;
  renderCatalog = function enhancedRenderCatalog() {
    baseRenderCatalog150();
    const actions = document.querySelector(".home-actions");
    if (actions) {
      actions.insertAdjacentHTML("beforeend", `
        <button class="button" id="openDirtyTextParser150" style="margin-left: 8px;">
          <span>≡</span> <b>Colar WhatsApp / E-mail</b>
        </button>
      `);
      const btn = document.querySelector("#openDirtyTextParser150");
      if (btn) btn.onclick = openDirtyTextModal;
    }
  };

  function openDirtyTextModal() {
    const m = modal(`
      <div class="modal-head" id="dirtyTextModal140">
        <div>
          <h2>Extrair texto sujo (WhatsApp / E-mail / OCR)</h2>
          <p>Cole a mensagem contendo produtos, quantidades, preços e fornecedores.</p>
        </div>
        <button class="modal-close" data-close>×</button>
      </div>
      <div class="modal-body">
        <div class="field">
          <label>Texto da Mensagem</label>
          <textarea id="dirtyText140" rows="8" placeholder="Exemplo:&#10;5 un do cabo flexivel 2,5mm por R$ 4,50 do fornecedor Alfa&#10;Tubo PVC 1/2 polegada - 10 barras a R$ 12,00 cada" style="width:100%; font-family:monospace; padding:8px; border-radius:4px; border:1px solid var(--border); resize:vertical;"></textarea>
        </div>
        <div id="dirtyTextPreview150" style="margin-top:15px; display:none;">
          <h3>Itens Inferidos</h3>
          <table class="trace-table" id="dirtyTextTable150">
            <thead>
              <tr>
                <th>Linha</th>
                <th>Material no Catálogo</th>
                <th>Quantidade</th>
                <th>Preço Unitário</th>
                <th>Fornecedor</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody></tbody>
          </table>
        </div>
      </div>
      <div class="modal-foot">
        <button class="button" data-close>Cancelar</button>
        <button class="button primary" id="parseDirtyText140">Analisar Texto</button>
        <button class="button primary" id="saveDirtyTextBtn150" style="display:none;">Confirmar e Registrar</button>
      </div>
    `, "wide");

    const textInput = $("#dirtyText140", m.host) || $("#dirtyTextContent150", m.host);
    const previewDiv = $("#dirtyTextPreview150", m.host);
    const tableBody = $("#dirtyTextTable150 tbody", m.host);
    const parseBtn = $("#parseDirtyText140", m.host) || $("#parseDirtyTextBtn150", m.host);
    const saveBtn = $("#saveDirtyTextBtn150", m.host);

    let parsedItems = [];

    parseBtn.onclick = () => {
      const txt = textInput.value;
      if (!txt.trim()) return toast("Cole algum texto para analisar.", "bad");

      parsedItems = parseDirtyTextLines(txt);
      if (parsedItems.length === 0) {
        return toast("Nenhum item válido identificado no texto.", "bad");
      }

      tableBody.innerHTML = parsedItems.map((item, idx) => {
        let matCell = "";
        if (item.product) {
          matCell = `<b>${esc(item.product.name)}</b><br><small>${esc(item.product.code || "Sem código")} • ${esc(variantLine(item.product))}</small>`;
        } else {
          matCell = `<span class="text-danger">⚠️ Não encontrado: "${esc(item.rawDescription)}"</span><br><small style="color:var(--text-muted)">Será sugerido criar novo material</small>`;
        }

        const supText = item.supplierName || "Não informado";

        return `
          <tr data-idx="${idx}">
            <td>${idx + 1}</td>
            <td>${matCell}</td>
            <td><input type="number" min="0.0001" step="0.0001" class="dirty-qty" value="${item.quantity}" style="width:70px;"></td>
            <td><input type="number" min="0.0001" step="0.0001" class="dirty-price" value="${item.price}" style="width:90px;"></td>
            <td><input type="text" class="dirty-supplier" value="${esc(supText)}" style="width:120px;"></td>
            <td><button class="button small text-danger" onclick="this.closest('tr').remove();">Excluir</button></td>
          </tr>
        `;
      }).join("");

      previewDiv.style.display = "block";
      saveBtn.style.display = "inline-block";
      parseBtn.textContent = "Reanalisar Texto";
    };

    saveBtn.onclick = async () => {
      const rows = tableBody.querySelectorAll("tr");
      const finalOffers = [];

      rows.forEach(row => {
        const idx = Number(row.dataset.idx);
        const item = parsedItems[idx];
        if (!item) return;

        const qty = Number(row.querySelector(".dirty-qty").value) || 1;
        const price = Number(row.querySelector(".dirty-price").value) || 0;
        const supName = row.querySelector(".dirty-supplier").value.trim();

        if (price > 0) {
          finalOffers.push({
            product: item.product,
            rawDescription: item.rawDescription,
            rawCode: item.rawCode,
            quantity: qty,
            price: price,
            supplierName: supName
          });
        }
      });

      if (finalOffers.length === 0) {
        return toast("Nenhuma compra com preço válido para salvar.", "bad");
      }

      const offerIds = [];
      for (const fo of finalOffers) {
        let p = fo.product;

        if (!p) {
          const name = fo.rawDescription;
          p = {
            id: uid("prd"),
            code: fo.rawCode || "",
            name: name,
            displayName: name,
            technicalName: name,
            description: "",
            category: "Importado",
            familyKey: "Importado",
            family: "Importado",
            subcategory: "Importado",
            group: "Importado",
            subtitle: "",
            unit: "un",
            notes: "Criado via parser de textos sujos",
            icon: "box",
            specs: [],
            quality: { needsReview: true, reasons: ["Novo material criado via WhatsApp/E-mail: conferir dados"] },
            resolvedQualityIssues: [],
            favorite: false,
            archived: false,
            contacts: [],
            aliases: [name],
            externalCodes: [],
            originalLines: [name],
            source: { sheet: "Importado", row: 1 },
            sources: [{ sheet: "Importado", row: 1 }],
            supplierLinks: [],
            searchText: [name, fo.rawCode].filter(Boolean).join(" "),
            offers: []
          };
          state.db.products.push(p);
        }

        const sup = ensureSupplierByName(fo.supplierName);
        const offer = {
          id: uid("off"),
          supplierId: sup?.id || "",
          supplierName: sup?.name || fo.supplierName || "Não informado",
          basePrice: fo.price,
          ipi: 0,
          adjustment: 0,
          quantity: fo.quantity,
          finalPrice: fo.price,
          updatedAt: new Date().toISOString().slice(0, 10),
          updatedAtRaw: "",
          email: sup?.email || "",
          phone: sup?.phone || "",
          notes: "Registro via parser de textos sujos",
          source: { sheet: "Aplicativo", row: "" },
          qualityIssues: [],
          calculationMode: "standard",
          percentUnit: "percent"
        };
        p.offers.push(offer);
        offerIds.push({ productId: p.id, offerId: offer.id });
      }

      state.db.lastBatchUndo = { offerIds, at: new Date().toISOString() };
      addActivity(`${offerIds.length} compras registradas via WhatsApp/E-mail`, "bulk-price", "batch", "", { offerIds });
      refreshSupplierCounts();

      if (await persist(`${offerIds.length} compras registradas.`, { backup: "antes-dirty-text" })) {
        m.close();
        toast(`${offerIds.length} compras salvas com sucesso!`, "good");
        go("catalog");
      }
    };
  }

  function parseDirtyTextLines(text) {
    const lines = text.split("\n").map(l => l.trim()).filter(l => l.length > 0);
    const results = [];
    const negativeRegex = /\b(n[aã]o\s+comprar|recusado|cancelado|ignorar|n[aã]o\s+salvar)\b/i;

    lines.forEach(line => {
      if (negativeRegex.test(line)) return;

      let qty = 1;
      const qtyMatch = line.match(/^\b(\d+(?:[.,]\d+)?)\s*(?:unid|un|pcs|pçs|pcs\.|pçs\.|unidades|unidade|metros|m|barras|kg|litros|l|x)?\b/i) ||
                       line.match(/\b(\d+(?:[.,]\d+)?)\s*(?:unid|un|pcs|pçs|pcs\.|pçs\.|unidades|unidade|metros|m|barras|kg|litros|l)\b/i);
      if (qtyMatch) {
        qty = Number(qtyMatch[1].replace(",", "."));
      }

      let price = 0;
      const priceMatch = line.match(/(?:r\$|\$|por|a|cada)\s*(\d+(?:[.,]\d+)?)/i) ||
                         line.match(/\b(\d+[.,]\d{2})\b/);
      if (priceMatch) {
        price = Number(priceMatch[1].replace(",", "."));
      }

      let supplierName = "";
      const supMatch = line.match(/(?:fornecedor|forn|empresa|de|da)\s+([A-Za-z0-9À-ÿ\s]+)$/i);
      if (supMatch) {
        const potential = supMatch[1].trim();
        if (!/\b\d+\b/.test(potential) && potential.length < 30) {
          supplierName = potential;
        }
      }

      if (!supplierName && state.db && state.db.suppliers) {
        for (const s of state.db.suppliers) {
          const sNorm = s.name.toLowerCase();
          if (line.toLowerCase().includes(sNorm)) {
            supplierName = s.name;
            break;
          }
        }
      }

      let cleanDesc = line;
      if (qtyMatch) cleanDesc = cleanDesc.replace(qtyMatch[0], "");
      if (priceMatch) cleanDesc = cleanDesc.replace(priceMatch[0], "");
      if (supplierName) {
        const idx = cleanDesc.toLowerCase().indexOf(supplierName.toLowerCase());
        if (idx !== -1) {
          cleanDesc = cleanDesc.slice(0, idx) + cleanDesc.slice(idx + supplierName.length);
        }
      }
      cleanDesc = cleanDesc.replace(/\b(?:por|a|cada|de|da|do|unid|un|pcs|pçs|unidades|unidade)\b/gi, " ");
      cleanDesc = cleanDesc.replace(/\s+/g, " ").trim();

      if (!cleanDesc) return;

      let matchedProduct = null;
      if (state.db && state.db.products) {
        let bestScore = 0;
        for (const p of state.db.products) {
          if (p.archived) continue;
          const score = VesperIntelligence.scoreProduct(p, cleanDesc).score;
          if (score > 150 && score > bestScore) {
            bestScore = score;
            matchedProduct = p;
          }
        }
      }

      results.push({
        product: matchedProduct,
        rawDescription: cleanDesc,
        rawCode: matchedProduct?.code || "",
        quantity: qty,
        price: price,
        supplierName: supplierName || "Não informado"
      });
    });

    return results;
  }

  // O app base executa init() antes deste arquivo e prende a referência antiga de openCreate.
  // Reatribuímos o botão fixo para o cadastro estruturado 1.5.0.
  const createButton = document.querySelector("#createBtn");
  if (createButton) createButton.onclick = () => openCreate("");
  // O init do app base já ocorreu; reaplicamos a migração aprimorada uma vez.
  if (state && state.db) prepareDb();

  // Ajuste do status filtrado e da versão após o init.
  const version = document.querySelector(".app-version");
  if (version) {
    version.textContent = `ProcureFlow ${APP_VERSION}`;
    const portfolioFooterStyle = document.createElement("style");
    portfolioFooterStyle.textContent = ".sidebar-foot .app-version::after{content:none!important}";
    document.head.appendChild(portfolioFooterStyle);
  }
})();
