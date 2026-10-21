import assert from 'node:assert/strict';
import { initOutboundsEditor } from '../src/js/outbounds-editor.js';
import { defaultProfile, profileFromJson, profileToJson, buildLink, parseRoutingLink } from '../src/js/profile.js';

let passed = 0;
function test(name, run) {
  try { run(); passed++; } catch (error) { console.error(`FAIL: ${name}`); throw error; }
}
class Element {
  constructor(tag = 'div') { this.tagName = tag; }
  children = []; dataset = {}; attributes = {}; events = {};
  textContent = ''; value = ''; disabled = false; hidden = false;
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(event, fn) { (this.events[event] ??= []).push(fn); }
  emit(event) { for (const fn of this.events[event] ?? []) fn(); }
  click() { if (!this.disabled) this.emit('click'); }
  set innerHTML(_) { throw new Error('Unsafe HTML insertion'); }
}
const descendants = (element) => element.children.flatMap((child) => [child, ...descendants(child)]);
const direct = (extra = {}) => ({ tag: 'direct', protocol: 'freedom', settings: {}, ...extra });
const block = () => ({ tag: 'block', protocol: 'blackhole', settings: {} });
const custom = (tag = 'custom', extra = {}) => ({ tag, protocol: 'socks', settings: {}, ...extra });
const basic = (extra = {}) => ({ ...defaultProfile(), rules: [], outbounds: [direct(), block()], ...extra });
function harness(initial = defaultProfile()) {
  const ids = new Map(['outbounds-editor', 'outbounds-list', 'outbounds-enable', 'outbounds-add',
    'outbounds-kind', 'outbounds-status', 'outbounds-empty'].map((id) => [id, new Element()]));
  const get = (id) => ids.get(id);
  get('outbounds-editor').dataset = { title: 'Destination', tag: 'Tag', protocol: 'Protocol',
    settings: 'Settings JSON', extra: 'Extra JSON', domainStrategy: 'Domain strategy',
    up: 'Move up', down: 'Move down', remove: 'Remove', invalid: 'Translated generic error',
    addInvalid: 'Translated add error', protected: 'Enable first', references: 'Referenced tag' };
  get('outbounds-kind').value = 'freedom';
  let profile = initial, structures = 0;
  const changes = [], previous = globalThis.document;
  globalThis.document = { getElementById: get, createElement: (tag) => new Element(tag) };
  const editor = initOutboundsEditor({ getProfile: () => profile,
    onChange: (valid) => changes.push(valid), onStructureChange: () => structures++ });
  const fields = (index) => descendants(get('outbounds-list').children[index]);
  const field = (index, key) => fields(index).find((el) => el.id?.endsWith(`-${key}`));
  return { get, editor, changes, fields, field, structures: () => structures, profile: () => profile,
    replace(value, refresh = true) { profile = value; if (refresh) editor.refresh(); },
    import(value) { profile = profileFromJson(value); editor.refresh(); },
    edit(index, key, value) {
      const el = field(index, key); el.value = value;
      el.emit(key === 'domainStrategy' ? 'change' : 'input');
    },
    add(kind) { get('outbounds-kind').value = kind; get('outbounds-add').click(); },
    action(index, label) { fields(index).find((el) => el.tagName === 'button' && el.textContent === label).click(); },
    button(index, label) { return fields(index).find((el) => el.tagName === 'button' && el.textContent === label); },
    restore() { globalThis.document = previous; },
  };
}
function uiTest(name, run, initial) {
  test(name, () => { const ui = harness(initial); try { run(ui); } finally { ui.restore(); } });
}
function roundtrip(profile) {
  assert.deepEqual(profileFromJson(profileToJson(profile)).outbounds, profile.outbounds);
  for (const command of ['add', 'onadd']) {
    assert.deepEqual(parseRoutingLink(buildLink(profile, command)).profile.outbounds, profile.outbounds);
  }
}

uiTest('absent list displays readonly defaults and refresh never mutates or notifies', (ui) => {
  const before = structuredClone(ui.profile());
  ui.editor.refresh();
  assert.deepEqual(ui.profile(), before);
  assert.equal(Object.hasOwn(ui.profile(), 'outbounds'), false);
  assert.equal(ui.get('outbounds-list').children.length, 2);
  assert.equal(ui.field(0, 'tag').value, 'direct');
  assert.equal(ui.field(1, 'protocol').value, 'blackhole');
  for (const el of descendants(ui.get('outbounds-list')).filter((el) =>
    ['input', 'select', 'textarea', 'button'].includes(el.tagName))) assert.equal(el.disabled, true);
  ui.edit(0, 'tag', 'ignored'); ui.get('outbounds-add').emit('click');
  assert.deepEqual(ui.profile(), before);
  assert.deepEqual(ui.changes, []); assert.equal(ui.structures(), 0);
  assert.equal(ui.editor.isValid(), true);
});

