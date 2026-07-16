# -*- coding: utf-8 -*-
"""ProcureFlow — backend local de pesquisa, extração estruturada e OCR.

O backend não decide silenciosamente o cadastro. Ele devolve evidências e níveis de
confiança para a interface permitir revisão humana antes de aplicar os campos.
"""
from __future__ import annotations

import io
import difflib
import statistics
import ipaddress
import json
import logging
import threading
import time
import os
import re
import shutil
import socket
import secrets
import unicodedata
from typing import Any, Dict, Iterable, List, Optional
from pathlib import Path
from datetime import datetime
from urllib.parse import quote_plus, urljoin, urlparse

import httpx
import pytesseract
from bs4 import BeautifulSoup
from fastapi import Depends, FastAPI, File, Header, HTTPException, Query, Response, UploadFile
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from PIL import Image, ImageEnhance, ImageOps
from pydantic import BaseModel, ConfigDict, Field

try:
    from sqlite_catalog import audit as sqlite_audit, history as sqlite_history, search as sqlite_search, import_json as sqlite_import_json
except Exception:  # pragma: no cover
    sqlite_audit = sqlite_history = sqlite_search = sqlite_import_json = None

APP_VERSION = "1.0.0-demo"
MAX_IMAGE_BYTES = 10 * 1024 * 1024
MAX_IMAGE_PIXELS = 24_000_000
MAX_HTML_BYTES = 3 * 1024 * 1024
SEARXNG_URL = os.getenv("SEARXNG_URL", "").rstrip("/")
DEMO_MODE = os.getenv("PROCUREFLOW_DEMO", "").strip().lower() in {"1", "true", "yes"}
ADMIN_TOKEN = os.getenv("PROCUREFLOW_ADMIN_TOKEN", "").strip()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("procureflow-backend")

for candidate_path in (
    r"C:\Program Files\Tesseract-OCR\tesseract.exe",
    r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
):
    if os.path.exists(candidate_path):
        pytesseract.pytesseract.tesseract_cmd = candidate_path
        break

app = FastAPI(
    title="ProcureFlow - Servidor Local",
    description="Pesquisa, extração estruturada, validação e OCR para o catálogo local.",
    version=APP_VERSION,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[],
    allow_origin_regex=r"https?://(?:127\.0\.0\.1|localhost)(?::\d+)?",
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "X-ProcureFlow-Token"],
)


def require_write_access(x_procureflow_token: str | None = Header(default=None)) -> None:
    """Fail closed outside the explicit local demo mode.

    The demo runs on loopback and intentionally allows edits so a recruiter can
    exercise the product. A LAN or production deployment must set
    PROCUREFLOW_ADMIN_TOKEN; this avoids exposing reset/backup/write endpoints
    to every device on the network.
    """
    if DEMO_MODE and not ADMIN_TOKEN:
        return
    if not ADMIN_TOKEN:
        raise HTTPException(
            status_code=503,
            detail="Operações de escrita exigem PROCUREFLOW_ADMIN_TOKEN nesta instalação.",
        )
    if not x_procureflow_token or not secrets.compare_digest(x_procureflow_token, ADMIN_TOKEN):
        raise HTTPException(status_code=401, detail="Token administrativo inválido.")


class ScrapeRequest(BaseModel):
    url: str


class MatchCandidate(BaseModel):
    model_config = ConfigDict(extra="allow")
    name: str
    raw_name: Optional[str] = None
    canonical_name: Optional[str] = None
    product_name: Optional[str] = None
    product_type: Optional[str] = None
    manufacturer: Optional[str] = None
    brand: Optional[str] = None
    product_line: Optional[str] = None
    model: Optional[str] = None
    manufacturer_code: Optional[str] = None
    gtin: Optional[str] = None
    unit: Optional[str] = None
    color: Optional[str] = None
    specs: List[Dict[str, Any]] = Field(default_factory=list)
    attributes: List[Dict[str, Any]] = Field(default_factory=list)
    url: str = ""
    source_name: str = ""
    source_type: Optional[str] = None
    seller: Optional[str] = None
    supplier: Optional[str] = None
    description: str = ""
    field_confidence: Dict[str, str] = Field(default_factory=dict)


class MatchRequest(BaseModel):
    query: str
    candidates: List[MatchCandidate] = Field(default_factory=list)


class MaterialNormalizeRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=500)


class SupplierDedupeRequest(BaseModel):
    suppliers: List[Dict[str, Any]] = Field(default_factory=list)


class PriceAuditRequest(BaseModel):
    products: List[Dict[str, Any]] = Field(default_factory=list)
    threshold_pct: float = Field(default=30, ge=1, le=500)
    stale_days: int = Field(default=180, ge=1, le=3650)


class CatalogAuditRequest(BaseModel):
    products: List[Dict[str, Any]] = Field(default_factory=list)
    suppliers: List[Dict[str, Any]] = Field(default_factory=list)
    threshold_pct: float = Field(default=30, ge=1, le=500)
    stale_days: int = Field(default=180, ge=1, le=3650)


