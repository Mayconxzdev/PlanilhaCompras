from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CANONICAL = "Catálogo Operacional de Compras"
OLD_NAME = "ProcureFlow"

REQUIRED_FILES = {
    ROOT / "README.md": [CANONICAL, "usada diariamente por três usuários operacionais", "SQLite/FTS5"],
    ROOT / "app" / "renderer" / "index.html": [CANONICAL, "demonstração local"],
    ROOT / "docs" / "architecture.md": [CANONICAL, "controle", "revision"],
    ROOT / "docs" / "demo-walkthrough.md": [CANONICAL],
}

SCAN_SUFFIXES = {".html", ".js", ".css", ".py", ".md", ".json", ".yml", ".yaml", ".svg"}
OLD_NAME_ALLOWED = {ROOT / "README.md", ROOT / "CHANGELOG.md"}


def main() -> int:
    errors: list[str] = []

    for path, phrases in REQUIRED_FILES.items():
        if not path.exists():
            errors.append(f"missing required file: {path.relative_to(ROOT)}")
            continue
        text = path.read_text(encoding="utf-8")
        for phrase in phrases:
            if phrase not in text:
                errors.append(f"{path.relative_to(ROOT)} is missing required identity/evidence: {phrase}")

    for path in ROOT.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in SCAN_SUFFIXES:
            continue
        if any(part in {".git", ".runtime", "node_modules"} for part in path.parts):
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        if OLD_NAME in text and path not in OLD_NAME_ALLOWED:
            errors.append(f"outdated public name found in {path.relative_to(ROOT)}")

    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        return 1

    print("Public identity validation completed without errors.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
