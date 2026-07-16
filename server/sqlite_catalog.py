# -*- coding: utf-8 -*-
"""Núcleo SQLite/FTS5 gratuito e offline para o ProcureFlow.

Este módulo não depende de pacotes pagos, SaaS ou APIs externas. Ele usa apenas a
biblioteca padrão do Python (sqlite3) para gerar uma base local consultável.

Uso:
  python sqlite_catalog.py build --json ../demo-data/seed.json --db ../.runtime/catalog.sqlite
  python sqlite_catalog.py search --db ../.runtime/catalog.sqlite --q "parafuso inox 1/4"
  python sqlite_catalog.py audit --db ../.runtime/catalog.sqlite
"""
from __future__ import annotations

import argparse
import json
import re
import sqlite3
import unicodedata
from pathlib import Path
from typing import Any, Iterable

SCHEMA_VERSION = 15
APP_VERSION = "2.2.0"


def clean(value: Any = "") -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def norm(value: Any = "") -> str:
    text = unicodedata.normalize("NFD", clean(value)).encode("ascii", "ignore").decode("ascii")
    text = text.lower().replace("×", " x ").replace("“", '"').replace("”", '"').replace("′", "'").replace("″", '"')
    text = re.sub(r"(?<=\d),(?=\d)", ".", text)
    text = re.sub(r"\baco\s+(?:inoxidavel|inox)\b", "inox", text)
    text = re.sub(r"\bmilimetros?\b", "mm", text)
    text = re.sub(r"\bpolegadas?|\bpol\b", '"', text)
    text = re.sub(r"[^a-z0-9#/+.'\" -]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def parse_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(str(value).replace(".", "").replace(",", ".") if isinstance(value, str) and value.count(',') == 1 and value.count('.') >= 1 else str(value).replace(",", "."))
    except ValueError:
        return None


def sqlite_has_fts5(conn: sqlite3.Connection) -> bool:
    try:
        conn.execute("CREATE VIRTUAL TABLE temp.__fts_check USING fts5(x)")
        conn.execute("DROP TABLE temp.__fts_check")
        return True
    except sqlite3.Error:
        return False


def product_search_text(p: dict[str, Any]) -> str:
    parts: list[str] = [
        p.get("name"), p.get("displayName"), p.get("technicalName"), p.get("description"),
        p.get("code"), p.get("family"), p.get("subcategory"), p.get("group"), p.get("subtitle"),
        p.get("manufacturer"), p.get("searchText"),
    ]
    parts.extend(p.get("aliases") or [])
    parts.extend(p.get("externalCodes") or [])
    for spec in p.get("specs") or []:
        if isinstance(spec, dict):
            parts.append(spec.get("label")); parts.append(spec.get("value"))
    for link in p.get("supplierLinks") or []:
        if isinstance(link, dict): parts.append(link.get("name"))
    for off in p.get("offers") or []:
        if isinstance(off, dict): parts.append(off.get("supplierName"))
    raw = " ".join(clean(x) for x in parts if x)
    return f"{raw} {norm(raw)}"


def connect(db_path: str | Path) -> sqlite3.Connection:
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    return conn


def create_schema(conn: sqlite3.Connection) -> None:
    fts5 = sqlite_has_fts5(conn)
    conn.executescript(
        """
        DROP TABLE IF EXISTS product_fts;
        DROP TABLE IF EXISTS price_event;
        DROP TABLE IF EXISTS supplier_link;
        DROP TABLE IF EXISTS product;
        DROP TABLE IF EXISTS supplier;
        DROP TABLE IF EXISTS meta;
        CREATE TABLE meta(
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        ) STRICT;
        CREATE TABLE supplier(
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          name_norm TEXT NOT NULL,
          email TEXT NOT NULL DEFAULT '',
          phone TEXT NOT NULL DEFAULT '',
          aliases_json TEXT NOT NULL DEFAULT '[]',
          product_count INTEGER NOT NULL DEFAULT 0
        ) STRICT;
        CREATE TABLE product(
          id TEXT PRIMARY KEY,
          code TEXT NOT NULL DEFAULT '',
          name TEXT NOT NULL,
          name_norm TEXT NOT NULL,
          family TEXT NOT NULL DEFAULT '',
          subcategory TEXT NOT NULL DEFAULT '',
          unit TEXT NOT NULL DEFAULT 'un',
          manufacturer TEXT NOT NULL DEFAULT '',
          specs_json TEXT NOT NULL DEFAULT '[]',
          aliases_json TEXT NOT NULL DEFAULT '[]',
          external_codes_json TEXT NOT NULL DEFAULT '[]',
          archived INTEGER NOT NULL DEFAULT 0,
          needs_review INTEGER NOT NULL DEFAULT 0,
          search_text TEXT NOT NULL,
          current_price REAL,
          current_supplier_id TEXT,
          current_supplier_name TEXT NOT NULL DEFAULT '',
          current_date TEXT NOT NULL DEFAULT '',
          current_offer_id TEXT NOT NULL DEFAULT '',
          offer_count INTEGER NOT NULL DEFAULT 0,
          FOREIGN KEY(current_supplier_id) REFERENCES supplier(id)
        ) STRICT;
        CREATE TABLE supplier_link(
          product_id TEXT NOT NULL REFERENCES product(id) ON DELETE CASCADE,
          supplier_id TEXT,
          supplier_name TEXT NOT NULL DEFAULT '',
          kind TEXT NOT NULL DEFAULT '',
          source TEXT NOT NULL DEFAULT '',
          PRIMARY KEY(product_id, supplier_name, kind, source)
        ) STRICT;
        CREATE TABLE price_event(
          id TEXT PRIMARY KEY,
          product_id TEXT NOT NULL REFERENCES product(id) ON DELETE CASCADE,
          supplier_id TEXT,
          supplier_name TEXT NOT NULL DEFAULT '',
          base_price REAL,
          quantity REAL NOT NULL DEFAULT 1,
          final_price REAL,
          updated_at TEXT NOT NULL DEFAULT '',
          updated_at_raw TEXT NOT NULL DEFAULT '',
          notes TEXT NOT NULL DEFAULT '',
          source_json TEXT NOT NULL DEFAULT '{}',
          quality_json TEXT NOT NULL DEFAULT '[]'
        ) STRICT;
        CREATE INDEX idx_product_code ON product(code);
        CREATE INDEX idx_product_family ON product(family);
        CREATE INDEX idx_product_current_date ON product("current_date");
        CREATE INDEX idx_price_event_product_date ON price_event(product_id, updated_at DESC);
        CREATE INDEX idx_supplier_norm ON supplier(name_norm);
        """
    )
    if fts5:
        conn.execute(
            "CREATE VIRTUAL TABLE product_fts USING fts5(name, code, family, manufacturer, search_text, content='product', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2')"
        )
    else:
        conn.execute("CREATE TABLE product_fts(rowid INTEGER PRIMARY KEY, name TEXT, code TEXT, family TEXT, manufacturer TEXT, search_text TEXT) STRICT")
    conn.execute("INSERT INTO meta(key,value) VALUES('appVersion',?),('schemaVersion',?),('fts5',?)", (APP_VERSION, str(SCHEMA_VERSION), '1' if fts5 else '0'))


def import_json(json_path: str | Path, db_path: str | Path) -> dict[str, Any]:
    json_path = Path(json_path)
    db_path = Path(db_path)
    data = json.loads(json_path.read_text(encoding="utf-8"))
    if db_path.exists(): db_path.unlink()
    conn = connect(db_path)
    with conn:
        create_schema(conn)
        for s in data.get('suppliers') or []:
            conn.execute(
                "INSERT INTO supplier(id,name,name_norm,email,phone,aliases_json,product_count) VALUES(?,?,?,?,?,?,?)",
                (clean(s.get('id')), clean(s.get('name')), norm(s.get('name')), clean(s.get('email')), clean(s.get('phone')), json.dumps(s.get('aliases') or [], ensure_ascii=False), int(s.get('productCount') or 0)),
            )
        product_rows = 0; offer_rows = 0
        for p in data.get('products') or []:
            offers = sorted((p.get('offers') or []), key=lambda o: (clean(o.get('updatedAt')), clean(o.get('id'))), reverse=True)
            cur = next((o for o in offers if parse_float(o.get('finalPrice')) and parse_float(o.get('finalPrice')) > 0), None)
            search_text = product_search_text(p)
            conn.execute(
                """INSERT INTO product(id,code,name,name_norm,family,subcategory,unit,manufacturer,specs_json,aliases_json,external_codes_json,archived,needs_review,search_text,current_price,current_supplier_id,current_supplier_name,current_date,current_offer_id,offer_count)
                   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    clean(p.get('id')), clean(p.get('code')), clean(p.get('name')), norm(p.get('name')), clean(p.get('family')), clean(p.get('subcategory')), clean(p.get('unit') or 'un'), clean(p.get('manufacturer')),
                    json.dumps(p.get('specs') or [], ensure_ascii=False), json.dumps(p.get('aliases') or [], ensure_ascii=False), json.dumps(p.get('externalCodes') or [], ensure_ascii=False),
                    1 if p.get('archived') else 0, 1 if (p.get('quality') or {}).get('needsReview') else 0, search_text,
                    parse_float(cur.get('finalPrice')) if cur else None, clean(cur.get('supplierId')) if cur else None, clean(cur.get('supplierName')) if cur else '', clean(cur.get('updatedAt')) if cur else '', clean(cur.get('id')) if cur else '', len(offers),
                ),
            )
            rowid = conn.execute("SELECT rowid FROM product WHERE id=?", (clean(p.get('id')),)).fetchone()[0]
            conn.execute("INSERT INTO product_fts(rowid,name,code,family,manufacturer,search_text) VALUES(?,?,?,?,?,?)", (rowid, clean(p.get('name')), clean(p.get('code')), clean(p.get('family')), clean(p.get('manufacturer')), search_text))
            product_rows += 1
            for link in p.get('supplierLinks') or []:
                if not isinstance(link, dict): continue
                try:
                    conn.execute("INSERT OR IGNORE INTO supplier_link(product_id,supplier_id,supplier_name,kind,source) VALUES(?,?,?,?,?)", (clean(p.get('id')), clean(link.get('supplierId')), clean(link.get('name')), clean(link.get('kind')), clean(link.get('source'))))
                except sqlite3.IntegrityError:
                    pass
            for o in offers:
                if not isinstance(o, dict): continue
                final = parse_float(o.get('finalPrice'))
                conn.execute(
                    "INSERT OR REPLACE INTO price_event(id,product_id,supplier_id,supplier_name,base_price,quantity,final_price,updated_at,updated_at_raw,notes,source_json,quality_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                    (clean(o.get('id')) or f"off_{clean(p.get('id'))}_{offer_rows}", clean(p.get('id')), clean(o.get('supplierId')), clean(o.get('supplierName')), parse_float(o.get('basePrice')), parse_float(o.get('quantity')) or 1, final, clean(o.get('updatedAt')), clean(o.get('updatedAtRaw')), clean(o.get('notes')), json.dumps(o.get('source') or {}, ensure_ascii=False), json.dumps(o.get('qualityIssues') or [], ensure_ascii=False)),
                )
                offer_rows += 1
    conn.close()
    return {'ok': True, 'db': str(db_path), 'products': product_rows, 'offers': offer_rows, 'suppliers': len(data.get('suppliers') or [])}


def safe_fts_query(q: str) -> str:
    tokens = [t for t in norm(q).split() if t]
    # prefix query on meaningful tokens, quoted to avoid syntax issues
    return " OR ".join(f'"{t}"*' for t in tokens[:8]) or '""'


def search(db_path: str | Path, q: str, limit: int = 25) -> list[dict[str, Any]]:
    conn = connect(db_path)
    meta_row = conn.execute("SELECT value FROM meta WHERE key='fts5'").fetchone()
    fts5 = bool(meta_row and str(meta_row["value"]) == "1")
    if fts5 and clean(q):
        query = safe_fts_query(q)
        rows = conn.execute(
            """SELECT p.id,p.code,p.name,p.family,p.unit,p.current_price,p.current_supplier_name,p.current_date,p.offer_count,
                      bm25(product_fts, 5.0, 4.0, 1.2, 2.0, 1.0) AS score,
                      snippet(product_fts, 4, '<b>', '</b>', '…', 10) AS snippet
               FROM product_fts JOIN product p ON product_fts.rowid=p.rowid
               WHERE product_fts MATCH ? AND p.archived=0
               ORDER BY score LIMIT ?""",
            (query, int(limit)),
        ).fetchall()
    else:
        like = f"%{norm(q)}%"
        rows = conn.execute(
            """SELECT id,code,name,family,unit,current_price,current_supplier_name,current_date,offer_count,0.0 AS score,search_text AS snippet
               FROM product WHERE archived=0 AND (name_norm LIKE ? OR search_text LIKE ? OR code LIKE ?) LIMIT ?""",
            (like, like, f"%{clean(q)}%", int(limit)),
        ).fetchall()
    out = [dict(r) for r in rows]
    conn.close()
    return out


def history(db_path: str | Path, product_id: str) -> list[dict[str, Any]]:
    conn = connect(db_path)
    rows = conn.execute("SELECT * FROM price_event WHERE product_id=? ORDER BY updated_at DESC, rowid DESC", (product_id,)).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def audit(db_path: str | Path) -> dict[str, Any]:
    conn = connect(db_path)
    products = conn.execute("SELECT COUNT(*) c FROM product WHERE archived=0").fetchone()['c']
    suppliers = conn.execute("SELECT COUNT(*) c FROM supplier").fetchone()['c']
    offers = conn.execute("SELECT COUNT(*) c FROM price_event WHERE final_price IS NOT NULL AND final_price>0").fetchone()['c']
    no_price = conn.execute("SELECT COUNT(*) c FROM product WHERE archived=0 AND current_price IS NULL").fetchone()['c']
    duplicate_codes = conn.execute("SELECT code,COUNT(*) c FROM product WHERE code<>'' GROUP BY code HAVING COUNT(*)>1 ORDER BY c DESC LIMIT 20").fetchall()
    top_suppliers = conn.execute("SELECT supplier_name,COUNT(*) c,COUNT(DISTINCT product_id) products FROM price_event WHERE supplier_name<>'' GROUP BY supplier_name ORDER BY c DESC LIMIT 20").fetchall()
    conn.close()
    return {'products': products, 'suppliers': suppliers, 'priceEvents': offers, 'productsWithoutPrice': no_price, 'duplicateCodes': [dict(r) for r in duplicate_codes], 'topSuppliers': [dict(r) for r in top_suppliers]}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description='ProcureFlow SQLite/FTS5 offline')
    sub = parser.add_subparsers(dest='cmd', required=True)
    b = sub.add_parser('build'); b.add_argument('--json', required=True); b.add_argument('--db', required=True)
    s = sub.add_parser('search'); s.add_argument('--db', required=True); s.add_argument('--q', required=True); s.add_argument('--limit', type=int, default=10)
    h = sub.add_parser('history'); h.add_argument('--db', required=True); h.add_argument('--product-id', required=True)
    a = sub.add_parser('audit'); a.add_argument('--db', required=True)
    args = parser.parse_args(argv)
    if args.cmd == 'build': print(json.dumps(import_json(args.json, args.db), ensure_ascii=False, indent=2))
    elif args.cmd == 'search': print(json.dumps(search(args.db, args.q, args.limit), ensure_ascii=False, indent=2))
    elif args.cmd == 'history': print(json.dumps(history(args.db, args.product_id), ensure_ascii=False, indent=2))
    elif args.cmd == 'audit': print(json.dumps(audit(args.db), ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
