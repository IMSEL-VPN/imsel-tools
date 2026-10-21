// Routing Builder: визуальный редактор профиля маршрутизации.
import { initCopyButtons, initCounters, showStatus } from './common.js';
import { decodeToText } from './codec.js';
import { initGeoPicker } from './geo-picker.js';
import { initConfigPreview } from './config-preview-ui.js';
import { initDnsEditor } from './dns-editor.js';
import { initRulesEditor } from './rules-editor.js';
import { initOutboundsEditor } from './outbounds-editor.js';
import { profileTemplate } from './profile-templates.js';
import {
  profileFromJson,
  profileToJson,
  parseRoutingLink,
  buildLink,
  buildSourceLink,
  validateRoutingSourceUrl,
  defaultProfile,
  ROUTE_ORDERS,
  DOMAIN_STRATEGIES,
  DIRECT_DOMAIN_STRATEGIES,
} from './profile.js';

const $ = (id) => document.getElementById(id);

const state = { profile: defaultProfile(), command: 'add' };
const LIST_KEYS = [
  'directSites',
  'directIp',
  'proxySites',
  'proxyIp',
  'blockSites',
  'blockIp',
];
let jsonDirty = false;
let dnsHostsValid = true;
let renderConfigPreview = () => {};
let dnsEditor = { refresh() {}, isValid: () => true };
let rulesEditor = { refresh() {}, isValid: () => true };
let outboundsEditor = { refresh() {}, isValid: () => true };
let geoInputsValid = true;
const geoTouched = new Set();

function formValid() {
  return dnsHostsValid && geoInputsValid && dnsEditor.isValid()
    && rulesEditor.isValid() && outboundsEditor.isValid() && !jsonDirty;
}

function errorText(code) {
  const btn = $('import-btn');
  const key = {
    invalidLink: 'errInvalidLink',
    unsupportedScheme: 'errUnsupportedScheme',
    missingPayload: 'errMissingPayload',
    unsupportedCommand: 'errUnsupportedCommand',
    invalidBase64: 'errInvalidBase64',
    invalidJson: 'errInvalidJson',
    invalidProfile: 'errInvalidProfile',
    badInput: 'errBadInput',
  }[code] || 'errBadInput';
  return btn.dataset[key] || key;
}

function fillSelect(sel, values, { allowEmpty = false } = {}) {
  sel.innerHTML = '';
  if (allowEmpty) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '—';
    sel.appendChild(opt);
  }
  for (const v of values) {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = v;
    sel.appendChild(opt);
  }
}

function nullableText(el) {
  const v = el.value.trim();
  return v === '' ? null : v;
}

function formToState() {
  const p = state.profile;
  p.name = nullableText($('f-name'));
  if (!$('f-globalproxy').disabled) p.globalProxy = $('f-globalproxy').checked;
  if (!$('f-routeorder').disabled) p.routeOrder = nullableText($('f-routeorder'));
  if (!$('f-domainstrategy').disabled) p.domainStrategy = nullableText($('f-domainstrategy'));
  if (!$('f-directdomainstrategy').disabled) p.directDomainStrategy = nullableText($('f-directdomainstrategy'));
  if (!$('f-fakedns').disabled) p.fakeDns = $('f-fakedns').checked;
  p.useChunkFiles = $('f-usechunkfiles').checked;
  p.geoipUrl = nullableText($('f-geoipurl'));
  p.geositeUrl = nullableText($('f-geositeurl'));
  const ts = nullableText($('f-lastupdated'));
  p.lastUpdated = ts === null ? null : (parseInt(ts, 10) || 0);
  // dnsHosts обновляется отдельно из textarea (только валидный JSON).
}

function parseDnsHostsInput() {
  if ($('f-dnshosts').disabled) return;
  const raw = $('f-dnshosts').value.trim();
  if (raw === '') {
    state.profile.dnsHosts = {};
    dnsHostsValid = true;
  } else {
    try {
      const parsed = JSON.parse(raw);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('not an object');
      }
      const hosts = {};
      for (const [k, v] of Object.entries(parsed)) {
        hosts[k] = v === null || v === undefined ? '' : String(v);
      }
      state.profile.dnsHosts = hosts;
      dnsHostsValid = true;
    } catch (_) {
      dnsHostsValid = false;
    }
  }
  $('dnshosts-status').hidden = dnsHostsValid;
}

