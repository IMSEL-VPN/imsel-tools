// Standalone public preview regression tests: node tool/test_config_preview.mjs
import assert from 'node:assert/strict';
import { buildConfigPreview } from '../src/js/config-preview.js';

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (error) {
    console.error(`FAIL: ${name}`);
    throw error;
  }
}
const copy = (value) => JSON.parse(JSON.stringify(value));
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
function code(expected, fn) {
  assert.throws(fn, (error) => error instanceof Error
    && error.message === expected && error.code === expected);
}
function valid(config) {
  assert.deepEqual(copy(config), config, 'no undefined or non-JSON output values');
  const tags = new Set(config.outbounds.map((outbound) => outbound.tag));
  assert.equal(tags.size, config.outbounds.length, 'unique outbound tags');
  for (const rule of config.routing.rules) {
    assert.equal(rule.type, 'field');
    assert.equal(tags.has(rule.outboundTag), true, 'all rules resolve to an outbound');
    if (rule.inboundTag) {
      for (const tag of rule.inboundTag) {
        assert.equal(config.inbounds.some((inbound) => inbound.tag === tag), true);
      }
    }
  }
  return config;
}
const build = (...args) => valid(buildConfigPreview(...args));
const byTag = (config, tag) => config.outbounds.find((outbound) => outbound.tag === tag);
const sample = () => ({
  name: 'Public sample', globalProxy: true, fakeDns: false,
  remoteDnsType: 'DoH', remoteDnsDomain: 'https://cloudflare-dns.com/dns-query',
  remoteDnsIp: '1.1.1.1', domesticDnsType: 'DoU', domesticDnsIp: '8.8.8.8',
  dnsHosts: { 'cloudflare-dns.com': '1.1.1.1' },
  directSites: ['geosite:private'], directIp: ['10.0.0.0/8'],
  proxySites: ['domain:proxy.example'], proxyIp: ['203.0.113.0/24'],
  blockSites: ['domain:blocked.example'], blockIp: ['192.0.2.0/24'],
  domainStrategy: 'IPIfNonMatch', directDomainStrategy: 'AsIs',
  routeOrder: 'block,direct,proxy', blockAds: true,
  geoipUrl: 'https://geo.example/geoip.dat', geositeUrl: 'https://geo.example/geosite.dat',
  geoipSha256Url: 'https://geo.example/geoip.sha256',
  geoUpdateIntervalHours: 24, useChunkFiles: true, lastUpdated: 123,
});
const simpleBase = () => ({
  log: { loglevel: 'error', access: 'none' },
  inbounds: [{ tag: 'local-in', protocol: 'socks', listen: '127.0.0.1', port: 10080,
    settings: { auth: 'password', accounts: [{ user: 'test-user', pass: 'test-password' }] },
    sniffing: { enabled: true, destOverride: ['http', 'tls'] } }],
  outbounds: [{ tag: 'chosen', protocol: 'vless',
    settings: { vnext: [{ address: 'vpn.example.invalid', port: 443,
      users: [{ id: '00000000-0000-0000-0000-000000000000', encryption: 'none' }] }] },
    streamSettings: { network: 'tcp', security: 'tls',
      tlsSettings: { serverName: 'vpn.example.invalid', allowInsecure: false,
        pinnedPeerCertSha256: ['abc123'], alpn: ['h2'] } } }],
  dns: { servers: ['localhost'], hosts: { 'old.example': '192.0.2.1' } },
  routing: { domainMatcher: 'hybrid', domainStrategy: 'AsIs',
    rules: [{ type: 'field', domain: ['domain:old.example'], outboundTag: 'chosen' }] },
});

test('minimal template is explicitly demonstrative with a safe placeholder', () => {
  const config = build({});
  assert.deepEqual(config.log, { loglevel: 'warning' });
  assert.deepEqual(config.outbounds[0], { tag: 'proxy', protocol: 'socks',
    settings: { servers: [{ address: 'proxy.example.invalid', port: 1080 }] } });
  assert.deepEqual(config.inbounds[0], { tag: 'socks', listen: '127.0.0.1',
    port: 10808, protocol: 'socks', settings: { udp: true },
    sniffing: { enabled: true, destOverride: ['http', 'tls'] } });
  assert.deepEqual(config.routing, { domainStrategy: 'IPIfNonMatch',
    rules: [{ type: 'field', network: 'tcp,udp', outboundTag: 'proxy' }] });
  assert.deepEqual(config.dns, { servers: ['localhost'], queryStrategy: 'UseIP' });
});

