#!/usr/bin/env python3
"""Validate the lightweight tool catalog without third-party YAML dependencies."""

from __future__ import annotations

import sys
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CATALOG_PATH = ROOT / "tools" / "catalog.yaml"
ALLOWED_CATEGORIES = {"data", "strategy", "job"}
ALLOWED_STAGES = {"development", "production", "mature", "deprecated"}
ALLOWED_RUNTIMES = {"go", "python", "shell"}


@dataclass
class CatalogEntry:
    id: str
    category: str = ""
    stage: str = ""
    runtime: str = ""
    entrypoints: list[str] = field(default_factory=list)


def value_after_colon(line: str) -> str:
    return line.split(":", 1)[1].strip().strip("\"'")


def parse_catalog() -> list[CatalogEntry]:
    entries: list[CatalogEntry] = []
    current: CatalogEntry | None = None
    section = ""

    for raw_line in CATALOG_PATH.read_text(encoding="utf-8").splitlines():
        line = raw_line.rstrip()
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if "\t" in line:
            raise ValueError("catalog must use spaces, not tabs")

        if stripped.startswith("- id: "):
            current = CatalogEntry(id=value_after_colon(stripped))
            entries.append(current)
            section = ""
            continue
        if current is None:
            continue

        if stripped.endswith(":"):
            section = stripped[:-1]
            continue
        if section == "entrypoints" and stripped.startswith("- path: "):
            current.entrypoints.append(value_after_colon(stripped))
            continue
        if stripped.startswith("category: "):
            current.category = value_after_colon(stripped)
        elif stripped.startswith("stage: "):
            current.stage = value_after_colon(stripped)
        elif stripped.startswith("runtime: "):
            current.runtime = value_after_colon(stripped)

    return entries


def validate(entries: list[CatalogEntry]) -> list[str]:
    errors: list[str] = []
    seen_ids: set[str] = set()
    for entry in entries:
        if entry.id in seen_ids:
            errors.append(f"duplicate tool id: {entry.id}")
        seen_ids.add(entry.id)
        if entry.category not in ALLOWED_CATEGORIES:
            errors.append(f"{entry.id}: invalid category {entry.category!r}")
        if entry.stage not in ALLOWED_STAGES:
            errors.append(f"{entry.id}: invalid stage {entry.stage!r}")
        if entry.runtime not in ALLOWED_RUNTIMES:
            errors.append(f"{entry.id}: invalid runtime {entry.runtime!r}")
        if not entry.entrypoints:
            errors.append(f"{entry.id}: missing entrypoints")
        for relative_path in entry.entrypoints:
            path = ROOT / relative_path
            if not path.exists():
                errors.append(f"{entry.id}: missing entrypoint {relative_path}")
    return errors


def main() -> int:
    if not CATALOG_PATH.exists():
        print(f"missing catalog: {CATALOG_PATH}", file=sys.stderr)
        return 1
    try:
        entries = parse_catalog()
    except ValueError as error:
        print(str(error), file=sys.stderr)
        return 1
    errors = validate(entries)
    if errors:
        print("tool catalog check failed:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1
    print(f"tool catalog ok: {len(entries)} tools")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
