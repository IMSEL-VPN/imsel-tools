import assert from 'node:assert/strict';
import * as profileMod from '../src/js/profile.js';
import { dnsRows, dnsTransport, setDnsTransport, validateDnsRows, serializeDnsRows } from '../src/js/dns-servers.js';
import { initDnsEditor } from '../src/js/dns-editor.js';

let passed = 0;
function test(name, run) {
  try { run(); passed++; } catch (error) { console.error(`FAIL: ${name}`); throw error; }
}
const row = (address = 'resolver.example.invalid', extra = {}) =>
  ({ address, port: '', domains: [], enabled: true, ...extra });

class Element {
  constructor(tag = 'div') { this.tagName = tag; }
  children = []; dataset = {}; events = {}; attributes = {};
  value = ''; checked = false; disabled = false; hidden = false; textContent = '';
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(name, fn) { (this.events[name] ??= []).push(fn); }
  emit(name) { for (const fn of this.events[name] ?? []) fn(); }
  click() { if (!this.disabled) this.emit('click'); }
  set innerHTML(_) { throw new Error('Unsafe HTML insertion'); }
}
function descendants(element) {
  return element.children.flatMap((child) => [child, ...descendants(child)]);
}
function harness(initial = profileMod.defaultProfile()) {
  const ids = new Map(['dns-editor-list', 'dns-add', 'dns-empty', 'dns-editor-status',
    'dns-query-strategy'].map((id) => [id, new Element()]));
  const get = (id) => ids.get(id);
  get('dns-editor-list').dataset = { server: 'Server', enabled: 'Enable server', remove: 'Remove',
    up: 'Move up', down: 'Move down', type: 'Transport', address: 'Address / URL', port: 'Port',
    domains: 'Priority domains', domainHint: 'One per line...', localHint: 'Local bypass',
    routedHint: 'Nonlocal routing', unsupported: 'Custom compatibility not validated',
    system: 'System DNS', custom: 'Custom address' };
  get('dns-editor-status').dataset.invalid = 'Translated error';
  let profile = initial;
  const changes = [];
  const previous = globalThis.document;
  globalThis.document = { getElementById: get, createElement: (tag) => new Element(tag) };
  const editor = initDnsEditor({ getProfile: () => profile, onChange: (valid) => changes.push(valid) });
  const fields = (index) => descendants(get('dns-editor-list').children[index]);
  const field = (index, key) => fields(index).find((el) => el.id?.endsWith(`-${key}`));
  return { get, editor, changes, fields, field,
    profile: () => profile,
    import(value) { profile = profileMod.profileFromJson(value); editor.refresh(); },
    edit(index, key, value) {
      const el = field(index, key);
      if (key === 'enabled') el.checked = value; else el.value = value;
      el.emit(['enabled', 'type'].includes(key) ? 'change' : 'input');
    },
    action(index, label) { fields(index).find((el) => el.tagName === 'button' && el.textContent === label).click(); },
    restore() { globalThis.document = previous; },
  };
}
function uiTest(name, fn, initial) {
  test(name, () => { const ui = harness(initial); try { fn(ui); } finally { ui.restore(); } });
}

test('transport detection covers supported modes; h2c/DoT/remote QUIC remain custom', () => {
  for (const [type, address] of Object.entries({ udp: '2001:db8::1', tcp: 'tcp://dns.invalid:5353',
    https: 'HTTPS://dns.invalid/query', 'tcp+local': 'tcp+local://dns.invalid',
    'https+local': 'https+local://dns.invalid', 'quic+local': 'quic+local://dns.invalid',
    system: 'localhost' })) assert.equal(dnsTransport(address), type);
  for (const address of ['h2c://dns.invalid', 'h2c+local://dns.invalid', 'tls://dns.invalid',
    'quic://dns.invalid', 'future://dns.invalid', 'fakedns']) assert.equal(dnsTransport(address), 'custom');
  for (const address of ['', 'dns.invalid', '192.0.2.1', '[2001:db8::1]:5353', 'dns.invalid:443']) {
    assert.equal(dnsTransport(address), 'udp');
  }
});

