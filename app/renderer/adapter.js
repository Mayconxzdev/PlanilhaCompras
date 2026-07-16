(function () {
  if (window.vesper) return;
  const DB_NAME = "vesper-compras-210",
    STORE = "data",
    KEY = "database",
    SNAP = "snapshots";
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const text = (v) =>
    String(v ?? "")
      .replace(/\s+/g, " ")
      .trim();
  const norm = (v) =>
    text(v)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  const initial = () =>
    clone(
      window.__VESPER_INITIAL_DATA__ || {
        version: 15,
        schemaVersion: 15,
        appVersion: "2.2.0",
        products: [],
        suppliers: [],
        categories: [],
        activity: [],
        auditLog: [],
        settings: { staleDays: 180, priceAlertThreshold: 30, recentProductIds: [], importValidation: { absoluteMin: 0.01, absoluteMax: 1000000, deviationFactor: 5, requireDate: true, minimumJustificationLength: 8 } },
      },
    );
  const id = (p) =>
    `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
        if (!db.objectStoreNames.contains(SNAP))
          db.createObjectStore(SNAP, { autoIncrement: true });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function get(store, key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, "readonly"),
        r = tx.objectStore(store).get(key);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      tx.oncomplete = () => db.close();
    });
  }
  async function put(store, key, value) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, "readwrite"),
        os = tx.objectStore(store);
      const r = key === undefined ? os.add(value) : os.put(value, key);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      tx.oncomplete = () => db.close();
    });
  }
  async function listSnapshots() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SNAP, "readonly"), os = tx.objectStore(SNAP),
        valuesReq = os.getAll(), keysReq = os.getAllKeys();
      tx.oncomplete = () => {
        const values = valuesReq.result || [], keys = keysReq.result || [];
        db.close();
        resolve(values.map((value, index) => ({ ...value, id: String(keys[index]) })));
      };
      tx.onerror = () => reject(tx.error);
    });
  }
  async function deleteSnapshot(snapshotId) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SNAP, "readwrite");
      tx.objectStore(SNAP).delete(Number(snapshotId));
      tx.oncomplete = () => { db.close(); resolve({ ok: true }); };
      tx.onerror = () => reject(tx.error);
    });
  }
  async function trimSnapshots() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SNAP, "readwrite"),
        os = tx.objectStore(SNAP),
        keys = [];
      os.openKeyCursor().onsuccess = (e) => {
        const c = e.target.result;
        if (c) {
          keys.push(c.key);
          c.continue();
        } else {
          keys.slice(0, -10).forEach((k) => os.delete(k));
        }
      };
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    });
  }
  function isAppSource(x) {
    return /aplicativo|importa/i.test(
      String(x?.source?.sheet || x?.source || ""),
    );
  }
  function findOld() {
    for (const k of [
      "vesper-compras-db-v4",
      "vesper-compras-db-v3",
      "vesper-compras-db-v2",
    ]) {
      try {
        const s = localStorage.getItem(k);
        if (s) return JSON.parse(s);
      } catch {}
    }
    return null;
  }
  function migrateOld(old) {
    const seed = initial();
    if (!old) return seed;
    const seedById = new Map(seed.products.map((p) => [p.id, p])),
      seedBySig = new Map(
        seed.products.map((p) => [
          [norm(p.code), norm(p.technicalName)].join("|"),
          p,
        ]),
      ),
      oldSup = new Map((old.suppliers || []).map((s) => [s.id, s])),
      seedSup = new Map(seed.suppliers.map((s) => [norm(s.name), s]));
    for (const s of old.suppliers || []) {
      if (
        (s.sources || []).some((x) => /aplicativo/i.test(String(x))) &&
        !seedSup.has(norm(s.name))
      ) {
        const cp = { ...clone(s), id: s.id || id("sup") };
        seed.suppliers.push(cp);
        seedSup.set(norm(cp.name), cp);
      }
    }
    for (const op of old.products || []) {
      if (isAppSource(op)) {
        seed.products.unshift(clone(op));
        continue;
      }
      const target =
        seedById.get(op.id) ||
        seedBySig.get([norm(op.code), norm(op.technicalName)].join("|"));
      if (!target) continue;
      for (const oo of op.offers || []) {
        if (!isAppSource(oo)) continue;
        let sid = oo.supplierId,
          sup = oldSup.get(sid),
          mapped = sup ? seedSup.get(norm(sup.name)) : null;
        if (mapped) {
          sid = mapped.id;
          oo.supplierName = mapped.name;
        }
        if (!(target.offers || []).some((x) => x.id === oo.id))
          target.offers.push({ ...clone(oo), supplierId: sid });
        if (
          sid &&
          !(target.supplierLinks || []).some(
            (x) => x.supplierId === sid && x.kind === "quoted",
          )
        )
          target.supplierLinks.push({
            supplierId: sid,
            name: oo.supplierName || mapped?.name || sup?.name || "",
            kind: "quoted",
            source: "Aplicativo",
          });
      }
      if (op.notes && /aplicativo/i.test(op.notes)) target.notes = op.notes;
    }
    seed.activity = [
      {
        id: id("act"),
        type: "migration",
        message:
          "Dados feitos nas versões anteriores foram preservados na versão final",
        at: new Date().toISOString(),
      },
      ...(old.activity || []).slice(0, 50),
      ...(seed.activity || []),
    ];
    seed.auditLog = [...(old.auditLog || []), ...(seed.auditLog || [])];
    return seed;
  }
  function migrateToV11(base) {
    if (!base) return base;
    const products = base.products || [];
    for (const p of products) {
      if (Array.isArray(p.offers)) {
        for (const o of p.offers) {
          if (o.divisor !== undefined && o.quantity === undefined) {
            o.quantity = Number(o.divisor);
            delete o.divisor;
          }
        }
      }
      if (Array.isArray(p.history)) {
        for (const h of p.history) {
          if (h.divisor !== undefined && h.quantity === undefined) {
            h.quantity = Number(h.divisor);
            delete h.divisor;
          }
        }
      }
    }
    base.settings = { staleDays: 180, priceAlertThreshold: 30, recentProductIds: [], importValidation: { absoluteMin: 0.01, absoluteMax: 1000000, deviationFactor: 5, requireDate: true, minimumJustificationLength: 8 }, ...(base.settings || {}) };
    return base;
  }
  async function loadData() {
    let d = await get(STORE, KEY);
    if (!d) {
      d = migrateOld(findOld());
      await saveData(d);
    }
    if (Number(d.schemaVersion || 0) < 9) {
      d = migrateOld(d);
      await saveData(d);
    }
    if (Number(d.schemaVersion || 0) < 11) {
      d = migrateToV11(d);
      await saveData(d);
    }
    return d;
  }
  async function saveData(data) {
    data.version = 15;
    data.schemaVersion = 15;
    data.appVersion = "2.2.0";
    data.brands = Array.isArray(data.brands) ? data.brands : [];
    data.settings = { staleDays: 180, priceAlertThreshold: 30, recentProductIds: [], importValidation: { absoluteMin: 0.01, absoluteMax: 1000000, deviationFactor: 5, requireDate: true, minimumJustificationLength: 8 }, ...(data.settings || {}) };
    data.revision = Number(data.revision || 0) + 1;
    data.updatedAt = new Date().toISOString();
    await put(STORE, KEY, clone(data));
    return {
      ok: true,
      data,
      storage: {
        mode: "local",
        name: "neste computador",
        path: "Armazenamento interno do aplicativo",
      },
    };
  }
  async function snapshot(label = "automatico") {
    const data = await loadData();
    await put(SNAP, undefined, {
      label,
      at: new Date().toISOString(),
      data: clone(data),
    });
    await trimSnapshots();
    return { ok: true };
  }
  function download(name, content, type = "application/json") {
    const blob = new Blob([content], { type }),
      a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  }
  function chooseFile(accept) {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = accept;
      input.onchange = () => resolve(input.files?.[0] || null);
      input.click();
    });
  }
  function number(v) {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    let s = text(v).replace(/R\$/gi, "").replace(/\s/g, "");
    if (!s) return null;
    if (/^[-+]?\d{1,3}(\.\d{3})*,\d+$/.test(s))
      s = s.replace(/\./g, "").replace(",", ".");
    else if (/^[-+]?\d+,\d+$/.test(s)) s = s.replace(",", ".");
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  function excelDate(v) {
    if (typeof v === "number" && v > 30000 && window.VesperSpreadsheet) {
      const d = VesperSpreadsheet.serialDate(v);
      if (d)
        return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
    }
    const s = text(v),
      m = s.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})$/);
    if (!m) return "";
    let y = Number(m[3]);
    if (y < 100) y += 2000;
    const dt = new Date(y, Number(m[2]) - 1, Number(m[1]));
    return dt.getFullYear() === y
      ? `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`
      : "";
  }
  const HEADER_ALIASES = {
    code: ["codigo", "cod", "código", "item"],
    name: ["material", "descricao", "descrição", "produto", "nome"],
    price: ["preco", "preço", "valor", "preco informado"],
    final: ["valor final", "preco final", "preço final"],
    supplier: ["fornecedor", "empresa"],
    date: ["atualizado em", "data", "data cotacao", "cotacao"],
    ipi: ["ipi"],
    adjustment: ["reajuste", "ajuste"],
    divisor: ["divisor", "quantidade do preço", "qtd do preço"],
    email: ["email", "e-mail"],
    phone: ["telefone", "fone", "contato"],
    unit: ["unidade", "un"],
  };
  function detectHeader(rows) {
    for (let i = 0; i < Math.min(30, rows.length); i++) {
      const vals = (rows[i] || []).map(norm),
        map = {};
      for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
        const idx = vals.findIndex((v) =>
          aliases.some((a) => String(v || "") === norm(a) || String(v || "").includes(norm(a))),
        );
        if (idx >= 0) map[key] = idx;
      }
      if (map.name !== undefined && Object.keys(map).length >= 2)
        return { row: i, map };
    }
    return null;
  }
  function similarity(a, b) {
    a = norm(a);
    b = norm(b);
    if (a === b) return 1;
    if (!a || !b) return 0;
    const sa = new Set(a.split(" ")),
      sb = new Set(b.split(" ")),
      inter = [...sa].filter((x) => sb.has(x)).length;
    return inter / Math.max(sa.size, sb.size);
  }
  async function importXlsx(db, providedFile = null) {
    const file = providedFile || await chooseFile(".xlsx");
    if (!file) return { canceled: true };
    const extension = String(file.name || "").toLowerCase().split(".").pop();
    if (extension !== "xlsx") throw new Error("Escolha uma planilha .xlsx.");
    if (Number(file.size || 0) > 50 * 1024 * 1024) throw new Error("A planilha ultrapassa o limite seguro de 50 MB.");
    const wb = VesperSpreadsheet.readWorkbook(await file.arrayBuffer());
    if (!window.VesperCatalogImporter?.previewWorkbook) throw new Error("O importador seguro não foi carregado.");
    const preview = window.VesperCatalogImporter.previewWorkbook(wb, db, { fileName: file.name, makeId: id });
    return { ok: true, fileName: file.name, preview };
  }
  async function exportXlsx(db) {
    const materials = [],
      last3 = [],
      history = [],
      suppliers = [],
      issues = [],
      audit = [];
    (db.products || []).forEach((p) => {
      const offers = [...(p.offers || [])]
          .filter((x) => Number(x.finalPrice) > 0)
          .sort((a, b) =>
            String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")),
          ),
        o = offers[0] || {};
      materials.push({
        Código: p.code,
        "Nome simples": p.name,
        Resumo: p.subtitle,
        "Descrição original": p.technicalName,
        Família: p.family,
        Grupo: p.group,
        Especificações: (p.specs || [])
          .map((x) => `${x.label}: ${x.value}`)
          .join(" | "),
        Unidade: p.unit,
        "Preço atual": o.finalPrice,
        Fornecedor: o.supplierName,
        "Data válida": o.updatedAt,
        "Data original": o.updatedAtRaw,
        Observações: p.notes,
        "Aba de origem": p.source?.sheet,
        "Linha de origem": p.source?.row,
      });
      last3.push({
        Código: p.code,
        Material: p.name,
        "Preço atual": offers[0]?.finalPrice,
        "Fornecedor atual": offers[0]?.supplierName,
        "Data atual": offers[0]?.updatedAt,
        "Preço anterior": offers[1]?.finalPrice,
        "Fornecedor anterior": offers[1]?.supplierName,
        "Data anterior": offers[1]?.updatedAt,
        "3º preço": offers[2]?.finalPrice,
        "3º fornecedor": offers[2]?.supplierName,
        "3ª data": offers[2]?.updatedAt,
      });
      offers.forEach((x, i) =>
        history.push({
          Código: p.code,
          Material: p.name,
          Ordem: i + 1,
          Fornecedor: x.supplierName,
          "Preço informado": x.basePrice,
          IPI: x.ipi,
          Reajuste: x.adjustment,
          Quantidade: x.quantity ?? x.divisor ?? 1,
          "Preço final": x.finalPrice,
          "Data válida": x.updatedAt,
          "Data original": x.updatedAtRaw,
          Observações: x.notes,
          "Aba de origem": x.source?.sheet,
          "Linha de origem": x.source?.row,
        }),
      );
      const resolved = new Set(p.resolvedQualityIssues || []);
      (p.quality?.reasons || []).forEach((r) =>
        issues.push({
          Código: p.code,
          Material: p.name,
          Família: p.family,
          Pendência: r,
          Situação: resolved.has(r) ? "Conferido" : "Pendente",
          "Aba de origem": p.source?.sheet,
          "Linha de origem": p.source?.row,
        }),
      );
    });
    (db.suppliers || [])
      .filter((s) => s.productCount > 0)
      .forEach((s) =>
        suppliers.push({
          Fornecedor: s.name,
          "E-mail": s.email,
          Telefone: s.phone,
          "Materiais relacionados": s.productCount,
          "Com preço": s.quotedProductCount,
          "Indicado na planilha": s.listedProductCount,
          "Outros nomes": (s.aliases || []).join(" | "),
        }),
      );
    (db.auditLog || db.activity || []).forEach((a) =>
      audit.push({
        Data: a.at,
        Ação: a.type,
        Descrição: a.message,
        Entidade: a.entityType,
        ID: a.entityId,
      }),
    );
    const bytes = VesperSpreadsheet.writeWorkbookBuffer([
      { name: "Catálogo", rows: materials },
      { name: "Últimos 3 Preços", rows: last3 },
      { name: "Histórico de Preços", rows: history },
      { name: "Fornecedores", rows: suppliers },
      { name: "Pendências", rows: issues },
      { name: "Auditoria", rows: audit },
    ]);
    download(
      `Vesper-Compras-${new Date().toISOString().slice(0, 10)}.xlsx`,
      bytes,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    return { ok: true, path: "Pasta Downloads" };
  }

  const SERVER_MODE = /^https?:$/.test(location.protocol);
  async function api(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    const body = options.body;
    if (body && !(body instanceof FormData) && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
    const response = await fetch(path, { ...options, headers });
    const textBody = await response.text();
    let parsed = {};
    try { parsed = textBody ? JSON.parse(textBody) : {}; } catch { parsed = { raw: textBody }; }
    if (!response.ok) {
      if (response.status === 409 && parsed && parsed.conflict) return parsed;
      throw new Error(parsed.detail || parsed.message || `Servidor respondeu ${response.status}`);
    }
    return parsed;
  }
  const serverAdapter = {
    load: async () => api("/api/data"),
    save: async (data) => api("/api/data", { method: "POST", body: JSON.stringify({ data, expectedRevision: Number(data?.revision || 0) }) }),
    createAutomaticBackup: async (label) => api("/api/backups", { method: "POST", body: JSON.stringify({ label: label || "automatico" }) }),
    createBackup: async () => api("/api/backups", { method: "POST", body: JSON.stringify({ label: "manual" }) }),
    listBackups: async () => api("/api/backups"),
    restoreBackupFile: async (filename) => api(`/api/backups/${encodeURIComponent(filename)}/restore`, { method: "POST" }),
    deleteBackup: async (filename) => api(`/api/backups/${encodeURIComponent(filename)}`, { method: "DELETE" }),
    deleteBackupFile: async (filename) => api(`/api/backups/${encodeURIComponent(filename)}`, { method: "DELETE" }),
    restoreBackup: async () => {
      const f = await chooseFile(".json");
      if (!f) return { canceled: true };
      const data = JSON.parse(await f.text());
      if (!data || !Array.isArray(data.products)) throw new Error("Arquivo de backup inválido.");
      return api("/api/data", { method: "POST", body: JSON.stringify({ data }) });
    },
    resetData: async () => {
      if (!confirm("Restaurar a base inicial no servidor? Um backup automático será criado.")) return { canceled: true };
      return api("/api/reset", { method: "POST" });
    },
    importXlsx,
    importXlsxFile: async (file, db) => importXlsx(db, file),
    exportXlsx,
    email: async (email) => { location.href = `mailto:${encodeURIComponent(email)}`; return { ok: true }; },
    openExternal: async (url) => { window.open(url, "_blank", "noopener"); return { ok: true }; },
    openFolder: async () => ({ ok: true, message: "Os dados ficam centralizados no servidor local 24h." }),
    researchProduct: async (query) => {
      try {
        const normalizedQuery = typeof query === "object" && query ? query.query : query;
        const cleanQuery = String(normalizedQuery || "").trim();
        const s = await api(`/search?q=${encodeURIComponent(cleanQuery)}`);
        const candidates = s.candidates || [];
        const results = s.results || [];
        return { available: true, mode: "servidor-local", query: cleanQuery, results: results.length ? results : candidates, candidates };
      } catch (err) {
        return { available: false, reason: "Pesquisa local/SearXNG indisponível no servidor.", error: String(err.message || err) };
      }
    },
    chooseSharedFolder: undefined,
    useLocalStorage: async () => ({ ok: false, message: "Esta instalação está em modo servidor. Todos usam a base central." }),
    sync: async () => api("/api/data"),
    diagnostics: async () => api("/api/diagnostics"),
    listSnapshots: async () => (await api("/api/backups")).backups || [],
    rebuildSearchIndex: async () => api("/api/sqlite/rebuild", { method: "POST" }),
  };
  const localAdapter = {
    load: async () => ({
      data: await loadData(),
      dataPath: "Armazenamento interno do aplicativo",
      backupsPath: "Downloads",
      version: "2.2.0-portatil",
      storage: {
        mode: "local",
        name: "neste computador",
        path: "Armazenamento interno do navegador",
      },
    }),
    save: async (data) => saveData(data),
    createAutomaticBackup: async (label) => snapshot(label),
    createBackup: async () => {
      const d = await loadData();
      await snapshot("manual");
      download(
        `vesper-compras-backup-manual-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
        JSON.stringify(d, null, 2),
      );
      return { ok: true, path: "Pasta Downloads" };
    },
    listBackups: async () => ({
      ok: true,
      backups: (await listSnapshots()).sort((a,b)=>String(b.at).localeCompare(String(a.at))).map((x) => ({
        filename: x.id,
        label: String(x.label || "automático").replace(/-/g, " "),
        date: x.at,
        sizeBytes: new Blob([JSON.stringify(x.data || {})]).size,
        manual: x.label === "manual",
      })),
    }),
    restoreBackupFile: async (snapshotId) => {
      const snapshotItem = (await listSnapshots()).find((x) => x.id === String(snapshotId));
      if (!snapshotItem?.data) throw new Error("Esse backup não foi encontrado.");
      await snapshot("antes-restaurar");
      await saveData(clone(snapshotItem.data));
      return { ok: true, data: clone(snapshotItem.data) };
    },
    deleteBackup: async (snapshotId) => {
      const snapshotItem = (await listSnapshots()).find((x) => x.id === String(snapshotId));
      if (!snapshotItem || snapshotItem.label !== "manual") throw new Error("Somente backups manuais podem ser excluídos.");
      return deleteSnapshot(snapshotId);
    },
    deleteBackupFile: async (snapshotId) => {
      const snapshotItem = (await listSnapshots()).find((x) => x.id === String(snapshotId));
      if (!snapshotItem || snapshotItem.label !== "manual") throw new Error("Somente backups manuais podem ser excluídos.");
      return deleteSnapshot(snapshotId);
    },
    restoreBackup: async () => {
      const f = await chooseFile(".json");
      if (!f) return { canceled: true };
      const data = JSON.parse(await f.text());
      if (!data || !Array.isArray(data.products))
        throw new Error("Arquivo de backup inválido.");
      await snapshot("antes-restaurar");
      await saveData(data);
      return { ok: true, data };
    },
    resetData: async () => {
      if (
        !confirm("Restaurar a base inicial? Um backup automático será criado.")
      )
        return { canceled: true };
      await snapshot("antes-reset");
      const data = initial();
      await saveData(data);
      return { ok: true, data };
    },
    importXlsx,
    importXlsxFile: async (file, db) => importXlsx(db, file),
    exportXlsx,
    email: async (email) => {
      location.href = `mailto:${encodeURIComponent(email)}`;
      return { ok: true };
    },
    openExternal: async (url) => {
      window.open(url, "_blank", "noopener");
      return { ok: true };
    },
    openFolder: async () => ({ ok: false, message: "Use a pasta Downloads." }),
    researchProduct: async () => ({ available: false, reason: "Modo offline: sem API paga. A busca usa apenas o backend local/SearXNG opcional quando configurado pela empresa." }),
    chooseSharedFolder: undefined,
    useLocalStorage: async () => ({
      ok: true,
      data: await loadData(),
      storage: {
        mode: "local",
        name: "neste computador",
        path: "Armazenamento interno do navegador",
      },
    }),
    sync: async () => ({ ok: true, data: await loadData() }),
    diagnostics: async () => {
      const data = await loadData();
      return { ok: true, appVersion: "2.2.0-portatil", buildId: "220-20260702-servidor-cliente-multiusuario", compileDate: "2026-07-02", schemaVersion: data.schemaVersion, revision: data.revision, products: (data.products||[]).length, suppliers: (data.suppliers||[]).length, backups: (await listSnapshots()).length, storage: { mode: "local", path: "Armazenamento interno do navegador", logLines: 0, logBytes: 0 }, warnings: [] };
    },
    listSnapshots,
  };
  ;
  window.vesper = SERVER_MODE ? serverAdapter : localAdapter;
})();