def clean(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def norm(value: Any) -> str:
    text = unicodedata.normalize("NFD", clean(value)).encode("ascii", "ignore").decode().lower()
    text = text.replace("×", " x ").replace("“", '"').replace("”", '"').replace("™", "").replace("®", "")
    text = re.sub(r"(?<=\d),(?=\d)", ".", text)
    text = re.sub(r"\b(304|316|310|321|409|410|420|430|440)\s+l\b", r"\1l", text)
    text = re.sub(r"\baco\s+(?:inoxidavel|inox)\b", "inox", text)
    return re.sub(r"\s+", " ", text).strip()


def first_text(value: Any) -> str:
    if isinstance(value, dict):
        return clean(value.get("name") or value.get("value") or value.get("@id"))
    if isinstance(value, list):
        return first_text(value[0]) if value else ""
    return clean(value)


def flatten_jsonld(value: Any) -> Iterable[Dict[str, Any]]:
    if isinstance(value, dict):
        yield value
        graph = value.get("@graph")
        if graph is not None:
            yield from flatten_jsonld(graph)
        for key, child in value.items():
            if key != "@graph" and isinstance(child, (dict, list)):
                yield from flatten_jsonld(child)
    elif isinstance(value, list):
        for item in value:
            yield from flatten_jsonld(item)


def type_values(node: Dict[str, Any]) -> List[str]:
    raw = node.get("@type")
    if isinstance(raw, list):
        return [norm(x) for x in raw]
    return [norm(raw)] if raw else []


TYPE_ALIASES = [
    ("barra_chata", ("barra chata", "b chata")),
    ("chapa", ("chapa", "chapas", "ch.", "folha metalica", "lamina")),
    ("tubo", ("tubo", "tubos", "tubulacao")),
    ("fita", ("silver tape", "fita adesiva", "fita")),
    ("parafuso", ("parafuso", "paraf.")),
    ("porca", ("porca",)), ("arruela", ("arruela",)), ("rebite", ("rebite",)),
    ("cantoneira", ("cantoneira", "perfil l")), ("arame", ("arame", "fio de solda")),
    ("tela", ("tela", "malha")), ("flange", ("flange",)), ("tarugo", ("tarugo",)),
    ("conexao", ("conexao", "niple", "nipple", "luva", "cotovelo", "joelho", "valvula", "adaptador")),
    ("mangueira", ("mangueira",)), ("cabo", ("cabo",)), ("prensa_cabo", ("prensa cabo", "prensa-cabo")),
    ("rolamento", ("rolamento", "retentor")), ("adesivo", ("adesivo", "cola")),
]
TYPE_LABELS = {"barra_chata":"Barra chata","chapa":"Chapa","tubo":"Tubo","fita":"Fita","parafuso":"Parafuso","porca":"Porca","arruela":"Arruela","rebite":"Rebite","cantoneira":"Cantoneira","arame":"Arame","tela":"Tela","flange":"Flange","tarugo":"Tarugo","conexao":"Conexão","mangueira":"Mangueira","cabo":"Cabo","prensa_cabo":"Prensa-cabo","rolamento":"Rolamento","adesivo":"Adesivo"}
KNOWN_MANUFACTURERS = {"3m":"3M","weg":"WEG","tigre":"Tigre","tramontina":"Tramontina","bosch":"Bosch","siemens":"Siemens","schneider":"Schneider","vonder":"Vonder","norton":"Norton","makita":"Makita","dewalt":"DeWalt","skf":"SKF","loctite":"Loctite","tekbond":"Tekbond","adere":"Adere"}
MARKETPLACES = ("mercadolivre", "mercadolibre", "amazon", "shopee", "aliexpress", "magazineluiza", "americanas")


def detect_product_type(text: str) -> str:
    n = f" {norm(text)} "
    # Evita falso positivo: "flange" de cadeira/sofá/peça genérica não deve virar flange industrial.
    if re.search(r"(?:^|\s)flange(?=$|\s)", n) and not re.search(r"\b(?:aco|inox|aluminio|dn|ansi|npt|rosca|tubo|solda|industrial|alta pressao|valvula|conexao)\b", n):
        return ""
    # A abreviação curta só vale com limite de palavra, evitando casar com "chata".
    if re.search(r"(?:^|\s)ch\.?\s", n):
        return "chapa"
    for key, aliases in TYPE_ALIASES:
        for alias in aliases:
            if re.search(rf"(?:^|\s){re.escape(norm(alias))}(?=$|\s)", n):
                return key
    return ""


def detect_material(text: str) -> str:
    n = norm(text)
    if re.search(r"\b(?:inox|stainless)\b", n): return "inox"
    if re.search(r"\b(?:aluminio|al\.)\b", n): return "aluminio"
    if re.search(r"\b(?:aco carbono|carbon steel)\b", n): return "aco_carbono"
    if re.search(r"\bpvc\b", n): return "pvc"
    if re.search(r"\bborracha\b", n): return "borracha"
    if re.search(r"\b(?:latao|bronze|cobre|nylon)\b", n): return re.search(r"\b(latao|bronze|cobre|nylon)\b", n).group(1)
    return ""


def detect_alloys(text: str) -> List[str]:
    n = norm(text)
    values = re.findall(r"\b(?:aisi\s*)?f?(304l?|316l?|201|202|310s?|321|409|410|420|430|440|1010|1018|1020|1045|4140|4340|8620|a36|3003|4043|5052f?|6061|6063|7075|2024)\b", n, flags=re.I)
    return list(dict.fromkeys(v.upper() for v in values))


def fraction_number(raw: str) -> Optional[float]:
    value = clean(raw).replace(",", ".")
    match = re.fullmatch(r"(\d+)[.\s](\d+)/(\d+)", value)
    if match: return float(match.group(1)) + float(match.group(2)) / float(match.group(3))
    match = re.fullmatch(r"(\d+)/(\d+)", value)
    if match: return float(match.group(1)) / float(match.group(2))
    try: return float(value)
    except ValueError: return None


def to_mm(value: str, unit: str) -> Optional[float]:
    number = fraction_number(value)
    if number is None: return None
    u = norm(unit)
    if u in {'"', "pol", "inch"}: return number * 25.4
    if u == "cm": return number * 10
    if u in {"m", "mt"}: return number * 1000
    if u in {"mm", ""}: return number
    return None


def parse_dimensions(text: str) -> List[Dict[str, Any]]:
    raw = clean(text).replace("×", " x ").replace("“", '"').replace("”", '"')
    # Não confundir liga, marca 3M ou rosca M8 com unidades de medida.
    raw = re.sub(r"\b(?:aisi\s*)?(?:f)?(?:304l?|316l?|201|202|310s?|321|409|410|420|430|440|1010|1018|1020|1045|4140|4340|8620|a36|3003|4043|5052f?|6061|6063|7075|2024)\b", " ", raw, flags=re.I)
    raw = re.sub(r"\bM\s*\d+(?:[.,]\d+)?\b", " ", raw, flags=re.I)
    raw = re.sub(r"\b3M[™®]?\b", " ", raw, flags=re.I)
    value = r"(?:\d+\s+\d+/\d+|\d+\.\d+/\d+|\d+/\d+|\d+(?:[.,]\d+)?)"
    unit = r"(?:mm|cm|mt|m|in|inch|pol|\")"
    found: List[Dict[str, Any]] = []
    pattern = re.compile(rf"(?<![A-Za-z0-9])({value})\s*({unit})?\s*x\s*({value})\s*({unit})?(?:\s*x\s*({value})\s*({unit})?)?(?![A-Za-z0-9])", re.I)
    covered: List[tuple[int,int]] = []
    for match in pattern.finditer(raw):
        covered.append(match.span())
        inherited = match.group(6) or match.group(4) or match.group(2) or ""
        for val, unt in ((match.group(1), match.group(2) or inherited),(match.group(3),match.group(4) or inherited),(match.group(5),match.group(6) or inherited)):
            if not val: continue
            mm = to_mm(val, unt)
            if mm is not None: found.append({"raw": clean(f"{val} {unt}"), "value_mm": round(mm,4)})
    single = re.compile(rf"(?<![A-Za-z0-9])({value})\s*({unit})(?![A-Za-z0-9])", re.I)
    for match in single.finditer(raw):
        if any(a <= match.start() and match.end() <= b for a,b in covered): continue
        if match.group(1) == "3" and match.group(2).lower() == "m" and re.search(r"3M[™®]?", raw[max(0, match.start()-1):match.end()+2]): continue
        mm = to_mm(match.group(1), match.group(2))
        if mm is not None: found.append({"raw": clean(f"{match.group(1)} {match.group(2)}"), "value_mm": round(mm,4)})
    output: List[Dict[str, Any]] = []
    for item in found:
        if not any(abs(item["value_mm"] - old["value_mm"]) < .001 for old in output): output.append(item)
    return output


def canonical_label(label: str) -> str:
    n = norm(label)
    mappings = (("Largura",r"largura|width"),("Comprimento",r"comprimento|length"),("Espessura",r"espessura|thickness"),("Diâmetro",r"diametro|diameter"),("Altura",r"altura|height"),("Peso / capacidade",r"peso|weight|capacidade"),("Cor",r"cor|color"),("Liga",r"liga|alloy"),("Rosca",r"rosca|thread"),("Schedule",r"schedule|\bsch\b"),("Medida",r"medida|dimension|size"))
    for canonical, regex in mappings:
        if re.search(regex,n): return canonical
    return clean(label) or "Característica"


def add_spec(specs: List[Dict[str, Any]], label: str, value: Any, confidence: str = "alta", evidence: str = "texto da fonte") -> None:
    label, value = canonical_label(label), clean(value)
    if not value: return
    for current in specs:
        if norm(current.get("label")) != norm(label): continue
        if norm(current.get("value")) == norm(value): return
        a, b = parse_dimensions(current.get("value", "")), parse_dimensions(value)
        if a and b and len(a) == len(b) and all(abs(x["value_mm"]-y["value_mm"]) <= max(.25, x["value_mm"]*.015) for x,y in zip(a,b)): return
        if label in {"Largura","Comprimento","Espessura","Diâmetro","Liga","Rosca"}: return
    specs.append({"label": label, "value": value, "confidence": confidence, "evidence": evidence})


def extract_specs_from_text(text: str, product_type: str = "") -> List[Dict[str, Any]]:
    n = norm(text)
    ptype = product_type or detect_product_type(text)
    specs: List[Dict[str, Any]] = []
    material = detect_material(text)
    if material: add_spec(specs,"Material","Aço inoxidável" if material=="inox" else material.replace("_"," "))
    alloys = detect_alloys(text)
    if alloys: add_spec(specs,"Liga",", ".join(alloys))
    schedule = re.search(r"\b(?:sch|schedule)\s*(\d+)\b", n)
    if schedule: add_spec(specs,"Schedule",f"SCH {schedule.group(1)}")
    thread = re.search(r"\b(npt|bspt?|unc|unf|m\s*\d+(?:[.,]\d+)?|dn\s*\d+)\b", n, re.I)
    if thread: add_spec(specs,"Rosca",clean(thread.group(1)).upper().replace(" ",""))
    protection = re.search(r"\bip\s*\d{2,3}\b", n, re.I)
    if protection: add_spec(specs,"Proteção",protection.group(0).upper().replace(" ",""))
    color = re.search(r"\b(preto|preta|prata|branco|branca|azul|amarelo|amarela|verde|vermelho|vermelha|cinza|marrom|transparente)\b", n)
    if color: add_spec(specs,"Cor",color.group(1))
    dimensions = parse_dimensions(text)
    if len(dimensions)>=2:
        if ptype=="fita":
            add_spec(specs,"Largura",dimensions[0]["raw"]); add_spec(specs,"Comprimento",dimensions[1]["raw"])
        elif ptype=="chapa":
            if len(dimensions)>=3:
                add_spec(specs,"Espessura",dimensions[0]["raw"]); add_spec(specs,"Comprimento",dimensions[1]["raw"]); add_spec(specs,"Largura",dimensions[2]["raw"])
            else:
                add_spec(specs,"Comprimento",dimensions[0]["raw"]); add_spec(specs,"Largura",dimensions[1]["raw"])
        elif ptype in {"barra_chata","cantoneira"}:
            add_spec(specs,"Largura",dimensions[0]["raw"]); add_spec(specs,"Espessura",dimensions[1]["raw"])
            if len(dimensions)>2: add_spec(specs,"Comprimento",dimensions[2]["raw"])
        else:
            add_spec(specs,"Medida"," × ".join(item["raw"] for item in dimensions[:3]))
    elif len(dimensions)==1:
        if ptype=="parafuso" and thread: add_spec(specs,"Comprimento",dimensions[0]["raw"])
        else: add_spec(specs,"Medida",dimensions[0]["raw"])
    return specs


def validate_gtin(value: str) -> bool:
    digits = re.sub(r"\D", "", value or "")
    if len(digits) not in {8,12,13,14}: return False
    body = list(map(int, digits[:-1]))[::-1]
    checksum = (10 - sum(d*(3 if i%2==0 else 1) for i,d in enumerate(body)) % 10) % 10
    return checksum == int(digits[-1])


def clean_title(title: str) -> str:
    value = clean(title).replace("™", "").replace("®", "").replace("©", "")
    value = re.sub(r"\s*[|｜]\s*[^|]{2,90}$", "", value)
    value = re.sub(r"\s[-–—]\s(?:Amazon(?:\.com\.br)?|Mercado\s*Livre|Loja\s*Oficial)\s*$", "", value, flags=re.I)
    return clean(value)


def infer_manufacturer(text: str, explicit: str = "") -> str:
    if clean(explicit): return clean(explicit)
    n = norm(text)
    for key, display in KNOWN_MANUFACTURERS.items():
        if re.search(rf"\b{re.escape(key)}\b", n): return display
    return ""


def infer_unit(product_type: str, text: str, specs: List[Dict[str, Any]]) -> tuple[str,str,str]:
    n = norm(text + " " + " ".join(f"{s.get('label')} {s.get('value')}" for s in specs))
    explicit = ((r"\b(?:rolo|bobina)\b","rolo"),(r"\b(?:caixa|cx)\b","cx"),(r"\b(?:pacote|pct)\b","pct"),(r"\bpar\b","par"),(r"\bkg\b","kg"),(r"\bm2|m²\b","m²"))
    for regex, unit in explicit:
        if re.search(regex,n): return unit,"alta","informado no texto"
    defaults = {"fita":"rolo","cabo":"m","mangueira":"m","arame":"kg","tela":"m²","chapa":"un","barra_chata":"un","tubo":"un","parafuso":"un","porca":"un","arruela":"un","rebite":"un"}
    value = defaults.get(product_type,"un")
    confidence = "média" if product_type in {"fita","parafuso","porca","arruela","rebite"} else "baixa"
    return value,confidence,"inferido pelo tipo do material"


def source_classification(host: str, product: Dict[str, Any], manufacturer: str, seller: str) -> str:
    compact = re.sub(r"[^a-z0-9]", "", norm(host))
    if any(market in compact for market in MARKETPLACES): return "marketplace"
    if seller: return "retailer"
    if manufacturer:
        m = re.sub(r"[^a-z0-9]", "", norm(manufacturer))
        if m and (m in compact or compact in {"scotchbrandcombr","3mcombr","3mcom"}): return "manufacturer"
    if product.get("manufacturer") or product.get("brand"): return "manufacturer"
    return "reference"


def product_nodes_from_html(soup: BeautifulSoup) -> List[Dict[str, Any]]:
    nodes: List[Dict[str, Any]] = []
    for script in soup.select('script[type="application/ld+json"]'):
        try:
            raw = script.string or script.get_text(" ", strip=True)
            data = json.loads(raw)
        except Exception:
            continue
        for node in flatten_jsonld(data):
            if any(t.endswith("product") or t == "product" for t in type_values(node)):
                nodes.append(node)
    return nodes


def property_specs(node: Dict[str, Any]) -> List[Dict[str, Any]]:
    result: List[Dict[str, Any]] = []
    raw = node.get("additionalProperty") or node.get("additionalProperties") or []
    if isinstance(raw, dict): raw = [raw]
    for prop in raw if isinstance(raw,list) else []:
        if not isinstance(prop,dict): continue
        label = first_text(prop.get("name") or prop.get("propertyID"))
        value = first_text(prop.get("value") or prop.get("valueReference"))
        if label and value: add_spec(result,label,value,"alta","campo estruturado da página")
    for key,label in (("width","Largura"),("height","Altura"),("depth","Comprimento"),("weight","Peso / capacidade"),("color","Cor"),("size","Medida")):
        if node.get(key): add_spec(result,label,first_text(node.get(key)),"alta","campo estruturado da página")
    return result


def seller_from_offers(offers: Any) -> str:
    values = offers if isinstance(offers,list) else [offers] if isinstance(offers,dict) else []
    for offer in values:
        if not isinstance(offer,dict): continue
        seller = first_text(offer.get("seller") or offer.get("offeredBy"))
        if seller: return seller
    return ""


def price_from_offers(offers: Any) -> Optional[float]:
    values = offers if isinstance(offers,list) else [offers] if isinstance(offers,dict) else []
    for offer in values:
        if not isinstance(offer,dict): continue
        price_val = offer.get("price")
        if price_val is not None:
            try:
                p = float(str(price_val).replace(",", ".").strip())
                if p > 0: return p
            except ValueError:
                pass
    return None


def extract_price_from_soup(soup: BeautifulSoup) -> Optional[float]:
    for meta in (
        soup.find("meta", property="product:price:amount"),
        soup.find("meta", property="og:price:amount"),
        soup.find("meta", property="price"),
        soup.find("meta", attrs={"name": "twitter:data1"}),
    ):
        if meta and meta.get("content"):
            try:
                val = re.sub(r"[^\d.,]", "", meta.get("content"))
                val = val.replace(",", ".")
                p = float(val)
                if p > 0: return p
            except ValueError:
                pass
    return None


def extract_product_from_html(html: str, url: str) -> Dict[str, Any]:
    soup = BeautifulSoup(html, "html.parser")
    host = urlparse(url).hostname or ""
    nodes = product_nodes_from_html(soup)
    node = nodes[0] if nodes else {}

    title_tag = soup.find("meta", property="og:title") or soup.find("title")
    fallback_title = title_tag.get("content","") if title_tag and title_tag.name=="meta" else (title_tag.get_text(" ",strip=True) if title_tag else "")
    description_tag = soup.find("meta", property="og:description") or soup.find("meta", attrs={"name":"description"})
    fallback_description = description_tag.get("content","") if description_tag else ""

    raw_name = clean(node.get("name") or fallback_title)
    description = clean(node.get("description") or fallback_description)
    if not raw_name:
        raise ValueError("A página não informou o nome do produto.")

    manufacturer_node = node.get("manufacturer")
    brand_node = node.get("brand")
    manufacturer = infer_manufacturer(f"{raw_name} {description}", first_text(manufacturer_node))
    raw_brand = first_text(brand_node)
    product_line = ""
    if raw_brand:
        if not manufacturer and norm(raw_brand) in KNOWN_MANUFACTURERS: manufacturer = KNOWN_MANUFACTURERS[norm(raw_brand)]
        elif manufacturer and norm(raw_brand) != norm(manufacturer): product_line = raw_brand
        elif not manufacturer: product_line = raw_brand
    if not product_line and re.search(r"\bscotch\b", raw_name, re.I): product_line = "Scotch"

    product_type = detect_product_type(f"{raw_name} {description}")
    specs = property_specs(node)
    for spec in extract_specs_from_text(f"{raw_name} {description}", product_type):
        add_spec(specs,spec["label"],spec["value"],spec.get("confidence","média"),spec.get("evidence","texto da fonte"))

    manufacturer_code = clean(node.get("mpn") or node.get("model") or node.get("sku"))
    gtin = ""
    for key in ("gtin14","gtin13","gtin12","gtin8","gtin","ean"):
        value = re.sub(r"\D", "", clean(node.get(key)))
        if value and validate_gtin(value): gtin = value; break
    seller = seller_from_offers(node.get("offers"))
    price = price_from_offers(node.get("offers"))
    if price is None:
        price = extract_price_from_soup(soup)
    source_type = source_classification(host,node,manufacturer,seller)
    unit, unit_confidence, unit_evidence = infer_unit(product_type,raw_name,specs)

    product_name = clean_title(raw_name)
    if product_type=="fita" and re.search(r"silver\s*tape", raw_name, re.I): product_name = "Fita Silver Tape"
    parts = [product_name]
    if product_line and norm(product_line) not in norm(product_name): parts.append(product_line)
    if manufacturer and norm(manufacturer) not in norm(product_name): parts.append(manufacturer)
    width = next((s["value"] for s in specs if s["label"]=="Largura"),"")
    length = next((s["value"] for s in specs if s["label"]=="Comprimento"),"")
    measure = next((s["value"] for s in specs if s["label"]=="Medida"),"")
    dimension_title = f"{width} × {length}" if width and length else measure
    canonical = clean(" ".join(parts))
    if dimension_title and norm(dimension_title) not in norm(canonical): canonical += f" — {dimension_title}"

    confidence = {
        "name":"alta","manufacturer":"alta" if manufacturer_node else ("média" if manufacturer else "baixa"),
        "brand":"alta" if raw_brand else ("média" if product_line else "baixa"),
        "product_type":"alta" if product_type else "baixa","manufacturer_code":"alta" if manufacturer_code else "baixa",
        "gtin":"alta" if gtin else "baixa","unit":unit_confidence,"specs":"alta" if node else "média",
    }
    return {
        "success":True,"structured":bool(node),"name":canonical,"raw_name":raw_name,"canonical_name":canonical,
        "product_name":product_name,"product_type":product_type,"product_type_label":TYPE_LABELS.get(product_type,""),
        "manufacturer":manufacturer,"brand":product_line,"product_line":product_line,"model":manufacturer_code,
        "manufacturer_code":manufacturer_code,"gtin":gtin,"unit":unit,"unit_confidence":unit_confidence,
        "unit_evidence":unit_evidence,"specs":specs,"description":description[:600],"url":url,"source_name":host,
        "source_type":source_type,"seller":seller,"supplier_suggestion":seller if source_type in {"marketplace","retailer","distributor"} else "",
        "current_price":price,"price":price,
        "field_confidence":confidence,
    }


def tesseract_available() -> bool:
    try:
        command = getattr(pytesseract.pytesseract,"tesseract_cmd","tesseract")
        return bool(shutil.which(command) or os.path.isfile(command))
    except Exception:
        return False


def tesseract_languages() -> List[str]:
    if not tesseract_available():
        return []
    try:
        return sorted(str(x) for x in pytesseract.get_languages(config="") if x)
    except Exception:
        return []


def tesseract_lang_argument() -> Optional[str]:
    languages = set(tesseract_languages())
    preferred = [lang for lang in ("por", "eng") if lang in languages]
    return "+".join(preferred) if preferred else None


def monetary_values(text: str) -> List[float]:
    # O limite à esquerda/direita impede capturar 234,56 dentro de 1.234,56.
    pattern = r"(?<![\d.])(?:R\$\s*)?(\d{1,3}(?:\.\d{3})+,\d{2}|\d+[.,]\d{2})(?!\d)"
    result: List[float] = []
    for raw in re.findall(pattern,text or "",flags=re.I):
        value = raw.replace(".","").replace(",",".") if "," in raw else raw
        try:
            number = round(float(value),4)
            if 0 < number < 1_000_000_000 and number not in result: result.append(number)
        except ValueError: pass
    return sorted(result)



def optional_paddleocr_available() -> bool:
    try:
        import importlib.util
        return importlib.util.find_spec("paddleocr") is not None
    except Exception:
        return False


def searxng_candidate_urls() -> List[str]:
    values = [
        os.getenv("SEARXNG_URL", "").strip().rstrip("/"),
        SEARXNG_URL,
        "http://localhost:8088",
        "http://localhost:8080",
    ]
    result: List[str] = []
    for value in values:
        if value and value not in result:
            result.append(value)
    return result


BAD_SEARCH_QUERIES = {"[object object]", "object object", "undefined", "null", "none", "[object]", ""}
BLOCKED_REFERENCE_DOMAINS = {
    "stackoverflow.com",
    "developer.mozilla.org",
    "developer.mozilla.org",
    "w3schools.com",
    "freecodecamp.org",
    "geeksforgeeks.org",
    "github.com",
    "gitlab.com",
    "npmjs.com",
    "python.org",
    "microsoft.com",
    "learn.microsoft.com",
}
INDUSTRIAL_HINTS = {
    "aco", "inox", "inoxidavel", "aisi", "chapa", "tubo", "barra", "cantoneira", "flange",
    "parafuso", "porca", "arruela", "rebite", "bucha", "valvula", "conexao", "niple",
    "cotovelo", "eletroduto", "tomada", "plugue", "cabo", "mangueira", "rolamento",
    "retentor", "tigre", "weg", "tramontina", "3m", "scotch", "316", "316l", "304", "304l",
    "1020", "1045", "a36", "galvanizado", "carbono", "pvc", "mm", "pol"
}
PREFERRED_REFERENCE_TERMS = {
    "catalogo", "catálogo", "ficha", "tecnica", "técnica", "datasheet", "produto",
    "industrial", "aco", "aço", "inox", "fornecedor", "distribuidor", "fabricante",
    "metal", "metais", "siderurgica", "siderúrgica", "parafuso", "ferragem", "chapa"
}


def search_query_text(value: Any) -> str:
    if isinstance(value, dict):
        value = value.get("query") or value.get("q") or ""
    query = clean(str(value or ""))
    if norm(query) in BAD_SEARCH_QUERIES:
        raise HTTPException(status_code=400, detail="Consulta de pesquisa inválida.")
    return query


def source_hostname(url: str) -> str:
    try:
        return (urlparse(url).hostname or "").lower().removeprefix("www.")
    except Exception:
        return ""


def is_blocked_reference(url: str) -> bool:
    host = source_hostname(url)
    return any(host == domain or host.endswith("." + domain) for domain in BLOCKED_REFERENCE_DOMAINS)


def industrial_query_score(query: str, item: Dict[str, str]) -> int:
    text = norm(" ".join([query, item.get("title", ""), item.get("snippet", ""), source_hostname(item.get("url", ""))]))
    q_tokens = {x for x in re.findall(r"[a-z0-9]+", norm(query)) if len(x) > 1}
    item_tokens = {x for x in re.findall(r"[a-z0-9]+", text) if len(x) > 1}
    score = 0
    score += 12 * len(q_tokens & item_tokens)
    score += 18 * len(item_tokens & INDUSTRIAL_HINTS)
    score += 8 * len(item_tokens & {norm(x) for x in PREFERRED_REFERENCE_TERMS})
    host = source_hostname(item.get("url", ""))
    if any(word in host for word in ("metal", "aco", "inox", "ferr", "paraf", "industrial", "catalogo")):
        score += 18
    if is_blocked_reference(item.get("url", "")):
        score -= 500
    return score


def filter_and_rank_search_results(query: str, results: List[Dict[str, str]]) -> List[Dict[str, str]]:
    industrial_query = bool(set(re.findall(r"[a-z0-9]+", norm(query))) & INDUSTRIAL_HINTS)
    ranked: List[tuple[int, Dict[str, str]]] = []
    for item in results:
        if not item.get("url") or not item.get("title"):
            continue
        if is_blocked_reference(item["url"]):
            continue
        score = industrial_query_score(query, item)
        if industrial_query and score < 18:
            continue
        enriched = dict(item)
        enriched["source_host"] = source_hostname(item["url"])
        enriched["confidence"] = "alta" if score >= 70 else "média" if score >= 38 else "baixa"
        ranked.append((score, enriched))
    ranked.sort(key=lambda x: x[0], reverse=True)
    return [item for _, item in ranked]


def internal_search_candidates(query: str, limit: int = 6) -> List[Dict[str, Any]]:
    if not sqlite_search or not os.path.exists(default_sqlite_path()):
        return []
    try:
        rows = sqlite_search(default_sqlite_path(), query, limit)
    except Exception:
        return []
    candidates: List[Dict[str, Any]] = []
    for row in rows[:limit]:
        name = clean(row.get("name"))
        if not name:
            continue
        candidates.append({
            "name": name,
            "canonical_name": name,
            "title": name,
            "description": clean(row.get("snippet", "")),
            "source_name": "Base demonstrativa",
            "source_type": "internal",
            "url": "",
            "product_id": row.get("id"),
            "code": row.get("code") or "",
            "family": row.get("family") or "",
            "supplier_suggestion": row.get("current_supplier_name") or "",
            "current_price": row.get("current_price"),
            "current_supplier_name": row.get("current_supplier_name") or "",
            "current_date": row.get("current_date") or "",
            "field_confidence": {"name": "alta", "product_type": "alta"},
        })
    return candidates


def extract_search_results_from_html(html: str, base_url: str) -> List[Dict[str, str]]:
    soup = BeautifulSoup(html, "html.parser")
    results: List[Dict[str, str]] = []
    selectors = [".result", "article.result", ".result-default", ".web-result"]
    nodes = []
    for selector in selectors:
        nodes = soup.select(selector)
        if nodes:
            break
    for node in nodes[:8]:
        anchor = node.select_one("a[href] h3")
        if anchor and anchor.parent:
            anchor = anchor.parent
        if not anchor:
            anchor = node.select_one("h3 a[href], a.result__a[href], a[href]")
        if not anchor or not anchor.get("href"):
            continue
        snippet = node.select_one(".content, .result-content, .result__snippet, p")
        title = clean(anchor.get_text(" ", strip=True))
        url = urljoin(base_url, anchor.get("href"))
        if title and url:
            results.append({"title": title, "url": url, "snippet": clean(snippet.get_text(" ", strip=True) if snippet else "")[:300]})
    return results


async def search_with_searxng(client: httpx.AsyncClient, base_url: str, query: str) -> List[Dict[str, str]]:
    try:
        response = await client.get(f"{base_url}/search", params={"q": query, "format": "json", "language": "pt-BR"})
        if response.status_code == 200:
            data = response.json()
            if isinstance(data, dict):
                output: List[Dict[str, str]] = []
                for item in data.get("results", [])[:8]:
                    url = clean(item.get("url"))
                    title = clean(item.get("title"))
                    if url and title:
                        output.append({"title": title, "url": url, "snippet": clean(item.get("content"))[:300]})
                if output:
                    return output
    except Exception:
        pass
    try:
        response = await client.get(f"{base_url}/search", params={"q": query, "language": "pt-BR"}, follow_redirects=True)
        if response.status_code == 200:
            return extract_search_results_from_html(response.text, str(response.url))
    except Exception:
        pass
    return []


def supplier_key(value: str) -> str:
    value = norm(value)
    value = re.sub(r"\b(ltda|eireli|epp|me|sa|s/a|comercio|comercial|industria|industrial|materiais|ferragens|ferramentas|distribuidora|distribuicao)\b", " ", value)
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]+", " ", value)).strip()