test('transport conversions preserve authority and HTTP paths without providers', () => {
  const prefixes = { udp: '', tcp: 'tcp://', https: 'https://', 'tcp+local': 'tcp+local://',
    'https+local': 'https+local://', 'quic+local': 'quic+local://' };
  for (const from of Object.values(prefixes)) for (const [to, prefix] of Object.entries(prefixes)) {
    assert.equal(setDnsTransport(`${from}[2001:db8::1]:8853/query?a=b`, to),
      `${prefix}[2001:db8::1]:8853${to.startsWith('https') ? '/query?a=b' : ''}`);
  }
  assert.equal(setDnsTransport('tcp://dns.invalid:443', 'https'), 'https://dns.invalid:443/dns-query');
  assert.equal(setDnsTransport('dns.invalid?q=1', 'https+local'), 'https+local://dns.invalid/dns-query?q=1');
  assert.equal(setDnsTransport('h2c://dns.invalid/own', 'custom'), 'h2c://dns.invalid/own');
  assert.equal(setDnsTransport('anything', 'system'), 'localhost');
  assert.equal(setDnsTransport('localhost', 'udp'), '');
  assert.equal(setDnsTransport('', 'https'), 'https://');
  assert.equal(setDnsTransport('2001:db8::1', 'https'), 'https://[2001:db8::1]/dns-query');
  assert.equal(setDnsTransport('2001:db8:0:0:0:0:0:1', 'tcp'), 'tcp://[2001:db8:0:0:0:0:0:1]');
});

test('legacy rows preserve supplied endpoints and do not repair malformed DoH URLs', () => {
  assert.deepEqual(dnsRows({}), []);
  assert.deepEqual(dnsRows({ remoteDnsType: 'DoH', remoteDnsDomain: 'https://own.invalid/query',
    remoteDnsIp: '192.0.2.1', domesticDnsType: 'DoU', domesticDnsDomain: 'other.invalid',
    domesticDnsIp: '2001:db8::1' }), [row('https://own.invalid/query'), row('2001:db8::1', { port: '53' })]);
  for (const ip of ['2001:db8::1', '[2001:db8::1]']) {
    assert.equal(dnsRows({ remoteDnsType: 'DoH', remoteDnsIp: ip })[0].address,
      `https://${ip}/dns-query`);
  }
  assert.deepEqual(dnsRows({ domesticDnsDomain: 'own.invalid' }), [row('own.invalid', { port: '53' })]);
  assert.deepEqual(dnsRows({ remoteDnsType: ' doh ', remoteDnsDomain: ' https://own.invalid/query ',
    remoteDnsIp: ' 192.0.2.1 ', domesticDnsDomain: '  ' }), [row('https://own.invalid/query')]);
});

test('explicit empty list authoritative and helper clones arrays', () => {
  assert.deepEqual(dnsRows({ ...profileMod.defaultProfile(), dnsServers: [] }), []);
  const profile = { dnsServers: [row('dns.invalid', { enabled: false, domains: ['domain:own.invalid'] })] };
  const rows = dnsRows(profile);
  rows[0].domains.push('extra'); rows[0].address = 'changed';
  assert.deepEqual(profile.dnsServers, [row('dns.invalid', { enabled: false, domains: ['domain:own.invalid'] })]);
});

test('validation accepts ports, recognized URLs, IPv6 and custom syntax without claiming compatibility', () => {
  for (const address of ['localhost', '192.0.2.1', '2001:db8::1', '[2001:db8::1]:53',
    'dns.invalid:443', 'tcp://dns.invalid:65535', 'tcp+local://[2001:db8::1]:53',
    'https://dns.invalid:443/dns-query?q=1', 'https+local://dns.invalid/query',
    'quic+local://dns.invalid:8853', 'h2c://dns.invalid/query', 'tls://dns.invalid', 'future:value']) {
    for (const port of ['', '1', '53', '65535', '0053']) {
      assert.equal(validateDnsRows([row(address, { port })]), true, `${address} / ${port}`);
    }
  }
  assert.equal(validateDnsRows([]), true);
});

