// Тесты ядра (codec.js / profile.js) на Node: node tool/test.mjs
// Golden-векторы взяты из тестов приложения, чтобы ссылки, собранные
// сайтом, гарантированно парсились импортом приложения.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = (p) => readFileSync(path.join(root, 'src', 'js', p), 'utf8');

const codec = await import('../src/js/codec.js');
const profileMod = await import('../src/js/profile.js');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    console.error(`FAIL: ${name}`);
    throw e;
  }
}

const {
  encodeText, encodeTextUrlSafe, decodeToText,
} = codec;
const {
  profileFromJson, profileToJson, buildLink, parseRoutingLink,
  tryParseRoutingLink, encodeProfileB64, defaultProfile, LINK_ERRORS,
} = profileMod;

// ── Base64 кодек ──────────────────────────────────────────────────────
test('b64: UTF-8 round-trip совпадает с Node Buffer', () => {
  const cases = ['Hello World!', '{"GlobalProxy":"false"}', 'привет мир', ' протест ', '༑', '𝄞 AudioClip'];
  for (const c of cases) {
    assert.equal(encodeText(c), Buffer.from(c, 'utf8').toString('base64'));
    assert.equal(decodeToText(encodeText(c)), c);
  }
});

test('b64: URL-safe без padding декодируется', () => {
  const raw = 'привет';
  const std = encodeText(raw);
  const urlSafe = std.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  assert.equal(urlSafe, encodeTextUrlSafe(raw));
  assert.equal(decodeToText(urlSafe), raw);
});

test('b64: пробелы и перевод строки игнорируются', () => {
  const raw = 'a b c';
  const std = encodeText(raw);
  assert.equal(decodeToText(std.slice(0, 4) + '\n' + std.slice(4) + '  '), raw);
});

test('b64: невалидные символы → null', () => {
  assert.equal(decodeToText('!!!'), null);
  assert.equal(decodeToText('abc$'), null);
});

test('b64: битый UTF-8 → null', () => {
  // 0xFF не является валидной UTF-8 последовательностью.
  assert.equal(decodeToText('//8='), null);
});

// ── fromJson: регистры, дефолты, булевы-строки ────────────────────────
test('fromJson: PascalCase полный формат', () => {
  const p = profileFromJson({
    Name: 'Test',
    GlobalProxy: 'true',
    RemoteDNSType: 'DoH',
    RemoteDNSDomain: 'https://cloudflare-dns.com/dns-query',
    DirectSites: ['geosite:cn'],
    DirectIp: ['10.0.0.0/8'],
    BlockSites: ['geosite:ads'],
    DomainStrategy: 'IPIfNonMatch',
    FakeDNS: 'false',
  });
  assert.equal(p.globalProxy, true);
  assert.equal(p.remoteDnsType, 'DoH');
  assert.deepEqual(p.directSites, ['geosite:cn']);
  assert.deepEqual(p.directIp, ['10.0.0.0/8']);
  assert.deepEqual(p.blockSites, ['geosite:ads']);
  assert.equal(p.fakeDns, false);
});

test('fromJson: camelCase компактный формат', () => {
  const p = profileFromJson({
    globalProxy: 'false',
    directSites: ['geosite:test'],
    blockIp: ['1.2.3.0/24'],
  });
  assert.equal(p.globalProxy, false);
  assert.deepEqual(p.directSites, ['geosite:test']);
  assert.deepEqual(p.blockIp, ['1.2.3.0/24']);
});

test('fromJson: пустой профиль — дефолты', () => {
  const p = profileFromJson({});
  assert.equal(p.globalProxy, true);
  assert.equal(p.fakeDns, false);
  assert.deepEqual(p.directSites, []);
  assert.deepEqual(p.dnsHosts, {});
});

