import { GEO_CATALOG } from './geo-catalog-data.js';

export function geoKind(listName) {
  return listName.endsWith('Sites') ? 'geosite' : 'geoip';
}

export function matchingCategories(kind, query) {
  const search = query.trim().toLowerCase().replace(new RegExp(`^${kind}:`), '');
  return GEO_CATALOG[kind].categories.filter((name) => name.includes(search));
}

export function catalogMatchesSource(kind, url) {
  return (url || '').trim() === GEO_CATALOG[kind].url;
}

// The picker only adds references. It never changes the profile's geo URLs.
export function initGeoPicker({ getProfile, onAdd }) {
  const $ = (id) => document.getElementById(id);
  const dialog = $('geo-picker');
  const search = $('geo-search');
  const results = $('geo-results');
  const count = $('geo-count');
  const add = $('geo-add');
  let kind;
  let commit = () => {};
  let canAdd = () => false;
  let selected = new Set();
  let existing = new Set();
  let limit = 100;

  function updateCount(total) {
    count.textContent = `${count.dataset.results}: ${total} · ${count.dataset.selected}: ${selected.size}`;
    add.disabled = selected.size === 0 || !canAdd();
  }

  function open(type, values, onSelected, options = {}) {
    kind = type;
    commit = onSelected;
    canAdd = options.canAdd || (() => true);
    if (!canAdd()) return;
    existing = new Set(values);
    selected = new Set();
    search.value = '';
    limit = 100;
    $('geo-title').textContent = options.title || (kind === 'geosite' ? 'GeoSite' : 'GeoIP');
    $('geo-source').textContent = `${$('geo-source').dataset.label}: ${GEO_CATALOG.provider} · ${GEO_CATALOG.updatedAt.slice(0, 10)} · ${GEO_CATALOG[kind].categories.length}`;
    $('geo-mismatch').hidden = catalogMatchesSource(kind, getProfile()[`${kind}Url`]);
    renderResults();
    results.scrollTop = 0;
    dialog.showModal();
    search.focus();
  }

  function renderResults() {
    let matches = matchingCategories(kind, search.value);
    if (search.value.trim() === '' && matches.includes('private')) {
      matches = ['private', ...matches.filter((name) => name !== 'private')];
    }
    results.replaceChildren();
    for (const name of matches.slice(0, limit)) {
      const value = `${kind}:${name}`;
      const label = document.createElement('label');
      label.className = 'geo-option';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = value;
      checkbox.checked = existing.has(value) || selected.has(value);
      checkbox.disabled = existing.has(value);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) selected.add(value);
        else selected.delete(value);
        updateCount(matches.length);
      });
      const text = document.createElement('span');
      text.textContent = name === 'private'
        ? `${value} (${kind === 'geoip' ? results.dataset.local : results.dataset.localDomains})` : value;
      label.append(checkbox, text);
      results.appendChild(label);
    }
    $('geo-empty').hidden = matches.length !== 0;
    $('geo-more').hidden = matches.length <= limit;
    updateCount(matches.length);
  }

  const tab = $('tab-rules');
  for (const editor of document.querySelectorAll('.list-editor')) {
    const key = editor.dataset.list;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn geo-open';
    button.textContent = geoKind(key) === 'geosite' ? tab.dataset.geoSites : tab.dataset.geoIp;
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('aria-controls', 'geo-picker');
    button.addEventListener('click', () => {
      const profile = getProfile();
      if (profile.rules !== undefined) return;
      open(geoKind(key), profile[key], (values) => onAdd(key, values), {
        title: `${button.textContent} / ${key}`,
        canAdd: () => getProfile() === profile && getProfile().rules === undefined,
      });
    });
    editor.querySelector('.list-add-row').appendChild(button);
  }
  search.addEventListener('input', () => {
    limit = 100;
    renderResults();
    results.scrollTop = 0;
  });
  $('geo-more').addEventListener('click', () => {
    limit += 100;
    renderResults();
  });
  $('geo-close').addEventListener('click', () => dialog.close());
  add.addEventListener('click', () => {
    if (!canAdd() || selected.size === 0) return;
    commit([...selected]);
    dialog.close();
  });
  return { open };
}