def supplier_similarity(a: str, b: str) -> int:
    ka, kb = supplier_key(a), supplier_key(b)
    if not ka or not kb:
        return 0
    if ka == kb:
        return 100
    return round(100 * difflib.SequenceMatcher(None, ka, kb).ratio())


def parse_date(value: str) -> Optional[datetime]:
    try:
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(value or "")):
            return datetime.fromisoformat(str(value) + "T12:00:00")
    except Exception:
        return None
    return None


def offer_price(offer: Dict[str, Any]) -> float:
    try:
        value = float(offer.get("finalPrice") or offer.get("price") or 0)
        return value if value > 0 else 0.0
    except Exception:
        return 0.0


def sorted_price_offers(product: Dict[str, Any]) -> List[Dict[str, Any]]:
    offers = [o for o in product.get("offers", []) if offer_price(o) > 0]
    return sorted(offers, key=lambda o: str(o.get("updatedAt") or ""), reverse=True)


def price_audit_rows(products: List[Dict[str, Any]], threshold_pct: float, stale_days: int) -> Dict[str, Any]:
    alerts: List[Dict[str, Any]] = []
    stale: List[Dict[str, Any]] = []
    no_price: List[Dict[str, Any]] = []
    today = datetime.now()
    for product in products:
        offers = sorted_price_offers(product)
        if not offers:
            no_price.append({"id": product.get("id"), "name": product.get("name"), "reason": "sem preço"})
            continue
        current = offers[0]
        date = parse_date(current.get("updatedAt"))
        if date and (today - date).days > stale_days:
            stale.append({"id": product.get("id"), "name": product.get("name"), "days": (today - date).days, "current": current})
        if len(offers) >= 2:
            previous = offers[1]
            cur, prev = offer_price(current), offer_price(previous)
            if prev > 0:
                delta = ((cur - prev) / prev) * 100
                if abs(delta) >= threshold_pct:
                    alerts.append({"id": product.get("id"), "name": product.get("name"), "delta_pct": round(delta, 2), "current": current, "previous": previous})
    alerts.sort(key=lambda x: abs(x["delta_pct"]), reverse=True)
    return {"alerts": alerts[:100], "stale": stale[:200], "no_price": no_price[:200], "summary": {"alerts": len(alerts), "stale": len(stale), "no_price": len(no_price)}}