test('fromJson: FakeDNS строка "true" и "1"', () => {
  assert.equal(profileFromJson({ FakeDNS: 'true' }).fakeDns, true);
  assert.equal(profileFromJson({ FakeDNS: '1' }).fakeDns, true);
  assert.equal(profileFromJson({ FakeDNS: 'false' }).fakeDns, false);
});

test('fromJson: DnsHosts объект, значения приводятся к строкам', () => {
  const p = profileFromJson({
    DnsHosts: { 'cloudflare-dns.com': '1.1.1.1', 'dns.google': 8 },
  });
  assert.equal(p.dnsHosts['cloudflare-dns.com'], '1.1.1.1');
  assert.equal(p.dnsHosts['dns.google'], '8');
  assert.equal(Object.keys(p.dnsHosts).length, 2);
});

test('fromJson: одиночная строка вместо списка → список из одного', () => {
  const p = profileFromJson({ ProxySites: 'geosite:youtube' });
  assert.deepEqual(p.proxySites, ['geosite:youtube']);
});

test('fromJson: нестроковые элементы списка отбрасываются', () => {
  const p = profileFromJson({ DirectSites: ['geosite:cn', 4, null, '', 'ok'] });
  assert.deepEqual(p.directSites, ['geosite:cn', 'ok']);
});

test('fromJson: Geo URL', () => {
  const p = profileFromJson({
    Geoipurl: 'https://example.com/geoip.dat',
    Geositeurl: 'https://example.com/geosite.dat',
  });
  assert.equal(p.geoipUrl, 'https://example.com/geoip.dat');
  assert.equal(p.geositeUrl, 'https://example.com/geosite.dat');
});

test('fromJson: DirectDomainStrategy — только известные значения', () => {
  for (const s of ['AsIs', 'UseIP', 'UseIPv4', 'UseIPv6']) {
    assert.equal(profileFromJson({ DirectDomainStrategy: s }).directDomainStrategy, s);
    assert.equal(
      profileFromJson({ directDomainStrategy: s.toLowerCase() }).directDomainStrategy,
      s,
    );
  }
  for (const bad of ['ForceIP', 'unknown', '']) {
    assert.equal(profileFromJson({ DirectDomainStrategy: bad }).directDomainStrategy, null);
  }
  assert.equal(profileFromJson({ DirectDomainStrategy: 4 }).directDomainStrategy, null);
});

// ── toJson: точная структура ──────────────────────────────────────────
test('toJson: полный профиль — ключи, порядок, строковые булевы', () => {
  const data = {
    Name: 'Simple-RU-routing',
    GlobalProxy: 'true',
    RemoteDNSType: 'DoU',
    RemoteDNSDomain: 'https://dns.adguard-dns.com/dns-query',
    RemoteDNSIP: '94.140.14.14',
    DomesticDNSType: 'DoU',
    DomesticDNSDomain: 'https://dns.adguard-dns.com/dns-query',
    DomesticDNSIP: '94.140.15.15',
    Geoipurl: 'https://github.com/frayZV/simple-ru-geoip/releases/latest/download/geoip.dat',
    Geositeurl: 'https://github.com/frayZV/simple-ru-geosite/releases/latest/download/geosite.dat',
    LastUpdated: '4070905200',
    DnsHosts: {},
    DirectSites: ['geosite:private', 'geosite:category-ru', 'geosite:apple', 'geosite:twitch'],
    DirectIp: ['geoip:ru', 'geoip:private'],
    ProxySites: ['geosite:youtube', 'geosite:category-ban-ru'],
    ProxyIp: [],
    BlockSites: [],
    BlockIp: [],
    DomainStrategy: 'IPIfNonMatch',
    FakeDNS: 'false',
    UseChunkFiles: 'true',
  };
  const out = profileToJson(profileFromJson(data));
  assert.deepEqual(out, data);
});

