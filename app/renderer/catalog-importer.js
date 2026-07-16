/* ProcureFlow — importação flexível, auditável e defensiva de planilhas.
 * Suporta um formato legado de oito abas ou qualquer planilha geral.
 * Identifica colunas dinamicamente analisando as primeiras 30 linhas.
 * Realiza validação estrita de preços, datas e higieniza strings contra caracteres invisíveis.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.VesperCatalogImporter = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // Higieniza strings removendo Unicode invisível (ZWSP, ZWNJ, BOM, etc.) e caracteres bidirecionais (RTL/LTR)
  const cleanString = (v) => {
    if (v == null) return "";
    return String(v)
      .replace(/[\u200B-\u200D\uFEFF]/g, "") // ZWSP, ZWNJ, ZWJ, BOM
      .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, "") // controles bidi / isolamento
      .replace(/\s+/g, " ")
      .trim();
  };

  const norm = (v) => cleanString(v).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

  const company = (v) => norm(v).replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(ltda|limitada|me|epp|eireli|sa|s a|comercio|comercial|industria|industrial|materiais|equipamentos|ferragens|distribuidora|distribuidor)\b/g, " ")
    .replace(/\s+/g, " ").trim();

  const compact = (v) => company(v).replace(/\s+/g, "");

  const number = (v) => {
    if (typeof v === "number") return Number.isFinite(v) ? v : 0;
    let s = cleanString(v).replace(/R\$|\s/g, "");
    if (!s) return 0;
    if (s.includes(",") && s.includes(".")) s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
    else if (s.includes(",")) s = s.replace(",", ".");
    const n = Number(s); return Number.isFinite(n) ? n : 0;
  };

  const percent = (v) => { const n = number(v); return n > 0 && n < 1 ? n * 100 : n; };

  // Validação estrita de ano bissexto e dias válidos do calendário comercial
  const isValidDate = (year, month, day) => {
    if (year < 1900 || year > 2100) return false;
    if (month < 1 || month > 12) return false;
    const daysInMonth = [31, (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return day >= 1 && day <= daysInMonth[month - 1];
  };

  const parseStrictDate = (v) => {
    const s = cleanString(v);
    if (!s) return { date: "", error: null };

    // Se for número de série do Excel
    if (/^\d+(?:\.\d+)?$/.test(s)) {
      const n = Number(s);
      if (n > 30000 && n < 80000) {
        const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000);
        const year = d.getUTCFullYear();
        const month = d.getUTCMonth() + 1;
        const day = d.getUTCDate();
        if (isValidDate(year, month, day)) {
          return { date: d.toISOString().slice(0, 10), error: null };
        }
      }
      return { date: "", error: `Data serial inválida: ${s}` };
    }

    // Se for formato DD/MM/AAAA ou DD-MM-AAAA ou DD.MM.AAAA
    const m = s.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})$/);
    if (!m) {
      return { date: "", error: `Formato de data inválido: ${s}` };
    }

    const day = Number(m[1]);
    const month = Number(m[2]);
    const year = Number(m[3]);

    if (!isValidDate(year, month, day)) {
      return { date: "", error: `Data inexistente: ${s}` };
    }

    const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return { date: iso, error: null };
  };

  const validName = (v) => {
    const s = cleanString(v);
    return s.length >= 3 && /[A-Za-zÀ-ÿ]/.test(s) && !/^#(?:NAME|REF|VALUE|N\/A)/i.test(s) && !/^(pre[cç]o|valor final|fornecedor|empresa|contato|email|telefone|situa[cç][aã]o)$/i.test(s);
  };

  const PRODUCT_NOUN = /\b(tubo|duto|tampa|tambor|cabo|plugue|tomada|prensa.?cabo|capacitor|contator|rel[eé]|eletrodo|arame|parafuso|porca|arruela|rebite|rod[ií]zio|chapa|ch\.?|tela|cantoneira|barra|tarugo|eslinga|perfil|h[eé]lice|v[aá]lvula|niple|redutor|bico|uni[aã]o|conector|bomba|tanque|filtro|flange|eixo|disco|adaptador|mangueira|corrente|grampo|abra[cç]adeira|terminal|bucha|painel|caixa|suporte|junta|rolamento|retentor|pallet|pl[aá]stico|fita|adesivo|chave|sinaleira|spray|eletroduto|cola|registro|joelho|prego|bobina)\b/i;
  const familyNames = new Set(["PVC","Embalagem","Mat. Elétrico","Mat. Elétrico Ex","Mat. p Solda","Fixadores","Fixadores Inox","Rodizios","Rodizios Inox","Chapas","Chapa e Tubo Inox","Arame e Tela","Arame e Tela Inox","Cantoneira","Cantoneira Inox","Barra Chata e Redonda","Barra Chata Inox","Tubo e Tarugo - Flange","Tarugo - Eslinga Inox","Perfil T","Hélice FM","Hélice MW","Conexões Alta Pressão","CLIMATIZADORES"].map(norm));

  const findSupplier = (db, value) => {
    const n = norm(value), c = company(value), cp = compact(value);
    if (!n) return null;
    return (db.suppliers || []).find((s) => {
      const vals = [s.name, ...(s.aliases || [])];
      return vals.some((x) => norm(x) === n || compact(x) === cp || (c.length >= 5 && company(x) === c));
    }) || null;
  };

  const currentOffer = (p) => {
    if (!p || !p.offers || p.offers.length === 0) return null;
    return p.offers.slice().sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")) || String(b.id).localeCompare(String(a.id)))[0];
  };

  const hasSameOffer = (product, offer) => (product.offers || []).some((old) => {
    const samePrice = Math.abs(Number(old.finalPrice || 0) - Number(offer.finalPrice || 0)) < 0.005;
    const sameDate = !offer.updatedAt || old.updatedAt === offer.updatedAt;
    const sameSupplier = (offer.supplierId && old.supplierId === offer.supplierId) || compact(old.supplierName) === compact(offer.supplierName);
    return samePrice && sameDate && sameSupplier;
  });

  const contextualName = (rows, rowIndex, current, descCol = 1) => {
    if (validName(current) && PRODUCT_NOUN.test(current)) return cleanString(current);
    const context = [];
    for (let i = Math.max(0, rowIndex - 6); i <= rowIndex; i++) {
      const value = cleanString((rows[i] || [])[descCol]);
      if (validName(value) && !/^(email|telefone|contato)$/i.test(value)) context.push(value);
    }
    const base = [...context].reverse().find((x) => PRODUCT_NOUN.test(x));
    if (!base) return validName(current) ? cleanString(current) : "";
    if (current && norm(base) !== norm(current) && /\d/.test(current)) return `${base} — ${cleanString(current)}`;
    return base;
  };

  // Identificação dinâmica de colunas
  const detectColumns = (sheet) => {
    const rows = sheet.rows || [];
    const limit = Math.min(rows.length, 30);

    const regexes = {
      code: /c[oó]d(?:igo)?|ref(?:er[eê]ncia)?|part[-_]?number/i,
      name: /descri[cç][aã]o|material|produto|nome|item/i,
      basePrice: /pre[cç]o\s*(?:base|unit[aá]rio|bruto)?|valor\s*(?:base|unit[aá]rio|bruto)?|val\.\s*unit/i,
      finalPrice: /pre[cç]o\s*(?:final|l[ií]quido)?|valor\s*(?:final|l[ií]quido)?/i,
      supplier: /fornecedor|empresa|forn(?:ecedor)?|vendedor|distribuidor/i,
      date: /data|atualizado|compra/i,
      ipi: /ipi/i,
      adjustment: /ajuste|acr[eé]scimo|desconto/i,
      quantity: /quantidade|qtd|divisor|embalagem|convers[aã]o/i
    };

    for (let ri = 0; ri < limit; ri++) {
      const row = rows[ri] || [];
      const mapping = { code: -1, name: -1, basePrice: -1, finalPrice: -1, supplier: -1, date: -1, ipi: -1, adjustment: -1, quantity: -1 };
      let matchCount = 0;

      for (let ci = 0; ci < row.length; ci++) {
        const val = norm(row[ci]);
        if (!val) continue;

        for (const [key, regex] of Object.entries(regexes)) {
          if (mapping[key] === -1 && regex.test(val)) {
            mapping[key] = ci;
            matchCount++;
            break;
          }
        }
      }

      if (mapping.name !== -1 && (mapping.basePrice !== -1 || mapping.finalPrice !== -1)) {
        return { mapping, headerRowIndex: ri };
      }
    }
    return null;
  };

  // Heurística baseada em tipo de dados para planilhas sem cabeçalho
  const guessColumnsHeuristically = (sheet) => {
    const rows = sheet.rows || [];
    const limit = Math.min(rows.length, 30);
    const colTypes = [];

    for (let ri = 0; ri < limit; ri++) {
      const row = rows[ri] || [];
      for (let ci = 0; ci < row.length; ci++) {
        if (!colTypes[ci]) {
          colTypes[ci] = { number: 0, date: 0, text: 0, empty: 0, short: 0, float: 0 };
        }
        const val = row[ci];
        if (val == null || val === "") {
          colTypes[ci].empty++;
          continue;
        }

        const sVal = String(val).trim();
        const num = Number(sVal.replace(/R\$|\s/g, "").replace(",", "."));

        if (parseStrictDate(val).date && !parseStrictDate(val).error) {
          colTypes[ci].date++;
        } else if (Number.isFinite(num) && num > 0) {
          colTypes[ci].number++;
          if (num % 1 !== 0) colTypes[ci].float++;
        } else if (sVal.length <= 15) {
          colTypes[ci].short++;
        } else {
          colTypes[ci].text++;
        }
      }
    }

    let descCol = -1, maxText = 0;
    for (let ci = 0; ci < colTypes.length; ci++) {
      if (colTypes[ci] && colTypes[ci].text > maxText) {
        maxText = colTypes[ci].text;
        descCol = ci;
      }
    }

    if (descCol === -1) {
      let maxGeneral = 0;
      for (let ci = 0; ci < colTypes.length; ci++) {
        if (colTypes[ci]) {
          const gen = colTypes[ci].text + colTypes[ci].short;
          if (gen > maxGeneral) {
            maxGeneral = gen;
            descCol = ci;
          }
        }
      }
    }

    let priceCol = -1, maxPriceScore = 0;
    for (let ci = 0; ci < colTypes.length; ci++) {
      if (ci === descCol) continue;
      if (colTypes[ci]) {
        const score = colTypes[ci].number + colTypes[ci].float * 2;
        if (score > maxPriceScore) {
          maxPriceScore = score;
          priceCol = ci;
        }
      }
    }

    let codeCol = -1;
    for (let ci = 0; ci < colTypes.length; ci++) {
      if (ci === descCol || ci === priceCol) continue;
      if (colTypes[ci] && colTypes[ci].short > 0 && ci < descCol) {
        codeCol = ci;
        break;
      }
    }

    let dateCol = -1, maxDates = 0;
    for (let ci = 0; ci < colTypes.length; ci++) {
      if (colTypes[ci] && colTypes[ci].date > maxDates) {
        maxDates = colTypes[ci].date;
        dateCol = ci;
      }
    }

    let supplierCol = -1, maxSupplierScore = 0;
    for (let ci = 0; ci < colTypes.length; ci++) {
      if (ci === descCol || ci === priceCol || ci === codeCol || ci === dateCol) continue;
      if (colTypes[ci]) {
        const score = colTypes[ci].short + colTypes[ci].text;
        if (score > maxSupplierScore) {
          maxSupplierScore = score;
          supplierCol = ci;
        }
      }
    }

    if (descCol !== -1 && priceCol !== -1) {
      return {
        mapping: {
          code: codeCol,
          name: descCol,
          basePrice: priceCol,
          finalPrice: -1,
          supplier: supplierCol,
          date: dateCol,
          ipi: -1,
          adjustment: -1,
          quantity: -1
        },
        headerRowIndex: -1
      };
    }
    return null;
  };

  const getFamilyMedians = (db) => {
    const medians = {};
    const pricesByFamily = {};
    for (const p of (db.products || [])) {
      const f = norm(p.family || "Geral");
      if (!pricesByFamily[f]) pricesByFamily[f] = [];
      const o = currentOffer(p);
      if (o && Number(o.finalPrice) > 0) {
        pricesByFamily[f].push(Number(o.finalPrice));
      }
    }
    for (const [f, list] of Object.entries(pricesByFamily)) {
      if (list.length === 0) continue;
      list.sort((a, b) => a - b);
      const mid = Math.floor(list.length / 2);
      medians[f] = list.length % 2 !== 0 ? list[mid] : (list[mid - 1] + list[mid]) / 2;
    }
    return medians;
  };

  const medianOf = (values = []) => {
    const list = values.map(Number).filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
    if (!list.length) return 0;
    const mid = Math.floor(list.length / 2);
    return list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2;
  };

  const productMedian = (product) => medianOf((product?.offers || []).map((o) => o.finalPrice));

  function previewWorkbook(wb, db, options = {}) {
    const fileName = options.fileName || "planilha.xlsx";
    const makeId = options.makeId || ((p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`);
    const sheets = wb?.sheets || [];
    const legacyWorkbook = sheets.filter((sheet) => familyNames.has(norm(sheet.name))).length >= 8;
    const existingCodes = new Set((db.products || []).map((p) => norm(p.code)).filter(Boolean));
    // Índice de proveniência: quando a planilha original é reimportada, a linha física
    // é a evidência mais forte e evita criar falsos "novos materiais" por nomes resumidos.
    const sourceIndex = new Map();
    const addSource = (product, source) => {
      if (!source?.sheet || !source?.row) return;
      const key = `${norm(source.sheet)}|${Number(source.row)}`;
      if (!sourceIndex.has(key)) sourceIndex.set(key, []);
      const list = sourceIndex.get(key);
      if (!list.some((p) => p.id === product.id)) list.push(product);
    };
    for (const product of (db.products || [])) {
      addSource(product, product.source);
      for (const source of (product.sources || [])) addSource(product, source);
      for (const offer of (product.offers || [])) addSource(product, offer.source);
    }
    const familyMedians = getFamilyMedians(db);
    const validation = {
      absoluteMin: 0.01,
      absoluteMax: 1000000,
      deviationFactor: 5,
      requireDate: true,
      minimumJustificationLength: 8,
      ...(db.settings?.importValidation || {}),
      ...(options.validation || {})
    };

    const updates = [], newProducts = [], newSuppliers = [], skipped = [], reviewItems = [], seenProducts = new Set(), seenNewCodes = new Set(), qualityIssuesDetailed = [];
    let examinedPriceRows = 0, unchanged = 0, aligned = 0;

    const supplierFor = (raw) => {
      const cleaned = cleanString(raw);
      if (!cleaned) return null;
      let found = findSupplier(db, cleaned) || findSupplier({ suppliers: newSuppliers }, cleaned);
      if (!found) {
        found = { id: makeId("sup"), name: cleaned, email: "", phone: "", emails: [], phones: [], aliases: [cleaned], sources: [`Importação: ${fileName}`], productCount: 0, quotedProductCount: 0, listedProductCount: 0 };
        newSuppliers.push(found);
      }
      return found;
    };

    const processedRows = new Set();

    for (const sheet of sheets) {
      const rows = sheet.rows || [];
      if (rows.length === 0) {
        skipped.push({ sheet: sheet.name, row: 1, reason: "Aba vazia ou sem linhas legíveis", name: "" });
        continue;
      }

      // A planilha corporativa histórica tem layout conhecido e linhas-resumo.
      // Quando o conjunto de abas confirma esse formato, não usamos heurística em colunas
      // de contatos/indicadores, pois elas podem parecer fornecedor ou preço.
      const isLegacyTab = legacyWorkbook && familyNames.has(norm(sheet.name));
      let info = isLegacyTab ? {
        mapping: { code: 0, name: 1, basePrice: 2, ipi: 3, adjustment: 4, finalPrice: 5, supplier: 7, date: 8, quantity: -1 },
        headerRowIndex: 1
      } : detectColumns(sheet);
      if (!info) info = guessColumnsHeuristically(sheet);

      // Se falhou em detectar, pula a aba sem alterar a base.
      if (!info) {
        if (false) {
          info = null;
        } else {
          skipped.push({ sheet: sheet.name, row: 1, reason: "Colunas de descrição e preço não encontradas", name: "" });
          continue;
        }
      }

      const { mapping, headerRowIndex } = info;
      const startRow = headerRowIndex + 1;

      for (let ri = startRow; ri < rows.length; ri++) {
        const row = rows[ri] || [];
        const code = cleanString(row[mapping.code]);
        const rowText = cleanString(row[mapping.name]);
        const supplierRaw = cleanString(mapping.supplier !== -1 ? row[mapping.supplier] : "");
        const dateRaw = cleanString(mapping.date !== -1 ? row[mapping.date] : "");

        // Linhas de total/resumo da planilha legada repetem apenas o valor final.
        // Sem código nem descrição não existe identidade de material: nunca herdar o título anterior.
        if (!code && !rowText) continue;

        const base = number(row[mapping.basePrice]);
        const finalCell = mapping.finalPrice !== -1 ? number(row[mapping.finalPrice]) : 0;
        const ipi = mapping.ipi !== -1 ? percent(row[mapping.ipi]) : 0;
        const adjustment = mapping.adjustment !== -1 ? percent(row[mapping.adjustment]) : 0;
        const quantity = mapping.quantity !== -1 ? (number(row[mapping.quantity]) || 1) : 1;

        // Validação estrita de preço (não aceita nulo, negativo, infinito ou não numérico)
        if (base <= 0 && finalCell <= 0) {
          const rawBaseVal = cleanString(row[mapping.basePrice]);
          if (rawBaseVal) {
            skipped.push({ sheet: sheet.name, row: ri + 1, reason: `Preço inválido (menor ou igual a zero): ${rawBaseVal}`, name: rowText || code });
          }
          continue;
        }

        // Validação estrita de data (bloqueia datas impossíveis)
        const dateResult = parseStrictDate(dateRaw);
        if (dateResult.error) {
          skipped.push({ sheet: sheet.name, row: ri + 1, reason: `Data inválida na linha: ${dateResult.error}`, name: rowText || code });
          continue;
        }

        examinedPriceRows++;

        const supplier = supplierFor(supplierRaw);
        const basePrice = base || finalCell;
        const grossWithTaxes = basePrice * (1 + ipi / 100 + adjustment / 100);
        const finalPrice = finalCell > 0 ? finalCell : grossWithTaxes / Math.max(1, quantity);

        const famNorm = norm(sheet.name);
        const familyMedian = familyMedians[famNorm] || 0;

        // Primeiro tenta a proveniência física da planilha já migrada. Em cópias da
        // planilha corporativa, folha + linha identifica a oferta sem depender de título abreviado.
        let product = null;
        let duplicateCodeMatches = [];
        const sourceMatches = sourceIndex.get(`${norm(sheet.name)}|${ri + 1}`) || [];
        if (sourceMatches.length === 1) product = sourceMatches[0];
        else if (sourceMatches.length > 1) {
          const byCode = code ? sourceMatches.filter((p) => norm(p.code) === norm(code)) : [];
          const byName = rowText ? sourceMatches.filter((p) => norm(p.name) === norm(rowText) || (p.aliases || []).some((a) => norm(a) === norm(rowText))) : [];
          if (byCode.length === 1) product = byCode[0];
          else if (byName.length === 1) product = byName[0];
        }
        // Código repetido pode representar variações diferentes. Nunca escolhe silenciosamente a primeira.
        if (!product && code) {
          duplicateCodeMatches = (db.products || []).filter((p) => !p.archived && norm(p.code) === norm(code));
          if (duplicateCodeMatches.length === 1) product = duplicateCodeMatches[0];
          else if (duplicateCodeMatches.length > 1 && rowText) {
            const exactNamed = duplicateCodeMatches.filter((p) => norm(p.name) === norm(rowText));
            if (exactNamed.length === 1) product = exactNamed[0];
          }
        }

        // Se não achou por código, tenta correspondência exata de nome e variante no banco.
        if (!product && rowText) {
          const normName = norm(rowText);
          const nameMatches = (db.products || []).filter((p) => !p.archived && norm(p.name) === normName);
          if (nameMatches.length === 1) product = nameMatches[0];
        }

        if (!product && duplicateCodeMatches.length > 1) {
          const reason = `Código ${code} corresponde a ${duplicateCodeMatches.length} variações. Informe a descrição completa ou selecione a variação correta antes de importar.`;
          reviewItems.push({ sheet: sheet.name, row: ri + 1, reason, name: rowText || code, code, candidateProductIds: duplicateCodeMatches.map((p) => p.id) });
          qualityIssuesDetailed.push({ sheet: sheet.name, row: ri + 1, productName: rowText || code, field: "Código", original: code, interpreted: "Não selecionado", alert: reason, action: "Enviado para revisão; nenhum histórico foi gravado" });
          continue;
        }

        const offer = {
          id: makeId("off"),
          supplierId: supplier?.id || "",
          supplierName: supplier?.name || supplierRaw || "Não informado",
          basePrice,
          ipi,
          adjustment,
          quantity,
          finalPrice,
          updatedAt: dateResult.date || "",
          updatedAtRaw: dateRaw,
          email: supplier?.email || "",
          phone: supplier?.phone || "",
          notes: `Importado de ${fileName}`,
          source: { sheet: sheet.name.trim(), row: ri + 1 },
          qualityIssues: [],
          calculationMode: finalCell > 0 ? "manual" : "standard",
          manualFinal: finalCell > 0 ? finalCell : undefined,
          percentUnit: "percent"
        };

        // Quarentena semântica: usa primeiro o histórico do próprio material, depois a família.
        let quarantineReason = null;
        const productReference = productMedian(product) || Number(currentOffer(product)?.finalPrice || 0);
        const reference = productReference || familyMedian;
        const factor = Math.max(1.2, Number(validation.deviationFactor || 5));
        if (!Number.isFinite(finalPrice) || finalPrice <= 0) {
          quarantineReason = "Preço inválido ou menor/igual a zero";
        } else if (finalPrice < Number(validation.absoluteMin || 0.01)) {
          quarantineReason = `Preço abaixo do mínimo configurado: R$ ${finalPrice.toFixed(4)}`;
        } else if (finalPrice > Number(validation.absoluteMax || 1000000)) {
          quarantineReason = `Preço acima do máximo configurado: R$ ${finalPrice.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;
        } else if (reference > 0 && finalPrice > reference * factor) {
          quarantineReason = `Preço ${factor}x superior à referência histórica (R$ ${reference.toFixed(2)})`;
        } else if (reference > 0 && finalPrice < reference / factor) {
          quarantineReason = `Preço ${factor}x inferior à referência histórica (R$ ${reference.toFixed(2)})`;
        }
        if (!dateRaw && validation.requireDate) {
          quarantineReason = [quarantineReason, "Data da compra não informada"].filter(Boolean).join(" • ");
        }
        if (quarantineReason) {
          offer.quarantined = true;
          offer.quarantineReason = quarantineReason;
          offer.qualityIssues.push(quarantineReason);
          qualityIssuesDetailed.push({
            sheet: sheet.name,
            row: ri + 1,
            productName: rowText || code || "Desconhecido",
            field: "Preço Final",
            original: finalCell > 0 ? `R$ ${finalCell.toFixed(2)}` : `Base R$ ${base.toFixed(2)}`,
            interpreted: `R$ ${finalPrice.toFixed(2)}`,
            alert: quarantineReason,
            action: "Direcionado para revisão e desmarcado por padrão"
          });
        }

        if (!dateRaw) {
          qualityIssuesDetailed.push({
            sheet: sheet.name,
            row: ri + 1,
            productName: rowText || code || "Desconhecido",
            field: "Data de Compra",
            original: "(Vazio)",
            interpreted: "Não informada",
            alert: "A data não será inventada pelo sistema",
            action: validation.requireDate ? "Item enviado para revisão" : "Mantido sem data por configuração explícita"
          });
        }

        if (product) {
          aligned++;
          const signature = `${product.id}|${offer.supplierId || compact(offer.supplierName)}|${offer.updatedAt}|${offer.finalPrice.toFixed(4)}`;
          if (seenProducts.has(signature)) {
            skipped.push({ sheet: sheet.name, row: ri + 1, reason: "Oferta repetida na planilha", name: product.name });
            continue;
          }
          seenProducts.add(signature);

          if (hasSameOffer(product, offer)) {
            unchanged++;
            continue;
          }

          const patch = {};
          if (!cleanString(product.code) && code) patch.code = code;
          updates.push({ productId: product.id, productName: product.name, offer, patch, match: "linha alinhada" });
        } else {
          // Criar novo produto se o nome for válido e contiver um substantivo industrial de produto
          const name = contextualName(rows, ri, rowText, mapping.name);
          if (!validName(name) || !PRODUCT_NOUN.test(name)) {
            skipped.push({ sheet: sheet.name, row: ri + 1, reason: "Descrição de material ambígua ou cabeçalho de resumo", name: rowText || code });
            continue;
          }

          if (code && seenNewCodes.has(norm(code))) {
            skipped.push({ sheet: sheet.name, row: ri + 1, reason: "Código repetido na planilha para novo material", name });
            continue;
          }

          if (code) seenNewCodes.add(norm(code));

          qualityIssuesDetailed.push({
            sheet: sheet.name,
            row: ri + 1,
            productName: name,
            field: "Cadastro",
            original: rowText || code,
            interpreted: name,
            alert: "Material não encontrado no catálogo atual",
            action: "Classificado para criação de novo cadastro de produto"
          });

          const newProduct = {
            id: makeId("prd"),
            code,
            name,
            displayName: name,
            technicalName: [name, rowText].filter(Boolean).join(" | "),
            description: "",
            category: sheet.name.trim(),
            familyKey: sheet.name.trim(),
            family: sheet.name.trim(),
            subcategory: "Importado",
            group: "Importado",
            subtitle: "",
            unit: "un",
            notes: `Importado de ${fileName}`,
            icon: "box",
            specs: [],
            quality: { needsReview: true, reasons: ["Novo material da planilha: conferir nome, unidade e especificações"] },
            resolvedQualityIssues: [],
            favorite: false,
            archived: false,
            contacts: [],
            aliases: [name, rowText].filter(Boolean),
            externalCodes: [],
            originalLines: [rowText].filter(Boolean),
            source: { sheet: sheet.name.trim(), row: ri + 1 },
            sources: [{ sheet: sheet.name.trim(), row: ri + 1 }],
            supplierLinks: supplier ? [{ supplierId: supplier.id, name: supplier.name, kind: "quoted", source: "Importação" }] : [],
            searchText: [code, name, sheet.name, supplier?.name].filter(Boolean).join(" "),
            offers: [offer]
          };
          newProducts.push(newProduct);
        }
      }
    }

    const usedSupplierIds = new Set([...updates.map((x) => x.offer?.supplierId), ...newProducts.flatMap((p) => (p.offers || []).map((o) => o.supplierId))].filter(Boolean));
    const filteredSuppliers = newSuppliers.filter((s) => usedSupplierIds.has(s.id));

    return {
      updates,
      newProducts,
      newSuppliers: filteredSuppliers,
      skipped,
      reviewItems,
      qualityIssuesDetailed,
      validation,
      mode: legacyWorkbook ? "vesper-legacy-aligned" : "general-import",
      stats: { examinedPriceRows, aligned, unchanged, updates: updates.length, newProducts: newProducts.length, skipped: skipped.length, reviewItems: reviewItems.length }
    };
  }

  return { previewWorkbook, cleanString, norm, number, percent, parseStrictDate, isValidDate, validName, version: "1.7.0" };
});