uiTest('enable creates exact defaults explicitly, never changes rules or legacy fields', (ui) => {
  const before = structuredClone(ui.profile());
  ui.get('outbounds-enable').click();
  assert.deepEqual(ui.profile().outbounds, [direct(), block()]);
  for (const key of Object.keys(before)) assert.deepEqual(ui.profile()[key], before[key]);
  assert.deepEqual(ui.changes, [true]); assert.equal(ui.structures(), 1);
  assert.equal(ui.get('outbounds-enable').hidden, true);
  ui.get('outbounds-enable').emit('click');
  assert.equal(ui.structures(), 1);
  roundtrip(ui.profile());
});

for (const strategy of ['UseIP', 'UseIPv4', 'UseIPv6']) {
  uiTest(`enable derives nondefault direct strategy ${strategy} without rewriting legacy value`, (ui) => {
    assert.deepEqual(JSON.parse(ui.field(0, 'settings').value), { domainStrategy: strategy });
    ui.get('outbounds-enable').click();
    assert.deepEqual(ui.profile().outbounds[0].settings, { domainStrategy: strategy });
    assert.equal(ui.profile().directDomainStrategy, strategy);
  }, { ...defaultProfile(), directDomainStrategy: strategy });
}

uiTest('explicit empty is authoritative, add/remove never resurrect defaults', (ui) => {
  assert.equal(ui.get('outbounds-list').children.length, 0);
  assert.equal(ui.get('outbounds-enable').hidden, true);
  assert.equal(ui.get('outbounds-empty').hidden, false);
  assert.equal(ui.editor.isValid(), true);
  ui.add('dns'); ui.action(0, 'Remove');
  assert.deepEqual(ui.profile().outbounds, []);
  ui.editor.refresh();
  assert.equal(ui.get('outbounds-list').children.length, 0);
  assert.equal(ui.structures(), 2);
  roundtrip(ui.profile());
}, basic({ outbounds: [] }));

for (const extra of [{ globalProxy: false }, { rules: undefined, directIp: ['geoip:private'] },
  { rules: [{ action: 'direct', enabled: false }] }, { rules: [{ action: 'block', enabled: false }] }]) {
  uiTest('explicit empty fails closed when fallback or enabled/disabled rules need a service', (ui) => {
    assert.equal(ui.get('outbounds-list').children.length, 0);
    assert.equal(ui.editor.isValid(), false);
    assert.equal(ui.get('outbounds-status').textContent, 'Translated generic error');
    assert.deepEqual(ui.profile().outbounds, []);
  }, basic({ outbounds: [], ...extra }));
}

uiTest('all presets create safe unique tags and the exact settings placeholders', (ui) => {
  for (const value of ['freedom', 'blackhole', 'dns', 'socks', 'http', 'json', 'freedom', 'socks']) ui.add(value);
  const items = ui.profile().outbounds;
  assert.deepEqual(items.map((item) => item.tag),
    ['direct', 'block', 'dns', 'socks-2', 'http-2', 'outbound', 'direct-2', 'socks-3']);
  assert.deepEqual(items.map((item) => item.protocol),
    ['freedom', 'blackhole', 'dns', 'socks', 'http', 'socks', 'freedom', 'socks']);
  assert.deepEqual(items[3].settings, { servers: [{ address: 'proxy.example.invalid', port: 1080 }] });
  assert.deepEqual(items[4].settings, { servers: [{ address: 'proxy.example.invalid', port: 8080 }] });
  for (const index of [0, 1, 2, 5, 6]) assert.deepEqual(items[index].settings, {});
  assert.equal(ui.structures(), 8);
  ui.edit(5, 'protocol', 'future-protocol');
  assert.equal(ui.profile().outbounds[5].protocol, 'future-protocol');
  assert.equal(ui.structures(), 8);
  roundtrip(ui.profile());
}, basic({ outbounds: [] }));