test('full public sample emits all six simple fields in category/domain-before-IP order', () => {
  const p = freeze(sample());
  const config = build(p);
  assert.deepEqual(config.routing.rules, [
    { type: 'field', domain: p.blockSites, outboundTag: 'preview-block' },
    { type: 'field', ip: p.blockIp, outboundTag: 'preview-block' },
    { type: 'field', domain: p.directSites, outboundTag: 'preview-direct' },
    { type: 'field', ip: p.directIp, outboundTag: 'preview-direct' },
    { type: 'field', domain: p.proxySites, outboundTag: 'proxy' },
    { type: 'field', ip: p.proxyIp, outboundTag: 'proxy' },
    { type: 'field', network: 'tcp,udp', outboundTag: 'proxy' },
  ]);
  assert.deepEqual(config.dns.servers, [
    { address: 'https://cloudflare-dns.com/dns-query' }, { address: '8.8.8.8' }, 'localhost',
  ]);
  assert.deepEqual(config.dns.hosts, p.dnsHosts);
  for (const key of ['name', 'blockAds', 'geoipUrl', 'geositeUrl', 'geoipSha256Url',
    'geoUpdateIntervalHours', 'useChunkFiles', 'lastUpdated']) {
    assert.equal(Object.hasOwn(config, key), false);
  }
  assert.equal(JSON.stringify(config).includes('category-ads'), false);
});

test('all six route orders work and partial/unknown/case-duplicate tokens normalize', () => {
  for (const routeOrder of ['block,direct,proxy', 'block,proxy,direct', 'proxy,direct,block',
    'proxy,block,direct', 'direct,proxy,block', 'direct,block,proxy']) {
    const config = build({ ...sample(), routeOrder });
    assert.deepEqual(config.routing.rules.slice(0, 6).map((rule) => rule.outboundTag),
      routeOrder.split(',').flatMap((action) => Array(2)
        .fill(action === 'proxy' ? 'proxy' : `preview-${action}`)));
  }
  const config = build({ ...sample(), routeOrder: 'DIRECT,unknown,direct' });
  assert.deepEqual(config.routing.rules.slice(0, 6).map((rule) => rule.outboundTag),
    ['preview-direct', 'preview-direct', 'proxy', 'proxy', 'preview-block', 'preview-block']);
});

test('missing, empty or wholly unknown routeOrder defaults block/direct/proxy', () => {
  const p = sample();
  delete p.routeOrder;
  assert.equal(build(p).routing.rules[0].outboundTag, 'preview-block');
  for (const routeOrder of ['', '  ', 'unknown,other']) {
    p.routeOrder = routeOrder;
    assert.equal(build(p).routing.rules[0].outboundTag, 'preview-block');
  }
});

test('global default always has an explicit tcp,udp rule for both modes', () => {
  for (const globalProxy of [true, false]) {
    const config = build({ globalProxy });
    const rule = config.routing.rules.at(-1);
    assert.deepEqual(rule, { type: 'field', network: 'tcp,udp',
      outboundTag: globalProxy ? 'proxy' : 'preview-direct' });
    if (!globalProxy) assert.equal(byTag(config, rule.outboundTag).protocol, 'freedom');
  }
});

test('domainStrategy and queryStrategy absent/none mappings', () => {
  assert.equal(build({ domainStrategy: 'none' }).routing.domainStrategy, 'AsIs');
  for (const domainStrategy of ['AsIs', 'IPIfNonMatch', 'IPOnDemand']) {
    assert.equal(build({ domainStrategy }).routing.domainStrategy, domainStrategy);
  }
  for (const queryStrategy of ['none', 'UseIP', 'UseIPv4', 'UseIPv6']) {
    assert.equal(build({ queryStrategy }).dns.queryStrategy,
      queryStrategy === 'none' ? 'UseIP' : queryStrategy);
  }
});

test('directDomainStrategy affects only generated legacy direct freedom', () => {
  for (const directDomainStrategy of [undefined, null, 'AsIs', 'UseIP', 'UseIPv4', 'UseIPv6']) {
    const config = build({ globalProxy: false, directDomainStrategy });
    assert.deepEqual(byTag(config, 'preview-direct').settings,
      !directDomainStrategy || directDomainStrategy === 'AsIs'
        ? {} : { domainStrategy: directDomainStrategy });
  }
  const config = build({ globalProxy: false, directDomainStrategy: 'UseIPv6',
    outbounds: [{ tag: 'direct', protocol: 'freedom', settings: { domainStrategy: 'UseIPv4' } }] });
  assert.deepEqual(byTag(config, 'direct').settings, { domainStrategy: 'UseIPv4' });
});

