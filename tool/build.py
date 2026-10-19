#!/usr/bin/env python3
"""Рендер статического сайта IMSEL Tools: src/ -> public/.

Только стандартная библиотека Python. Шаблоны в src/templates используют
плейсхолдеры {{t:ключ}} (переводы из src/i18n/<lang>.json) и $MARKER$
(вычисляемые пути: $ROOT$, $NAV$, $HREF_*$, $OTHER_HREF$ и т.п.).
Результат — полностью статические страницы без сборки на клиенте.
"""
from __future__ import annotations

import json
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src"
OUT = ROOT / "public"

LANGS = ("ru", "en")
DEFAULT_LANG = "ru"

# key — идентификатор страницы (совпадает с ключом перевода nav/home),
# dir — каталог внутри языка ("" для главной), template — файл шаблона.
PAGES = (
    {"key": "home", "dir": "", "template": "home.html",
     "title": "home.title", "desc": "home.desc"},
    {"key": "routing", "dir": "routing/", "template": "routing.html",
     "title": "routing.title", "desc": "routing.desc"},
    {"key": "b64e", "dir": "base64-encode/", "template": "b64e.html",
     "title": "b64e.title", "desc": "b64e.desc"},
    {"key": "b64d", "dir": "base64-decode/", "template": "b64d.html",
     "title": "b64d.title", "desc": "b64d.desc"},
    {"key": "deeplink", "dir": "deeplink/", "template": "deeplink.html",
     "title": "deeplink.title", "desc": "deeplink.desc"},
)

T_PLACEHOLDER = re.compile(r"\{\{t:([A-Za-z0-9_.]+)\}\}")
MARKER_PLACEHOLDER = re.compile(r"\$([A-Z][A-Z0-9_]*)\$")

REDIRECT_PAGE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>IMSEL Tools</title>
<meta http-equiv="refresh" content="0; url=ru/">
<script>
(function () {
  var lang = (navigator.language || "").toLowerCase();
  location.replace(lang.indexOf("ru") === 0 ? "ru/" : "en/");
})();
</script>
</head>
<body>
<noscript><a href="ru/">IMSEL Tools</a></noscript>
</body>
</html>
"""


def load_i18n() -> dict:
    result = {}
    for lang in LANGS:
        path = SRC / "i18n" / f"{lang}.json"
        with path.open(encoding="utf-8") as fh:
            result[lang] = json.load(fh)
    return result


def lookup(table: dict, dotted: str):
    node = table
    for part in dotted.split("."):
        if not isinstance(node, dict) or part not in node:
            raise KeyError(dotted)
        node = node[part]
    if not isinstance(node, str):
        raise KeyError(f"{dotted}: expected string, got {type(node).__name__}")
    return node


def page_depth(page: dict) -> int:
    return 0 if page["dir"] == "" else 1


def page_href(current: dict, target: dict) -> str:
    # Поднимаемся до корня языка, затем спускаемся в каталог цели.
    prefix = "../" * page_depth(current)
    if page_depth(target) == 0:
        return prefix or "./"
    return prefix + target["dir"]


def build_nav(lang: str, current: dict, i18n: dict) -> str:
    items = []
    for page in PAGES:
        if page["key"] == "home":
            continue
        label = lookup(i18n[lang], f"nav.{page['key']}")
        href = page_href(current, page)
        active = (
            ' aria-current="page"' if page["key"] == current["key"] else ""
        )
        items.append(f'<a href="{href}"{active}>{label}</a>')
    return "\n".join(items)


def render_page(lang: str, page: dict, layout: str, i18n: dict) -> str:
    content = (SRC / "templates" / page["template"]).read_text(
        encoding="utf-8",
    )
    depth = page_depth(page)
    root = "../" * (depth + 1)
    other = next(item for item in LANGS if item != lang)
    other_href = "../" * (depth + 1) + f"{other}/{page['dir']}"

    markers = {
        "TITLE": lookup(i18n[lang], page["title"]),
        "DESC": lookup(i18n[lang], page["desc"]),
        "ROOT": root,
        "HOME_HREF": page_href(page, PAGES[0]),
        "NAV": build_nav(lang, page, i18n),
        "OTHER_HREF": other_href,
        "OTHER_LANG": other,
        "CONTENT": content,
    }
    for target in PAGES:
        markers[f"HREF_{target['key'].upper()}"] = page_href(page, target)
    # Первый проход подставляет $CONTENT$ (и маркеры layout), второй —
    # маркеры внутри самого шаблона страницы ($ROOT$, $HREF_*$).
    doc = MARKER_PLACEHOLDER.sub(
        lambda match: markers.get(match.group(1), match.group(0)),
        layout,
    )
    doc = MARKER_PLACEHOLDER.sub(
        lambda match: markers.get(match.group(1), match.group(0)),
        doc,
    )
    doc = T_PLACEHOLDER.sub(
        lambda match: lookup(i18n[lang], match.group(1)), doc,
    )
    return doc


def render_to(out_dir: Path) -> None:
    i18n = load_i18n()
    layout = (SRC / "templates" / "layout.html").read_text(encoding="utf-8")

    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True)

    (out_dir / ".nojekyll").write_text("", encoding="utf-8")
    (out_dir / "index.html").write_text(REDIRECT_PAGE, encoding="utf-8")

    for lang in LANGS:
        for page in PAGES:
            target_dir = out_dir / lang / page["dir"]
            target_dir.mkdir(parents=True, exist_ok=True)
            html = render_page(lang, page, layout, i18n)
            (target_dir / "index.html").write_text(html, encoding="utf-8")

    shutil.copytree(SRC / "css", out_dir / "assets" / "css")
    shutil.copytree(SRC / "js", out_dir / "assets" / "js")


def main() -> None:
    render_to(OUT)
    pages = sum(1 for _ in OUT.rglob("index.html"))
    print(f"OK: rendered {pages} pages into {OUT}")


if __name__ == "__main__":
    main()