uiTest('unknown add kind fails without creating a row or leaking the value', (ui) => {
  const before = structuredClone(ui.profile());
  ui.add('https://user:password@example.invalid');
  assert.deepEqual(ui.profile(), before);
  assert.equal(ui.editor.isValid(), false);
  assert.equal(ui.get('outbounds-status').textContent, 'Translated add error');
  assert.deepEqual(ui.changes, [false]); assert.equal(ui.structures(), 0);
  ui.add('dns'); assert.equal(ui.editor.isValid(), true);
}, basic());

uiTest('enable may remain a draft until a required explicit custom DNS outbound is added', (ui) => {
  const before = structuredClone(ui.profile());
  assert.equal(ui.editor.isValid(), true);
  ui.get('outbounds-enable').click();
  assert.equal(ui.editor.isValid(), false); assert.deepEqual(ui.profile(), before);
  assert.equal(ui.structures(), 0);
  ui.add('dns');
  assert.equal(ui.editor.isValid(), true);
  assert.deepEqual(ui.profile().outbounds, [direct(), block(), { tag: 'dns', protocol: 'dns', settings: {} }]);
  assert.equal(ui.structures(), 1);
  roundtrip(ui.profile());
}, { ...defaultProfile(), rules: [{ action: 'custom', customTag: 'dns', enabled: false }] });

uiTest('nonfinite JSON numbers reject rather than silently turning into null', (ui) => {
  const before = structuredClone(ui.profile());
  for (const key of ['settings', 'extra']) {
    ui.edit(0, key, '{"nested":{"value":1e400}}');
    assert.equal(ui.editor.isValid(), false); assert.deepEqual(ui.profile(), before);
    ui.editor.refresh();
  }
}, basic());

uiTest('missing settings stays missing across unrelated edits until explicit JSON/strategy editing', (ui) => {
  assert.equal(ui.field(0, 'settings').value, '{}');
  ui.edit(0, 'protocol', 'future-protocol');
  ui.edit(0, 'extra', '{"future":{"nested":[1,2]}}');
  assert.equal(Object.hasOwn(ui.profile().outbounds[0], 'settings'), false);
  ui.edit(0, 'protocol', 'freedom');
  assert.equal(Object.hasOwn(ui.profile().outbounds[0], 'settings'), false);
  ui.edit(0, 'domainStrategy', 'UseIPv4');
  assert.deepEqual(ui.profile().outbounds[0], direct({ settings: { domainStrategy: 'UseIPv4' },
    future: { nested: [1, 2] } }));
  ui.edit(0, 'domainStrategy', 'AsIs');
  assert.deepEqual(ui.profile().outbounds[0].settings, { domainStrategy: 'AsIs' });
  assert.equal(ui.structures(), 0);
}, basic({ outbounds: [{ tag: 'direct', protocol: 'freedom' }, block()] }));

uiTest('freedom strategy updates only domainStrategy, unknown strategies and protocols preserved', (ui) => {
  ui.edit(0, 'domainStrategy', 'UseIPv6');
  assert.deepEqual(ui.profile().outbounds[0].settings, { domainStrategy: 'UseIPv6', userLevel: 7 });
  ui.edit(0, 'settings', '{"domainStrategy":"FutureStrategy","userLevel":7}');
  assert.equal(ui.field(0, 'domainStrategy').disabled, true);
  ui.edit(0, 'tag', 'renamed');
  assert.equal(ui.profile().outbounds[0].settings.domainStrategy, 'FutureStrategy');
  ui.edit(0, 'protocol', 'future');
  assert.equal(ui.field(0, 'domainStrategy').hidden, true);
  roundtrip(ui.profile());
}, basic({ outbounds: [direct({ settings: { userLevel: 7 } }), block()] }));

uiTest('invalid JSON/object drafts never commit and refresh discards them without callbacks', (ui) => {
  const before = structuredClone(ui.profile());
  for (const value of ['{', 'null', '[]', '1', '"credential"', '{"bad":undefined}']) {
    for (const key of ['settings', 'extra']) {
      ui.edit(0, key, value);
      assert.equal(ui.editor.isValid(), false);
      assert.deepEqual(ui.profile(), before);
      assert.equal(ui.get('outbounds-status').textContent, 'Translated generic error');
      ui.editor.refresh();
    }
  }
  assert.equal(ui.changes.length, 12);
  assert.ok(ui.changes.every((valid) => valid === false));
  assert.equal(ui.structures(), 0);
  ui.edit(0, 'extra', '{"mux":{"enabled":true}}');
  assert.equal(ui.editor.isValid(), true);
  assert.deepEqual(ui.profile().outbounds[0].mux, { enabled: true });
}, basic());