test('advanced rules override all legacy lists, including an explicit empty list', () => {
  const cleared = build({ ...sample(), rules: [] });
  assert.equal(cleared.routing.rules.length, 1);
  const config = build({ ...sample(), rules: [{ action: 'proxy', domain: ['only.example'] }] });
  assert.equal(config.routing.rules.length, 2);
  assert.deepEqual(config.routing.rules[0].domain, ['only.example']);
});

test('advanced DNS first, category ordering, then custom; disabled rules skipped', () => {
  const config = build({ routeOrder: 'DIRECT,PROXY,BLOCK', rules: [
    { action: 'custom', customTag: 'tail', domain: ['custom.example'] },
    { action: 'block', domain: ['blocked.example'] },
    { action: 'proxy', domain: ['proxy.example'] },
    { action: 'dns', port: '53' },
    { action: 'direct', domain: ['direct.example'] },
    { action: 'proxy', enabled: false, domain: ['disabled.example'] },
  ] });
  assert.deepEqual(config.routing.rules.map((rule) => rule.outboundTag),
    ['preview-dns', 'preview-direct', 'proxy', 'preview-block', 'tail', 'proxy']);
  assert.equal(byTag(config, 'tail').protocol, 'freedom');
});

test('advanced conditions stay AND-combined and unknown/raw fields never propagate', () => {
  const source = freeze({ action: 'proxy', enabled: true, id: 'id', name: 'name', locked: true,
    domain: ['domain:combined.example'], ip: ['192.0.2.0/24'],
    process: ['browser'], protocol: ['tls'], port: '80,443', network: 'tcp',
    outboundTag: 'not-a-real-target', balancerTag: 'not-a-balancer', source: ['ignored'],
    inboundTag: ['ignored'], type: 'not-a-field', customFutureField: { ignored: true } });
  assert.deepEqual(build({ rules: [source] }).routing.rules[0], {
    type: 'field', domain: source.domain, ip: source.ip, process: source.process,
    protocol: source.protocol, port: '80,443', network: 'tcp', outboundTag: 'proxy',
  });
});

test('custom empty tag means direct, proxy maps selected tag, empty conditions remain valid', () => {
  const config = build({ rules: [
    { action: 'custom', customTag: '' }, { action: 'custom', customTag: 'proxy' },
    { action: 'custom', customTag: 'block' }, { action: 'custom', customTag: 'dns' },
  ] }, simpleBase(), 'chosen');
  assert.deepEqual(config.routing.rules.map((rule) => rule.outboundTag),
    ['preview-direct', 'chosen', 'preview-block', 'preview-dns', 'chosen']);
  config.routing.rules.forEach((rule) => assert.equal(rule.network, 'tcp,udp'));
});

test('explicit Outbounds preserve exact settings and add all entries, including unused ones', () => {
  const outbounds = freeze([
    { tag: 'direct', protocol: 'freedom', settings: { domainStrategy: 'UseIPv4', redirect: ':443' } },
    { tag: 'block', protocol: 'blackhole', settings: { response: { type: 'http' } } },
    { tag: 'special', protocol: 'socks', settings: { servers: [{ address: 'hop.invalid',
      port: 1080, users: [{ user: 'sample', pass: 'sample' }] }] } },
    { tag: 'unused', protocol: 'freedom', settings: { userLevel: 1 } },
  ]);
  const config = build({ globalProxy: false, outbounds, rules: [
    { action: 'direct', domain: ['direct.example'] }, { action: 'block', domain: ['block.example'] },
    { action: 'custom', customTag: 'special' },
  ] });
  assert.deepEqual(config.outbounds.slice(1), outbounds);
  assert.deepEqual(config.routing.rules.map((rule) => rule.outboundTag),
    ['block', 'direct', 'special', 'direct']);
});

test('explicit Outbounds:[] never rescues required direct/block/custom dependencies', () => {
  build({ outbounds: [], rules: [] });
  for (const p of [
    { globalProxy: false }, { directSites: ['direct.example'] }, { blockIp: ['192.0.2.1'] },
    { rules: [{ action: 'custom', customTag: '' }] },
    { rules: [{ action: 'custom', customTag: 'missing' }] },
  ]) code('invalidTarget', () => buildConfigPreview({ ...p, outbounds: [] }));
  const base = simpleBase();
  base.outbounds.push({ tag: 'direct', protocol: 'freedom', settings: {} });
  code('invalidTarget', () => buildConfigPreview({ globalProxy: false, outbounds: [] }, base, 'chosen'));
});

