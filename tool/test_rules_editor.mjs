import assert from 'node:assert/strict';
import { initRulesEditor } from '../src/js/rules-editor.js';
import { createRule, rulesFromLegacy, serializeRules, validateRules } from '../src/js/rules-state.js';
import { defaultProfile, profileFromJson, profileToJson, buildLink, parseRoutingLink } from '../src/js/profile.js';

let passed = 0;
function test(name, run) {
  try { run(); passed++; } catch (error) { console.error(`FAIL: ${name}`); throw error; }
}
const rule = (extra = {}) => ({ action: 'proxy', network: 'tcp,udp', ...extra });
const profile = (rules = []) => ({ ...defaultProfile(), rules });

class Element {
  constructor(tag = 'div') { this.tagName = tag; }
  children = []; dataset = {}; events = {}; attributes = {};
  value = ''; checked = false; disabled = false; hidden = false; textContent = '';
  append(...children) {
    for (const child of children) {
      this.children = this.children.filter((value) => value !== child);
      this.children.push(child);
    }
  }
  replaceChildren(...children) { this.children = children; }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(name, fn) { (this.events[name] ??= []).push(fn); }
  emit(name) { for (const fn of this.events[name] ?? []) fn(); }
  click() { if (!this.disabled) this.emit('click'); }
  set innerHTML(_) { throw new Error('Unsafe HTML insertion'); }
}
const descendants = (el) => el.children.flatMap((child) => [child, ...descendants(child)]);
function harness(initial = defaultProfile()) {
  const ids = new Map(['rules-editor', 'rules-list', 'rules-enable', 'rules-add', 'rules-empty',
    'rules-status'].map((id) => [id, new Element()]));
  const get = (id) => ids.get(id);
  for (const key of ['rule', 'name', 'action', 'enabled', 'locked', 'domain', 'ip', 'port', 'network',
    'process', 'protocol', 'customTag', 'up', 'down', 'remove', 'duplicate', 'invalid', 'orderHint',
    'actionProxy', 'actionDirect', 'actionBlock', 'actionDns', 'actionCustom']) {
    get('rules-editor').dataset[key] = `translated:${key}`;
  }
  let current = initial, structures = 0, geo;
  const changes = [], previous = globalThis.document;
  globalThis.document = { getElementById: get, createElement: (tag) => new Element(tag) };
  const editor = initRulesEditor({ getProfile: () => current, onChange: (valid) => changes.push(valid),
    onStructureChange: () => { structures++; },
    openGeo: (...args) => { geo = args; } });
  const cards = () => get('rules-list').children.filter((el) => el.className === 'rule-card')
    .sort((a, b) => Number(a.dataset.ruleIndex) - Number(b.dataset.ruleIndex));
  const fields = (index) => descendants(cards()[index]);
  const field = (index, key) => fields(index).find((el) => el.id?.endsWith(`-${key}`));
  return { get, editor, changes, cards, fields, field, profile: () => current,
    structures: () => structures, geo: () => geo,
    import(value) { current = profileFromJson(value); editor.refresh(); },
    edit(index, key, value) {
      const el = field(index, key);
      if (['enabled', 'locked'].includes(key)) el.checked = value; else el.value = value;
      el.emit(['enabled', 'locked', 'action', 'network'].includes(key) ? 'change' : 'input');
    },
    action(index, key) {
      fields(index).find((el) => el.tagName === 'button'
        && el.textContent === (key.startsWith('Geo') ? key : `translated:${key}`)).click();
    },
    restore() { globalThis.document = previous; },
  };
}
function uiTest(name, fn, initial) {
  test(name, () => { const ui = harness(initial); try { fn(ui); } finally { ui.restore(); } });
}

test('new rules use the complete schema, unique IDs and an invalid empty enabled condition', () => {
  const first = createRule(), second = createRule([first]);
  assert.match(first.id, /^rule-/); assert.notEqual(first.id, second.id);
  assert.deepEqual({ ...first, id: '' }, { id: '', name: '', action: 'direct', enabled: true,
    locked: false, domain: [], ip: [], port: '', network: '', process: [], protocol: [], customTag: '' });
  assert.equal(validateRules(profile(), [first]), false);
  first.enabled = false;
  assert.equal(validateRules(profile(), [first]), true);
});