test('validation rejects empty/whitespace, credentials, fragments, malformed URLs and ports even disabled', () => {
  for (const address of ['', ' ', ' dns.invalid', 'dns.invalid\n', 'dns .invalid',
    'https://', 'https:broken', 'https:///dns.invalid', 'tcp://', 'https://user@dns.invalid/query',
    'h2c://user:pass@dns.invalid/query', 'https://dns.invalid/#', 'https://dns.invalid:0/query',
    'https://dns.invalid:65536/query', 'https://dns.invalid:/query', 'https://[::1',
    'https://dns.invalid/%zz', 'https://dns.invalid\\query', 'dns.invalid:0', 'dns.invalid:65536']) {
    for (const enabled of [true, false]) assert.equal(validateDnsRows([row(address, { enabled })]), false, address);
  }
  for (const port of ['0', '65536', '-1', '1.5', '53x', ' 53', '1e2', 53, null]) {
    assert.equal(validateDnsRows([row('dns.invalid', { port })]), false, String(port));
  }
  assert.equal(serializeDnsRows([row('')]), null);
});

test('serialization uses exact wire fields, trims newline lists and retains disabled addresses', () => {
  const draft = row('h2c://own.invalid/Query?case=A', { enabled: false, port: '853',
    domains: ' domain:EXAMPLE.invalid \n\nregexp:^own\\.invalid$\r\ngeosite:private\n', type: 'custom' });
  const result = serializeDnsRows([draft]);
  assert.deepEqual(result, [row(draft.address, { enabled: false, port: '853',
    domains: ['domain:EXAMPLE.invalid', 'regexp:^own\\.invalid$', 'geosite:private'] })]);
  result[0].domains.push('changed');
  assert.equal(typeof draft.domains, 'string');
  assert.deepEqual(serializeDnsRows([row('own.invalid', { domains: [' domain:EXACT.invalid ', ''] })])[0].domains,
    [' domain:EXACT.invalid ', '']);
});

test('wrong imported field types remain visible to validation instead of becoming defaults', () => {
  for (const extra of [{ port: null }, { port: 53 }, { domains: null }, { domains: [1] }, { enabled: null }]) {
    assert.equal(validateDnsRows(dnsRows({ dnsServers: [row('own.invalid', extra)] })), false);
  }
});

uiTest('initialization and refresh preserve absent defaults/legacy profile exactly, with no callback', (ui) => {
  const before = structuredClone(ui.profile());
  ui.editor.refresh();
  assert.deepEqual(ui.profile(), before);
  assert.equal(Object.hasOwn(ui.profile(), 'dnsServers'), false);
  assert.deepEqual(ui.changes, []);
  assert.equal(ui.editor.isValid(), true);
  assert.equal(ui.get('dns-editor-list').children.length, 2);
});

uiTest('toggle migrates lazily, preserves legacy fields, and survives both link commands', (ui) => {
  const legacy = structuredClone(ui.profile());
  ui.edit(0, 'enabled', false);
  assert.deepEqual(ui.changes, [true]);
  assert.equal(ui.profile().dnsServers[0].enabled, false);
  for (const key of Object.keys(legacy)) assert.deepEqual(ui.profile()[key], legacy[key], key);
  for (const command of ['add', 'onadd']) {
    const imported = profileMod.parseRoutingLink(profileMod.buildLink(ui.profile(), command)).profile;
    assert.deepEqual(imported.dnsServers, ui.profile().dnsServers);
    assert.equal(imported.remoteDnsDomain, legacy.remoteDnsDomain);
  }
  ui.editor.refresh(); ui.edit(0, 'enabled', true);
  assert.equal(ui.profile().dnsServers[0].enabled, true);
});

