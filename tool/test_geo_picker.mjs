import assert from 'node:assert/strict';
import { GEO_CATALOG } from '../src/js/geo-catalog-data.js';
import { geoKind, matchingCategories, catalogMatchesSource, initGeoPicker } from '../src/js/geo-picker.js';
import { defaultProfile, profileToJson, parseRoutingLink, buildLink } from '../src/js/profile.js';

for (const key of ['directSites', 'proxySites', 'blockSites']) assert.equal(geoKind(key), 'geosite');
for (const key of ['directIp', 'proxyIp', 'blockIp']) assert.equal(geoKind(key), 'geoip');
for (const kind of ['geoip', 'geosite']) {
  const entries = GEO_CATALOG[kind].categories;
  assert.ok(entries.length > 100);
  assert.deepEqual(entries, [...new Set(entries)].sort());
  assert.ok(entries.includes('private'));
  assert.ok(entries.includes('telegram'));
  assert.match(GEO_CATALOG[kind].sha256, /^[a-f0-9]{64}$/);
  assert.equal(catalogMatchesSource(kind, GEO_CATALOG[kind].url), true);
  assert.equal(catalogMatchesSource(kind, ''), false);
  assert.equal(catalogMatchesSource(kind, 'https://example.com/custom.dat'), false);
  assert.deepEqual(matchingCategories(kind, `  ${kind.toUpperCase()}:TELEGRAM `), ['telegram']);
  assert.deepEqual(matchingCategories(kind, 'not-a-real-category-123456'), []);
}

class Element {
  value = '';
  dataset = {};
  children = [];
  events = {};
  disabled = false;
  hidden = false;
  open = false;
  textContent = '';
  append(...items) { this.children.push(...items); }
  appendChild(item) { this.append(item); }
  replaceChildren(...items) { this.children = items; }
  setAttribute() {}
  focus() { this.focused = true; }
  showModal() { this.open = true; }
  close() { this.open = false; }
  addEventListener(name, fn) { (this.events[name] ??= []).push(fn); }
  emit(name) { for (const fn of this.events[name] ?? []) fn(); }
  click() { if (!this.disabled) this.emit('click'); }
}
const ids = new Map();
const get = (id) => {
  if (!ids.has(id)) ids.set(id, new Element());
  return ids.get(id);
};
const editors = ['directSites', 'directIp', 'proxySites', 'proxyIp', 'blockSites', 'blockIp'].map((key) => {
  const row = new Element();
  return { dataset: { list: key }, querySelector: () => row, row };
});
globalThis.document = {
  getElementById: get,
  createElement: () => new Element(),
  querySelectorAll: () => editors,
};
get('tab-rules').dataset = { geoSites: 'Choose GeoSite', geoIp: 'Choose GeoIP' };
get('geo-results').dataset = { local: 'Local networks', localDomains: 'Local domains' };
const profile = defaultProfile();
const initial = structuredClone(profile);
const commits = [];
initGeoPicker({
  getProfile: () => profile,
  onAdd(key, values) {
    commits.push(key);
    for (const value of values) if (!profile[key].includes(value)) profile[key].push(value);
  },
});
const open = (index) => editors[index].row.children[0].click();
const search = (value) => { get('geo-search').value = value; get('geo-search').emit('input'); };
const choose = (value) => {
  const checkbox = get('geo-results').children.map((el) => el.children[0]).find((el) => el.value === value);
  assert.ok(checkbox, value);
  assert.equal(checkbox.disabled, false);
  checkbox.checked = true;
  checkbox.emit('change');
};

for (let index = 0; index < editors.length; index++) {
  const key = editors[index].dataset.list;
  const kind = geoKind(key);
  open(index);
  assert.equal(get('geo-picker').open, true);
  assert.equal(get('geo-search').focused, true);
  assert.equal(get('geo-mismatch').hidden, true);
  assert.equal(get('geo-results').children.length, 100);
  assert.equal(get('geo-results').children[0].children[0].value, `${kind}:private`);
  assert.equal(get('geo-more').hidden, false);
  get('geo-more').click();
  assert.equal(get('geo-results').children.length, 200);
  search('telegram');
  choose(`${kind}:telegram`);
  search('private');
  choose(`${kind}:private`);
  get('geo-add').click();
  assert.equal(get('geo-picker').open, false);
  assert.ok(profile[key].includes(`${kind}:telegram`));
  assert.ok(profile[key].includes(`${kind}:private`));
  open(index);
  search('telegram');
  assert.equal(get('geo-results').children[0].children[0].disabled, true);
  assert.equal(get('geo-add').disabled, true);
  get('geo-close').click();
}
assert.deepEqual(commits, editors.map((el) => el.dataset.list));
assert.deepEqual(profile.directIp.slice(0, initial.directIp.length), initial.directIp);
assert.equal(profile.geositeUrl, initial.geositeUrl);
assert.equal(profile.geoipUrl, initial.geoipUrl);
assert.deepEqual(profileToJson(parseRoutingLink(buildLink(profile)).profile), profileToJson(profile));

// Unknown/empty sources warn without rewriting the source or changing existing values.
for (const url of ['https://example.com/custom.dat', null]) {
  profile.geositeUrl = url;
  open(0);
  assert.equal(get('geo-mismatch').hidden, false);
  search('not-found-12345');
  assert.equal(get('geo-empty').hidden, false);
  assert.equal(get('geo-results').children.length, 0);
  assert.equal(get('geo-add').disabled, true);
  get('geo-close').click();
  assert.equal(profile.geositeUrl, url);
}
// Cancel discards pending selections, including selections hidden by a search.
open(0);
search('google');
choose('geosite:google');
get('geo-close').click();
open(0);
assert.equal(get('geo-add').disabled, true);
assert.ok(!profile.directSites.includes('geosite:google'));
// Advanced Rules are authoritative, including while a picker is already open.
search('google');
choose('geosite:google');
profile.rules = [];
get('geo-add').click();
assert.ok(!profile.directSites.includes('geosite:google'));
get('geo-close').click();
open(0);
assert.equal(get('geo-picker').open, false);
delete globalThis.document;
console.log('OK: geo catalog integrity, six list pickers, search, paging, selections, cancellation, source warnings, Rules lock and profile round-trip');