test('conversion skips empty lists, keeps six-list category order and all defaults', () => {
  const p = { blockSites: ['geosite:ads'], blockIp: ['192.0.2.1'], directSites: ['domain:local'],
    directIp: ['geoip:private'], proxySites: ['domain:remote'], proxyIp: ['198.51.100.1'] };
  const before = structuredClone(p), rows = rulesFromLegacy(p);
  assert.deepEqual(rows.map((r) => r.action), ['block', 'block', 'direct', 'direct', 'proxy', 'proxy']);
  assert.deepEqual(rows.map((r) => [r.domain, r.ip]), [
    [p.blockSites, []], [[], p.blockIp], [p.directSites, []], [[], p.directIp],
    [p.proxySites, []], [[], p.proxyIp] ]);
  assert.equal(new Set(rows.map((r) => r.id)).size, 6);
  for (const row of rows) assert.deepEqual({ ...row, id: '', action: 'direct', domain: [], ip: [] },
    { ...createRule(), id: '' });
  assert.deepEqual(p, before);
  assert.deepEqual(rulesFromLegacy({ blockSites: [], directIp: [' ', ''] }), []);
});

test('conversion recognizes explicit order, default order and never resurrects Rules []', () => {
  const p = { blockSites: ['b'], directSites: ['d'], proxySites: ['p'] };
  for (const routeOrder of [undefined, '', 'unknown']) assert.deepEqual(
    rulesFromLegacy({ ...p, routeOrder }).map((r) => r.action), ['block', 'direct', 'proxy']);
  assert.deepEqual(rulesFromLegacy({ ...p, routeOrder: 'proxy,block,direct' }).map((r) => r.action),
    ['proxy', 'block', 'direct']);
  assert.deepEqual(rulesFromLegacy({ ...p, rules: [] }), []);
  const full = [rule({ foreign: { nested: [1] } })];
  const clone = rulesFromLegacy({ ...p, rules: full }); clone[0].foreign.nested.push(2);
  assert.deepEqual(full[0].foreign.nested, [1]);
});

test('all five actions validate full graph references, including disabled targets', () => {
  for (const action of ['proxy', 'direct', 'block', 'dns']) {
    assert.equal(validateRules(profile(), [rule({ action })]), true, action);
  }
  for (const customTag of ['proxy', 'direct', 'block', 'dns']) assert.equal(
    validateRules(profile(), [rule({ action: 'custom', customTag })]), true, customTag);
  for (const enabled of [true, false]) for (const customTag of ['', 'missing', ' direct ']) {
    assert.equal(validateRules(profile(), [rule({ action: 'custom', customTag, enabled })]), false);
  }
  const p = { ...profile(), outbounds: [{ tag: 'own', protocol: 'freedom' }] };
  assert.equal(validateRules(p, [rule({ action: 'custom', customTag: 'own' })]), true);
  assert.equal(validateRules(p, [rule({ action: 'direct', enabled: false })]), false);
  assert.equal(validateRules(p, [rule({ action: 'custom', customTag: 'dns' })]), false);
  assert.equal(validateRules(p, [rule({ action: 'dns' })]), true);
  p.outbounds = [{ tag: 'own', protocol: 'freedom', proxySettings: { tag: 'own' } }];
  assert.equal(validateRules(p, [rule()]), false);
});

test('AND conditions preserve raw field values, edited lists split only at newlines', () => {
  const original = rule({ domain: [' full:untouched '], process: ['one', 'two'],
    protocol: ['http', 'tls'], port: '80,443', network: 'udp,tcp', foreign: { deep: [1] } });
  const rows = serializeRules(profile(), [original]);
  assert.deepEqual(rows, [original]); rows[0].foreign.deep.push(2);
  assert.deepEqual(original.foreign.deep, [1]);
  const edited = serializeRules(profile(), [{ ...original, domain: ' full:one \r\n\nregexp:^a,b$\n' }])[0];
  assert.deepEqual(edited.domain, ['full:one', 'regexp:^a,b$']);
  for (const key of ['process', 'protocol', 'port', 'network']) assert.deepEqual(edited[key], original[key]);
});