uiTest('invalid drafts preserve last valid profile, report on every edit and refresh resets', (ui) => {
  const before = structuredClone(ui.profile());
  ui.get('dns-add').click();
  assert.equal(ui.field(2, 'type').value, 'udp');
  assert.equal(ui.field(2, 'address').value, '');
  assert.equal(ui.editor.isValid(), false);
  assert.deepEqual(ui.profile(), before);
  assert.equal(ui.get('dns-editor-status').textContent, 'Translated error');
  ui.edit(2, 'enabled', false);
  assert.equal(ui.editor.isValid(), false);
  ui.edit(2, 'address', 'new.invalid');
  assert.equal(ui.editor.isValid(), true);
  assert.equal(ui.profile().dnsServers[2].enabled, false);
  const valid = structuredClone(ui.profile());
  ui.edit(2, 'port', '65536');
  assert.deepEqual(ui.profile(), valid);
  assert.deepEqual(ui.changes, [false, false, true, false]);
  ui.editor.refresh();
  assert.equal(ui.editor.isValid(), true);
  assert.equal(ui.field(2, 'port').value, '');
  assert.deepEqual(ui.changes, [false, false, true, false]);
});

uiTest('import refresh replaces drafts; stale controls cannot edit replacement profile', (ui) => {
  const stale = ui.field(0, 'address');
  ui.get('dns-add').click();
  ui.import({ DnsServers: [row('tcp://fresh.invalid:5353')], QueryStrategy: 'UseIPv6' });
  stale.value = 'stale.invalid'; stale.emit('input');
  assert.equal(ui.field(0, 'address').value, 'tcp://fresh.invalid:5353');
  assert.equal(ui.get('dns-query-strategy').value, 'UseIPv6');
  assert.equal(ui.editor.isValid(), true);
  ui.edit(0, 'domains', 'domain:fresh.invalid');
  assert.deepEqual(ui.profile().dnsServers[0].domains, ['domain:fresh.invalid']);
});

uiTest('reorder/remove/add preserves rows; [] never resurrects legacy pair on refresh or reload', (ui) => {
  const original = dnsRows(ui.profile());
  ui.action(1, 'Move up');
  assert.deepEqual(ui.profile().dnsServers, [original[1], original[0]]);
  ui.action(0, 'Move down');
  assert.deepEqual(ui.profile().dnsServers, original);
  ui.action(0, 'Remove'); ui.action(0, 'Remove');
  assert.deepEqual(ui.profile().dnsServers, []);
  assert.equal(ui.get('dns-empty').hidden, false);
  ui.import(profileMod.profileToJson(profileMod.parseRoutingLink(profileMod.buildLink(ui.profile(), 'add')).profile));
  assert.equal(ui.get('dns-editor-list').children.length, 0);
  ui.get('dns-add').click(); ui.edit(0, 'address', 'own.invalid');
  assert.deepEqual(ui.profile().dnsServers, [row('own.invalid')]);
});

uiTest('all transport UI selections serialize exact addresses and clear port only on explicit selection', (ui) => {
  ui.import({ DnsServers: [row('https://dns.invalid:8853/query', { port: '5353' })] });
  assert.equal(ui.field(0, 'port').disabled, true);
  ui.edit(0, 'enabled', false);
  assert.equal(ui.profile().dnsServers[0].port, '5353');
  for (const [type, prefix] of [['tcp', 'tcp://'], ['tcp+local', 'tcp+local://'],
    ['https+local', 'https+local://'], ['quic+local', 'quic+local://'], ['https', 'https://'], ['udp', '']]) {
    ui.import({ DnsServers: [row('https://dns.invalid:8853/query', { port: '5353' })] });
    ui.edit(0, 'type', type);
    assert.equal(ui.profile().dnsServers[0].address, `${prefix}dns.invalid:8853${type.startsWith('https') ? '/query' : ''}`);
    assert.equal(ui.profile().dnsServers[0].port, '');
    assert.equal(ui.field(0, 'port').disabled, type !== 'udp');
  }
  ui.edit(0, 'type', 'system');
  assert.equal(ui.profile().dnsServers[0].address, 'localhost');
  assert.equal(ui.field(0, 'address').readOnly, true);
  assert.ok(ui.fields(0).some((el) => el.textContent === 'Local bypass'));
});

