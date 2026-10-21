"""Standalone stdlib tests: python -m unittest discover -s tool -p test_geo_catalog.py."""
import hashlib
import io
import json
from pathlib import Path
import unittest
from unittest.mock import patch
from urllib.error import URLError

import update_geo_catalog as updater


def varint(value):
    result = bytearray()
    while value >= 128:
        result.append((value & 127) | 128)
        value >>= 7
    return bytes(result + bytes([value]))


def field(number, data):
    return varint(number << 3 | 2) + varint(len(data)) + data


def entry(name, extra=b""):
    return field(1, field(1, name) + extra)


class ParserTests(unittest.TestCase):
    def test_names_are_lowercase_unique_sorted(self):
        data = b"".join(entry(name) for name in (
            b"ZZ", b"CN", b"cn", b"geolocation-!cn", b"foo_bar.v2", b"!private",
        ))
        self.assertEqual(updater.parse_categories(data),
                         ["!private", "cn", "foo_bar.v2", "geolocation-!cn", "zz"])

    def test_unknown_fields_and_opaque_contents(self):
        unknown = (varint(20 << 3) + varint(2**64 - 1)
                   + varint(21 << 3 | 1) + b"12345678"
                   + field(22, b"\xff\x00not a nested message")
                   + varint(23 << 3 | 5) + b"1234")
        # Domain/CIDR payloads are length-checked, not interpreted as names.
        self.assertEqual(updater.parse_categories(
            unknown + entry(b"CN", field(2, b"\xff\x00") + unknown) + unknown), ["cn"])

    def test_empty_or_missing_category(self):
        for data in (b"", field(2, b"unknown"), field(1, b""),
                     field(1, field(2, b"rules")), entry(b"")):
            with self.subTest(data=data), self.assertRaises(ValueError):
                updater.parse_categories(data)

    def test_invalid_identifiers(self):
        for name in (b"a b", b"../cn", b"cn@ads", b"cn:1", b"a\x00b",
                     b"a\nb", b"\xff", b"x" * 257):
            with self.subTest(name=name), self.assertRaises(ValueError):
                updater.parse_categories(entry(name))

    def test_truncated_fields_at_both_levels(self):
        invalid = (b"\x80", b"\x0a", b"\x0a\x03ab", b"\x10\x80",
                   b"\x19abcdefg", b"\x25abc", b"\x12\x80")
        for payload in invalid:
            for data in (entry(b"cn") + payload, field(1, field(1, b"cn") + payload)):
                with self.subTest(data=data), self.assertRaises(ValueError):
                    updater.parse_categories(data)

    def test_every_truncation_of_single_entry_fails(self):
        data = entry(b"geolocation-!cn", field(2, b"opaque"))
        for end in range(len(data)):
            with self.subTest(end=end), self.assertRaises(ValueError):
                updater.parse_categories(data[:end])

    def test_invalid_varints_and_keys(self):
        invalid = (b"\x80" * 10, b"\xff" * 9 + b"\x02",
                   b"\x80" * 10 + b"\x00", b"\x00", b"\x01" + b"0" * 8,
                   varint(1 << 32), b"\x0b", b"\x0c", b"\x0e", b"\x0f")
        for payload in invalid:
            for data in (payload, field(1, payload)):
                with self.subTest(data=data), self.assertRaises(ValueError):
                    updater.parse_categories(data)

    def test_wrong_known_wire_types_and_repeated_name(self):
        for data in (b"\x08\x01", field(1, b"\x08\x01"),
                     entry(b"cn", field(1, b"us"))):
            with self.subTest(data=data), self.assertRaises(ValueError):
                updater.parse_categories(data)

    def test_size_entry_and_field_limits(self):
        with patch.object(updater, "MAX_BYTES", 2), self.assertRaises(ValueError):
            updater.parse_categories(entry(b"cn"))
        with patch.object(updater, "MAX_CATEGORIES", 1), self.assertRaises(ValueError):
            updater.parse_categories(entry(b"cn") * 2)
        with patch.object(updater, "MAX_FIELDS", 1), self.assertRaises(ValueError):
            updater.parse_categories(entry(b"cn", field(2, b"")))


class Response(io.BytesIO):
    status = 200

    def __init__(self, data, length=None):
        super().__init__(data)
        self.headers = {} if length is None else {"Content-Length": length}

    def geturl(self):
        return "https://release-assets.githubusercontent.com/asset"