test('explicit Outbounds missing or wrong service protocol fails closed', () => {
  for (const [action, protocol] of [['direct', 'blackhole'], ['block', 'freedom']]) {
    code('invalidTarget', () => buildConfigPreview({
      outbounds: [{ tag: action, protocol, settings: {} }], rules: [{ action }],
    }));
  }
  code('invalidTarget', () => buildConfigPreview({ outbounds: [
    { tag: 'dns', protocol: 'freedom', settings: {} },
  ], rules: [{ action: 'dns' }] }));
});

test('explicit DNS helper is preserved and missing DNS helper is allocated safely', () => {
  const dns = { tag: 'dns', protocol: 'dns', settings: {
    network: 'tcp', address: '192.0.2.53', port: 5353, nonIPQuery: 'skip',
  } };
  const config = build({ outbounds: [dns], fakeDns: true, rules: [{ action: 'dns', port: '53' }] });
  assert.deepEqual(byTag(config, 'dns'), dns);
  assert.equal(config.routing.rules[0].outboundTag, 'dns');
  assert.equal(config.routing.rules[1].outboundTag, 'dns');
  const absent = build({ outbounds: [], rules: [{ action: 'dns', port: '53' }] });
  assert.equal(byTag(absent, absent.routing.rules[0].outboundTag).protocol, 'dns');
});

test('explicit Outbounds rejects duplicates, collisions and reserved names', () => {
  for (const tag of ['proxy', 'socks', 'http', 'socks-lan', 'Proxy', 'Socks']) {
    code('invalidTarget', () => buildConfigPreview({ outbounds: [{ tag, protocol: 'freedom' }] }));
  }
  code('invalidTarget', () => buildConfigPreview({ outbounds: [
    { tag: 'same', protocol: 'freedom' }, { tag: 'same', protocol: 'blackhole' },
  ] }));
  for (const tag of ['chosen', 'local-in']) {
    code('invalidTarget', () => buildConfigPreview({ outbounds: [{ tag, protocol: 'freedom' }] },
      simpleBase(), 'chosen'));
  }
});

test('base original helpers are untouched; generated helper names avoid every existing tag', () => {
  const base = simpleBase();
  for (const [tag, protocol] of [['direct', 'freedom'], ['block', 'blackhole'],
    ['preview-direct', 'freedom'], ['preview-direct-2', 'freedom'],
    ['preview-block', 'blackhole'], ['preview-dns', 'dns']]) {
    base.outbounds.push({ tag, protocol, settings: { foreign: tag } });
  }
  const config = build({ ...sample(), fakeDns: false, rules: [
    { action: 'direct' }, { action: 'block' }, { action: 'dns' },
  ] }, freeze(base), 'chosen');
  assert.deepEqual(config.outbounds.slice(0, base.outbounds.length), base.outbounds);
  assert.deepEqual(config.routing.rules.map((rule) => rule.outboundTag),
    ['preview-dns-2', 'preview-block-2', 'preview-direct-3', 'chosen']);
});

test('custom target can use a preserved base outbound; unknown legacy custom gets freedom', () => {
  const base = simpleBase();
  base.outbounds.push({ tag: 'existing-custom', protocol: 'freedom', settings: { userLevel: 3 } });
  const config = build({ outbounds: [], rules: [
    { action: 'custom', customTag: 'existing-custom' },
  ] }, base, 'chosen');
  assert.equal(config.routing.rules[0].outboundTag, 'existing-custom');
  const legacy = build({ rules: [{ action: 'custom', customTag: 'new-custom' }] });
  assert.deepEqual(byTag(legacy, 'new-custom'), { tag: 'new-custom', protocol: 'freedom', settings: {} });
});

test('prototype-key and generated-name custom tags never cause implicit lookup or collisions', () => {
  const tags = ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'preview-direct'];
  const config = build({ globalProxy: false, rules: tags.map((customTag) => ({
    action: 'custom', customTag, domain: [`domain:${customTag}.invalid`],
  })) });
  for (const tag of tags) {
    assert.deepEqual(byTag(config, tag), { tag, protocol: 'freedom', settings: {} });
  }
  assert.equal(config.routing.rules.at(-1).outboundTag, 'preview-direct-2');
  const explicit = build({ outbounds: [{ tag: '__proto__', protocol: 'freedom',
    settings: { keep: true } }], rules: [{ action: 'custom', customTag: '__proto__' }] });
  assert.deepEqual(byTag(explicit, '__proto__').settings, { keep: true });
  const base = simpleBase();
  base.outbounds[0].tag = 'constructor';
  base.routing.rules[0].outboundTag = 'constructor';
  assert.equal(build({}, base, 'constructor').routing.rules.at(-1).outboundTag, 'constructor');
});

