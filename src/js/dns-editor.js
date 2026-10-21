import { PREFIXES, dnsRows, dnsTransport, setDnsTransport, validateDnsRows, serializeDnsRows } from './dns-servers.js';
const STRATEGIES = ['', 'UseIP', 'UseIPv4', 'UseIPv6', 'none'];
let nextEditor = 0;

export function initDnsEditor({ getProfile, onChange }) {
  const list = document.getElementById('dns-editor-list');
  const add = document.getElementById('dns-add');
  const empty = document.getElementById('dns-empty');
  const status = document.getElementById('dns-editor-status');
  const query = document.getElementById('dns-query-strategy');
  const namespace = `dns-${++nextEditor}`;
  let rows = [], strategy = '', generation = 0;
  const isValid = () => validateDnsRows(rows) && STRATEGIES.includes(strategy);
  const text = (key, fallback) => list.dataset[key] || fallback;
  const node = (tag, content, className) => {
    const el = document.createElement(tag);
    if (content !== undefined) el.textContent = content;
    if (className) el.className = className;
    return el;
  };
  function validity() {
    status.hidden = isValid();
    status.textContent = isValid() ? '' : status.dataset.invalid || 'Check DNS settings';
    status.setAttribute('role', 'status');
  }
  function save() {
    const valid = isValid();
    if (valid) {
      const profile = getProfile();
      profile.dnsServers = serializeDnsRows(rows);
      if (strategy === '') delete profile.queryStrategy;
      else profile.queryStrategy = strategy;
    }
    validity();
    onChange(valid);
  }
  function render() {
    list.replaceChildren();
    empty.hidden = rows.length !== 0;
    add.disabled = query.disabled = false;
    query.value = strategy;
    rows.forEach((row, index) => {
      const card = node('div', undefined, 'dns-card');
      const head = node('div', undefined, 'dns-card-head');
      head.append(node('strong', `${text('server', 'Server')} ${index + 1}`));
      card.append(head);
      const version = generation;
      const guard = (fn) => () => {
        if (version === generation && rows.includes(row)) fn();
      };
      function field(key, tag = 'input', parent = card) {
        const wrapper = node('div', undefined, 'field');
        const input = node(tag);
        input.id = `${namespace}-${generation}-${index}-${key}`;
        const label = node('label', text(key, key));
        label.htmlFor = input.id;
        input.setAttribute('aria-label', `${text(key, key)} ${text('server', 'Server')} ${index + 1}`);
        wrapper.append(label, input);
        parent.append(wrapper);
        return input;
      }
      const enabled = field('enabled', 'input', head);
      enabled.type = 'checkbox';
      enabled.className = 'dns-enabled';
      enabled.checked = row.enabled;
      enabled.addEventListener('change', guard(() => { row.enabled = enabled.checked; save(); }));
      const actions = node('div', undefined, 'list-actions');
      for (const [key, offset] of [['up', -1], ['down', 1], ['remove', 0]]) {
        const button = node('button', text(key, key));
        button.className = 'btn';
        button.type = 'button';
        button.setAttribute('aria-label', `${text(key, key)} ${text('server', 'Server')} ${index + 1}`);
        button.disabled = offset !== 0 && !rows[index + offset];
        button.addEventListener('click', guard(() => {
          if (offset === 0) rows.splice(index, 1);
          else if (rows[index + offset]) [rows[index], rows[index + offset]] = [rows[index + offset], row];
          generation++; render(); save();
        }));
        actions.append(button);
      }
      head.append(actions);
      const type = field('type', 'select');
      for (const [value, label] of [['udp', 'UDP'], ['tcp', 'TCP'], ['https', 'DoH'],
        ['tcp+local', 'TCP local'], ['https+local', 'DoH local'], ['quic+local', 'DoQ local'],
        ['system', text('system', 'System DNS')], ['custom', text('custom', 'Custom address')]]) {
        const option = node('option', label); option.value = value; type.append(option);
      }
      type.value = row.type;
      const address = field('address');
      address.type = 'text'; address.value = row.address; address.autocomplete = 'off';
      const port = field('port');
      port.type = 'text'; port.inputMode = 'numeric'; port.value = row.port;
      const domains = field('domains', 'textarea');
      domains.value = typeof row.domains === 'string' ? row.domains : Array.isArray(row.domains) ? row.domains.join('\n') : '';
      const domainHint = node('small', text('domainHint', 'One per line'));
      domainHint.id = `${domains.id}-hint`;
      domains.setAttribute('aria-describedby', domainHint.id);
      card.append(domainHint);
      const hint = node('small'); hint.id = `${address.id}-hint`;
      address.setAttribute('aria-describedby', hint.id);
      port.setAttribute('aria-describedby', hint.id);
      card.append(hint);
      function transportState() {
        type.value = row.type;
        port.disabled = row.type !== 'udp';
        address.readOnly = row.type === 'system';
        address.placeholder = row.type === 'udp' ? 'example.invalid' : `${PREFIXES[row.type] || ''}example.invalid${row.type.startsWith('https') ? '/dns-query' : ''}`;
        hint.textContent = row.type === 'custom' ? text('unsupported', 'Custom syntax; compatibility not validated')
          : row.type === 'system' || row.type.endsWith('+local') ? text('localHint', 'Local/system mode bypasses routing')
            : text('routedHint', 'Nonlocal follows routing');
      }
      type.addEventListener('change', guard(() => {
        row.address = setDnsTransport(row.address, type.value);
        row.type = type.value; row.custom = type.value === 'custom';
        row.port = ''; address.value = row.address; port.value = '';
        transportState(); save();
      }));
      address.addEventListener('input', guard(() => {
        row.address = address.value;
        if (!row.custom) row.type = dnsTransport(row.address);
        transportState(); save();
      }));
      port.addEventListener('input', guard(() => {
        if (row.type !== 'udp') return;
        row.port = port.value; save();
      }));
      domains.addEventListener('input', guard(() => { row.domains = domains.value; save(); }));
      transportState(); list.append(card);
    });
    validity();
  }
  add.addEventListener('click', () => {
    rows.push({ address: '', port: '', domains: [], enabled: true, type: 'udp' });
    generation++; render(); save();
  });
  query.addEventListener('change', () => {
    strategy = query.value; save();
  });
  function refresh() {
    rows = dnsRows(getProfile()).map((row) => ({ ...row, type: dnsTransport(row.address) }));
    strategy = getProfile().queryStrategy ?? '';
    generation++; render();
  }
  refresh();
  return { refresh, isValid };
}
