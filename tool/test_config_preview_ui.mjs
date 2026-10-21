import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Test controller behavior independently of configuration-generation rules.
const script = readFileSync(new URL('../src/js/config-preview-ui.js', import.meta.url), 'utf8')
  .replace(/^import[^\n]+\n/, '').replace('export function', 'function');
class Element {
  value = '';
  dataset = {};
  hidden = false;
  disabled = false;
  children = [];
  events = {};
  appendChild(child) { this.children.push(child); }
  replaceChildren() { this.children = []; this.value = ''; }
  addEventListener(name, fn) { this.events[name] = fn; }
  emit(name) { this.events[name](); }
}
const elements = new Map();
const get = (id) => {
  if (!elements.has(id)) elements.set(id, new Element());
  return elements.get(id);
};
const document = { getElementById: get, createElement: () => new Element() };
get('preview-mode').value = 'template';
get('preview-status').dataset = Object.fromEntries(['pending', 'invalidBase', 'selectProxy',
  'unsupportedTopology', 'invalidTarget', 'invalidDns', 'invalidProfile'].map((code) => [code, code]));
let valid = true;
let failure;
let calls = [];
const build = (profile, base, tag) => {
  calls.push({ profile, base, tag });
  if (failure) throw new Error(failure);
  if (base && !tag) throw new Error('selectProxy');
  return { preview: true, base, tag };
};
const init = new Function('document', 'buildConfigPreview', `${script}\nreturn initConfigPreview;`)(document, build);
const profile = { name: 'test' };
const render = init({ getProfile: () => profile, isValid: () => valid });
assert.equal(JSON.parse(get('preview-output').value).preview, true);
assert.equal(get('preview-custom').hidden, true);
assert.equal(get('preview-copy').disabled, false);
assert.equal(calls.at(-1).base, null);
get('preview-mode').value = 'custom';
get('preview-mode').emit('change');
assert.equal(get('preview-output').value, '');
assert.equal(get('preview-copy').disabled, true);
assert.equal(get('preview-status').textContent, 'invalidBase');
const source = JSON.stringify({ outbounds: [
  { tag: 'direct', protocol: 'freedom' },
  { tag: 'server', protocol: 'vless' },
  { tag: 'server', protocol: 'trojan' },
  { tag: 'dns', protocol: 'dns' },
  { tag: 'block', protocol: 'blackhole' },
  { tag: 'other', protocol: 'socks' },
  null,
] });
get('preview-input').value = source;
get('preview-input').emit('input');
assert.equal(get('preview-status').textContent, 'selectProxy');
assert.deepEqual(get('preview-proxy').children.map((el) => el.value), ['', 'server', 'other']);
get('preview-proxy').value = 'server';
get('preview-proxy').emit('change');
assert.equal(get('preview-copy').disabled, false);
assert.equal(calls.at(-1).tag, 'server');
assert.equal(get('preview-input').value, source);
valid = false;
render();
assert.equal(get('preview-output').value, '');
assert.equal(get('preview-status').textContent, 'pending');
valid = true;
for (const code of ['unsupportedTopology', 'invalidTarget', 'invalidDns', 'invalidProfile', 'unrecognized']) {
  failure = code;
  render();
  assert.equal(get('preview-copy').disabled, true);
  assert.equal(get('preview-status').textContent, code === 'unrecognized' ? 'invalidProfile' : code);
}
failure = null;
render();
assert.equal(get('preview-copy').disabled, false);
for (const invalid of ['{', '[]', 'null', '42']) {
  get('preview-input').value = invalid;
  get('preview-input').emit('input');
  assert.equal(get('preview-output').value, '');
  assert.equal(get('preview-status').textContent, 'invalidBase');
}
get('preview-mode').value = 'template';
get('preview-mode').emit('change');
assert.equal(get('preview-status').hidden, true);
assert.equal(get('preview-copy').disabled, false);
assert.equal(calls.at(-1).base, null);
console.log('OK: preview modes, explicit proxy selection, invalid/pending/error clearing and immutable source input');