test('generated helpers cannot capture a later custom name and change its meaning', () => {
  const config = build({ rules: [
    { action: 'block', domain: ['blocked.invalid'] },
    { action: 'dns', port: '53' },
    { action: 'custom', customTag: 'preview-block', domain: ['custom.invalid'] },
    { action: 'custom', customTag: 'preview-dns', domain: ['custom-dns.invalid'] },
  ] });
  assert.equal(byTag(config, 'preview-block').protocol, 'freedom');
  assert.equal(byTag(config, 'preview-dns').protocol, 'freedom');
  assert.equal(byTag(config, 'preview-block-2').protocol, 'blackhole');
  assert.equal(byTag(config, 'preview-dns-2').protocol, 'dns');
});

test('legacy custom synthesis rejects arbitrary base inbound-tag collisions', () => {
  code('invalidTarget', () => buildConfigPreview({ rules: [
    { action: 'custom', customTag: 'local-in' },
  ] }, simpleBase(), 'chosen'));
});

test('modern DNS overrides legacy fields, supports enabled omission, domains and ports', () => {
  const config = build({ ...sample(), queryStrategy: 'UseIPv6', dnsServers: [
    { address: '9.9.9.9', domains: ['geosite:private'] },
    { address: 'tcp://dns.example.invalid', port: '0053', enabled: true },
    { address: 'https://dns.example.invalid/dns-query' },
    { address: 'https://other.example.invalid/dns-query', port: '443' },
    { address: '192.0.2.53', enabled: false },
  ] });
  assert.deepEqual(config.dns, { servers: [
    { address: '9.9.9.9', port: 53, domains: ['geosite:private'] },
    { address: 'tcp://dns.example.invalid', port: 53 },
    { address: 'https://dns.example.invalid/dns-query' },
    { address: 'https://other.example.invalid/dns-query', port: 443 }, 'localhost',
  ], queryStrategy: 'UseIPv6', hosts: sample().dnsHosts });
});

test('modern empty DNS suppresses remote/domestic and always appends localhost', () => {
  assert.deepEqual(build({ ...sample(), dnsServers: [] }).dns.servers, ['localhost']);
  assert.deepEqual(build({ dnsServers: [{ address: 'localhost' }] }).dns.servers,
    [{ address: 'localhost', port: 53 }, 'localhost']);
  assert.equal(Object.hasOwn(build({ dnsHosts: {} }).dns, 'hosts'), false);
});

test('legacy DoH prefers domain then builds IP URL; other types prefer IP then domain', () => {
  for (const ip of ['1.1.1.1', '2606:4700:4700::1111']) {
    const host = ip.includes(':') ? `[${ip}]` : ip;
    assert.deepEqual(build({ remoteDnsType: 'DoH', remoteDnsIp: ip }).dns.servers,
      [{ address: `https://${host}/dns-query` }, 'localhost']);
  }
  assert.deepEqual(build({ remoteDnsType: 'DoH', remoteDnsDomain: 'https://preferred.invalid/dns-query',
    remoteDnsIp: '1.1.1.1', domesticDnsType: 'DoU', domesticDnsDomain: 'fallback.invalid' }).dns.servers,
  [{ address: 'https://preferred.invalid/dns-query' }, { address: 'fallback.invalid' }, 'localhost']);
});

test('invalid DNS produces only stable invalidDns errors', () => {
  for (const port of ['0', '65536', '-1', '53x', '1.5', 'NaN', ' 53', 53, null]) {
    code('invalidDns', () => buildConfigPreview({ dnsServers: [{ address: '1.1.1.1', port }] }));
  }
  for (const dnsServers of [null, {}, ['1.1.1.1'], [{ address: '' }], [{ address: 1 }],
    [{ address: 'has spaces' }], [{ address: '1.1.1.1', domains: 'x' }],
    [{ address: '1.1.1.1', domains: [1] }], [{ address: '1.1.1.1', enabled: 'false' }]]) {
    code('invalidDns', () => buildConfigPreview({ dnsServers }));
  }
  code('invalidDns', () => buildConfigPreview({ dnsHosts: [] }));
  code('invalidDns', () => buildConfigPreview({ queryStrategy: 'invalid' }));
  code('invalidDns', () => buildConfigPreview({ remoteDnsIp: 42 }));
});

