/* Minimal, audited XLSX reader/writer for ProcureFlow.
 * Supports standard OOXML .xlsx workbooks with shared strings / inline strings.
 * Dependency: fflate (MIT). No macros, external links or formulas are executed.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("fflate"));
  else root.ProcureFlowSpreadsheet = factory(root.fflate);
})(typeof globalThis !== "undefined" ? globalThis : this, function (fflate) {
  "use strict";
  if (!fflate) throw new Error("fflate não foi carregado.");
  const encoder = typeof TextEncoder !== "undefined" ? new TextEncoder() : null;
  const decoder = typeof TextDecoder !== "undefined" ? new TextDecoder("utf-8") : null;
  const toBytes = (text) => encoder ? encoder.encode(text) : fflate.strToU8(text);
  const fromBytes = (bytes) => decoder ? decoder.decode(bytes) : fflate.strFromU8(bytes);
  const xmlDecode = (value = "") => String(value)
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
  const xmlEncode = (value = "") => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
  const attr = (source, name) => {
    const match = String(source || "").match(new RegExp(`(?:^|\\s)${name.replace(":", "\\:")}=(?:"([^"]*)"|'([^']*)')`, "i"));
    return xmlDecode(match ? (match[1] ?? match[2] ?? "") : "");
  };
  const columnIndex = (letters = "A") => {
    let index = 0;
    for (const ch of letters.toUpperCase()) index = index * 26 + ch.charCodeAt(0) - 64;
    return Math.max(0, index - 1);
  };
  const columnName = (index) => {
    let n = Number(index) + 1, out = "";
    while (n > 0) { const mod = (n - 1) % 26; out = String.fromCharCode(65 + mod) + out; n = Math.floor((n - 1) / 26); }
    return out;
  };
  const fileText = (files, name) => files[name] ? fromBytes(files[name]) : "";
  const normalizeTarget = (target = "") => {
    let value = String(target).replace(/\\/g, "/");
    if (value.startsWith("/")) value = value.slice(1);
    if (!value.startsWith("xl/")) value = `xl/${value.replace(/^\.\//, "")}`;
    return value.replace(/\/\.\//g, "/");
  };
  function parseSharedStrings(xml) {
    const values = [];
    for (const match of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/gi)) {
      const parts = [...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)].map((m) => xmlDecode(m[1]));
      values.push(parts.join(""));
    }
    return values;
  }
  function parseSheet(xml, sharedStrings) {
    const rows = [];
    for (const rowMatch of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/gi)) {
      const declaredRow = Math.max(0, Number(attr(rowMatch[1], "r") || rows.length + 1) - 1);
      const row = [];
      let fallbackColumn = 0;
      const cellRegex = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/gi;
      for (const cellMatch of rowMatch[2].matchAll(cellRegex)) {
        const attrs = cellMatch[1] || "", body = cellMatch[2] || "";
        const ref = attr(attrs, "r"), letters = (ref.match(/[A-Z]+/i) || [])[0];
        const column = letters ? columnIndex(letters) : fallbackColumn;
        fallbackColumn = column + 1;
        const type = attr(attrs, "t").toLowerCase();
        const rawValue = (body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/i) || [])[1];
        let value = null;
        if (type === "inlinestr") {
          value = [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)].map((m) => xmlDecode(m[1])).join("");
        } else if (type === "s") {
          const idx = Number(rawValue); value = Number.isInteger(idx) ? (sharedStrings[idx] ?? "") : "";
        } else if (type === "str" || type === "e") value = xmlDecode(rawValue || "");
        else if (type === "b") value = String(rawValue) === "1";
        else if (rawValue !== undefined) {
          const decoded = xmlDecode(rawValue);
          const number = Number(decoded);
          value = decoded !== "" && Number.isFinite(number) ? number : decoded;
        }
        row[column] = value;
      }
      while (row.length && row[row.length - 1] == null) row.pop();
      rows[declaredRow] = row;
    }
    for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
    return rows;
  }
  function readWorkbook(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    const files = fflate.unzipSync(bytes);
    const workbookXml = fileText(files, "xl/workbook.xml");
    if (!workbookXml) throw new Error("Arquivo .xlsx inválido: workbook.xml ausente.");
    const relationships = fileText(files, "xl/_rels/workbook.xml.rels");
    const relMap = new Map();
    for (const match of relationships.matchAll(/<Relationship\b([^>]*?)(?:\/>|><\/Relationship>)/gi)) {
      relMap.set(attr(match[1], "Id"), normalizeTarget(attr(match[1], "Target")));
    }
    const shared = parseSharedStrings(fileText(files, "xl/sharedStrings.xml"));
    const sheets = [];
    for (const match of workbookXml.matchAll(/<sheet\b([^>]*?)(?:\/>|><\/sheet>)/gi)) {
      const name = attr(match[1], "name") || `Planilha ${sheets.length + 1}`;
      const relId = attr(match[1], "r:id");
      const target = relMap.get(relId) || `xl/worksheets/sheet${sheets.length + 1}.xml`;
      const xml = fileText(files, target);
      if (xml) sheets.push({ name, rows: parseSheet(xml, shared) });
    }
    if (!sheets.length) throw new Error("Nenhuma planilha legível foi encontrada.");
    return { sheets };
  }
  function objectRows(rows) {
    if (!rows.length) return [[]];
    if (Array.isArray(rows[0])) return rows;
    const headers = [];
    rows.forEach((row) => Object.keys(row || {}).forEach((key) => { if (!headers.includes(key)) headers.push(key); }));
    return [headers, ...rows.map((row) => headers.map((key) => row?.[key] ?? null))];
  }
  function sheetXml(rows) {
    const data = objectRows(rows);
    let dimension = "A1";
    const xmlRows = data.map((row, rowIndex) => {
      const cells = (row || []).map((value, columnIndexValue) => {
        if (value === null || value === undefined || value === "") return "";
        const ref = `${columnName(columnIndexValue)}${rowIndex + 1}`;
        dimension = `${ref}`;
        if (typeof value === "number" && Number.isFinite(value)) return `<c r="${ref}"><v>${value}</v></c>`;
        if (typeof value === "boolean") return `<c r="${ref}" t="b"><v>${value ? 1 : 0}</v></c>`;
        return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEncode(value)}</t></is></c>`;
      }).join("");
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    }).join("");
    const end = dimension === "A1" ? "A1" : dimension;
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${end}"/><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="15"/><sheetData>${xmlRows}</sheetData></worksheet>`;
  }
  function safeSheetName(name, used) {
    let value = String(name || "Planilha").replace(/[\\/*?:\[\]]/g, " ").trim().slice(0, 31) || "Planilha";
    const base = value; let i = 2;
    while (used.has(value.toLowerCase())) value = `${base.slice(0, Math.max(1, 28 - String(i).length))} ${i++}`;
    used.add(value.toLowerCase()); return value;
  }
  function writeWorkbookBuffer(inputSheets) {
    const used = new Set();
    const sheets = (inputSheets || []).map((sheet, i) => ({ name: safeSheetName(sheet.name || `Planilha ${i + 1}`, used), rows: sheet.rows || [] }));
    if (!sheets.length) sheets.push({ name: "Planilha 1", rows: [[]] });
    const contentTypes = sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("");
    const workbookSheets = sheets.map((sheet, i) => `<sheet name="${xmlEncode(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("");
    const workbookRels = sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("") + `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`;
    const files = {
      "[Content_Types].xml": toBytes(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${contentTypes}</Types>`),
      "_rels/.rels": toBytes(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
      "xl/workbook.xml": toBytes(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${workbookSheets}</sheets></workbook>`),
      "xl/_rels/workbook.xml.rels": toBytes(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${workbookRels}</Relationships>`),
      "xl/styles.xml": toBytes(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="1"><xf xfId="0"/></cellXfs></styleSheet>`),
    };
    sheets.forEach((sheet, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = toBytes(sheetXml(sheet.rows)); });
    return fflate.zipSync(files, { level: 6 });
  }
  function writeFile(filePath, sheets) {
    if (typeof require !== "function") throw new Error("Gravação em arquivo disponível apenas no aplicativo instalado.");
    require("fs").writeFileSync(filePath, Buffer.from(writeWorkbookBuffer(sheets)));
    return filePath;
  }
  function serialDate(value) {
    if (!(typeof value === "number" && value > 0)) return null;
    const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000);
    return Number.isNaN(date.getTime()) ? null : { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() };
  }
  return { readWorkbook, writeWorkbookBuffer, writeFile, serialDate, version: "1.0.0" };
});