function renderChips(listName) {
  const container = document.querySelector(
    `.list-editor[data-list="${listName}"] .chips`,
  );
  const values = state.profile[listName];
  container.innerHTML = '';
  if (values.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'chips-empty';
    empty.textContent = '∅';
    container.appendChild(empty);
    return;
  }
  values.forEach((value, index) => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    const label = document.createElement('span');
    label.textContent = value;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.disabled = state.profile.rules !== undefined;
    remove.textContent = '×';
    remove.setAttribute('aria-label', '×');
    remove.addEventListener('click', () => {
      if (state.profile.rules !== undefined) return;
      state.profile[listName].splice(index, 1);
      renderChips(listName);
      render();
    });
    chip.append(label, remove);
    container.appendChild(chip);
  });
}

function syncProfileControls() {
  const p = state.profile;
  const fullRules = p.rules !== undefined;
  const fullOutbounds = p.outbounds !== undefined;
  $('advanced-notice').hidden = !(fullRules || fullOutbounds || p.blockAds !== undefined);
  for (const id of ['f-globalproxy', 'f-routeorder', 'f-domainstrategy']) {
    $(id).disabled = false;
  }
  $('f-directdomainstrategy').disabled = fullOutbounds;
  for (const id of ['f-dnshosts', 'f-fakedns']) {
    $(id).disabled = false;
  }
  document.querySelectorAll('.list-add-row input, .list-add-row .btn').forEach((el) => {
    el.disabled = fullRules;
  });
  $('simple-rules').open = !fullRules;
}

function stateToForm() {
  const p = state.profile;
  syncProfileControls();
  $('f-name').value = p.name ?? '';
  $('f-globalproxy').checked = p.globalProxy;
  $('f-routeorder').value = p.routeOrder ?? '';
  $('f-domainstrategy').value = p.domainStrategy ?? '';
  $('f-directdomainstrategy').value = p.directDomainStrategy ?? '';
  $('f-fakedns').checked = p.fakeDns;
  $('f-usechunkfiles').checked = p.useChunkFiles;
  $('f-blockads').checked = p.blockAds ?? true;
  $('f-geoipurl').value = p.geoipUrl ?? '';
  $('f-geositeurl').value = p.geositeUrl ?? '';
  $('f-lastupdated').value = p.lastUpdated ?? '';
  $('f-geoipchecksum').value = p.geoipSha256Url ?? '';
  $('f-geositechecksum').value = p.geositeSha256Url ?? '';
  $('f-geointerval').value = p.geoUpdateIntervalHours ?? '';
  geoInputsValid = true;
  geoTouched.clear();
  $('geo-fields-status').hidden = true;
  $('f-dnshosts').value =
    Object.keys(p.dnsHosts).length === 0
      ? '{ }'
      : JSON.stringify(p.dnsHosts, null, 2);
  $('onadd-toggle').checked = state.command === 'onadd';
  dnsHostsValid = true;
  $('dnshosts-status').hidden = true;
  for (const key of LIST_KEYS) renderChips(key);
  dnsEditor.refresh();
  rulesEditor.refresh();
  outboundsEditor.refresh();
}

function renderQr(link) {
  const box = $('qr-box');
  const note = $('qr-note');
  try {
    const qr = window.qrcode(0, 'M');
    qr.addData(link);
    qr.make();
    box.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2 });
    box.hidden = false;
    note.hidden = true;
  } catch (_) {
    box.hidden = true;
    box.innerHTML = '';
    note.hidden = false;
  }
}