def duplicate_codes(products: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    seen: Dict[str, List[Dict[str, Any]]] = {}
    for product in products:
        raw_codes = [product.get("code"), product.get("manufacturerCode"), product.get("gtin"), *(product.get("externalCodes") or [])]
        for code in {norm(x) for x in raw_codes if norm(x) and len(norm(x)) >= 3}:
            seen.setdefault(code, []).append({"id": product.get("id"), "name": product.get("name")})
    return [{"code": code, "products": rows, "count": len(rows)} for code, rows in seen.items() if len(rows) > 1][:100]


def supplier_dedupe_rows(suppliers: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    for i, a in enumerate(suppliers):
        for b in suppliers[i + 1:]:
            score = supplier_similarity(str(a.get("name", "")), str(b.get("name", "")))
            if score >= 88:
                rows.append({"a": a, "b": b, "score": score})
    return sorted(rows, key=lambda x: x["score"], reverse=True)[:100]

def validate_public_url(url: str) -> str:
    parsed = urlparse(clean(url))
    if parsed.scheme not in {"http","https"} or not parsed.hostname:
        raise HTTPException(status_code=400,detail="Use uma URL http ou https válida.")
    host = parsed.hostname.lower().rstrip(".")
    if host in {"localhost","localhost.localdomain"}:
        raise HTTPException(status_code=400,detail="Endereços locais não podem ser consultados.")
    try:
        infos = socket.getaddrinfo(host,parsed.port or (443 if parsed.scheme=="https" else 80),type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise HTTPException(status_code=400,detail="O endereço informado não pôde ser resolvido.") from exc
    for info in infos:
        if not ipaddress.ip_address(info[4][0]).is_global:
            raise HTTPException(status_code=400,detail="Endereços privados ou internos não podem ser consultados.")
    return parsed.geturl()


async def fetch_public_html(url: str, headers: Dict[str,str]) -> tuple[str,str]:
    current = validate_public_url(url)
    async with httpx.AsyncClient(headers=headers,timeout=httpx.Timeout(15,connect=5),follow_redirects=False) as client:
        for _ in range(4):
            response = await client.get(current)
            if response.status_code in {301,302,303,307,308}:
                target = response.headers.get("location")
                if not target: raise HTTPException(status_code=502,detail="Redirecionamento inválido na fonte.")
                current = validate_public_url(urljoin(current,target)); continue
            if response.status_code != 200: raise HTTPException(status_code=response.status_code,detail="Não foi possível carregar a página.")
            if "html" not in response.headers.get("content-type","").lower(): raise HTTPException(status_code=415,detail="A fonte não retornou uma página HTML.")
            raw = response.content[:MAX_HTML_BYTES+1]
            if len(raw)>MAX_HTML_BYTES: raise HTTPException(status_code=413,detail="A página é grande demais para análise.")
            return raw.decode(response.encoding or "utf-8",errors="replace"),current
    raise HTTPException(status_code=400,detail="A página redirecionou muitas vezes.")


@app.get("/backend/info")
def home() -> Dict[str,Any]:
    available = tesseract_available()
    return {"status":"online","app":"ProcureFlow Backend","version":APP_VERSION,"tesseract_available":available,"tesseract_loaded":available}


@app.get("/health")
def health() -> Dict[str, Any]:
    available = tesseract_available()
    return {
        "status": "online",
        "app": "ProcureFlow Backend",
        "version": APP_VERSION,
        "ocr": {
            "tesseract_available": available,
            "tesseract_lang": tesseract_lang_argument(),
            "paddleocr_available": optional_paddleocr_available(),
            "recommended_stack": "PaddleOCR/PP-OCRv5 opcional para OCR pesado; Tesseract continua como fallback leve.",
        },
        "features": ["ocr", "search", "scrape", "match", "normalize", "supplier-dedupe", "price-audit", "catalog-audit"],
        "writeProtection": "demo-loopback" if DEMO_MODE and not ADMIN_TOKEN else "token-required",
    }


@app.get("/ocr/status")
def ocr_status() -> Dict[str, Any]:
    return {
        "tesseract_available": tesseract_available(),
        "tesseract_languages": tesseract_languages(),
        "tesseract_lang": tesseract_lang_argument(),
        "paddleocr_available": optional_paddleocr_available(),
        "max_image_mb": MAX_IMAGE_BYTES // (1024 * 1024),
        "max_pixels": MAX_IMAGE_PIXELS,
    }


@app.post("/normalize/material")
def normalize_material(req: MaterialNormalizeRequest) -> Dict[str, Any]:
    product_type = detect_product_type(req.text)
    specs = extract_specs_from_text(req.text, product_type)
    unit, unit_confidence, unit_evidence = infer_unit(product_type, req.text, specs)
    return {
        "ok": True,
        "input": clean(req.text),
        "normalized": norm(req.text),
        "product_type": product_type,
        "product_type_label": TYPE_LABELS.get(product_type, product_type),
        "material": detect_material(req.text),
        "alloys": detect_alloys(req.text),
        "specs": specs,
        "unit": unit,
        "unit_confidence": unit_confidence,
        "unit_evidence": unit_evidence,
    }


@app.post("/supplier/dedupe")
def supplier_dedupe(req: SupplierDedupeRequest) -> Dict[str, Any]:
    rows = supplier_dedupe_rows(req.suppliers)
    return {"ok": True, "count": len(rows), "candidates": rows}


@app.post("/price/audit")
def price_audit(req: PriceAuditRequest) -> Dict[str, Any]:
    return price_audit_rows(req.products, req.threshold_pct, req.stale_days)


@app.post("/catalog/audit")
def catalog_audit(req: CatalogAuditRequest) -> Dict[str, Any]:
    price = price_audit_rows(req.products, req.threshold_pct, req.stale_days)
    supplier_dupes = supplier_dedupe_rows(req.suppliers)
    code_dupes = duplicate_codes(req.products)
    total = max(1, len(req.products))
    score = round(max(0, 100 - (price["summary"]["no_price"] / total) * 45 - (price["summary"]["stale"] / total) * 35 - len(code_dupes) * 2 - len(supplier_dupes)))
    return {
        "version": APP_VERSION,
        "score": score,
        "summary": {
            "products": len(req.products),
            "suppliers": len(req.suppliers),
            "price_alerts": price["summary"]["alerts"],
            "stale": price["summary"]["stale"],
            "no_price": price["summary"]["no_price"],
            "duplicate_codes": len(code_dupes),
            "supplier_dupes": len(supplier_dupes),
        },
        "price": price,
        "duplicate_codes": code_dupes,
        "supplier_dupes": supplier_dupes,
    }


@app.post("/ocr/extract")
async def extract_ocr(file: UploadFile = File(...)) -> Dict[str,Any]:
    if not tesseract_available(): raise HTTPException(status_code=503,detail="O leitor OCR não está instalado neste computador.")
    if file.content_type and not file.content_type.startswith("image/"): raise HTTPException(status_code=415,detail="Envie uma imagem JPG, PNG ou WEBP.")
    content = await file.read(MAX_IMAGE_BYTES+1)
    if len(content)>MAX_IMAGE_BYTES: raise HTTPException(status_code=413,detail="A imagem é grande demais. O limite é 10 MB.")
    try:
        image = Image.open(io.BytesIO(content)); image.load()
        if image.width*image.height>MAX_IMAGE_PIXELS: raise HTTPException(status_code=413,detail="A resolução da imagem é grande demais.")
        image = ImageOps.exif_transpose(image).convert("L")
        image = ImageEnhance.Contrast(image).enhance(1.8)
        lang = tesseract_lang_argument()
        text = pytesseract.image_to_string(image, lang=lang) if lang else pytesseract.image_to_string(image)
        values = monetary_values(text)
        return {"success":True,"text":clean(text)[:4000],"amounts":values,"suggested_amount":max(values) if values else None,"ocr_lang":lang}
    except HTTPException: raise
    except Exception as exc:
        logger.exception("Falha no OCR")
        raise HTTPException(status_code=422,detail="Não foi possível ler esta imagem.") from exc


@app.get("/search")
async def search_products(q: str = Query(...,min_length=3,max_length=180)) -> Dict[str,Any]:
    query = search_query_text(q)
    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36", "Accept-Language": "pt-BR,pt;q=0.9"}
    results: List[Dict[str,str]] = []
    internal_candidates = internal_search_candidates(query, 6)
    # Primeiro tenta instâncias SearXNG já ativas/configuradas. Se a API JSON estiver bloqueada,
    # aproveita o HTML do próprio SearXNG antes de cair para DuckDuckGo.
    async with httpx.AsyncClient(timeout=8,headers=headers) as client:
        for base_url in searxng_candidate_urls():
            results.extend(await search_with_searxng(client, base_url, query))
            if results:
                break
    if not results:
        try:
            async with httpx.AsyncClient(timeout=10,headers=headers,follow_redirects=True) as client:
                response=await client.get(f"https://html.duckduckgo.com/html/?q={quote_plus(query)}")
                if response.status_code==200:
                    soup=BeautifulSoup(response.text,"html.parser")
                    for node in soup.select(".result")[:8]:
                        anchor=node.select_one(".result__a"); snippet=node.select_one(".result__snippet")
                        if anchor and anchor.get("href"): results.append({"title":clean(anchor.get_text(" ",strip=True)),"url":urljoin(str(response.url),anchor.get("href")),"snippet":clean(snippet.get_text(" ",strip=True) if snippet else "")[:300]})
        except Exception:
            pass
    # Duplicação por URL removida para não mostrar cinco vezes a mesma página.
    dedup: Dict[str,Dict[str,str]]={}
    for item in filter_and_rank_search_results(query, results):
        dedup.setdefault(item["url"], item)
    ranked = list(dedup.values())[:6]
    return {"ok": True, "success": True, "query":query, "count": len(ranked), "results": ranked, "candidates": internal_candidates}


@app.post("/scrape")
async def scrape_url(req: ScrapeRequest) -> Dict[str,Any]:
    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36", "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.6"}
    html,final_url=await fetch_public_html(req.url,headers)
    try: return extract_product_from_html(html,final_url)
    except ValueError as exc: raise HTTPException(status_code=422,detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Falha ao extrair %s",final_url)
        raise HTTPException(status_code=422,detail="Não foi possível estruturar as informações desta página.") from exc


def token_set(value: str) -> set[str]:
    return {x for x in re.findall(r"[a-z0-9]+",norm(value)) if len(x)>1}


def alloy_compatible(requested: str, found: str) -> bool:
    r,f=requested.upper(),found.upper()
    return r==f or (not r.endswith("L") and f==r+"L")


def candidate_score(query: str, candidate: Dict[str,Any]) -> tuple[int,List[str],List[str]]:
    qtype=detect_product_type(query); ctype=candidate.get("product_type") or detect_product_type(candidate.get("name",""))
    qmaterial=detect_material(query); cmaterial=detect_material(f"{candidate.get('name','')} {' '.join(str(x.get('value','')) for x in candidate.get('specs',[]))}")
    qalloys=detect_alloys(query); calloys=detect_alloys(f"{candidate.get('name','')} {' '.join(str(x.get('value','')) for x in candidate.get('specs',[]))}")
    matches: List[str]=[]; differences: List[str]=[]
    if qtype and ctype and qtype!=ctype: return 0,matches,[f"Tipo diferente: {TYPE_LABELS.get(ctype,ctype)}"]
    if qmaterial and cmaterial and qmaterial!=cmaterial: return 0,matches,["Material diferente"]
    if qalloys and calloys and not any(alloy_compatible(q,c) for q in qalloys for c in calloys): return 0,matches,[f"Liga diferente: {', '.join(calloys)}"]
    score=10
    if qtype and ctype: score+=30; matches.append(f"Tipo {TYPE_LABELS.get(ctype,ctype)}")
    if qmaterial and cmaterial: score+=18; matches.append("Material correspondente")
    if qalloys and calloys: score+=22; matches.append(f"Liga {', '.join(calloys)}")
    qtokens,ctokens=token_set(query),token_set(candidate.get("name",""))
    if qtokens or ctokens: score+=round(25*len(qtokens&ctokens)/max(1,len(qtokens|ctokens)))
    qdims,cdims=parse_dimensions(query),parse_dimensions(candidate.get("name","")+" "+" ".join(str(x.get("value","")) for x in candidate.get("specs",[])))
    if qdims:
        found=sum(any(abs(q["value_mm"]-c["value_mm"])<=max(.25,q["value_mm"]*.015) for c in cdims) for q in qdims)
        if cdims and found/len(qdims)<.6: return 0,matches,["Medida diferente"]
        score+=round(20*found/len(qdims));
        if found: matches.append(f"{found}/{len(qdims)} medidas")
    return max(0,min(100,score)),matches,differences


@app.post("/match")
def match_candidates(req: MatchRequest) -> Dict[str,Any]:
    results=[]
    for model in req.candidates:
        candidate=model.model_dump()
        candidate.update({k:v for k,v in (model.model_extra or {}).items()})
        # Garante a mesma estrutura mesmo quando o resultado veio de um adaptador antigo.
        candidate.setdefault("raw_name",candidate.get("name",""))
        candidate.setdefault("canonical_name",candidate.get("name",""))
        candidate.setdefault("manufacturer_code",candidate.get("model") or "")
        score,matches,differences=candidate_score(req.query,candidate)
        confidence="alta" if score>=75 else "média" if score>=45 else "baixa"
        candidate.update({"score":score,"confidence":confidence,"coincidences":matches,"differences":differences})
        results.append(candidate)
    results.sort(key=lambda x:(x["score"],x.get("source_type")=="manufacturer"),reverse=True)
    return {"query":req.query,"candidates":results,"results":results}


# ---------------------------------------------------------------------------
# Núcleo SQLite/FTS5 offline e servidor LAN — 2.2.0
# ---------------------------------------------------------------------------
def default_sqlite_path() -> str:
    return os.getenv(
        "PROCUREFLOW_SQLITE_DB",
        str(RUNTIME_DIR / "catalog.sqlite"),
    )


# ---------------------------------------------------------------------------
# Servidor central gratuito para o PC que fica ligado 24h
# ---------------------------------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent
ROOT_DIR = BASE_DIR.parent
APP_RENDERER_DIR = ROOT_DIR / "app" / "renderer"
RUNTIME_DIR = Path(os.getenv("PROCUREFLOW_RUNTIME_DIR", str(ROOT_DIR / ".runtime")))
DATA_DIR = RUNTIME_DIR
INITIAL_DATA_PATH = ROOT_DIR / "demo-data" / "seed.json"
SERVER_DATA_PATH = Path(os.getenv("PROCUREFLOW_DATA_JSON", str(RUNTIME_DIR / "catalog.json")))
BACKUP_DIR = Path(os.getenv("PROCUREFLOW_BACKUP_DIR", str(RUNTIME_DIR / "backups")))
DATA_LOCK = threading.RLock()
SQLITE_REBUILD_LOCK = threading.Lock()
SQLITE_REBUILD_STATUS: Dict[str, Any] = {"state": "idle", "lastOk": None, "lastError": None}



def _safe_label(label: str = "backup") -> str:
    label = re.sub(r"[^a-zA-Z0-9_.-]+", "-", clean(label or "backup"))[:60] or "backup"
    return label.strip("-._") or "backup"


def _load_json_file(path: Path) -> Dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _ensure_server_data() -> Path:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not SERVER_DATA_PATH.exists():
        seed = _load_json_file(INITIAL_DATA_PATH)
        seed["appVersion"] = APP_VERSION
        seed["schemaVersion"] = max(16, int(seed.get("schemaVersion") or 0))
        seed["serverMode"] = True
        seed["storageMode"] = "server-local"
        seed["revision"] = int(seed.get("revision") or 0)
        SERVER_DATA_PATH.write_text(json.dumps(seed, ensure_ascii=False, indent=2), encoding="utf-8")
    return SERVER_DATA_PATH


def _create_backup_unlocked(label: str, data: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    data = data if data is not None else _load_json_file(_ensure_server_data())
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    filename = f"{stamp}-{_safe_label(label)}.json"
    path = BACKUP_DIR / filename
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    backups = sorted(BACKUP_DIR.glob("*.json"), key=lambda x: x.stat().st_mtime, reverse=True)
    for old in backups[60:]:
        try:
            old.unlink()
        except OSError:
            pass
    return {"filename": filename, "label": label, "date": datetime.fromtimestamp(path.stat().st_mtime).isoformat(), "sizeBytes": path.stat().st_size, "manual": label == "manual"}


def _rebuild_sqlite_from_server_data() -> Dict[str, Any]:
    path = default_sqlite_path()
    if not sqlite_import_json:
        return {"ok": False, "warning": "sqlite_catalog.py não disponível"}
    return sqlite_import_json(str(_ensure_server_data()), path)


def _rebuild_sqlite_background() -> None:
    global SQLITE_REBUILD_STATUS
    if not SQLITE_REBUILD_LOCK.acquire(blocking=False):
        SQLITE_REBUILD_STATUS = {**SQLITE_REBUILD_STATUS, "state": "queued"}
        return
    def worker():
        global SQLITE_REBUILD_STATUS
        try:
            SQLITE_REBUILD_STATUS = {"state": "running", "lastOk": SQLITE_REBUILD_STATUS.get("lastOk"), "lastError": None}
            result = _rebuild_sqlite_from_server_data()
            SQLITE_REBUILD_STATUS = {"state": "idle", "lastOk": datetime.now().isoformat(), "lastError": None, "result": result}
        except Exception as exc:  # pragma: no cover - proteção operacional
            SQLITE_REBUILD_STATUS = {"state": "idle", "lastOk": SQLITE_REBUILD_STATUS.get("lastOk"), "lastError": str(exc)}
        finally:
            SQLITE_REBUILD_LOCK.release()
    threading.Thread(target=worker, name="procureflow-sqlite-rebuild", daemon=True).start()


def _save_server_data(data: Dict[str, Any], label: str = "antes-salvar", expected_revision: Optional[int] = None, force: bool = False) -> Dict[str, Any]:
    with DATA_LOCK:
        current = _load_json_file(_ensure_server_data())
        current_revision = int(current.get("revision") or 0)
        if expected_revision is None:
            try:
                expected_revision = int((data or {}).get("revision") or 0)
            except Exception:
                expected_revision = 0
        if not force and expected_revision is not None and expected_revision < current_revision:
            return {
                "ok": False,
                "conflict": True,
                "message": "A base mudou em outro computador antes deste salvamento.",
                "currentRevision": current_revision,
                "clientRevision": expected_revision,
                "current": current,
                "storage": {"mode": "server", "name": "servidor local 24h", "path": str(SERVER_DATA_PATH)},
            }
        _create_backup_unlocked(label, current)
        data = dict(data or {})
        if not isinstance(data.get("products"), list) or not isinstance(data.get("suppliers"), list):
            raise HTTPException(status_code=422, detail="Base inválida: produtos e fornecedores são obrigatórios.")
        data["appVersion"] = APP_VERSION
        data["schemaVersion"] = max(16, int(data.get("schemaVersion") or 0))
        data["serverMode"] = True
        data["storageMode"] = "server-local"
        data["revision"] = current_revision + 1
        data["updatedAt"] = datetime.now().isoformat()
        tmp = SERVER_DATA_PATH.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(tmp, SERVER_DATA_PATH)
        _rebuild_sqlite_background()
        return {"ok": True, "data": data, "sqlite": {"state": SQLITE_REBUILD_STATUS.get("state", "queued")}, "storage": {"mode": "server", "name": "servidor local 24h", "path": str(SERVER_DATA_PATH)}}


@app.get("/api/data")
def api_data_load(response: Response):
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    with DATA_LOCK:
        data = _load_json_file(_ensure_server_data())
    return {"ok": True, "data": data, "dataPath": str(SERVER_DATA_PATH), "version": APP_VERSION, "storage": {"mode": "server", "name": "servidor local 24h", "path": str(SERVER_DATA_PATH)}}


@app.post("/api/data")
def api_data_save(payload: Dict[str, Any], _: None = Depends(require_write_access)):
    data = payload.get("data") if isinstance(payload, dict) and "data" in payload else payload
    expected = payload.get("expectedRevision") if isinstance(payload, dict) else None
    force = bool(payload.get("force")) if isinstance(payload, dict) else False
    return _save_server_data(data, "antes-salvar", expected_revision=expected, force=force)


@app.post("/api/reset")
def api_reset(_: None = Depends(require_write_access)):
    with DATA_LOCK:
        current = _load_json_file(_ensure_server_data())
        _create_backup_unlocked("antes-reset", current)
        seed = _load_json_file(INITIAL_DATA_PATH)
        seed["appVersion"] = APP_VERSION
        seed["schemaVersion"] = max(16, int(seed.get("schemaVersion") or 0))
        seed["serverMode"] = True
        seed["storageMode"] = "server-local"
        seed["revision"] = int(current.get("revision") or 0) + 1
        seed["updatedAt"] = datetime.now().isoformat()
        tmp = SERVER_DATA_PATH.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(seed, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(tmp, SERVER_DATA_PATH)
        _rebuild_sqlite_background()
        return {"ok": True, "data": seed, "storage": {"mode": "server", "name": "servidor local 24h", "path": str(SERVER_DATA_PATH)}}


@app.post("/api/backups")
def api_backup(payload: Dict[str, Any] | None = None, _: None = Depends(require_write_access)):
    label = clean((payload or {}).get("label") or "manual")
    with DATA_LOCK:
        return {"ok": True, "backup": _create_backup_unlocked(label, _load_json_file(_ensure_server_data()))}


@app.get("/api/backups")
def api_backups():
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    backups = []
    files_with_mtime = []
    for path in BACKUP_DIR.glob("*.json"):
        try:
            files_with_mtime.append((path, path.stat().st_mtime))
        except FileNotFoundError:
            continue
    files_with_mtime.sort(key=lambda x: x[1], reverse=True)
    for path, mtime in files_with_mtime:
        try:
            size = path.stat().st_size
            backups.append({
                "filename": path.name,
                "label": path.name.split('-', 2)[-1].replace('.json','').replace('-', ' '),
                "date": datetime.fromtimestamp(mtime).isoformat(),
                "sizeBytes": size,
                "manual": "manual" in path.name.lower()
            })
        except FileNotFoundError:
            continue
    return {"ok": True, "backups": backups}


@app.post("/api/backups/{filename}/restore")
def api_backup_restore(filename: str, _: None = Depends(require_write_access)):
    if "/" in filename or "\\" in filename or not filename.endswith(".json"):
        raise HTTPException(status_code=400, detail="Nome de backup inválido.")
    path = BACKUP_DIR / filename
    if not path.exists():
        raise HTTPException(status_code=404, detail="Backup não encontrado.")
    data = _load_json_file(path)
    return _save_server_data(data, "antes-restaurar", force=True)


@app.delete("/api/backups/{filename}")
def api_backup_delete(filename: str, _: None = Depends(require_write_access)):
    if "/" in filename or "\\" in filename or not filename.endswith(".json"):
        raise HTTPException(status_code=400, detail="Nome de backup inválido.")
    path = BACKUP_DIR / filename
    if path.exists():
        path.unlink()
    return {"ok": True}


@app.get("/api/diagnostics")
def api_diagnostics():
    with DATA_LOCK:
        data = _load_json_file(_ensure_server_data())
    sqlite = {}
    try:
        sqlite = sqlite_audit(default_sqlite_path()) if sqlite_audit and os.path.exists(default_sqlite_path()) else {}
    except Exception as exc:
        sqlite = {"warning": str(exc)}
    return {
        "ok": True,
        "appVersion": APP_VERSION,
        "buildId": "220-20260702-servidor-cliente-multiusuario",
        "schemaVersion": data.get("schemaVersion"),
        "revision": data.get("revision"),
        "products": len(data.get("products") or []),
        "suppliers": len(data.get("suppliers") or []),
        "storage": {"mode": "server", "path": str(SERVER_DATA_PATH), "backupsPath": str(BACKUP_DIR)},
        "sqlite": sqlite,
        "sqliteRebuild": SQLITE_REBUILD_STATUS,
        "warnings": [],
    }


@app.post("/api/sqlite/rebuild")
def api_sqlite_rebuild(_: None = Depends(require_write_access)):
    with DATA_LOCK:
        return {"ok": True, "sqlite": _rebuild_sqlite_from_server_data()}



@app.get("/sqlite/info")
def sqlite_info():
    path = default_sqlite_path()
    available = bool(sqlite_search) and os.path.exists(path)
    detail = {"available": available, "path": path, "mode": "offline-local", "paidApis": False, "externalLimits": False}
    if available and sqlite_audit:
        try:
            detail["audit"] = sqlite_audit(path)
        except Exception as exc:
            detail["warning"] = str(exc)
    return detail


@app.get("/sqlite/search")
def sqlite_catalog_search(q: str = Query(..., min_length=1, max_length=200), limit: int = Query(25, ge=1, le=100)):
    path = default_sqlite_path()
    if not sqlite_search or not os.path.exists(path):
        raise HTTPException(status_code=503, detail="Base SQLite local não encontrada. Rode sqlite_catalog.py build.")
    return {"ok": True, "success": True, "query": q, "results": sqlite_search(path, q, limit)}


@app.get("/sqlite/history/{product_id}")
def sqlite_catalog_history(product_id: str):
    path = default_sqlite_path()
    if not sqlite_history or not os.path.exists(path):
        raise HTTPException(status_code=503, detail="Base SQLite local não encontrada. Rode sqlite_catalog.py build.")
    return {"success": True, "productId": product_id, "history": sqlite_history(path, product_id)}


@app.get("/sqlite/audit")
def sqlite_catalog_audit():
    path = default_sqlite_path()
    if not sqlite_audit or not os.path.exists(path):
        raise HTTPException(status_code=503, detail="Base SQLite local não encontrada. Rode sqlite_catalog.py build.")
    return {"ok": True, "success": True, "audit": sqlite_audit(path)}


# Interface web central: http://SERVIDOR:8765
# Montada por último para não interceptar /api, /sqlite, /search e /ocr.
if APP_RENDERER_DIR.exists():
    app.mount("/", StaticFiles(directory=str(APP_RENDERER_DIR), html=True), name="procureflow-ui")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=os.getenv("PROCUREFLOW_HOST", "127.0.0.1"), port=int(os.getenv("PORT", "8090")))
