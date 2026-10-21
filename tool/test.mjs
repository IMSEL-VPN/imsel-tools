// Тесты ядра (codec.js / profile.js) на Node: node tool/test.mjs
// Public exchange vectors cover the supported fields, not every extension.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = (p) => readFileSync(path.join(root, 'src', 'js', p), 'utf8');

const codec = await import('../src/js/codec.js');
const profileMod = await import('../src/js/profile.js');
const { profileTemplate } = await import('../src/js/profile-templates.js');

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
  buildSourceLink, validateRoutingSourceUrl,
} = profileMod;

// ── Base64 кодек ──────────────────────────────────────────────────────
test('profile templates are independent and use the app default public settings', () => {
  const app = profileTemplate('app');
  assert.deepEqual(app.dnsServers.map((row) => row.address), ['1.1.1.1', '8.8.8.8']);
  assert.deepEqual(app.rules.map((row) => row.action), ['proxy', 'direct', 'direct', 'proxy']);
  assert.equal(app.rules[3].port, '0-65535');
  assert.equal(app.rules[2].ip[0], 'geoip:private');
  assert.deepEqual(app.dnsHosts, { 'domain:googleapis.cn': 'googleapis.com' });
  assert.equal(app.geoUpdateIntervalHours, 0);
  assert.deepEqual(app.outbounds.map((row) => row.tag), ['direct', 'block']);
  app.rules[0].ip.push('modified');
  assert.deepEqual(profileTemplate('app').rules[0].ip, ['1.1.1.1']);
  assert.deepEqual(profileTemplate('blank').rules, []);
  assert.deepEqual(profileTemplate('blank').dnsServers, []);
  assert.equal(profileTemplate('legacy').rules, undefined);
  for (const kind of ['app', 'blank', 'legacy']) {
    const p = profileTemplate(kind);
    assert.deepEqual(profileToJson(parseRoutingLink(buildLink(p, 'add')).profile), profileToJson(p));
  }
});

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

test('Geo optional fields: omission, aliases, clear, boundaries and repeated round-trip', () => {
  const keys = ['GeoipSha256Url', 'GeositeSha256Url', 'GeoUpdateIntervalHours'];
  for (const p of [defaultProfile(), profileFromJson({})]) {
    for (const key of keys) assert.equal(Object.hasOwn(profileToJson(p), key), false);
  }
  for (const interval of [0, 1, 24, 8760]) {
    const fields = {
      GeoipSha256Url: 'https://geo.example.org/geoip.dat.sha256?version=2',
      GeositeSha256Url: 'http://geo.example.org:8080/geosite.sha256',
      GeoUpdateIntervalHours: interval,
    };
    for (const camel of [false, true]) {
      const input = Object.fromEntries(Object.entries(fields).map(([key, value]) =>
        [camel ? key[0].toLowerCase() + key.slice(1) : key, value]));
      let p = profileFromJson(input);
      for (const command of ['add', 'onadd']) p = parseRoutingLink(buildLink(p, command)).profile;
      for (const key of keys) assert.equal(profileToJson(p)[key], fields[key]);
    }
  }
  const clear = profileFromJson({ GeoipSha256Url: '', GeositeSha256Url: '  ',
    geoipSha256Url: 'https://must-not-win.example.org/hash', GeoUpdateIntervalHours: 0,
    geoUpdateIntervalHours: 24 });
  assert.equal(profileToJson(clear).GeoipSha256Url, '');
  assert.equal(profileToJson(clear).GeositeSha256Url, '');
  assert.equal(profileToJson(clear).GeoUpdateIntervalHours, 0);
});