test('FakeDNS template contains required pools, sniffing and first DNS interception rule', () => {
  const config = build({ ...sample(), fakeDns: true, dnsServers: [] });
  assert.deepEqual(config.fakedns, [{ ipPool: '198.18.0.0/15', poolSize: 65535 },
    { ipPool: 'fc00::/18', poolSize: 65535 }]);
  assert.deepEqual(config.dns.servers, [{ address: 'fakedns' }, 'localhost']);
  assert.deepEqual(config.inbounds[0].sniffing, {
    enabled: true, destOverride: ['http', 'tls', 'fakedns'],
  });
  assert.deepEqual(config.routing.rules[0], {
    type: 'field', inboundTag: ['socks'], port: '53', outboundTag: 'preview-dns',
  });
});

test('FakeDNS base uses actual supported inbound tag without changing inbound data', () => {
  const base = simpleBase();
  base.inbounds[0].sniffing.destOverride.push('fakedns');
  base.inbounds[0].sniffing.routeOnly = true;
  const config = build({ fakeDns: true }, freeze(base), 'chosen');
  assert.deepEqual(config.inbounds, base.inbounds);
  assert.deepEqual(config.routing.rules[0].inboundTag, ['local-in']);
});

test('FakeDNS rejects missing/ambiguous/incompatible inputs and preexisting pools', () => {
  for (const mutate of [
    (b) => { delete b.inbounds; }, (b) => { b.inbounds = []; },
    (b) => { delete b.inbounds[0].tag; }, (b) => { b.inbounds[0].protocol = 'http'; },
    (b) => { delete b.inbounds[0].sniffing; },
    (b) => { b.inbounds[0].sniffing.enabled = false; },
    (b) => { b.inbounds[0].sniffing.destOverride = ['http', 'tls']; },
    (b) => { b.inbounds.push({ ...copy(b.inbounds[0]), tag: 'second-socks' }); },
    (b) => { b.fakedns = [{ ipPool: '198.18.0.0/16', poolSize: 100 }]; },
  ]) {
    const base = simpleBase();
    base.inbounds[0].sniffing.destOverride.push('fakedns');
    mutate(base);
    code('unsupportedTopology', () => buildConfigPreview({ fakeDns: true }, base, 'chosen'));
  }
});

test('FakeDNS off removes only top-level pools, never rewrites base sniffing', () => {
  const base = simpleBase();
  base.fakedns = [{ ipPool: '198.18.0.0/16', poolSize: 100 }];
  base.inbounds[0].sniffing.destOverride.push('fakedns');
  const config = build({ fakeDns: false }, freeze(base), 'chosen');
  assert.equal(Object.hasOwn(config, 'fakedns'), false);
  assert.deepEqual(config.inbounds, base.inbounds);
  assert.equal(Object.hasOwn(base, 'fakedns'), true);
});

test('large base preserves all six original outbounds, TLS/credentials and foreign data', () => {
  const base = simpleBase();
  base.outbounds.push(
    { tag: 'other-proxy', protocol: 'socks', settings: { servers: [{ address: 'other.invalid',
      port: 1080, users: [{ user: 'other', pass: 'other' }] }] } },
    { tag: 'direct', protocol: 'freedom', settings: { domainStrategy: 'UseIPv6' } },
    { tag: 'block', protocol: 'blackhole', settings: { response: { type: 'http' } } },
    { tag: 'dns', protocol: 'dns', settings: { network: 'udp', address: '192.0.2.53', port: 53 } },
    { tag: 'extra', protocol: 'trojan', settings: { servers: [{ address: 'extra.invalid',
      password: 'sample', port: 443 }] }, streamSettings: { security: 'tls',
      tlsSettings: { serverName: 'extra.invalid', allowInsecure: false } } },
  );
  base.foreignField = { payload: 'x'.repeat(120_000), nested: { keep: [true, null, 42] } };
  base.policy = { system: { statsOutboundUplink: true } };
  base.routing.foreignField = { keep: true };
  const snapshot = copy(base);
  assert.ok(JSON.stringify(base).length > 100 * 1024);
  const config = build({ ...sample(), directDomainStrategy: 'UseIPv4' }, freeze(base), 'chosen');
  assert.deepEqual(base, snapshot);
  assert.deepEqual(config.outbounds.slice(0, 6), snapshot.outbounds);
  assert.deepEqual(config.inbounds, snapshot.inbounds);
  assert.deepEqual(config.log, snapshot.log);
  assert.deepEqual(config.policy, snapshot.policy);
  assert.deepEqual(config.foreignField, snapshot.foreignField);
  assert.equal(config.routing.domainMatcher, 'hybrid');
  assert.deepEqual(config.routing.foreignField, { keep: true });
  assert.notDeepEqual(config.routing.rules, snapshot.routing.rules);
  assert.notDeepEqual(config.dns, snapshot.dns);
  assert.equal(config.routing.rules.at(-1).outboundTag, 'chosen');
});