test('every supported condition independently makes an enabled rule nonempty', () => {
  for (const [key, value] of [['domain', ['a']], ['ip', ['192.0.2.1']], ['process', ['process-name']],
    ['protocol', ['tls']], ['port', '443'], ['network', 'tcp,udp']]) {
    assert.equal(validateRules(profile(), [{ action: 'proxy', [key]: value }]), true, key);
  }
  assert.equal(serializeRules(profile(), [{ action: 'proxy', domain: [' ', ''] }]), null);
  assert.equal(validateRules(profile(), [{ action: 'proxy', enabled: false }]), true);
});

test('malformed known fields and duplicate IDs fail without losing imported absence', () => {
  for (const extra of [{ name: null }, { id: ' ' }, { network: 1 }, { domain: null }, { ip: [1] },
    { enabled: null }, { locked: 0 }, { customTag: 1 }, { action: 'unknown' }]) {
    assert.equal(serializeRules(profile(), [rule(extra)]), null, JSON.stringify(extra));
  }
  assert.equal(validateRules(profile(), [rule({ id: 'same' }), rule({ id: 'same' })]), false);
  assert.deepEqual(serializeRules(profile(), [rule()]), [rule()]);
  assert.deepEqual(serializeRules(profile(), [rule({ id: '' })]), [rule({ id: '' })]);
});

uiTest('legacy mode never silently converts; explicit enable converts and leaves all globals intact', (ui) => {
  const before = structuredClone(ui.profile());
  ui.editor.refresh();
  assert.deepEqual(ui.changes, []); assert.equal(ui.structures(), 0);
  assert.equal(ui.get('rules-enable').hidden, false);
  assert.equal(ui.cards().length, 0); assert.equal(ui.get('rules-add').disabled, true);
  assert.deepEqual(ui.profile(), before);
  ui.get('rules-enable').click();
  assert.equal(ui.get('rules-enable').hidden, true);
  assert.equal(ui.profile().rules.length, 1);
  assert.equal(ui.profile().rules[0].action, 'direct');
  for (const key of Object.keys(before)) assert.deepEqual(ui.profile()[key], before[key], key);
  assert.deepEqual(ui.changes, [true]); assert.equal(ui.structures(), 1);
});

uiTest('explicit empty Rules has no conversion button and never restores legacy lists', (ui) => {
  ui.editor.refresh();
  assert.equal(ui.cards().length, 0);
  assert.equal(ui.get('rules-empty').hidden, false);
  assert.equal(ui.get('rules-enable').hidden, true);
  ui.get('rules-enable').emit('click');
  assert.deepEqual(ui.profile().rules, []); assert.deepEqual(ui.changes, []);
}, profile());

uiTest('adding creates invalid draft, retains last valid profile and reports every keystroke', (ui) => {
  const before = structuredClone(ui.profile());
  ui.get('rules-add').click();
  assert.equal(ui.cards().length, 1); assert.equal(ui.field(0, 'network').value, '');
  assert.equal(ui.editor.isValid(), false); assert.deepEqual(ui.profile(), before);
  assert.equal(ui.get('rules-status').textContent, 'translated:invalid');
  ui.edit(0, 'name', 'draft');
  assert.deepEqual(ui.changes, [false, false]); assert.equal(ui.structures(), 1);
  ui.edit(0, 'network', 'tcp,udp');
  assert.equal(ui.editor.isValid(), true); assert.equal(ui.profile().rules[0].name, 'draft');
  const saved = structuredClone(ui.profile());
  ui.edit(0, 'network', '');
  assert.deepEqual(ui.profile(), saved); assert.equal(ui.changes.at(-1), false);
  ui.edit(0, 'enabled', false);
  assert.equal(ui.editor.isValid(), true); assert.equal(ui.profile().rules[0].enabled, false);
  assert.equal(ui.profile().rules[0].network, '');
}, profile());