uiTest('custom imported address/port survives toggle and unrelated edits exactly, no HTML injection', (ui) => {
  const address = 'h2c://own.invalid/<img-onerror=alert(1)>?case=A';
  ui.import({ DnsServers: [row(address, { port: '5353', domains: ['<script>alert(1)</script>'] })] });
  assert.equal(ui.field(0, 'type').value, 'custom');
  assert.ok(ui.fields(0).some((el) => el.textContent === 'Custom compatibility not validated'));
  assert.equal(ui.field(0, 'address').value, address);
  ui.edit(0, 'enabled', false);
  assert.deepEqual(ui.profile().dnsServers, [row(address, { enabled: false, port: '5353',
    domains: ['<script>alert(1)</script>'] })]);
});

uiTest('full Rules do not lock independent DNS controls', (ui) => {
  ui.profile().rules = [];
  ui.edit(0, 'address', 'guard.invalid');
  ui.get('dns-query-strategy').value = 'UseIPv4'; ui.get('dns-query-strategy').emit('change');
  assert.equal(ui.profile().dnsServers[0].address, 'guard.invalid');
  assert.equal(ui.profile().queryStrategy, 'UseIPv4');
  assert.deepEqual(ui.profile().rules, []);
  ui.editor.refresh();
  assert.equal(ui.field(0, 'address').disabled, false);
  assert.equal(ui.get('dns-add').disabled, false);
  assert.equal(ui.get('dns-query-strategy').disabled, false);
  ui.import({ DnsServers: [] });
  assert.equal(ui.get('dns-add').disabled, false);
  assert.equal(ui.get('dns-query-strategy').disabled, false);
});

uiTest('queryStrategy only accepts existing values, blank removes field, invalid keeps last valid profile', (ui) => {
  const query = ui.get('dns-query-strategy');
  for (const strategy of ['UseIP', 'UseIPv4', 'UseIPv6', 'none', '']) {
    query.value = strategy; query.emit('change');
    assert.equal(ui.editor.isValid(), true);
    assert.equal(ui.profile().queryStrategy, strategy || undefined);
    const imported = profileMod.parseRoutingLink(profileMod.buildLink(ui.profile(), 'add')).profile;
    assert.equal(imported.queryStrategy, strategy || undefined);
  }
  const before = structuredClone(ui.profile());
  query.value = 'UseIPv5'; query.emit('change');
  assert.equal(ui.editor.isValid(), false);
  assert.deepEqual(ui.profile(), before);
  assert.equal(ui.changes.at(-1), false);
});

uiTest('every field has a unique associated label, toggles included; hints use provided translations', (ui) => {
  const all = descendants(ui.get('dns-editor-list'));
  const fields = all.filter((el) => ['input', 'select', 'textarea'].includes(el.tagName));
  assert.equal(new Set(fields.map((el) => el.id)).size, fields.length);
  assert.equal(new Set(fields.map((el) => el.attributes['aria-label'])).size, fields.length);
  for (const field of fields) assert.ok(all.some((el) => el.tagName === 'label' && el.htmlFor === field.id));
  assert.ok(all.some((el) => el.tagName === 'label' && el.textContent === 'Enable server'));
  assert.ok(all.some((el) => el.textContent === 'One per line...'));
  assert.ok(all.some((el) => el.textContent === 'Nonlocal routing'));
  assert.equal(ui.get('dns-editor-list').children[0].className, 'dns-card');
});

console.log(`OK: ${passed} DNS editor tests passed`);
