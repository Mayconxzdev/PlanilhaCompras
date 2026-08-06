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
    ROOT / "tests" / "test_public_contract.py": [CANONICAL, "assertNotIn(\"ProcureFlow\", page.text)"],
}

PUBLIC_IDENTITY_PATHS = [
    ROOT / "app" / "renderer" / "index.html",
    ROOT / "app" / "renderer" / "favicon.svg",
    ROOT / "docs" / "architecture.md",
    ROOT / "docs" / "demo-walkthrough.md",
]


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

    for path in PUBLIC_IDENTITY_PATHS:
        text = path.read_text(encoding="utf-8", errors="ignore")
        if OLD_NAME in text:
            errors.append(f"outdated visible product name found in {path.relative_to(ROOT)}")

    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    if "A primeira edição pública foi publicada como **ProcureFlow**" not in readme:
        errors.append("README.md must preserve a transparent product-name migration note")

    changelog = (ROOT / "CHANGELOG.md").read_text(encoding="utf-8")
    if "Primeira publicação sanitizada, então chamada **ProcureFlow**" not in changelog:
        errors.append("CHANGELOG.md must preserve the historical name in the release history")

    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        return 1

    print("Public identity validation completed without errors.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
