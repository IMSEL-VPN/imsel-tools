import { buildConfigPreview } from './config-preview.js';

export function initConfigPreview({ getProfile, isValid }) {
  const $ = (id) => document.getElementById(id);
  const mode = $('preview-mode');
  const input = $('preview-input');
  const select = $('preview-proxy');
  const output = $('preview-output');
  const status = $('preview-status');
  let base = null;
  let baseValid = false;

  function render() {
    const custom = mode.value === 'custom';
    $('preview-custom').hidden = !custom;
    $('preview-template-note').hidden = custom;
    output.value = '';
    $('preview-copy').disabled = true;
    status.hidden = true;
    try {
      if (!isValid()) throw new Error('pending');
      if (custom && !baseValid) throw new Error('invalidBase');
      const config = buildConfigPreview(getProfile(), custom ? base : null, select.value);
      output.value = JSON.stringify(config, null, 2);
      $('preview-copy').disabled = false;
    } catch (error) {
      const codes = {
        pending: 'pending', invalidBase: 'invalidBase', selectProxy: 'selectProxy',
        unsupportedTopology: 'unsupportedTopology', invalidTarget: 'invalidTarget',
        invalidDns: 'invalidDns', invalidProfile: 'invalidProfile',
      };
      status.textContent = status.dataset[codes[error.message] || 'invalidProfile'];
      status.hidden = false;
    }
  }

  function readBase() {
    const previous = select.value;
    select.replaceChildren();
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = select.dataset.placeholder;
    select.appendChild(empty);
    base = null;
    baseValid = false;
    try {
      const parsed = JSON.parse(input.value);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
      base = parsed;
      baseValid = true;
      if (Array.isArray(base.outbounds)) {
        const tags = new Set();
        for (const outbound of base.outbounds) {
          if (!outbound || typeof outbound.tag !== 'string' || !outbound.tag
            || typeof outbound.protocol !== 'string'
            || ['freedom', 'blackhole', 'dns'].includes(outbound.protocol)
            || tags.has(outbound.tag)) continue;
          tags.add(outbound.tag);
          const option = document.createElement('option');
          option.value = outbound.tag;
          option.textContent = `${outbound.tag} (${outbound.protocol})`;
          select.appendChild(option);
        }
        if (tags.has(previous)) select.value = previous;
      }
    } catch { /* Invalid source must clear any previously successful preview. */ }
    render();
  }
  mode.addEventListener('change', render);
  input.addEventListener('input', readBase);
  select.addEventListener('change', render);
  readBase();
  return render;
}