test('output is independent in both directions, including profile settings and DNS hosts', () => {
  const p = sample();
  p.outbounds = [{ tag: 'direct', protocol: 'freedom', settings: { custom: { keep: true } } },
    { tag: 'block', protocol: 'blackhole', settings: {} }];
  const base = simpleBase();
  const beforeProfile = copy(p);
  const beforeBase = copy(base);
  const config = build(p, base, 'chosen');
  config.inbounds[0].settings.accounts[0].pass = 'changed';
  config.outbounds[0].streamSettings.tlsSettings.allowInsecure = true;
  byTag(config, 'direct').settings.custom.keep = false;
  config.dns.hosts['cloudflare-dns.com'] = 'changed';
  config.routing.rules[0].domain.push('changed');
  assert.deepEqual(p, beforeProfile);
  assert.deepEqual(base, beforeBase);
  p.outbounds[0].settings.custom.keep = false;
  base.outbounds[0].settings.vnext[0].address = 'changed';
  assert.equal(config.outbounds[0].settings.vnext[0].address, 'vpn.example.invalid');
});

test('existing JSON always requires a valid explicit non-service proxy selection', () => {
  for (const tag of ['', null, 42, 'missing']) {
    code('selectProxy', () => buildConfigPreview({}, simpleBase(), tag));
  }
  for (const protocol of ['freedom', 'blackhole', 'dns']) {
    const base = simpleBase();
    base.outbounds.push({ tag: 'service', protocol, settings: {} });
    code('selectProxy', () => buildConfigPreview({}, base, 'service'));
  }
});

test('base missing optional DNS/routing/inbounds remains supported without FakeDNS', () => {
  const base = { outbounds: simpleBase().outbounds };
  const config = build({}, freeze(base), 'chosen');
  assert.equal(Object.hasOwn(config, 'inbounds'), false);
  assert.deepEqual(config.dns.servers, ['localhost']);
  assert.equal(config.routing.rules.at(-1).outboundTag, 'chosen');
});

test('base globalProxy false uses a generated direct without changing native services', () => {
  const base = simpleBase();
  base.outbounds.push({ tag: 'direct', protocol: 'freedom', settings: { redirect: ':8443' } });
  const config = build({ globalProxy: false }, freeze(base), 'chosen');
  assert.equal(config.routing.rules.at(-1).outboundTag, 'preview-direct');
  assert.deepEqual(byTag(config, 'direct'), base.outbounds.at(-1));
  assert.deepEqual(byTag(config, 'preview-direct').settings, {});
});

test('invalid base shapes and duplicate tags fail closed', () => {
  for (const base of [[], 'not-json', {}, { outbounds: [] }, { outbounds: {} }]) {
    code('invalidBase', () => buildConfigPreview({}, base, 'chosen'));
  }
  for (const mutate of [
    (b) => { b.outbounds.push(copy(b.outbounds[0])); },
    (b) => { b.outbounds[0].tag = ''; }, (b) => { b.outbounds[0].protocol = ''; },
    (b) => { b.outbounds[0].settings = []; },
    (b) => { b.outbounds[0].streamSettings.sockopt = []; },
    (b) => { b.inbounds = {}; }, (b) => { b.inbounds = [null]; },
    (b) => { b.inbounds[0].settings = null; },
    (b) => { b.inbounds[0].streamSettings = []; },
    (b) => { b.inbounds[0].listen = {}; },
    (b) => { b.inbounds[0].port = 0; },
    (b) => { b.inbounds.push(copy(b.inbounds[0])); },
    (b) => { b.inbounds[0].sniffing = false; },
    (b) => { b.dns = []; }, (b) => { b.dns.servers = {}; },
    (b) => { b.dns.servers = [{}]; }, (b) => { b.dns.hosts = []; },
    (b) => { b.dns.queryStrategy = {}; },
    (b) => { b.routing = []; }, (b) => { b.routing.rules = {}; },
    (b) => { b.routing.rules = [null]; }, (b) => { b.routing.balancers = {}; },
    (b) => { b.routing.rules[0].domain = 'not-array'; },
    (b) => { b.routing.domainMatcher = {}; },
    (b) => { b.routing.rules[0].network = []; },
    (b) => { b.routing.rules[0].outboundTag = 'missing'; },
  ]) {
    const base = simpleBase();
    mutate(base);
    code('invalidBase', () => buildConfigPreview({}, base, 'chosen'));
  }
});

