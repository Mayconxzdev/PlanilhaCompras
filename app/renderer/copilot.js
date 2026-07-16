/* ProcureFlow — assistente local de compras industriais.
 * Não depende de internet nem envia dados: calcula auditoria, risco e prioridades no navegador/Electron.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.VesperCopilot = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const VERSION = "2.2.0";
  const DEFAULT_STALE_DAYS = 180;
  const DEFAULT_PRICE_THRESHOLD = 30;
  const LEGAL_SUFFIXES = /\b(ltda|eireli|epp|me|sa|s\/a|comercio|comercial|industria|industrial|materiais|ferragens|ferramentas|distribuidora|distribuicao)\b/g;
  const STOP = new Set(["de","da","do","das","dos","e","a","o","os","as","para","por","com","sem","em","no","na","nos","nas","the","of"]);

  function clean(v = "") { return String(v ?? "").replace(/\s+/g, " ").trim(); }
  function norm(v = "") {
    return clean(v).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
      .replace(/[“”″]/g, '"').replace(/[’]/g, "'")
      .replace(/(?<=\d),(?=\d)/g, ".")
      .replace(/\baco\s+(?:inox|inoxidavel)\b/g, "inox")
      .replace(/\b(?:polegadas?|pol)\b/g, '"')
      .replace(/\b(?:milimetros?)\b/g, "mm")
      .replace(/\b(?:metros?|mt)\b/g, "m")
      .replace(/[^a-z0-9#/+\.\-\" ]+/g, " ")
      .replace(/\s+/g, " ").trim();
  }
  function tokens(v = "") { return norm(v).split(" ").filter(x => x && !STOP.has(x)); }
  function supplierKey(v = "") {
    return norm(v).replace(LEGAL_SUFFIXES, " ").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  }
  function bigrams(v = "") {
    const s = supplierKey(v).replace(/\s+/g, "");
    if (s.length < 2) return new Set(s ? [s] : []);
    const out = new Set();
    for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
    return out;
  }
  function jaccard(a, b) {
    const A = a instanceof Set ? a : new Set(a), B = b instanceof Set ? b : new Set(b);
    if (!A.size && !B.size) return 1;
    let inter = 0;
    A.forEach(x => { if (B.has(x)) inter++; });
    return inter / Math.max(1, A.size + B.size - inter);
  }
  function pctChange(current, previous) {
    const c = Number(current), p = Number(previous);
    if (!(c > 0) || !(p > 0)) return null;
    return ((c - p) / p) * 100;
  }
  function parseDate(v) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v || ""))) return null;
    const d = new Date(`${v}T12:00:00`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  function daysSince(v) {
    const d = parseDate(v);
    if (!d) return null;
    return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
  }
  function moneyValue(v) { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; }
  function currentOffer(product) {
    return [...(product?.offers || [])].filter(o => moneyValue(o.finalPrice) > 0).sort((a, b) => {
      const ad = String(a.updatedAt || ""), bd = String(b.updatedAt || "");
      if (ad !== bd) return bd.localeCompare(ad);
      return Number(b.source?.row || 0) - Number(a.source?.row || 0);
    })[0] || null;
  }
  function sortedOffers(product) { return [...(product?.offers || [])].filter(o => moneyValue(o.finalPrice) > 0).sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""))); }
  function qualityFlags(product, settings = {}) {
    const staleDays = Number(settings.staleDays || DEFAULT_STALE_DAYS);
    const offer = currentOffer(product);
    const flags = [];
    if (!clean(product.code) && !(product.externalCodes || []).some(Boolean)) flags.push({ level: "info", code: "missing-code", text: "Código não informado" });
    if (!offer) flags.push({ level: "warning", code: "missing-price", text: "Sem preço histórico" });
    const age = daysSince(offer?.updatedAt);
    if (age !== null && age > staleDays) flags.push({ level: "warning", code: "stale", text: `Preço com ${age} dias` });
    if (!clean(product.manufacturer) && !clean(product.brand)) flags.push({ level: "info", code: "missing-brand", text: "Sem marca/fabricante" });
    if (!Array.isArray(product.specs) || product.specs.length === 0) flags.push({ level: "info", code: "missing-specs", text: "Sem medidas/características estruturadas" });
    if ((product.quality?.needsReview || false) && (product.quality?.reasons || []).length) flags.push({ level: "critical", code: "needs-review", text: product.quality.reasons.slice(0, 2).join("; ") });
    return flags;
  }
  function detectDuplicateCodes(products) {
    const map = new Map();
    for (const p of products || []) {
      const values = [p.code, p.manufacturerCode, p.gtin, ...(p.externalCodes || [])].map(norm).filter(x => x && x.length >= 3);
      for (const code of [...new Set(values)]) {
        const arr = map.get(code) || [];
        arr.push(p);
        map.set(code, arr);
      }
    }
    return [...map.entries()].filter(([, arr]) => arr.length > 1).map(([code, arr]) => ({ code, count: arr.length, products: arr.map(p => ({ id: p.id, name: p.name, family: p.family })) })).slice(0, 50);
  }
  function detectDuplicateNames(products) {
    const map = new Map();
    for (const p of products || []) {
      const key = `${norm(p.familyKey || p.family)}|${norm(p.name || p.technicalName)}`;
      if (!key.split("|")[1]) continue;
      const arr = map.get(key) || [];
      arr.push(p);
      map.set(key, arr);
    }
    return [...map.entries()].filter(([, arr]) => arr.length > 1).map(([key, arr]) => ({ key, count: arr.length, products: arr.map(p => ({ id: p.id, name: p.name, family: p.family })) })).slice(0, 50);
  }
  function detectSupplierDupes(suppliers) {
    const list = (suppliers || []).filter(s => clean(s.name).length >= 4);
    const out = [];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = supplierKey(list[i].name), b = supplierKey(list[j].name);
        if (a.length < 4 || b.length < 4) continue;
        const score = a === b ? 1 : jaccard(bigrams(a), bigrams(b));
        if (score >= 0.86 || (Math.min(a.length, b.length) >= 7 && (a.startsWith(b) || b.startsWith(a)))) out.push({ a: list[i], b: list[j], score: Math.round(score * 100) });
      }
    }
    return out.sort((x, y) => y.score - x.score).slice(0, 50);
  }
  function priceInsights(products, settings = {}) {
    const threshold = Number(settings.priceAlertThreshold || DEFAULT_PRICE_THRESHOLD);
    const rows = [];
    for (const p of products || []) {
      const offers = sortedOffers(p);
      if (offers.length < 2) continue;
      const current = offers[0], previous = offers.find(o => o.id !== current.id);
      const delta = pctChange(current.finalPrice, previous?.finalPrice);
      if (delta === null) continue;
      const abs = Math.abs(delta);
      if (abs >= threshold) rows.push({ product: p, current, previous, delta, abs, direction: delta > 0 ? "alta" : "queda" });
    }
    return rows.sort((a, b) => b.abs - a.abs).slice(0, 80);
  }
  function supplierCoverage(products, suppliers) {
    const bySupplier = new Map((suppliers || []).map(s => [s.id, { supplier: s, offers: 0, products: new Set(), total: 0 }]));
    for (const p of products || []) {
      for (const o of p.offers || []) {
        if (!o.supplierId && !o.supplierName) continue;
        let row = o.supplierId ? bySupplier.get(o.supplierId) : null;
        if (!row) {
          row = { supplier: { id: o.supplierId || o.supplierName, name: o.supplierName || "Fornecedor sem nome" }, offers: 0, products: new Set(), total: 0 };
          bySupplier.set(row.supplier.id, row);
        }
        row.offers++;
        row.products.add(p.id);
        row.total += moneyValue(o.finalPrice);
      }
    }
    return [...bySupplier.values()].map(x => ({ ...x, productCount: x.products.size, products: undefined })).sort((a, b) => b.offers - a.offers).slice(0, 30);
  }
  function auditCatalog(db = {}) {
    const products = db.products || [], suppliers = db.suppliers || [], settings = db.settings || {};
    const staleDays = Number(settings.staleDays || DEFAULT_STALE_DAYS);
    const flagsByProduct = products.map(p => ({ product: p, flags: qualityFlags(p, settings) }));
    const stale = flagsByProduct.filter(x => x.flags.some(f => f.code === "stale"));
    const noPrice = flagsByProduct.filter(x => x.flags.some(f => f.code === "missing-price"));
    const needsReview = flagsByProduct.filter(x => x.flags.some(f => f.level === "critical"));
    const enrich = flagsByProduct.filter(x => x.flags.some(f => ["missing-brand", "missing-specs", "missing-code"].includes(f.code)));
    const duplicateCodes = detectDuplicateCodes(products);
    const duplicateNames = detectDuplicateNames(products);
    const supplierDupes = detectSupplierDupes(suppliers);
    const prices = priceInsights(products, settings);
    const scoreParts = [
      products.length ? Math.max(0, 100 - (noPrice.length / products.length) * 45) : 100,
      products.length ? Math.max(0, 100 - (stale.length / products.length) * 35) : 100,
      Math.max(0, 100 - duplicateCodes.length * 3 - duplicateNames.length * 2 - supplierDupes.length),
      Math.max(0, 100 - needsReview.length * 2 - prices.length * 0.6),
    ];
    const score = Math.round(scoreParts.reduce((a, b) => a + b, 0) / scoreParts.length);
    const queue = [
      ...needsReview.slice(0, 20).map(x => ({ priority: "P0", type: "Revisão crítica", product: x.product, reason: x.flags.map(f => f.text).join("; ") })),
      ...prices.slice(0, 20).map(x => ({ priority: "P1", type: "Variação de preço", product: x.product, reason: `${x.direction} de ${Math.round(x.delta)}% vs compra anterior` })),
      ...stale.slice(0, 25).map(x => ({ priority: "P1", type: "Preço vencido", product: x.product, reason: x.flags.find(f => f.code === "stale")?.text || `mais de ${staleDays} dias` })),
      ...noPrice.slice(0, 25).map(x => ({ priority: "P2", type: "Sem histórico", product: x.product, reason: "Registrar primeira compra/preço" })),
      ...enrich.slice(0, 25).map(x => ({ priority: "P3", type: "Enriquecimento", product: x.product, reason: x.flags.filter(f => f.code.startsWith("missing")).map(f => f.text).join("; ") })),
    ];
    return {
      version: VERSION,
      generatedAt: new Date().toISOString(),
      score,
      metrics: {
        products: products.length,
        suppliers: suppliers.length,
        offers: products.reduce((n, p) => n + (p.offers || []).length, 0),
        stale: stale.length,
        noPrice: noPrice.length,
        needsReview: needsReview.length,
        duplicateCodes: duplicateCodes.length,
        duplicateNames: duplicateNames.length,
        supplierDupes: supplierDupes.length,
        priceAlerts: prices.length,
      },
      duplicateCodes,
      duplicateNames,
      supplierDupes,
      priceAlerts: prices,
      supplierCoverage: supplierCoverage(products, suppliers),
      queue: queue.slice(0, 100),
      flagsByProduct,
    };
  }
  return { VERSION, clean, norm, daysSince, currentOffer, sortedOffers, auditCatalog, qualityFlags, detectSupplierDupes, priceInsights, supplierCoverage };
});