test('Geo optional fields: strict types, HTTP(S) URLs without credentials or fragment', () => {
  const invalid = [
    ...[true, false, null, '24', -1, 8761, 0.5, [], {}, NaN, Infinity]
      .map((GeoUpdateIntervalHours) => ({ GeoUpdateIntervalHours })),
    ...[null, true, 42, [], {}, 'ftp://geo.example.org/hash', 'relative/hash',
      'https://', 'https://user@geo.example.org/hash', 'https://user:pass@geo.example.org/hash',
      'https://geo.example.org:0/hash', 'https://geo.example.org:65536/hash',
      'https://geo.example.org/has h', 'https://geo.example.org/has\nh',
      'https://geo.example.org/hash#part', 'https://geo.example.org/hash#']
      .flatMap((value) => [{ GeoipSha256Url: value }, { geositeSha256Url: value }]),
    { GeoipSha256Url: false, geoipSha256Url: 'https://valid.example.org/hash' },
    { GeoUpdateIntervalHours: true, geoUpdateIntervalHours: 24 },
  ];
  for (const input of invalid) {
    assert.throws(() => profileFromJson(input), (e) => e === LINK_ERRORS.invalidProfile);
  }
  for (const input of [{ GeoipSha256Url: true }, { GeoUpdateIntervalHours: false }]) {
    const link = `imsel://routing/add/${encodeText(JSON.stringify(input))}`;
    assert.throws(() => parseRoutingLink(link), (e) => e === LINK_ERRORS.invalidProfile);
  }
  const p = profileFromJson({ Geoipurl: 'https://old.example.org/geoip.dat',
    Geositeurl: 'http://old.example.org/geosite.dat',
    GeoipSha256Url: '  https://geo.example.org/hash  ' });
  assert.equal(profileToJson(p).Geoipurl, 'https://old.example.org/geoip.dat');
  assert.equal(profileToJson(p).Geositeurl, 'http://old.example.org/geosite.dat');
  assert.equal(profileToJson(p).GeoipSha256Url, 'https://geo.example.org/hash');
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

const fullProfile = JSON.parse(readFileSync(
  path.join(root, 'tool', 'fixtures', 'routing-profile-full.json'), 'utf8',
));

test('full public golden: exact canonical JSON and two link round-trips', () => {
  let p = profileFromJson(fullProfile);
  assert.deepEqual(profileToJson(p), fullProfile);
  for (const command of ['add', 'onadd']) {
    p = parseRoutingLink(buildLink(p, command)).profile;
    assert.deepEqual(profileToJson(p), fullProfile);
  }
});

test('full public fields: camel aliases, Pascal precedence, no shared references', () => {
  const input = structuredClone(fullProfile);
  for (const key of ['Rules', 'Outbounds', 'DnsServers', 'QueryStrategy', 'BlockAds']) {
    input[key[0].toLowerCase() + key.slice(1)] = input[key];
    delete input[key];
  }
  const p = profileFromJson(input);
  assert.deepEqual(profileToJson(p), fullProfile);
  input.rules[0].domain.push('changed');
  input.dnsServers[0].domains.push('changed');
  input.outbounds[0].settings.domainStrategy = 'changed';
  assert.deepEqual(profileToJson(p), fullProfile);
  const exported = profileToJson(p);
  exported.Outbounds[0].settings.domainStrategy = 'changed';
  assert.deepEqual(profileToJson(p), fullProfile);
  assert.equal(profileFromJson({ BlockAds: false, blockAds: true }).blockAds, false);
  assert.deepEqual(profileFromJson({ DnsServers: [], dnsServers: fullProfile.DnsServers }).dnsServers, []);
});

test('new fields: omission, empty arrays, DNS defaults and boolean false are distinct', () => {
  const legacy = profileToJson(profileFromJson({}));
  for (const key of ['Rules', 'Outbounds', 'DnsServers', 'QueryStrategy', 'BlockAds']) {
    assert.equal(Object.hasOwn(legacy, key), false);
  }
  const empty = { Rules: [], Outbounds: [], DnsServers: [], BlockAds: false };
  const out = profileToJson(profileFromJson(empty));
  for (const key of Object.keys(empty)) assert.deepEqual(out[key], empty[key]);
  assert.deepEqual(profileFromJson({ DnsServers: [{ address: 'localhost', id: 'local-only' }] }).dnsServers,
    [{ address: 'localhost', port: '', domains: [], enabled: true }]);
});

test('QueryStrategy: canonical values, aliases, none without conversion', () => {
  for (const value of ['UseIP', 'UseIPv4', 'UseIPv6', 'none']) {
    assert.equal(profileToJson(profileFromJson({ queryStrategy: value.toLowerCase() })).QueryStrategy, value);
  }
  assert.equal(profileToJson(profileFromJson({ DomainStrategy: 'none' })).DomainStrategy, 'none');
});

test('new field types: reject instead of silently dropping values', () => {
  const invalid = [
    { Rules: {} }, { Rules: [null] }, { Rules: [{}] }, { Outbounds: 'bad' }, { Outbounds: [[]] },
    { Outbounds: [null] }, { Outbounds: [{}] }, { Outbounds: [{ tag: 'x', protocol: 1 }] },
    { Outbounds: [{ tag: 'x', protocol: 'freedom', settings: [] }] },
    { Outbounds: [{ tag: 'x', protocol: 'freedom', settings: null }] },
    { Rules: [{ action: 'blok' }] }, { Rules: [{ enabled: 'false' }] },
    { Rules: [{ domain: ['ok', 1] }] }, { Rules: [{ port: 443 }] },
    ...['false', 0, null, [], {}].map((BlockAds) => ({ BlockAds })),
    ...['bad', '', 0, null, [], {}].map((QueryStrategy) => ({ QueryStrategy })),
    ...[null, {}, 'bad', [null], [[]], [{}], [{ address: 1 }], [{ address: '' }], [{ address: '   ' }],
      [{ address: 'x', port: 53 }], [{ address: 'x', port: null }],
      [{ address: 'x', domains: 'domain:x' }], [{ address: 'x', domains: [1] }],
      [{ address: 'x', enabled: 'false' }], [{ address: 'x', enabled: null }],
    ].map((DnsServers) => ({ DnsServers })),
  ];
  for (const input of invalid) {
    assert.throws(() => profileFromJson(input), (e) => e === LINK_ERRORS.invalidProfile);
    assert.throws(() => parseRoutingLink(`imsel://routing/add/${encodeText(JSON.stringify(input))}`),
      (e) => e === LINK_ERRORS.invalidProfile);
    assert.equal(tryParseRoutingLink(`imsel://routing/add/${encodeText(JSON.stringify(input))}`), null);
  }
});

test('full data: six outbounds, >100KB, nested unknown fields and order preserved', () => {
  const input = structuredClone(fullProfile);
  input.Outbounds = Array.from({ length: 6 }, (_, i) => ({
    tag: `extra-${i}`, protocol: 'freedom', settings: { future: { list: [false, null, i, { data: 'x'.repeat(18000) }] } },
  }));
  input.Rules[0].customTag = 'extra-0';
  input.Rules[0].future = { ordered: [3, 1, null, { unknown: true }] };
  assert.ok(JSON.stringify(input).length > 100000);
  let p = profileFromJson(input);
  for (let i = 0; i < 2; i++) p = parseRoutingLink(buildLink(p, 'add')).profile;
  assert.deepEqual(profileToJson(p), input);
});

// Exercise the real browser event handlers without adding a DOM dependency.
function routingHarness() {
  class Element {
    value = '';
    checked = false;
    disabled = false;
    hidden = false;
    dataset = {};
    children = [];
    events = {};
    classList = { toggle() {} };
    set innerHTML(_) { this.children = []; }
    appendChild(child) { this.children.push(child); }
    append(...children) { this.children.push(...children); }
    setAttribute() {}
    addEventListener(name, fn) { (this.events[name] ??= []).push(fn); }
    emit(name, event = {}) {
      for (const fn of this.events[name] ?? []) fn(event);
    }
    click() { if (!this.disabled) this.emit('click'); }
  }
  const ids = new Map();
  const get = (id) => {
    if (!ids.has(id)) ids.set(id, new Element());
    return ids.get(id);
  };
  const lists = ['directSites', 'directIp', 'proxySites', 'proxyIp', 'blockSites', 'blockIp']
    .map((key) => {
      const editor = new Element();
      editor.dataset.list = key;
      editor.input = new Element();
      editor.button = new Element();
      editor.chips = new Element();
      editor.querySelector = (selector) => selector.endsWith('input') ? editor.input : editor.button;
      return editor;
    });
  const document = {
    getElementById: get,
    createElement: () => new Element(),
    querySelector: (selector) => lists.find((el) => selector.includes(`"${el.dataset.list}"`)).chips,
    querySelectorAll: (selector) => {
      if (selector === '.list-editor') return lists;
      if (selector.startsWith('.list-add-row')) return lists.flatMap((el) => [el.input, el.button]);
      return [];
    },
  };
  const window = { qrcode: () => ({ addData() {}, make() {}, createSvgTag: () => '<svg></svg>' }) };
  const bindings = {
    ...profileMod, decodeToText,
    initCopyButtons() {}, initCounters() {},
    initGeoPicker() {},
    profileTemplate,
    initRulesEditor() { return { refresh() {}, isValid: () => true }; },
    initOutboundsEditor() { return { refresh() {}, isValid: () => true }; },
    initDnsEditor() {
      return {
        isValid: () => get('dns-editor-status').hidden !== false,
        refresh() {
          get('dns-editor-status').hidden = true;
          get('dns-add').disabled = false;
          get('dns-query-strategy').disabled = false;
        },
      };
    },
    initConfigPreview() { return () => {}; },
    showStatus(el, text, error) { el.hidden = false; el.textContent = text; el.error = error; },
  };
  const script = src('routing.js').replace(/^import[\s\S]*?from '[^']+';\r?\n/gm, '');
  new Function('document', 'window', 'location', 'history', ...Object.keys(bindings), script)(
    document, window, { hash: '' }, {}, ...Object.values(bindings),
  );
  return {
    get, lists,
    import(input) {
      get('import-input').value = typeof input === 'string' ? input : JSON.stringify(input);
      get('import-btn').click();
      assert.equal(get('import-status').error, false);
    },
    output() { return profileToJson(parseRoutingLink(get('link-output').value).profile); },
  };
}

test('form: full Rules lock only legacy lists; global routing and DNS remain independent', () => {
  const ui = routingHarness();
  ui.import(fullProfile);
  assert.equal(ui.get('advanced-notice').hidden, false);
  const locked = ['f-directdomainstrategy'];
  for (const id of locked) assert.equal(ui.get(id).disabled, true, id);
  for (const id of ['f-globalproxy', 'f-routeorder', 'f-domainstrategy',
    'f-fakedns', 'f-dnshosts', 'dns-add', 'dns-query-strategy']) assert.equal(ui.get(id).disabled, false, id);
  for (const list of ui.lists) {
    assert.equal(list.input.disabled, true);
    assert.equal(list.button.disabled, true);
    list.input.value = 'must-not-add';
    list.input.emit('keydown', { key: 'Enter', preventDefault() {} });
  }
  for (const id of ['f-name', 'f-geoipurl', 'f-geositeurl', 'f-lastupdated', 'f-usechunkfiles']) {
    assert.equal(ui.get(id).disabled, false);
    ui.get(id).value = id === 'f-lastupdated' ? '123' : 'edited';
    ui.get(id).emit('input');
    for (const key of ['Rules', 'Outbounds', 'DnsServers', 'QueryStrategy', 'BlockAds',
      'RemoteDNSType', 'DomesticDNSType', 'DomainStrategy', 'DirectSites']) {
      assert.deepEqual(ui.output()[key], fullProfile[key], `${id}: ${key}`);
    }
  }
  ui.get('f-dnshosts').value = '{"changed":"192.0.2.1"}';
  ui.get('f-dnshosts').emit('input');
  assert.deepEqual(ui.output().DnsHosts, { changed: '192.0.2.1' });
});

test('form: full DNS alone and empty full fields stay authoritative; JSON edits apply', () => {
  const ui = routingHarness();
  for (const DnsServers of [fullProfile.DnsServers, []]) {
    ui.import({ ...profileToJson(defaultProfile()), DnsServers });
    assert.equal(ui.get('dns-add').disabled, false);
    assert.equal(ui.get('f-dnshosts').disabled, false);
    assert.equal(ui.get('f-fakedns').disabled, false);
    assert.equal(ui.get('f-globalproxy').disabled, false);
    ui.get('f-name').value = 'Renamed';
    ui.get('f-name').emit('input');
    assert.deepEqual(ui.output().DnsServers, DnsServers);
  }
  ui.import({ Rules: [], Outbounds: [] });
  assert.equal(ui.get('f-routeorder').disabled, false);
  assert.deepEqual(ui.output().Rules, []);
  assert.deepEqual(ui.output().Outbounds, []);
  ui.get('json-editor').value = JSON.stringify(fullProfile);
  ui.get('json-editor').emit('input');
  ui.get('json-apply').click();
  assert.deepEqual(ui.output(), fullProfile);
  const previous = ui.get('link-output').value;
  ui.get('json-editor').value = JSON.stringify({ DnsServers: [{ address: 'x', enabled: 'false' }] });
  ui.get('json-apply').click();
  assert.equal(ui.get('json-status').hidden, false);
  assert.equal(ui.get('link-output').value, previous);
  ui.import({ Outbounds: [] });
  assert.equal(ui.get('f-directdomainstrategy').disabled, true);
  assert.equal(ui.get('dns-add').disabled, false);
  ui.import({});
  assert.equal(ui.get('advanced-notice').hidden, true);
  assert.equal(ui.get('f-directdomainstrategy').disabled, false);
  assert.equal(ui.lists[0].input.disabled, false);
});

test('form: raw JSON, base64 and link imports preserve identical public profile', () => {
  const ui = routingHarness();
  for (const input of [fullProfile, encodeText(JSON.stringify(fullProfile)),
    `imsel://routing/onadd/${encodeText(JSON.stringify(fullProfile))}`]) {
    ui.import(input);
    assert.deepEqual(ui.output(), fullProfile);
  }
});

test('form: templates, fallback, BlockAds and Geo controls produce admitted profiles', () => {
  const ui = routingHarness();
  ui.get('template-select').value = 'app'; ui.get('template-apply').click();
  assert.equal(ui.output().Rules.length, 4);
  assert.equal(ui.output().DnsServers[0].address, '1.1.1.1');
  ui.get('f-globalproxy').checked = false; ui.get('f-globalproxy').emit('input');
  assert.equal(ui.output().GlobalProxy, 'false');
  assert.equal(ui.output().Rules[3].port, '0-65535');
  ui.get('f-blockads').checked = false; ui.get('f-blockads').emit('change');
  assert.equal(ui.output().BlockAds, false);
  ui.get('f-geoipchecksum').value = 'https://geo.example.org/ip.sha256';
  ui.get('f-geoipchecksum').emit('input');
  ui.get('f-geointerval').value = '48'; ui.get('f-geointerval').emit('input');
  assert.equal(ui.output().GeoipSha256Url, 'https://geo.example.org/ip.sha256');
  assert.equal(ui.output().GeoUpdateIntervalHours, 48);
  ui.get('f-geointerval').value = '8761'; ui.get('f-geointerval').emit('input');
  assert.equal(ui.get('link-output').value, '');
  ui.get('f-geositechecksum').value = 'https://geo.example.org/site.sha256';
  ui.get('f-geositechecksum').emit('input');
  ui.get('f-geointerval').value = '0'; ui.get('f-geointerval').emit('input');
  assert.equal(ui.output().GeositeSha256Url, 'https://geo.example.org/site.sha256');
  assert.equal(ui.output().GeoUpdateIntervalHours, 0);
});

test('form: Geo fields survive unrelated edits without locking simplified controls', () => {
  const ui = routingHarness();
  const fields = { GeoipSha256Url: 'https://geo.example.org/ip.sha256',
    GeositeSha256Url: '', GeoUpdateIntervalHours: 0 };
  const input = { ...profileToJson(defaultProfile()), ...fields };
  for (const source of [input, encodeText(JSON.stringify(input)),
    `imsel://routing/onadd/${encodeText(JSON.stringify(input))}`]) {
    ui.import(source);
    assert.equal(ui.get('advanced-notice').hidden, true);
    assert.equal(ui.get('f-globalproxy').disabled, false);
    assert.equal(ui.get('dns-add').disabled, false);
    for (const id of ['f-name', 'f-geoipurl', 'f-geositeurl', 'f-usechunkfiles']) {
      ui.get(id).value = id === 'f-name' ? 'Renamed' : 'https://changed.example.org/data';
      if (id === 'f-usechunkfiles') ui.get(id).checked = !ui.get(id).checked;
      ui.get(id).emit('input');
      for (const key of Object.keys(fields)) assert.equal(ui.output()[key], fields[key]);
    }
  }
  ui.import({ ...fullProfile, ...fields });
  ui.get('f-name').value = 'Full profile renamed';
  ui.get('f-name').emit('input');
  assert.deepEqual(ui.output(), { ...fullProfile, ...fields, Name: 'Full profile renamed' });
  ui.get('json-editor').value = JSON.stringify({ ...input, GeoUpdateIntervalHours: 8760 });
  ui.get('json-apply').click();
  assert.equal(ui.output().GeoUpdateIntervalHours, 8760);
  const previous = ui.get('link-output').value;
  ui.get('json-editor').value = JSON.stringify({ ...input, GeoUpdateIntervalHours: true });
  ui.get('json-apply').click();
  assert.equal(ui.get('link-output').value, previous);
  ui.import({});
  assert.equal(ui.get('advanced-notice').hidden, true);
  for (const key of Object.keys(fields)) assert.equal(Object.hasOwn(ui.output(), key), false);
});

// ── QR-библиотека (вендоренная) ───────────────────────────────────────
test('form: invalid DNS draft clears generated link and QR until fixed', () => {
  const ui = routingHarness();
  ui.get('dns-editor-status').hidden = false;
  ui.get('f-name').value = 'Pending DNS';
  ui.get('f-name').emit('input');
  assert.equal(ui.get('link-output').value, '');
  assert.equal(ui.get('link-copy').disabled, true);
  assert.equal(ui.get('qr-box').hidden, true);
  ui.get('dns-editor-status').hidden = true;
  ui.get('f-name').emit('input');
  assert.ok(ui.get('link-output').value.startsWith('imsel://routing/'));
  assert.equal(ui.get('link-copy').disabled, false);
});

test('source links: one-off/automatic, commands, raw and encoded URL queries', () => {
  for (const automatic of [false, true]) {
    for (const command of ['add', 'onadd']) {
      const url = 'https://example.org/profile.json?data=a%2Fb%2Bz&key=123';
      const link = buildSourceLink(url, { automatic, command });
      assert.equal(link, `imsel://${automatic ? 'autorouting' : 'routing'}/${command}/${url}`);
      for (const raw of [link, link.replace(url, encodeURIComponent(url))]) {
        const parsed = parseRoutingLink(raw);
        assert.equal(parsed.sourceUrl, url);
        assert.equal(parsed.automatic, automatic);
        assert.equal(parsed.command, command);
        assert.equal(parsed.profile, null);
      }
    }
  }
  assert.equal(parseRoutingLink('imsel://routing/https://example.org/p').sourceUrl,
    'https://example.org/p');
});

test('form: invalid graph after a simplified toggle clears export without throwing', () => {
  const ui = routingHarness();
  ui.import({ GlobalProxy: true, Outbounds: [] });
  ui.get('f-globalproxy').checked = false;
  ui.get('f-globalproxy').emit('input');
  assert.equal(ui.get('profile-graph-error').hidden, false);
  assert.equal(ui.get('link-output').value, '');
  assert.equal(ui.get('link-copy').disabled, true);
  ui.get('f-globalproxy').checked = true;
  ui.get('f-globalproxy').emit('input');
  assert.equal(ui.get('profile-graph-error').hidden, true);
  assert.ok(ui.get('link-output').value);
});

test('source links: invalid URL forms and automatic inline profiles rejected', () => {
  for (const url of ['', '/relative', 'ftp://example.org/p', 'https://user:pass@example.org/p',
    'https://example.org/p#', 'https://example.org/p#x', 'https://example.org:0/p',
    'https://example.org:65536/p', 'https://example.org/a b', 'https://example.org/\\p']) {
    assert.throws(() => validateRoutingSourceUrl(url));
    assert.throws(() => buildSourceLink(url));
  }
  assert.throws(() => parseRoutingLink(`imsel://autorouting/onadd/${encodeProfileB64(defaultProfile())}`));
  assert.throws(() => parseRoutingLink('imsel://routing/onadd/https://example.org/p#fragment'));
  assert.throws(() => parseRoutingLink('imsel://routing/onadd/https://example.org/p#'));
  assert.equal(validateRoutingSourceUrl('  http://example.org/p  '), 'http://example.org/p');
});

test('graph: both detour styles resolve; nested extensions remain untouched', () => {
  const json = {
    GlobalProxy: 'false',
    Outbounds: [
      { tag: 'direct', protocol: 'freedom' },
      { tag: 'first', protocol: 'socks', proxySettings: { tag: 'second', extra: [1, 2] } },
      { tag: 'second', protocol: 'socks', streamSettings: { sockopt: { dialerProxy: 'direct', mark: 1 } } },
    ],
    Rules: [{ action: 'custom', customTag: 'first', domain: ['full:example.org'] },
      { action: 'dns', enabled: false }],
  };
  const result = profileToJson(profileFromJson(json));
  assert.deepEqual(result.Outbounds, json.Outbounds);
  assert.deepEqual(result.Rules, json.Rules);
});

test('graph: invalid tags, references, cycles, incompatible edges and empty enabled rules reject', () => {
  const ob = (tag, extra = {}) => ({ tag, protocol: 'freedom', ...extra });
  const invalid = [
    { Outbounds: [ob('')] }, { Outbounds: [ob(' extra')] },
    ...['proxy', 'socks', 'socks-lan', 'http'].map((tag) => ({ Outbounds: [ob(tag)] })),
    { Outbounds: [ob('a'), ob('a')] }, { Outbounds: [ob('a', { protocol: ' ' })] },
    { Outbounds: [ob('a', { proxySettings: {} })] },
    { Outbounds: [ob('a', { proxySettings: { tag: null } })] },
    { Outbounds: [ob('a', { proxySettings: { tag: 'missing' } })] },
    { Outbounds: [ob('a', { proxySettings: { tag: 'a' } })] },
    { Outbounds: [ob('a', { proxySettings: { tag: 'b' } }),
      ob('b', { streamSettings: { sockopt: { dialerProxy: 'a' } } })] },
    { Outbounds: [ob('a', { proxySettings: { tag: 'b' },
      streamSettings: { sockopt: { dialerProxy: 'b' } } }), ob('b')] },
    { Outbounds: [ob('a', { streamSettings: [] })] },
    { Outbounds: [ob('a', { streamSettings: { sockopt: { dialerProxy: 1 } } })] },
    { GlobalProxy: false, Outbounds: [] },
    { Outbounds: [], Rules: [{ action: 'direct', domain: ['x'] }] },
    { Outbounds: [], DirectSites: ['x'] }, { Outbounds: [], BlockIp: ['192.0.2.0/24'] },
    { Outbounds: [], Rules: [{ action: 'custom', customTag: 'dns', domain: ['x'] },
      { action: 'dns', domain: ['y'] }] },
    { Outbounds: [ob('a', { proxySettings: { tag: 'dns' } })], Rules: [{ action: 'dns', domain: ['x'] }] },
    { Rules: [{ action: 'custom', customTag: 'missing', enabled: false }] },
    { Rules: [{ action: 'proxy' }] }, { Rules: [{ action: 'proxy', domain: ['  '] }] },
  ];
  for (const json of invalid) {
    assert.throws(() => profileFromJson(json), (e) => e === LINK_ERRORS.invalidProfile);
    assert.throws(() => parseRoutingLink(`imsel://routing/add/${encodeText(JSON.stringify(json))}`));
  }
  const stale = defaultProfile();
  stale.outbounds = [ob('a', { proxySettings: { tag: 'a' } })];
  assert.throws(() => buildLink(stale, 'add'));
  assert.doesNotThrow(() => profileFromJson({ Rules: [{ action: 'custom', customTag: 'dns', domain: ['x'] }] }));
  assert.doesNotThrow(() => profileFromJson({ Outbounds: [], Rules: [], DirectSites: ['ignored'], BlockAds: true }));
});

test('form: URL modes preserve profile and DNS, invalid URL hides link/QR', () => {
  const ui = routingHarness();
  ui.import(fullProfile);
  const before = ui.get('json-editor').value;
  ui.get('link-mode').value = 'auto';
  ui.get('link-mode').emit('change');
  assert.equal(ui.get('link-output').value, '');
  assert.equal(ui.get('link-copy').disabled, true);
  assert.equal(ui.get('qr-box').hidden, true);
  ui.get('link-source-url').value = 'https://example.org/profile?data=a%2Fb';
  ui.get('link-source-url').emit('input');
  assert.equal(parseRoutingLink(ui.get('link-output').value).automatic, true);
  assert.equal(ui.get('json-editor').value, before);
  ui.import('imsel://routing/onadd/https://example.org/profile?key=1');
  assert.equal(ui.get('link-mode').value, 'url');
  assert.equal(ui.get('link-source-url').value, 'https://example.org/profile?key=1');
  ui.get('link-mode').value = 'inline';
  ui.get('link-mode').emit('change');
  assert.deepEqual(ui.output(), fullProfile);
  const previous = ui.get('link-output').value;
  ui.get('json-editor').value = JSON.stringify({ Rules: [{ action: 'custom', customTag: 'missing', domain: ['x'] }] });
  ui.get('json-apply').click();
  assert.equal(ui.get('json-status').hidden, false);
  assert.equal(ui.get('link-output').value, previous);
});

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