function render() {
  rulesEditor.sync?.();
  const mode = $('link-mode').value || 'inline';
  $('link-source-field').hidden = mode === 'inline';
  let link = '';
  let sourceInvalid = false;
  let graphInvalid = false;
  try {
    if (mode !== 'inline') {
      link = buildSourceLink($('link-source-url').value, {
        automatic: mode === 'auto', command: state.command,
      });
    } else if (formValid()) link = buildLink(state.profile, state.command);
  } catch (_) {
    if (mode === 'inline') graphInvalid = true;
    else sourceInvalid = true;
  }
  $('link-source-error').hidden = !sourceInvalid;
  $('link-output').value = link;
  $('link-copy').disabled = link === '';
  if (link) renderQr(link);
  else {
    $('qr-box').hidden = true;
    $('qr-note').hidden = true;
  }
  if (!jsonDirty) {
    try {
      $('json-editor').value = JSON.stringify(profileToJson(state.profile), null, 2);
    } catch (_) { graphInvalid = true; }
  }
  $('profile-graph-error').hidden = !graphInvalid;
  $('fallback-summary').textContent = state.profile.globalProxy
    ? $('fallback-summary').dataset.proxy : $('fallback-summary').dataset.direct;
  renderConfigPreview();
}

function importFromObject(obj) {
  state.profile = profileFromJson(obj);
  $('link-mode').value = 'inline';
  stateToForm();
  jsonDirty = false;
  render();
}

function runImport(raw) {
  const input = raw.trim();
  if (input === '') throw 'badInput';
  if (input.startsWith('{')) {
    let parsed;
    try {
      parsed = JSON.parse(input);
    } catch (_) {
      throw 'invalidJson';
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw 'invalidJson';
    }
    importFromObject(parsed);
    return;
  }
  if (input.includes('://')) {
    let result;
    try {
      result = parseRoutingLink(input);
    } catch (e) {
      throw e;
    }
    if (result.command === 'onadd') state.command = 'onadd';
    else if (result.command === 'add') state.command = 'add';
    if (result.sourceUrl) {
      $('link-mode').value = result.automatic ? 'auto' : 'url';
      $('link-source-url').value = result.sourceUrl;
      $('onadd-toggle').checked = state.command === 'onadd';
      render();
      return;
    }
    importFromObject(profileToJson(result.profile));
    return;
  }
  const text = decodeToText(input);
  if (text === null) throw 'invalidBase64';
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (_) {
    throw 'invalidJson';
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw 'invalidJson';
  }
  importFromObject(parsed);
}

function bindImport() {
  const status = $('import-status');
  $('import-btn').addEventListener('click', () => {
    try {
      runImport($('import-input').value);
      showStatus(status, $('import-btn').dataset.statusOk || 'OK', false);
    } catch (e) {
      showStatus(status, errorText(e), true);
    }
  });
}

function bindJsonEditor() {
  const editor = $('json-editor');
  const status = $('json-status');
  editor.addEventListener('input', () => {
    jsonDirty = true;
    renderConfigPreview();
  });
  $('json-apply').addEventListener('click', () => {
    try {
      const parsed = JSON.parse(editor.value);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('not an object');
      }
      importFromObject(parsed);
      status.hidden = true;
    } catch (_) {
      status.hidden = false;
    }
  });
  $('json-reset').addEventListener('click', () => {
    jsonDirty = false;
    status.hidden = true;
    render();
  });
}

function bindTabs() {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach((b) => {
        b.classList.toggle('is-active', b === btn);
      });
      document.querySelectorAll('.tab-panel').forEach((panel) => {
        panel.classList.toggle(
          'is-active',
          panel.id === `tab-${btn.dataset.tab}`,
        );
      });
    });
  });
}

function bindLists() {
  document.querySelectorAll('.list-editor').forEach((editor) => {
    const key = editor.dataset.list;
    const input = editor.querySelector('.list-add-row input');
    const addBtn = editor.querySelector('.list-add-row .btn');
    const add = () => {
      if (state.profile.rules !== undefined) return;
      const value = input.value.trim();
      if (value === '') return;
      const list = state.profile[key];
      if (!list.includes(value)) list.push(value);
      input.value = '';
      renderChips(key);
      render();
    };
    addBtn.addEventListener('click', add);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        add();
      }
    });
  });
}