test('toJson: DirectDomainStrategy отсутствует при неизвестном значении', () => {
  const p = profileFromJson({ DirectDomainStrategy: 'ForceIP', RemoteDNSType: 'DoU', RemoteDNSIP: '1.1.1.1' });
  const out = profileToJson(p);
  assert.equal('DirectDomainStrategy' in out, false);
});

test('toJson: LastUpdated всегда присутствует строкой', () => {
  assert.equal(profileToJson(profileFromJson({})).LastUpdated, '');
  assert.equal(profileToJson(profileFromJson({ LastUpdated: '1693826255' })).LastUpdated, '1693826255');
  assert.equal(profileToJson(profileFromJson({ LastUpdated: 1693826255 })).LastUpdated, '1693826255');
});

test('toJson: RouteOrder только при заданном значении', () => {
  assert.equal('RouteOrder' in profileToJson(profileFromJson({})), false);
  assert.equal(profileToJson(profileFromJson({ RouteOrder: 'proxy,direct,block' })).RouteOrder, 'proxy,direct,block');
});

// ── parseRoutingLink: команды, схемы, кодировки ───────────────────────
test('parse: без команды / add / onadd, любые схемы', () => {
  const payload = encodeProfileB64(profileFromJson({
    Name: 'Simple-RU-routing',
    GlobalProxy: 'true',
    RemoteDNSType: 'DoU',
    RemoteDNSDomain: 'https://dns.adguard-dns.com/dns-query',
    RemoteDNSIP: '94.140.14.14',
    DomesticDNSType: 'DoU',
    DomesticDNSDomain: 'https://dns.adguard-dns.com/dns-query',
    DomesticDNSIP: '94.140.15.15',
    Geoipurl: 'https://github.com/frayZV/simple-ru-geoip/releases/latest/download/geoip.dat',
    Geositeurl: 'https://github.com/frayZV/simple-ru-geosite/releases/latest/download/geosite.dat',
    LastUpdated: '4070905200',
    DnsHosts: {},
    DirectSites: ['geosite:private', 'geosite:category-ru', 'geosite:apple', 'geosite:twitch'],
    DirectIp: ['geoip:ru', 'geoip:private'],
    ProxySites: ['geosite:youtube', 'geosite:category-ban-ru'],
    ProxyIp: [],
    BlockSites: [],
    BlockIp: [],
    DomainStrategy: 'IPIfNonMatch',
    FakeDNS: 'false',
    UseChunkFiles: 'true',
  }));
  for (const scheme of ['imsel', 'external', 'custom+vpn.test-1']) {
    for (const prefix of ['', 'add/', 'onadd/']) {
      const link = `${scheme}://routing/${prefix}${payload}`;
      const parsed = parseRoutingLink(link);
      assert.deepEqual(profileToJson(parsed.profile).Name, 'Simple-RU-routing');
      assert.equal(parsed.profile.remoteDnsIp, '94.140.14.14');
      assert.equal(parsed.profile.domesticDnsIp, '94.140.15.15');
    }
  }
});

test('parse: стандартный base64 со слэшами, URL-safe, percent-encoding, без padding', () => {
  const data = { Name: '\u083f', DirectSites: ['domain:example.com'] };
  const payload = encodeText(JSON.stringify(data));
  assert.ok(payload.includes('/'));
  const variants = [
    payload,
    payload.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, ''),
    encodeURIComponent(payload),
  ];
  for (const encoded of variants) {
    for (const command of ['', 'add/', 'onadd/']) {
      const parsed = parseRoutingLink(`  external://routing/${command}${encoded}  `);
      assert.equal(parsed.profile.name, '\u083f');
      assert.deepEqual(parsed.profile.directSites, ['domain:example.com']);
    }
  }
  // Без команды перед данными команда не извлекается.
  assert.equal(parseRoutingLink(`imsel://routing/${payload}`).command, null);
});