uiTest('refresh drops invalid draft without callbacks and detached controls cannot edit imported state', (ui) => {
  ui.get('rules-add').click(); const old = ui.field(0, 'name');
  ui.import({ Rules: [rule({ name: 'fresh' })] });
  old.value = 'stale'; old.emit('input');
  assert.equal(ui.field(0, 'name').value, 'fresh'); assert.deepEqual(ui.changes, [false]);
  assert.equal(ui.editor.isValid(), true);
}, profile());

uiTest('imported unknown nested fields and absent known fields survive edits and link roundtrip', (ui) => {
  const imported = rule({ network: 'future-network', domain: [' full:EXACT '],
    extra: { nested: [{ token: '<script>' }] } });
  ui.import({ Rules: [imported] });
  assert.ok(ui.field(0, 'network').children.some((el) => el.value === 'future-network'));
  ui.edit(0, 'name', 'Edited');
  assert.deepEqual(ui.profile().rules, [{ ...imported, name: 'Edited' }]);
  for (const cmd of ['add', 'onadd']) {
    const result = parseRoutingLink(buildLink(ui.profile(), cmd)).profile;
    assert.deepEqual(result.rules, ui.profile().rules);
  }
  assert.equal(Object.hasOwn(ui.profile().rules[0], 'enabled'), false);
  assert.equal(Object.hasOwn(ui.profile().rules[0], 'id'), false);
});

uiTest('array textarea edits preserve AND fields and commit no invented protocol/process presets', (ui) => {
  ui.edit(0, 'domain', ' domain:a \r\n\nregexp:^x,y$');
  ui.edit(0, 'ip', '192.0.2.0/24\ngeoip:private');
  ui.edit(0, 'process', ' one.exe \n/path/to/process');
  ui.edit(0, 'protocol', 'http\ntls\nunknown-exact');
  ui.edit(0, 'port', '80,443');
  assert.deepEqual(ui.profile().rules[0], rule({ domain: ['domain:a', 'regexp:^x,y$'],
    ip: ['192.0.2.0/24', 'geoip:private'], process: ['one.exe', '/path/to/process'],
    protocol: ['http', 'tls', 'unknown-exact'], port: '80,443' }));
  assert.equal(ui.field(0, 'process').tagName, 'textarea');
  assert.equal(ui.field(0, 'protocol').tagName, 'textarea');
  assert.equal(ui.structures(), 0);
}, profile([rule()]));

uiTest('custom action visibility changes in place, bad/missing target blocks commit even disabled', (ui) => {
  const before = structuredClone(ui.profile());
  const custom = ui.field(0, 'customTag');
  ui.edit(0, 'action', 'custom');
  assert.equal(ui.field(0, 'customTag'), custom);
  assert.equal(ui.editor.isValid(), false); assert.deepEqual(ui.profile(), before);
  ui.edit(0, 'enabled', false); ui.edit(0, 'customTag', 'missing');
  assert.equal(ui.editor.isValid(), false);
  ui.edit(0, 'customTag', 'proxy');
  assert.equal(ui.editor.isValid(), true); assert.equal(ui.profile().rules[0].customTag, 'proxy');
  ui.edit(0, 'action', 'dns');
  assert.equal(ui.profile().rules[0].action, 'dns');
  assert.equal(ui.profile().rules[0].customTag, 'proxy');
}, profile([rule()]));

uiTest('adding an external destination resolves the pending rule without losing its draft', (ui) => {
  ui.edit(0, 'action', 'custom'); ui.edit(0, 'customTag', 'new-destination');
  assert.equal(ui.editor.isValid(), false);
  ui.profile().outbounds = [{ tag: 'direct', protocol: 'freedom' },
    { tag: 'block', protocol: 'blackhole' }, { tag: 'new-destination', protocol: 'freedom' }];
  ui.editor.sync();
  assert.equal(ui.editor.isValid(), true);
  assert.equal(ui.profile().rules[0].action, 'custom');
  assert.equal(ui.profile().rules[0].customTag, 'new-destination');
}, profile([rule()]));

