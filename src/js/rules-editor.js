import { validateProfileGraph } from './profile-graph.js';
import { RULE_ACTIONS, RULE_LISTS, cloneRulesData, createRule, rulesFromLegacy,
  serializeRules, splitRuleLines, ruleActionOrder } from './rules-state.js';

let nextEditor = 0;

export function initRulesEditor({ getProfile, onChange, onStructureChange, openGeo }) {
  const root = document.getElementById('rules-editor');
  const list = document.getElementById('rules-list');
  const enable = document.getElementById('rules-enable');
  const add = document.getElementById('rules-add');
  const empty = document.getElementById('rules-empty');
  const status = document.getElementById('rules-status');
  const namespace = `rules-${++nextEditor}`;
  let rows = [], active = false, generation = 0, source, orderControls = [], cards = [];
  const text = (key, fallback = key) => root.dataset[key] || fallback;
  const node = (tag, content, className) => {
    const el = document.createElement(tag);
    if (content !== undefined) el.textContent = content;
    if (className) el.className = className;
    return el;
  };
  function isValid() {
    if (active) return serializeRules(getProfile(), rows) !== null;
    try { validateProfileGraph(getProfile()); return true; } catch (_) { return false; }
  }
  function validity() {
    const valid = isValid();
    status.hidden = valid;
    status.textContent = valid ? '' : text('invalid', 'Check routing rules');
    status.setAttribute('role', 'status');
    list.setAttribute('aria-invalid', String(!valid));
    return valid;
  }
  function save(structure = false) {
    const rules = serializeRules(getProfile(), rows);
    if (rules !== null) getProfile().rules = rules;
    const valid = validity();
    onChange?.(valid);
    if (structure) onStructureChange?.();
  }
  function arrangeCards() {
    const order = ruleActionOrder(getProfile());
    [...cards].sort((a, b) => order.indexOf(a.row.action) - order.indexOf(b.row.action)
      || a.index - b.index).forEach(({ card }) => list.append(card));
  }
  function render() {
    generation++;
    orderControls = [];
    cards = [];
    list.replaceChildren();
    enable.hidden = active;
    add.hidden = !active;
    add.disabled = !active;
    empty.hidden = !active || rows.length !== 0;
    list.hidden = !active;
    if (text('orderHint', '')) {
      const hint = node('p', text('orderHint'), 'hint');
      hint.id = `${namespace}-order`;
      list.append(hint);
      list.setAttribute('aria-describedby', hint.id);
    }
    rows.forEach((row, index) => {
      const card = node('div', undefined, 'rule-card');
      card.dataset.ruleIndex = String(index);
      const head = node('div', undefined, 'rule-card-head');
      const title = `${text('rule', 'Rule')} ${index + 1}`;
      head.append(node('strong', title));
      card.append(head);
      const version = generation, wrappers = {};
      const current = () => version === generation && source === getProfile() && rows.includes(row);
      const guard = (fn) => () => {
        if (current()) fn();
      };
      function field(key, tag = 'input', parent = card) {
        const wrapper = node('div', undefined, 'field');
        const input = node(tag);
        input.id = `${namespace}-${generation}-${index}-${key}`;
        const label = node('label', text(key));
        label.htmlFor = input.id;
        input.setAttribute('aria-label', `${text(key)} ${title}`);
        wrapper.append(label, input);
        parent.append(wrapper);
        wrappers[key] = wrapper;
        return input;
      }
      function button(key, parent, fn, disabled = false, label = text(key)) {
        const el = node('button', label, 'btn');
        el.type = 'button';
        el.disabled = disabled;
        el.setAttribute('aria-label', `${label} ${title}`);
        el.addEventListener('click', guard(fn));
        parent.append(el);
        return el;
      }
      for (const key of ['enabled', 'locked']) {
        const input = field(key, 'input', head);
        input.type = 'checkbox';
        input.checked = key === 'enabled' ? row.enabled !== false : row.locked === true;
        input.addEventListener('change', guard(() => {
          row[key] = input.checked;
          if (key === 'locked') render();
          save(key === 'locked');
        }));
      }
      const actions = node('div', undefined, 'list-actions');
      head.append(actions);
      for (const [key, offset] of [['up', -1], ['down', 1]]) {
        const destination = () => {
          let target = index + offset;
          while (rows[target] && rows[target].action !== row.action) target += offset;
          return target;
        };
        const move = button(key, actions, () => {
          const target = destination();
          if (!rows[target]) return;
          [rows[index], rows[target]] = [rows[target], row];
          render(); save(true);
        });
        const update = () => {
          move.disabled = !rows[destination()];
        };
        orderControls.push(update); update();
      }
      button('duplicate', actions, () => {
        const copy = cloneRulesData(row);
        copy.id = createRule(rows).id;
        rows.splice(index + 1, 0, copy);
        render(); save(true);
      });
      button('remove', actions, () => { rows.splice(index, 1); render(); save(true); });
      const name = field('name');
      name.type = 'text'; name.value = row.name ?? '';
      name.addEventListener('input', guard(() => { row.name = name.value; save(); }));
      const action = field('action', 'select');
      for (const value of RULE_ACTIONS) {
        const option = node('option', text(`action${value[0].toUpperCase()}${value.slice(1)}`, value));
        option.value = value; action.append(option);
      }
      action.value = row.action;
      const customTag = field('customTag');
      customTag.type = 'text'; customTag.value = row.customTag ?? '';
      wrappers.customTag.hidden = row.action !== 'custom';
      action.addEventListener('change', guard(() => {
        row.action = action.value;
        wrappers.customTag.hidden = row.action !== 'custom';
        orderControls.forEach((update) => update());
        arrangeCards();
        save();
      }));
      customTag.addEventListener('input', guard(() => { row.customTag = customTag.value; save(); }));
      for (const key of RULE_LISTS) {
        const input = field(key, 'textarea');
        input.value = typeof row[key] === 'string' ? row[key] : (row[key] ?? []).join('\n');
        input.addEventListener('input', guard(() => { row[key] = input.value; save(); }));
        if (openGeo && ['domain', 'ip'].includes(key)) {
          const kind = key === 'domain' ? 'geosite' : 'geoip';
          button(key, wrappers[key], () => {
            const values = () => typeof row[key] === 'string' ? splitRuleLines(row[key]) : row[key] ?? [];
            openGeo(kind, [...values()], (selected) => {
              if (!current() || !Array.isArray(selected)
                || selected.some((value) => typeof value !== 'string')) return;
              row[key] = [...new Set([...values(), ...selected])];
              input.value = row[key].join('\n');
              save();
            });
          }, false, key === 'domain' ? 'GeoSite' : 'GeoIP');
        }
      }
      const port = field('port');
      port.type = 'text'; port.value = row.port ?? '';
      port.addEventListener('input', guard(() => { row.port = port.value; save(); }));
      const network = field('network', 'select');
      const networks = ['', 'tcp', 'udp', 'tcp,udp'];
      if (row.network && !networks.includes(row.network)) networks.push(row.network);
      for (const value of networks) {
        const option = node('option', value || text('network'));
        option.value = value; network.append(option);
      }
      network.value = row.network ?? '';
      network.addEventListener('change', guard(() => { row.network = network.value; save(); }));
      list.append(card);
      cards.push({ row, index, card });
    });
    arrangeCards();
    validity();
  }
  enable.addEventListener('click', () => {
    if (active || source !== getProfile()) return;
    rows = rulesFromLegacy(getProfile());
    for (const [index, row] of rows.entries()) {
      if (!row.name) row.name = `${text('rule', 'Rule')} ${index + 1}`;
    }
    active = true;
    render(); save(true);
  });
  add.addEventListener('click', () => {
    if (!active || source !== getProfile()) return;
    rows.push({ ...createRule(rows), name: `${text('rule', 'Rule')} ${rows.length + 1}` });
    render(); save(true);
  });
  function refresh() {
    source = getProfile();
    active = source.rules !== undefined;
    rows = active ? cloneRulesData(source.rules) : [];
    render();
  }
  refresh();
  return { refresh, isValid, arrange: arrangeCards, sync() {
    const rules = active ? serializeRules(getProfile(), rows) : null;
    if (rules !== null) getProfile().rules = rules;
    validity();
  } };
}