class DownloaderTests(unittest.TestCase):
    def test_download_with_or_without_length(self):
        for length in (None, "4"):
            with self.subTest(length=length), patch.object(
                updater, "urlopen", return_value=Response(b"data", length)
            ) as opened:
                self.assertEqual(updater.download(updater.URLS["geoip"]), b"data")
                self.assertEqual(opened.call_args.kwargs["timeout"], updater.SOCKET_TIMEOUT)
                self.assertEqual(opened.call_args.args[0].full_url, updater.URLS["geoip"])

    def test_invalid_length_empty_and_truncated_download(self):
        for data, length in ((b"", None), (b"abc", "4"), (b"abc", "2"),
                             (b"abc", "-1"), (b"abc", "invalid"), (b"", "0"),
                             (b"abc", str(updater.MAX_BYTES + 1))):
            with self.subTest(length=length), patch.object(
                updater, "urlopen", return_value=Response(data, length)
            ), self.assertRaises(ValueError):
                updater.download(updater.URLS["geoip"])

    def test_actual_size_limit_without_trusting_header(self):
        for length in (None, "4"):
            with self.subTest(length=length), patch.object(updater, "MAX_BYTES", 4), patch.object(
                updater, "urlopen", return_value=Response(b"abcde", length)
            ), self.assertRaises(ValueError):
                updater.download(updater.URLS["geoip"])

    def test_total_timeout(self):
        with patch.object(updater, "urlopen", return_value=Response(b"data")), patch.object(
            updater.time, "monotonic", side_effect=[0, updater.DOWNLOAD_TIMEOUT + 1]
        ), self.assertRaises(TimeoutError):
            updater.download(updater.URLS["geoip"])

    def test_reject_bad_status_and_insecure_final_url(self):
        for status, url in ((206, "https://example.com"), (200, "http://example.com")):
            response = Response(b"data")
            response.status = status
            with self.subTest(status=status, url=url), patch.object(response, "geturl", return_value=url), patch.object(
                updater, "urlopen", return_value=response
            ), self.assertRaises(ValueError):
                updater.download(updater.URLS["geoip"])


class CliTests(unittest.TestCase):
    def test_default_path_schema_provenance_and_module(self):
        payloads = [entry(b"CN"), entry(b"example")]
        with patch.object(updater, "download", side_effect=payloads) as fetch, patch.object(
            Path, "write_text", autospec=True
        ) as write, patch("sys.stdout", new_callable=io.StringIO):
            self.assertEqual(updater.main([]), 0)
        self.assertEqual([call.args[0] for call in fetch.call_args_list], list(updater.URLS.values()))
        path, module = write.call_args.args
        self.assertEqual(path, Path(updater.__file__).resolve().parent.parent / "src/js/geo-catalog-data.js")
        prefix = "export const GEO_CATALOG = "
        self.assertTrue(module.startswith(prefix))
        self.assertTrue(module.endswith(";\n"))
        catalog = json.loads(module[len(prefix):-2])
        self.assertEqual(set(catalog), {"provider", "updatedAt", "geoip", "geosite"})
        self.assertEqual(catalog["provider"], updater.PROVIDER)
        self.assertRegex(catalog["updatedAt"], r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$")
        for (kind, url), payload in zip(updater.URLS.items(), payloads):
            self.assertEqual(catalog[kind], {"url": url, "sha256": hashlib.sha256(payload).hexdigest(),
                                             "categories": updater.parse_categories(payload)})

    def test_explicit_output(self):
        with patch.object(updater, "download", return_value=entry(b"cn")), patch.object(
            Path, "write_text", autospec=True
        ) as write, patch("sys.stdout", new_callable=io.StringIO):
            self.assertEqual(updater.main(["--output", "custom.js"]), 0)
        self.assertEqual(write.call_args.args[0], Path("custom.js"))

    def test_failures_never_write_catalog(self):
        for error in (URLError("network unavailable"), TimeoutError("timed out"), b"invalid"):
            with self.subTest(error=error), patch.object(
                updater, "download", side_effect=[entry(b"cn"), error]
            ), patch.object(Path, "write_text") as write, patch(
                "sys.stderr", new_callable=io.StringIO
            ) as stderr:
                self.assertEqual(updater.main([]), 1)
                write.assert_not_called()
                self.assertIn("geosite", stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