function bindForm() {
  $('template-apply').addEventListener('click', () => {
    const button = $('template-apply');
    importFromObject(profileToJson(profileTemplate($('template-select').value, button.dataset)));
  });
  $('f-blockads').addEventListener('change', () => {
    state.profile.blockAds = $('f-blockads').checked;
    render();
  });
  for (const id of ['f-geoipchecksum', 'f-geositechecksum', 'f-geointerval']) {
    $(id).addEventListener('input', () => {
      geoTouched.add(id);
      try {
        const ip = $('f-geoipchecksum').value.trim();
        const site = $('f-geositechecksum').value.trim();
        const interval = $('f-geointerval').value.trim();
        if (ip) validateRoutingSourceUrl(ip);
        if (site) validateRoutingSourceUrl(site);
        if (interval && (!/^\d+$/.test(interval) || Number(interval) > 8760)) throw new Error();
        for (const field of geoTouched) {
          const key = { 'f-geoipchecksum': 'geoipSha256Url',
            'f-geositechecksum': 'geositeSha256Url', 'f-geointerval': 'geoUpdateIntervalHours' }[field];
          if (field === 'f-geointerval') {
            if (interval === '') delete state.profile[key];
            else state.profile[key] = Number(interval);
          } else state.profile[key] = field === 'f-geoipchecksum' ? ip : site;
        }
        geoInputsValid = true;
      } catch (_) { geoInputsValid = false; }
      $('geo-fields-status').hidden = geoInputsValid;
      render();
    });
  }
  for (const id of ['link-mode', 'link-source-url']) {
    $(id).addEventListener('input', render);
    $(id).addEventListener('change', render);
  }
  const ids = [
    'f-name', 'f-globalproxy', 'f-routeorder', 'f-domainstrategy',
    'f-directdomainstrategy', 'f-fakedns', 'f-usechunkfiles',
    'f-geoipurl', 'f-geositeurl', 'f-lastupdated',
  ];
  for (const id of ids) {
    $(id).addEventListener('input', () => {
      formToState();
      if (id === 'f-routeorder') rulesEditor.arrange?.();
      render();
    });
  }
  $('f-dnshosts').addEventListener('input', () => {
    parseDnsHostsInput();
    render();
  });
  $('onadd-toggle').addEventListener('change', () => {
    state.command = $('onadd-toggle').checked ? 'onadd' : 'add';
    render();
  });
}

function importFromHash() {
  if (!location.hash.startsWith('#import=')) return;
  let link;
  try {
    link = decodeURIComponent(location.hash.slice('#import='.length));
  } catch (_) {
    return;
  }
  if (!link) return;
  try {
    runImport(link);
    history.replaceState(null, '', location.pathname);
    showStatus($('import-status'), $('import-btn').dataset.statusOk || 'OK', false);
  } catch (e) {
    $('import-input').value = link;
    showStatus($('import-status'), errorText(e), true);
  }
}

function init() {
  fillSelect(
    $('f-routeorder'),
    ROUTE_ORDERS.map((o) => o.value),
    { allowEmpty: true },
  );
  fillSelect($('f-domainstrategy'), DOMAIN_STRATEGIES, { allowEmpty: true });
  fillSelect($('f-directdomainstrategy'), DIRECT_DOMAIN_STRATEGIES, {
    allowEmpty: true,
  });
  dnsEditor = initDnsEditor({ getProfile: () => state.profile, onChange: () => render() });
  bindTabs();
  bindLists();
  const geoPicker = initGeoPicker({
    getProfile: () => state.profile,
    onAdd(key, values) {
      if (state.profile.rules !== undefined) return;
      const list = state.profile[key];
      for (const value of values) {
        if (!list.includes(value)) list.push(value);
      }
      renderChips(key);
      render();
    },
  });
  rulesEditor = initRulesEditor({ getProfile: () => state.profile,
    onChange: () => render(), onStructureChange: syncProfileControls,
    openGeo: (...args) => geoPicker.open(...args),
  });
  outboundsEditor = initOutboundsEditor({ getProfile: () => state.profile,
    onChange: () => render(), onStructureChange: syncProfileControls,
  });
  stateToForm();
  bindForm();
  bindImport();
  bindJsonEditor();
  renderConfigPreview = initConfigPreview({
    getProfile: () => state.profile,
    isValid: formValid,
  });
  render();
  importFromHash();
  initCopyButtons();
  initCounters();
}

init();
