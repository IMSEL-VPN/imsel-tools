#!/usr/bin/env python3
"""Проверки репозитория IMSEL Tools (без сборки в public/).

1. Паритет переводов: ru.json и en.json имеют одинаковые наборы ключей.
2. Все плейсхолдеры {{t:...}} в шаблонах разрешаются в обоих языках.
3. Запрещённые упоминания: сторонние VPN-клиенты и внутренние имена
   приложения (приватность публичного сайта).
4. Сборка во временный каталог: нет неразрешённых плейсхолдеров,
   все внутренние ссылки ведут на существующие файлы.
"""
from __future__ import annotations

import json
import re
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build  # noqa: E402

ROOT = build.ROOT
SRC = build.SRC

# (описание, regex) — регистронезависимый поиск по словам.
FORBIDDEN = [
    ("сторонний VPN-клиент Happ", r"\bhapp\b"),
    ("сторонний VPN-клиент v2rayNG", r"\bv2rayng\b"),
    ("сторонний VPN-клиент NekoBox", r"\bnekobox\b"),
    ("сторонний VPN-клиент Hiddify", r"\bhiddify\b"),
    ("сторонний VPN-клиент Incy", r"\bincy\b"),
    ("сторонний VPN-клиент Shadowrocket", r"\bshadowrocket\b"),
    ("внутренний сервис приложения", r"\broutingdeeplinkservice\b"),
    ("внутренний сервис приложения", r"\bvpnprovider\b"),
    ("внутренний сервис приложения", r"\bsharedpreferences\b"),
    ("внутренний сервис приложения", r"\bworkmanager\b"),
    ("исходники приложения", r"\.dart\b"),
    ("исходники приложения", r"\blib/"),
    ("исходники приложения", r"\bpackages/"),
    ("внутренние материалы", r"\bdocs-internal\b"),
]

errors: list[str] = []


def fail(message: str) -> None:
    errors.append(message)


def flatten(table: dict, prefix: str = "") -> set[str]:
    keys: set[str] = set()
    for key, value in table.items():
        dotted = f"{prefix}{key}"
        if isinstance(value, dict):
            keys |= flatten(value, f"{dotted}.")
        else:
            keys.add(dotted)
    return keys


def check_i18n_parity(i18n: dict) -> None:
    ru = flatten(i18n["ru"])
    en = flatten(i18n["en"])
    if ru - en:
        fail(f"en.json missing keys: {sorted(ru - en)}")
    if en - ru:
        fail(f"ru.json missing keys: {sorted(en - ru)}")


def check_placeholders(i18n: dict) -> None:
    pattern = build.T_PLACEHOLDER
    for path in sorted((SRC / "templates").glob("*.html")):
        text = path.read_text(encoding="utf-8")
        for match in pattern.finditer(text):
            key = match.group(1)
            for lang in build.LANGS:
                try:
                    build.lookup(i18n[lang], key)
                except KeyError:
                    fail(f"{path.name}: missing i18n key {key} ({lang})")


def check_forbidden() -> None:
    for path in sorted(SRC.rglob("*")):
        if not path.is_file() or path.suffix.lower() not in {
            ".html", ".css", ".js", ".json",
        }:
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        for description, regex in FORBIDDEN:
            for match in re.finditer(regex, text, re.IGNORECASE):
                rel = path.relative_to(ROOT)
                fail(
                    f"{rel}: forbidden token '{match.group(0)}' "
                    f"({description})"
                )


def check_render(i18n: dict) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp)
        build.render_to(out)
        # 1. Неразрешённые плейсхолдеры.
        for page in sorted(out.rglob("*.html")):
            text = page.read_text(encoding="utf-8")
            leftover_t = build.T_PLACEHOLDER.findall(text)
            if leftover_t:
                fail(f"{page.relative_to(out)}: unresolved {{{{t:...}}}}: "
                     f"{sorted(set(leftover_t))}")
            leftover_m = build.MARKER_PLACEHOLDER.findall(text)
            if leftover_m:
                fail(f"{page.relative_to(out)}: unresolved markers: "
                     f"{sorted(set(leftover_m))}")
        # 2. Внутренние ссылки ведут на существующие файлы.
        for page in sorted(out.rglob("*.html")):
            base = page.parent
            text = page.read_text(encoding="utf-8")
            for href in re.findall(r'href="([^"]+)"', text):
                if href.startswith(("http://", "https://", "#", "data:",
                                    "mailto:")):
                    continue
                target = (base / href.split("#", 1)[0]
                          .split("?", 1)[0]).resolve()
                if not target.exists():
                    fail(f"{page.relative_to(out)}: broken href '{href}'")


def main() -> None:
    i18n = build.load_i18n()
    check_i18n_parity(i18n)
    check_placeholders(i18n)
    check_forbidden()
    check_render(i18n)
    if errors:
        print(f"FAIL: {len(errors)} problem(s)")
        for message in errors:
            print(f"  - {message}")
        sys.exit(1)
    print("OK: i18n parity, placeholders, forbidden tokens, links")


if __name__ == "__main__":
    main()