test('parse: ошибки — actionable и консистентные', () => {
  const cases = [
    ['invalid', LINK_ERRORS.invalidLink],
    ['https://routing/e30=', LINK_ERRORS.unsupportedScheme],
    ['http://routing/e30=', LINK_ERRORS.unsupportedScheme],
    ['imsel://other/e30=', LINK_ERRORS.invalidLink],
    ['imsel://routing/%FF', LINK_ERRORS.invalidLink],
    ['imsel://routing/', LINK_ERRORS.missingPayload],
    ['imsel://routing/add', LINK_ERRORS.missingPayload],
    ['imsel://routing/onadd/', LINK_ERRORS.missingPayload],
    ['imsel://routing/off', LINK_ERRORS.unsupportedCommand],
    ['imsel://routing/off/e30=', LINK_ERRORS.unsupportedCommand],
    ['imsel://routing/!!!', LINK_ERRORS.invalidBase64],
    [`imsel://routing/${encodeText('not JSON')}`, LINK_ERRORS.invalidJson],
    [`imsel://routing/${encodeText('[]')}`, LINK_ERRORS.invalidJson],
    [`imsel://routing/${encodeText('null')}`, LINK_ERRORS.invalidJson],
    ['imsel://routing/e30=?extra=true', LINK_ERRORS.invalidLink],
    ['imsel://routing/e30=#fragment', LINK_ERRORS.invalidLink],
    ['imsel://user:pass@routing/e30=', LINK_ERRORS.invalidLink],
    ['imsel://routing:8080/e30=', LINK_ERRORS.invalidLink],
  ];
  for (const [link, expected] of cases) {
    assert.throws(
      () => parseRoutingLink(link),
      (err) => err === expected,
      link,
    );
    assert.equal(tryParseRoutingLink(link), null, link);
  }
});

test('parse: валидный onadd-профиль', () => {
  const b64 = encodeText(JSON.stringify({ Name: 'Test', GlobalProxy: 'true', DirectSites: ['geosite:cn'] }));
  const p = parseRoutingLink(`imsel://routing/onadd/${b64}`);
  assert.equal(p.command, 'onadd');
  assert.equal(p.profile.globalProxy, true);
  assert.deepEqual(p.profile.directSites, ['geosite:cn']);
});

test('parse: isRouting-детекция по host, а не по строке', () => {
  assert.equal(tryParseRoutingLink('imsel://sub/e1/AAA'), null);
  assert.equal(tryParseRoutingLink('vless://uuid@host'), null);
  assert.equal(tryParseRoutingLink('https://example.com/routing'), null);
  assert.equal(tryParseRoutingLink('https://routing.example.com'), null);
});

// ── Экспорт ───────────────────────────────────────────────────────────
test('buildLink: round-trip дефолтного профиля', () => {
  const link = buildLink(defaultProfile(), 'onadd');
  assert.ok(link.startsWith('imsel://routing/onadd/'));
  const parsed = parseRoutingLink(link);
  assert.deepEqual(profileToJson(parsed.profile), profileToJson(defaultProfile()));
});

test('buildLink: add-команда', () => {
  const link = buildLink(defaultProfile(), 'add');
  assert.ok(link.startsWith('imsel://routing/add/'));
});

// ── QR-библиотека (вендоренная) ───────────────────────────────────────
test('vendor qrcode: UMD-экспорт и генерация SVG', () => {
  const createQr = new Function(
    'module',
    'exports',
    src('vendor/qrcode.js') + '\nreturn module.exports;',
  );
  const qr = createQr({ exports: {} }, {});
  assert.equal(typeof qr, 'function');
  const inst = qr(0, 'M');
  inst.addData('imsel://routing/onadd/eyJHbG9iYWxQcm94eSI6InRydWUifQ==');
  inst.make();
  const svg = inst.createSvgTag({ cellSize: 2, margin: 4 });
  assert.ok(svg.startsWith('<svg'));
  assert.ok(svg.includes('path'));
});

console.log(`OK: ${passed} tests passed`);