uiTest('extra cannot shadow identity/settings fields; graph enforces object/reference shapes', (ui) => {
  const before = structuredClone(ui.profile());
  for (const value of [{ tag: 'other' }, { protocol: 'other' }, { settings: {} },
    { proxySettings: [] }, { proxySettings: {} }, { proxySettings: { tag: 1 } },
    { streamSettings: [] }, { streamSettings: { sockopt: [] } },
    { streamSettings: { sockopt: { dialerProxy: 1 } } },
    { proxySettings: { tag: 'block' }, streamSettings: { sockopt: { dialerProxy: 'block' } } }]) {
    ui.edit(0, 'extra', JSON.stringify(value));
    assert.equal(ui.editor.isValid(), false);
    assert.deepEqual(ui.profile(), before);
  }
}, basic());

uiTest('reserved, duplicate, empty and padded tags reject without normalizing originals', (ui) => {
  const before = structuredClone(ui.profile());
  for (const tag of ['proxy', 'socks', 'socks-lan', 'http', 'block', '', ' ', ' direct', 'direct\n']) {
    ui.edit(0, 'tag', tag);
    assert.equal(ui.editor.isValid(), false); assert.deepEqual(ui.profile(), before);
  }
  ui.edit(0, 'tag', '__proto__');
  assert.equal(ui.editor.isValid(), true);
  assert.equal(ui.profile().outbounds[0].tag, '__proto__');
  roundtrip(ui.profile());
}, basic());

uiTest('blank protocols reject, unknown protocol text remains exact', (ui) => {
  const before = structuredClone(ui.profile());
  for (const value of ['', '  ', '\n']) {
    ui.edit(0, 'protocol', value); assert.equal(ui.editor.isValid(), false);
    assert.deepEqual(ui.profile(), before);
  }
  ui.edit(0, 'protocol', 'unknown-protocol');
  assert.equal(ui.profile().outbounds[0].protocol, 'unknown-protocol');
}, basic());

for (const relation of ['customRule', 'proxySettings', 'dialerProxy', 'fallback', 'legacyDirect', 'legacyBlock']) {
  const initial = basic({ outbounds: [direct(), block(), custom('hop')] });
  let index = 2;
  if (relation === 'customRule') initial.rules = [{ action: 'custom', customTag: 'hop', enabled: false }];
  if (relation === 'proxySettings') initial.outbounds.push(custom('chain', { proxySettings: { tag: 'hop' } }));
  if (relation === 'dialerProxy') initial.outbounds.push(custom('chain', { streamSettings: { sockopt: { dialerProxy: 'hop' } } }));
  if (relation === 'fallback') { initial.globalProxy = false; index = 0; }
  if (relation === 'legacyDirect') { delete initial.rules; initial.directIp = ['geoip:private']; index = 0; }
  if (relation === 'legacyBlock') { delete initial.rules; initial.blockSites = ['domain:bad.invalid']; index = 1; }
  uiTest(`referenced rename/removal is protected for ${relation}`, (ui) => {
    const before = structuredClone(ui.profile());
    assert.equal(ui.button(index, 'Remove').disabled, true);
    ui.action(index, 'Remove');
    ui.button(index, 'Remove').emit('click');
    assert.deepEqual(ui.profile(), before);
    ui.edit(index, 'tag', 'changed');
    assert.equal(ui.editor.isValid(), false);
    assert.deepEqual(ui.profile(), before);
    ui.edit(index, 'tag', before.outbounds[index].tag);
    ui.edit(index, 'settings', '{"userLevel":2}');
    assert.equal(ui.editor.isValid(), true);
    assert.deepEqual(ui.profile().outbounds[index].settings, { userLevel: 2 });
    if (before.rules) assert.deepEqual(ui.profile().rules, before.rules);
  }, initial);
}

uiTest('unreferenced default direct/block may be renamed and removed without synthetic protection', (ui) => {
  ui.edit(0, 'tag', 'other-direct'); assert.equal(ui.editor.isValid(), true);
  ui.action(0, 'Remove'); ui.action(0, 'Remove');
  assert.deepEqual(ui.profile().outbounds, []);
  assert.equal(ui.structures(), 2);
}, basic());

