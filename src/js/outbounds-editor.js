import { validateProfileGraph } from './profile-graph.js';

const STRATEGIES = ['AsIs', 'UseIP', 'UseIPv4', 'UseIPv6'];
const KINDS = ['freedom', 'blackhole', 'dns', 'socks', 'http', 'json'];
const RESERVED = ['proxy', 'socks', 'socks-lan', 'http'];
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const clone = (value) => JSON.parse(JSON.stringify(value));
let nextEditor = 0;

export function initOutboundsEditor({ getProfile, onChange, onStructureChange }) {
  const root = document.getElementById('outbounds-editor');
  const list = document.getElementById('outbounds-list');
  const enable = document.getElementById('outbounds-enable');
  const add = document.getElementById('outbounds-add');
  const kind = document.getElementById('outbounds-kind');
  const status = document.getElementById('outbounds-status');
  const empty = document.getElementById('outbounds-empty');
  const namespace = `outbounds-${++nextEditor}`;
  const text = (key, fallback) => root.dataset[key] || fallback;
  let rows = [], explicit = false, malformed = false, generation = 0, nextRow = 0;
  let committedOrder = [], operationError = '', controls = [], ownerProfile;
  const node = (tag, content, className) => {
    const el = document.createElement(tag);
    if (content !== undefined) el.textContent = content;
    if (className) el.className = className;
    return el;
  };
  function defaults(profile) {
    const settings = {};
    if (STRATEGIES.includes(profile.directDomainStrategy) && profile.directDomainStrategy !== 'AsIs') {
      settings.domainStrategy = profile.directDomainStrategy;
    }
    return [{ tag: 'direct', protocol: 'freedom', settings },
      { tag: 'block', protocol: 'blackhole', settings: {} }];
  }
  function draft(item) {
    const { tag, protocol, settings, ...extra } = clone(item);
    return { id: ++nextRow, originalTag: tag, tag, protocol,
      settingsPresent: Object.hasOwn(item, 'settings'),
      settings: JSON.stringify(settings === undefined ? {} : settings, null, 2),
      extra: JSON.stringify(extra, null, 2) };
  }
  function outbound(row) {
    const parse = (value) => JSON.parse(value, (_, item) => {
      if (typeof item === 'number' && !Number.isFinite(item)) throw 'invalidProfile';
      return item;
    });
    const settings = parse(row.settings);
    const extra = parse(row.extra);
    if (!object(settings) || !object(extra)
      || ['tag', 'protocol', 'settings'].some((key) => Object.hasOwn(extra, key))) throw 'invalidProfile';
    const item = { ...extra, tag: row.tag, protocol: row.protocol };
    if (row.settingsPresent) item.settings = settings;
    return item;
  }
  function referenced(tag, profile = getProfile()) {
    if (!profile.globalProxy && tag === 'direct') return true;
    if (profile.rules !== undefined) {
      if (profile.rules.some((rule) => rule.customTag === tag
        || rule.action !== 'custom' && rule.action === tag)) return true;
    } else {
      const prefix = tag === 'direct' ? 'direct' : tag === 'block' ? 'block' : null;
      if (prefix && (profile[`${prefix}Sites`]?.length || profile[`${prefix}Ip`]?.length)) return true;
    }
    return (profile.outbounds ?? []).some((item) => item.tag !== tag
      && (item.proxySettings?.tag === tag || item.streamSettings?.sockopt?.dialerProxy === tag));
  }
  function candidate() {
    if (malformed || operationError) throw 'invalidProfile';
    const profile = getProfile();
    if (!explicit) {
      validateProfileGraph(profile);
      return null;
    }
    const outbounds = rows.map(outbound);
    rows.forEach((row) => {
      if (row.tag !== row.originalTag && referenced(row.originalTag, profile)) throw 'invalidProfile';
    });
    validateProfileGraph({ ...profile, outbounds });
    return outbounds;
  }
  function isValid() {
    try { candidate(); return true; } catch (_) { return false; }
  }
  function canRemove(row) {
    if (!explicit || referenced(row.originalTag)) return false;
    try {
      validateProfileGraph({ ...getProfile(), outbounds: rows.filter((item) => item !== row).map(outbound) });
      return true;
    } catch (_) { return false; }
  }
  function validity() {
    const valid = isValid();
    status.hidden = valid;
    status.textContent = valid ? '' : operationError || text('invalid', 'Check outbound settings');
    status.setAttribute('role', 'status');
    for (const update of controls) update();
    return valid;
  }
  function save() {
    const valid = validity();
    let structure = false;
    if (valid && explicit) {
      const order = rows.map((row) => row.id);
      structure = getProfile().outbounds === undefined || order.length !== committedOrder.length
        || order.some((id, index) => id !== committedOrder[index]);
      getProfile().outbounds = clone(candidate());
      rows.forEach((row) => { row.originalTag = row.tag; });
      committedOrder = order;
    }
    onChange(valid);
    if (structure) onStructureChange?.();
  }
  function render() {
    generation++;
    controls = [];
    list.replaceChildren();
    enable.hidden = explicit;
    add.disabled = kind.disabled = !explicit || malformed;
    empty.hidden = rows.length !== 0;
    const profile = getProfile(), version = generation;
    rows.forEach((row, index) => {
      const card = node('div', undefined, 'outbound-card');
      const head = node('div', undefined, 'outbound-head');
      const title = `${text('title', 'Outbound')} ${index + 1}`;
      head.append(node('strong', title));
      card.append(head);
      const guard = (fn) => () => {
        if (explicit && !malformed && version === generation && getProfile() === profile && rows.includes(row)) {
          operationError = ''; fn();
        }
      };
      const containers = {};
      function field(key, tag = 'input') {
        const wrapper = node('div', undefined, 'field');
        containers[key] = wrapper;
        const input = node(tag);
        input.id = `${namespace}-${generation}-${row.id}-${key}`;
        input.disabled = !explicit || malformed;
        input.setAttribute('aria-label', `${text(key, key)} ${title}`);
        const label = node('label', text(key, key));
        label.htmlFor = input.id;
        wrapper.append(label, input); card.append(wrapper);
        return input;
      }
      const tag = field('tag'); tag.type = 'text'; tag.value = row.tag; tag.autocomplete = 'off';
      const protocol = field('protocol'); protocol.type = 'text'; protocol.value = row.protocol;
      protocol.autocomplete = 'off';
      const strategy = field('domainStrategy', 'select');
      for (const value of STRATEGIES) {
        const option = node('option', value); option.value = value; strategy.append(option);
      }
      const settings = field('settings', 'textarea'); settings.value = row.settings;
      const extra = field('extra', 'textarea'); extra.value = row.extra;
      settings.spellcheck = extra.spellcheck = false;
      settings.autocomplete = extra.autocomplete = 'off';
      settings.rows = extra.rows = 6;
      const hint = node('small'); hint.id = `${tag.id}-hint`;
      tag.setAttribute('aria-describedby', hint.id);
      card.append(hint);
      const actions = node('div', undefined, 'list-actions');
      const buttons = {};
      for (const [key, offset] of [['up', -1], ['down', 1], ['remove', 0]]) {
        const label = text(key, text(key === 'up' ? 'moveUp' : key === 'down' ? 'moveDown' : key,
          key === 'up' ? 'Move up' : key === 'down' ? 'Move down' : 'Remove'));
        const button = node('button', label, 'btn');
        button.type = 'button'; button.setAttribute('aria-label', `${label} ${title}`);
        buttons[key] = button;
        button.addEventListener('click', guard(() => {
          if (offset === 0) {
            if (!canRemove(row)) return;
            rows.splice(index, 1);
          } else {
            if (!rows[index + offset]) return;
            [rows[index], rows[index + offset]] = [rows[index + offset], row];
          }
          render(); save();
        }));
        actions.append(button);
      }
      head.append(actions);
      controls.push(() => {
        buttons.up.disabled = !explicit || index === 0;
        buttons.down.disabled = !explicit || index === rows.length - 1;
        buttons.remove.disabled = !canRemove(row);
        hint.textContent = !explicit ? text('protected', 'Enable the outbound list to edit')
          : referenced(row.originalTag) ? text('references', 'Referenced outbound: keep its tag or edit the whole profile JSON') : '';
        strategy.hidden = row.protocol !== 'freedom';
        containers.domainStrategy.hidden = strategy.hidden;
        try {
          const value = JSON.parse(row.settings).domainStrategy;
          strategy.value = value === undefined ? 'AsIs' : value;
          strategy.disabled = !explicit || !object(JSON.parse(row.settings))
            || value !== undefined && !STRATEGIES.includes(value);
        } catch (_) { strategy.disabled = true; }
      });
      tag.addEventListener('input', guard(() => { row.tag = tag.value; save(); }));
      protocol.addEventListener('input', guard(() => { row.protocol = protocol.value; save(); }));
      settings.addEventListener('input', guard(() => {
        row.settings = settings.value; row.settingsPresent = true; save();
      }));
      extra.addEventListener('input', guard(() => { row.extra = extra.value; save(); }));
      strategy.addEventListener('change', guard(() => {
        if (row.protocol !== 'freedom' || !STRATEGIES.includes(strategy.value)) return;
        try {
          const value = JSON.parse(row.settings);
          if (!object(value)) return;
          value.domainStrategy = strategy.value;
          row.settings = JSON.stringify(value, null, 2); row.settingsPresent = true;
          settings.value = row.settings; save();
        } catch (_) { /* Keep an invalid raw draft until the user fixes it. */ }
      }));
      list.append(card);
    });
    validity();
  }
  enable.addEventListener('click', () => {
    if (explicit || getProfile() !== ownerProfile || getProfile().outbounds !== undefined) return;
    rows = defaults(getProfile()).map(draft); explicit = true; operationError = '';
    render(); save();
  });
  add.addEventListener('click', () => {
    if (!explicit || malformed || getProfile() !== ownerProfile) return;
    operationError = '';
    if (!KINDS.includes(kind.value)) {
      operationError = text('addInvalid', text('invalid', 'Check outbound settings')); save(); return;
    }
    const protocol = kind.value === 'json' ? 'socks' : kind.value;
    const base = kind.value === 'json' ? 'outbound' : protocol === 'freedom' ? 'direct'
      : protocol === 'blackhole' ? 'block' : protocol;
    const used = new Set([...RESERVED, ...rows.map((row) => row.tag)]);
    let tag = base, suffix = 2;
    while (used.has(tag)) tag = `${base}-${suffix++}`;
    const settings = kind.value !== 'json' && ['socks', 'http'].includes(protocol)
      ? { servers: [{ address: 'proxy.example.invalid', port: protocol === 'socks' ? 1080 : 8080 }] } : {};
    rows.push(draft({ tag, protocol, settings })); render(); save();
  });
  function refresh() {
    const profile = getProfile();
    ownerProfile = profile;
    explicit = profile.outbounds !== undefined;
    malformed = explicit && (!Array.isArray(profile.outbounds) || profile.outbounds.some((item) => !object(item)));
    rows = malformed ? [] : (explicit ? profile.outbounds : defaults(profile)).map(draft);
    committedOrder = explicit ? rows.map((row) => row.id) : [];
    operationError = ''; render();
  }
  refresh();
  return { refresh, isValid };
}