uiTest('keep-on-reset flag does not prevent editing, toggling, ordering or removal', (ui) => {
  ui.edit(0, 'name', 'Editable'); ui.edit(0, 'enabled', false);
  assert.equal(ui.profile().rules[0].name, 'Editable');
  assert.equal(ui.profile().rules[0].enabled, false);
  assert.equal(ui.profile().rules[0].locked, true);
  ui.action(0, 'down');
  assert.equal(ui.profile().rules[1].id, 'one');
  ui.action(1, 'duplicate');
  assert.equal(ui.profile().rules.length, 3);
  ui.action(1, 'remove');
  assert.equal(ui.profile().rules.length, 2);
}, profile([rule({ id: 'one', locked: true }), rule({ id: 'two' })]));

uiTest('changing keep-on-reset invalidates stale controls but leaves current controls editable', (ui) => {
  const old = ui.field(0, 'name');
  ui.edit(0, 'locked', true);
  old.value = 'forbidden'; old.emit('input');
  assert.equal(ui.profile().rules[0].name, undefined);
  assert.notEqual(ui.field(0, 'name').disabled, true);
  ui.edit(0, 'locked', false); ui.edit(0, 'enabled', false);
  assert.equal(ui.profile().rules[0].enabled, false);
}, profile([rule()]));

uiTest('reorder keeps IDs/order, duplicate gets fresh ID and deep copy; remove last retains []', (ui) => {
  ui.action(1, 'up');
  assert.deepEqual(ui.profile().rules.map((r) => r.id), ['two', 'one']);
  ui.action(0, 'down');
  ui.action(0, 'duplicate');
  const rows = ui.profile().rules;
  assert.deepEqual(rows.map((r) => r.name), ['One', 'One', 'Two']);
  assert.notEqual(rows[1].id, 'one'); assert.notEqual(rows[1].id, 'two');
  assert.deepEqual({ ...rows[1], id: 'one' }, rows[0]);
  ui.edit(1, 'domain', 'clone');
  assert.deepEqual(ui.profile().rules[0].domain, ['original']);
  for (let i = 0; i < 3; i++) ui.action(0, 'remove');
  assert.deepEqual(ui.profile().rules, []);
  ui.editor.refresh(); assert.equal(ui.cards().length, 0);
  assert.equal(ui.get('rules-enable').hidden, true);
}, profile([rule({ id: 'one', name: 'One', domain: ['original'] }), rule({ id: 'two', name: 'Two' })]));

uiTest('GeoSite/GeoIP append and deduplicate current draft values before validation', (ui) => {
  ui.get('rules-add').click(); ui.action(0, 'GeoSite');
  let [kind, existing, choose] = ui.geo();
  assert.equal(kind, 'geosite'); assert.deepEqual(existing, []);
  choose(['geosite:one', 'geosite:one']);
  assert.deepEqual(ui.profile().rules[0].domain, ['geosite:one']);
  ui.edit(0, 'domain', 'geosite:one\ndomain:own'); ui.action(0, 'GeoSite');
  [kind, existing, choose] = ui.geo();
  assert.deepEqual(existing, ['geosite:one', 'domain:own']);
  choose(['geosite:one', 'geosite:two']);
  assert.deepEqual(ui.profile().rules[0].domain, ['geosite:one', 'domain:own', 'geosite:two']);
  ui.action(0, 'GeoIP'); [kind, existing, choose] = ui.geo();
  assert.equal(kind, 'geoip'); choose(['geoip:private']);
  assert.deepEqual(ui.profile().rules[0].ip, ['geoip:private']);
  assert.deepEqual(ui.changes, [false, true, true, true, true]);
}, profile());