uiTest('custom action does not incorrectly protect an unrelated outbound literally tagged custom', (ui) => {
  assert.equal(ui.button(2, 'Remove').disabled, false);
  ui.edit(2, 'tag', 'renamed'); assert.equal(ui.editor.isValid(), true);
  ui.action(2, 'Remove'); assert.equal(ui.profile().outbounds.length, 3);
}, basic({ rules: [{ action: 'custom', customTag: 'hop', enabled: false }],
  outbounds: [direct(), block(), custom('custom'), custom('hop')] }));

uiTest('dangling references, self/two-node cycles, and disabled rule references fail closed', (ui) => {
  const before = structuredClone(ui.profile());
  for (const extra of [{ proxySettings: { tag: 'missing' } }, { proxySettings: { tag: 'direct' } },
    { streamSettings: { sockopt: { dialerProxy: 'direct' } } }]) {
    ui.edit(0, 'extra', JSON.stringify(extra));
    assert.equal(ui.editor.isValid(), false); assert.deepEqual(ui.profile(), before);
  }
  ui.editor.refresh();
  ui.edit(0, 'extra', '{"proxySettings":{"tag":"block"}}');
  const valid = structuredClone(ui.profile());
  ui.edit(1, 'extra', '{"proxySettings":{"tag":"direct"}}');
  assert.equal(ui.editor.isValid(), false); assert.deepEqual(ui.profile(), valid);
  ui.editor.refresh();
  ui.profile().rules = [{ action: 'custom', customTag: 'missing', enabled: false }];
  assert.equal(ui.editor.isValid(), false);
  ui.edit(0, 'settings', '{"userLevel":1}');
  assert.equal(ui.changes.at(-1), false);
  assert.deepEqual(ui.profile().outbounds, valid.outbounds);
}, basic());

uiTest('whole candidate validates current rule conditions without modifying any rule data', (ui) => {
  const rule = { action: 'direct', enabled: true, domain: [], ip: [], network: '', port: '' };
  ui.profile().rules = [rule];
  const before = structuredClone(ui.profile());
  ui.add('dns');
  assert.equal(ui.editor.isValid(), false); assert.deepEqual(ui.profile(), before);
  rule.network = 'tcp,udp';
  ui.edit(2, 'settings', '{}');
  assert.equal(ui.editor.isValid(), true);
  assert.equal(ui.profile().rules[0], rule);
  assert.deepEqual(ui.profile().rules, [{ ...before.rules[0], network: 'tcp,udp' }]);
}, basic());

uiTest('reorder preserves entire items; only presence/count/order changes notify structure', (ui) => {
  const before = structuredClone(ui.profile().outbounds);
  ui.action(1, 'Move up');
  assert.deepEqual(ui.profile().outbounds, [before[1], before[0]]);
  ui.action(0, 'Move down'); assert.deepEqual(ui.profile().outbounds, before);
  assert.equal(ui.structures(), 2);
  ui.edit(0, 'tag', 'renamed'); ui.edit(0, 'settings', '{"domainStrategy":"UseIP"}');
  assert.equal(ui.structures(), 2);
  ui.editor.refresh(); assert.equal(ui.structures(), 2);
}, basic());

uiTest('invalid settings draft survives reorder and prevents the full candidate committing', (ui) => {
  const before = structuredClone(ui.profile());
  ui.edit(0, 'settings', '{'); ui.action(0, 'Move down');
  assert.deepEqual(ui.profile(), before); assert.equal(ui.structures(), 0);
  assert.equal(ui.field(1, 'settings').value, '{');
  ui.edit(1, 'settings', '{}');
  assert.deepEqual(ui.profile().outbounds, [before.outbounds[1], before.outbounds[0]]);
  assert.equal(ui.structures(), 1);
}, basic());

uiTest('large six-outbound input and TLS/mux/unknown fields remain immutable and roundtrip', (ui) => {
  const original = ui.profile().outbounds, snapshot = structuredClone(original);
  assert.ok(JSON.stringify(snapshot).length > 100_000);
  ui.edit(2, 'settings', '{"userLevel":9}');
  assert.deepEqual(original, snapshot);
  const expected = structuredClone(snapshot); expected[2].settings = { userLevel: 9 };
  assert.deepEqual(ui.profile().outbounds, expected);
  ui.action(5, 'Move up');
  assert.deepEqual(original, snapshot);
  assert.deepEqual(ui.profile().outbounds[4], expected[5]);
  assert.deepEqual(ui.profile().outbounds[2].streamSettings, snapshot[2].streamSettings);
  assert.deepEqual(ui.profile().outbounds[2].mux, snapshot[2].mux);
  roundtrip(ui.profile());
}, basic({ outbounds: [direct(), block(), ...Array.from({ length: 4 }, (_, index) => custom(`node-${index}`, {
  streamSettings: { security: 'tls', tlsSettings: { serverName: 'own.invalid', allowInsecure: false,
    certificates: [{ certificate: ['x'.repeat(30_000)] }] }, sockopt: { mark: 1 } },
  mux: { enabled: true, concurrency: 8 }, future: { array: [null, false, 1], key: index },
}))] }));