test('complex base topologies and infrastructure rules are unsupported, never guessed', () => {
  for (const mutate of [
    (b) => { b.reverse = {}; }, (b) => { b.observatory = {}; },
    (b) => { b.api = { tag: 'api', services: ['StatsService'] }; },
    (b) => { b.inbounds[0].protocol = 'loopback'; },
    (b) => { b.burstObservatory = {}; }, (b) => { b.detour = {}; },
    (b) => { b.routing.balancers = [{ tag: 'balance', selector: ['chosen'] }]; },
    (b) => { b.outbounds[0].protocol = 'loopback'; },
    (b) => { b.outbounds[0].proxySettings = { tag: 'chosen' }; },
    (b) => { b.outbounds[0].detour = 'chosen'; },
    (b) => { b.outbounds[0].streamSettings.sockopt = { dialerProxy: 'chosen' }; },
    (b) => { b.routing.rules[0].inboundTag = ['local-in']; },
    (b) => { b.routing.rules[0].balancerTag = 'balance'; },
    (b) => { b.routing.rules[0].protocol = ['dns']; },
    (b) => { b.outbounds.push({ tag: 'internal-dns', protocol: 'dns' });
      b.routing.rules[0].outboundTag = 'internal-dns'; },
  ]) {
    const base = simpleBase();
    mutate(base);
    code('unsupportedTopology', () => buildConfigPreview({}, base, 'chosen'));
  }
  const base = simpleBase();
  base.routing.balancers = [];
  assert.deepEqual(build({}, base, 'chosen').routing.balancers, []);
});

test('explicit outbound cycles/detours/loopbacks are unsupported even if unused', () => {
  for (const outbound of [
    { tag: 'self', protocol: 'freedom', proxySettings: { tag: 'self' } },
    { tag: 'chain', protocol: 'socks', detour: 'chosen' },
    { tag: 'loop', protocol: 'loopback', settings: { inboundTag: 'socks' } },
    { tag: 'dial', protocol: 'freedom', streamSettings: { sockopt: { dialerProxy: 'dial' } } },
  ]) code('unsupportedTopology', () => buildConfigPreview({ outbounds: [outbound] }));
});

test('invalid profiles, actions, target shapes and types have stable codes', () => {
  for (const profile of [null, [], 'profile', 42, { globalProxy: 'false' }, { fakeDns: 'true' },
    { routeOrder: [] }, { domainStrategy: 'unknown' }, { rules: null }, { rules: [{}] },
    { rules: [{ outboundTag: 'proxy' }] }, { rules: [{ action: 'unknown' }] },
    { rules: [{ action: 'proxy', domain: 'string' }] },
    { rules: [{ action: 'proxy', process: [1] }] },
    { rules: [{ action: 'proxy', enabled: 'false' }] },
    { rules: [{ action: 'proxy', port: 443 }] }, { directSites: 'string' },
    { outbounds: null }]) {
    code('invalidProfile', () => buildConfigPreview(profile));
  }
  for (const outbound of [null, {}, { tag: '', protocol: 'freedom' },
    { tag: 'x', protocol: '' }, { tag: ' x', protocol: 'freedom' },
    { tag: 'x', protocol: 'freedom', settings: [] }]) {
    code('invalidTarget', () => buildConfigPreview({ outbounds: [outbound] }));
  }
});

test('errors never include source data, JSON exception messages or proxy credentials', () => {
  const p = { name: 'SECRET-MARKER', rules: [{ action: 'custom', customTag: 'SECRET-MARKER' }],
    outbounds: [] };
  code('invalidTarget', () => buildConfigPreview(p));
  const circular = {};
  circular.self = circular;
  code('invalidProfile', () => buildConfigPreview(circular));
  const base = simpleBase();
  base.foreign = circular;
  code('invalidBase', () => buildConfigPreview({}, base, 'chosen'));
});

test('repeated builds are deterministic and isolated across template and base selections', () => {
  const p = freeze(sample());
  const base = simpleBase();
  base.outbounds.push({ tag: 'alternate', protocol: 'socks', settings: { servers: [
    { address: 'alternate.invalid', port: 1080 },
  ] } });
  freeze(base);
  const a = build(p, base, 'chosen');
  const b = build(p, base, 'alternate');
  assert.equal(a.routing.rules.at(-1).outboundTag, 'chosen');
  assert.equal(b.routing.rules.at(-1).outboundTag, 'alternate');
  assert.deepEqual(build(p, base, 'chosen'), a);
  assert.deepEqual(build(p), build(p));
});

console.log(`Config preview: ${passed} tests passed.`);