uiTest('ordering changes only precedence within an action and leaves intervening groups in place', (ui) => {
  ui.action(2, 'up');
  assert.deepEqual(ui.profile().rules.map((r) => r.id), ['proxy-two', 'direct', 'proxy-one']);
  ui.action(1, 'up'); ui.action(1, 'down');
  assert.equal(ui.structures(), 1);
  ui.action(0, 'down');
  assert.deepEqual(ui.profile().rules.map((r) => r.id), ['proxy-one', 'direct', 'proxy-two']);
}, profile([rule({ id: 'proxy-one' }), rule({ id: 'direct', action: 'direct' }),
  rule({ id: 'proxy-two' })]));

uiTest('changing action immediately recalculates move controls without replacing focused fields', (ui) => {
  const action = ui.field(1, 'action');
  ui.edit(1, 'action', 'proxy');
  assert.equal(ui.field(1, 'action'), action);
  ui.action(1, 'up');
  assert.deepEqual(ui.profile().rules.map((r) => r.id), ['two', 'one']);
}, profile([rule({ id: 'one' }), rule({ id: 'two', action: 'direct' })]));

uiTest('late Geo selection cannot modify replaced or newly locked rules', (ui) => {
  ui.action(0, 'GeoSite'); const select = ui.geo()[2];
  ui.edit(0, 'locked', true); const before = structuredClone(ui.profile());
  select(['geosite:late']); assert.deepEqual(ui.profile(), before);
  ui.import({ Rules: [rule({ name: 'fresh' })] }); select(['geosite:stale']);
  assert.equal(ui.profile().rules[0].domain, undefined);
}, profile([rule()]));

uiTest('global and DNS fields are never touched by Rules editing or conversion', (ui) => {
  const p = ui.profile(); p.globalProxy = false; p.dnsServers = [{ address: 'localhost', enabled: false }];
  const before = structuredClone(p);
  ui.get('rules-enable').click(); ui.edit(0, 'network', 'udp'); ui.action(0, 'duplicate');
  ui.edit(1, 'action', 'dns');
  for (const key of Object.keys(before)) assert.deepEqual(p[key], before[key], key);
  p.globalProxy = true;
  assert.equal(ui.editor.isValid(), true);
});

uiTest('all fields/toggles have unique labels; action labels and ordering hint use parent attributes', (ui) => {
  const all = descendants(ui.get('rules-list'));
  const fields = all.filter((el) => ['input', 'textarea', 'select'].includes(el.tagName));
  assert.equal(new Set(fields.map((el) => el.id)).size, fields.length);
  assert.equal(new Set(fields.map((el) => el.attributes['aria-label'])).size, fields.length);
  for (const el of fields) assert.ok(all.some((label) => label.tagName === 'label' && label.htmlFor === el.id));
  assert.deepEqual(ui.field(0, 'action').children.map((el) => el.textContent),
    ['translated:actionProxy', 'translated:actionDirect', 'translated:actionBlock',
      'translated:actionDns', 'translated:actionCustom']);
  assert.ok(all.some((el) => el.textContent === 'translated:orderHint'));
  assert.deepEqual(ui.field(0, 'network').children.map((el) => el.value), ['', 'tcp', 'udp', 'tcp,udp']);
}, profile([rule(), rule()]));

test('full wire fixtures survive profile JSON and both link commands with exact rule payloads', () => {
  const p = profileFromJson({ GlobalProxy: 'false', Rules: [
    rule({ action: 'dns', domain: ['full:dns.invalid'], foreign: { values: [1, true] } }),
    rule({ action: 'block', ip: ['geoip:private'] }), rule({ action: 'direct', enabled: false }),
    rule({ action: 'custom', customTag: 'own', process: ['tool.exe'], protocol: ['tls'], port: '443' }),
    rule({ action: 'proxy', network: 'tcp,udp' }),
  ], Outbounds: [{ tag: 'direct', protocol: 'freedom' }, { tag: 'block', protocol: 'blackhole' },
    { tag: 'own', protocol: 'freedom', settings: { domainStrategy: 'UseIP' } }] });
  assert.deepEqual(profileFromJson(profileToJson(p)).rules, p.rules);
  for (const command of ['add', 'onadd']) assert.deepEqual(parseRoutingLink(buildLink(p, command)).profile, p);
});

console.log(`OK: ${passed} Rules editor tests passed`);