uiTest('credentials and hostile text remain local values; errors never echo user data', (ui) => {
  const token = 'https://username:credential@example.invalid/<img-onerror=alert(1)>';
  const methods = ['log', 'warn', 'error'], calls = [], saved = methods.map((key) => console[key]);
  methods.forEach((key) => { console[key] = (...args) => calls.push(args); });
  try {
    ui.edit(0, 'extra', JSON.stringify({ url: token, streamSettings: { tlsSettings: { serverName: '<script>' } } }));
    ui.edit(0, 'settings', JSON.stringify({ servers: [{ address: 'own.invalid', users: [{ user: token, pass: token }] }] }));
    assert.equal(ui.editor.isValid(), true);
    assert.equal(ui.profile().outbounds[0].url, token);
    const before = structuredClone(ui.profile());
    ui.edit(0, 'extra', `{${token}`);
    assert.equal(ui.editor.isValid(), false); assert.deepEqual(ui.profile(), before);
    assert.equal(ui.get('outbounds-status').textContent, 'Translated generic error');
    assert.equal(descendants(ui.get('outbounds-list')).some((el) => el.textContent.includes(token)), false);
    assert.deepEqual(calls, []);
  } finally { methods.forEach((key, index) => { console[key] = saved[index]; }); }
}, basic());

uiTest('refresh/import replaces drafts and stale controls cannot edit replacement profiles', (ui) => {
  const stale = ui.field(0, 'tag'), staleRemove = ui.button(0, 'Remove');
  ui.edit(0, 'settings', '{');
  ui.import({ GlobalProxy: 'true', Rules: [], Outbounds: [custom('new', { future: true })] });
  const before = structuredClone(ui.profile());
  stale.value = 'stale'; stale.emit('input'); staleRemove.emit('click');
  assert.deepEqual(ui.profile(), before);
  assert.equal(ui.field(0, 'tag').value, 'new'); assert.equal(ui.editor.isValid(), true);
  assert.deepEqual(ui.changes, [false]); assert.equal(ui.structures(), 0);
}, basic());

uiTest('replacing a profile without refresh guards stale card and add controls', (ui) => {
  const replacement = basic({ outbounds: [custom('new')] });
  ui.replace(replacement, false);
  const before = structuredClone(replacement);
  ui.edit(0, 'tag', 'stale'); ui.add('dns');
  assert.deepEqual(ui.profile(), before);
  assert.deepEqual(ui.changes, []); assert.equal(ui.structures(), 0);
}, basic());

uiTest('all fields have unique associated labels and buttons have unique accessible names', (ui) => {
  const all = descendants(ui.get('outbounds-list'));
  const fields = all.filter((el) => ['input', 'select', 'textarea'].includes(el.tagName));
  assert.equal(new Set(fields.map((el) => el.id)).size, fields.length);
  for (const field of fields) assert.ok(all.some((el) => el.tagName === 'label' && el.htmlFor === field.id));
  const interactive = all.filter((el) => ['input', 'select', 'textarea', 'button'].includes(el.tagName));
  assert.equal(new Set(interactive.map((el) => el.attributes['aria-label'])).size, interactive.length);
  assert.equal(ui.get('outbounds-list').children[0].className, 'outbound-card');
  assert.ok(all.some((el) => el.className === 'outbound-head'));
  assert.ok(all.some((el) => el.className === 'list-actions'));
}, basic());

uiTest('malformed imported shapes are invalid without inventing or silently repairing data', (ui) => {
  for (const outbounds of [null, {}, [null], [direct({ settings: [] })], [direct({ settings: null })]]) {
    const profile = basic({ outbounds }), before = structuredClone(profile);
    ui.replace(profile);
    assert.equal(ui.editor.isValid(), false);
    assert.deepEqual(ui.profile(), before);
    assert.equal(ui.get('outbounds-status').textContent, 'Translated generic error');
  }
}, basic());

console.log(`OK: ${passed} outbounds editor tests passed`);
