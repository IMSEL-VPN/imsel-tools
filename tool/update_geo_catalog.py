#!/usr/bin/env python3
"""Fetch category names only; regenerate the static geo catalog using stdlib."""
from __future__ import annotations

import argparse
import hashlib
import io
import json
from pathlib import Path
import re
import sys
import time
from datetime import datetime, timezone
from urllib.error import URLError
from urllib.request import Request, urlopen

PROVIDER = "Loyalsoldier/v2ray-rules-dat"
URLS = {
    kind: f"https://github.com/{PROVIDER}/releases/latest/download/{kind}.dat"
    for kind in ("geoip", "geosite")
}
DEFAULT_OUTPUT = Path(__file__).resolve().parent.parent / "src/js/geo-catalog-data.js"
MAX_BYTES = 64 * 1024 * 1024  # Per download, including responses without a length.
SOCKET_TIMEOUT = 30
DOWNLOAD_TIMEOUT = 120
MAX_FIELDS = 2_000_000
MAX_CATEGORIES = 100_000
CATEGORY = re.compile(r"[a-z0-9_.!\-]{1,256}", re.ASCII)


def read_varint(data: memoryview, offset: int) -> tuple[int, int]:
    """Read a protobuf uint64 without reading beyond this message's bounds."""
    value = 0
    for index in range(10):
        if offset >= len(data):
            raise ValueError("truncated protobuf varint")
        byte = data[offset]
        offset += 1
        if index == 9 and byte > 1:
            raise ValueError("protobuf varint exceeds uint64")
        value |= (byte & 0x7F) << (7 * index)
        if not byte & 0x80:
            return value, offset
    raise ValueError("invalid protobuf varint")


def wire_fields(data: memoryview):
    """Walk one message, skipping opaque values with strict wire/length bounds.

    No recursive guessing of length-delimited strings or rule payloads. Groups
    are deliberately rejected: neither catalog schema uses deprecated groups.
    """
    offset = 0
    count = 0
    while offset < len(data):
        count += 1
        if count > MAX_FIELDS:
            raise ValueError("too many protobuf fields")
        key, offset = read_varint(data, offset)
        number, wire = key >> 3, key & 7
        if not 1 <= number <= 0x1FFFFFFF:
            raise ValueError("invalid protobuf field number")
        value = None
        if wire == 0:
            _, offset = read_varint(data, offset)
        elif wire in (1, 2, 5):
            if wire == 2:
                size, offset = read_varint(data, offset)
            else:
                size = 8 if wire == 1 else 4
            if size > len(data) - offset:
                raise ValueError("truncated protobuf field")
            value = data[offset:offset + size]
            offset += size
        else:
            raise ValueError(f"unsupported protobuf wire type {wire}")
        yield number, wire, value


def parse_categories(data: bytes) -> list[str]:
    """Both lists have repeated entry=1; each entry has country_code=1.

    Validate list and entry envelopes, not the opaque domain/CIDR messages;
    only names are needed. Work is linear, depth is fixed at two messages,
    and memoryviews avoid copying rule contents.
    """
    if len(data) > MAX_BYTES:
        raise ValueError("protobuf exceeds size limit")
    categories = set()
    entries = 0
    for number, wire, entry in wire_fields(memoryview(data)):
        if number != 1:
            continue
        if wire != 2:
            raise ValueError("catalog entry must be length-delimited")
        entries += 1
        if entries > MAX_CATEGORIES:
            raise ValueError("too many catalog entries")
        name = None
        for field, kind, value in wire_fields(entry):
            if field != 1:
                continue
            if kind != 2 or name is not None:
                raise ValueError("invalid or repeated category name field")
            if not 1 <= len(value) <= 256:
                raise ValueError("empty or oversized category name")
            try:
                name = bytes(value).decode("ascii").lower()
            except UnicodeDecodeError as exc:
                raise ValueError("category name must be ASCII") from exc
            if CATEGORY.fullmatch(name) is None:
                raise ValueError(f"invalid category identifier: {name!r}")
        if name is None:
            raise ValueError("catalog entry has no category name")
        categories.add(name)
    if not categories:
        raise ValueError("catalog contains no categories")
    return sorted(categories)


def download(url: str) -> bytes:
    """Bound network reads even when Content-Length is absent or dishonest."""
    started = time.monotonic()
    request = Request(url, headers={
        "User-Agent": "IMSEL-Tools-Geo-Catalog/1.0",
        "Accept": "application/octet-stream",
        "Accept-Encoding": "identity",
    })
    with urlopen(request, timeout=SOCKET_TIMEOUT) as response:
        if response.status != 200 or not response.geturl().startswith("https://"):
            raise ValueError("expected a successful HTTPS download")
        length = response.headers.get("Content-Length")
        expected = None
        if length is not None:
            if not re.fullmatch(r"[0-9]+", length):
                raise ValueError("invalid Content-Length")
            expected = int(length)
            if not 0 < expected <= MAX_BYTES:
                raise ValueError("Content-Length outside download size limit")
        with io.BytesIO() as buffer:
            while True:
                if time.monotonic() - started > DOWNLOAD_TIMEOUT:
                    raise TimeoutError("download exceeded total time limit")
                chunk = response.read(min(64 * 1024, MAX_BYTES + 1 - buffer.tell()))
                if not chunk:
                    break
                buffer.write(chunk)
                if buffer.tell() > MAX_BYTES:
                    raise ValueError("download exceeds size limit")
            data = buffer.getvalue()
        if not data or (expected is not None and len(data) != expected):
            raise ValueError("empty or truncated download (Content-Length mismatch)")
        return data


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT,
                        help="ES module output (default: repository src/js/geo-catalog-data.js)")
    args = parser.parse_args(argv)
    catalog = {"provider": PROVIDER}
    summaries = []
    try:
        for kind, url in URLS.items():
            try:
                data = download(url)
                categories = parse_categories(data)
            except (OSError, URLError, ValueError) as exc:
                raise ValueError(f"{kind} ({url}): {exc}") from exc
            digest = hashlib.sha256(data).hexdigest()
            catalog[kind] = {"url": url, "sha256": digest, "categories": categories}
            summaries.append(f"{kind}: {len(categories)} categories, {len(data)} bytes, sha256 {digest}")
        catalog["updatedAt"] = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
        module = "export const GEO_CATALOG = " + json.dumps(catalog, indent=2, ensure_ascii=True) + ";\n"
        args.output.write_text(module, encoding="utf-8", newline="\n")
    except (OSError, ValueError) as exc:
        print(f"Geo catalog update failed: {exc}", file=sys.stderr)
        return 1
    print("\n".join(summaries))
    print(f"Updated {args.output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
