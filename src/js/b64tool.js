// Инструменты Base64: кодирование и декодирование (data-tool на script-теге).
import { initCopyButtons, initCounters } from './common.js';
import { encodeText, encodeTextUrlSafe, decodeToText } from './codec.js';

const $ = (id) => document.getElementById(id);

function initEncode() {
  const input = $('b64-input');
  const output = $('b64-output');
  const urlSafe = $('opt-urlsafe');
  const noPadding = $('opt-nopadding');

  const update = () => {
    const text = input.value;
    if (text === '') {
      output.value = '';
      return;
    }
    let encoded = urlSafe.checked
      ? encodeTextUrlSafe(text)
      : encodeText(text);
    if (noPadding.checked && !urlSafe.checked) {
      encoded = encoded.replace(/=+$/, '');
    }
    output.value = encoded;
  };

  input.addEventListener('input', update);
  urlSafe.addEventListener('change', update);
  noPadding.addEventListener('change', update);
  document.querySelectorAll('.b64-example').forEach((btn) => {
    btn.addEventListener('click', () => {
      input.value = btn.dataset.value;
      update();
    });
  });
}

function initDecode() {
  const input = $('b64-input');
  const output = $('b64-output');
  const status = $('b64-status');
  const openBuilder = $('b64-open-builder');

  const update = () => {
    const raw = input.value.trim();
    openBuilder.hidden = true;
    if (raw === '') {
      output.value = '';
      status.hidden = true;
      return;
    }
    const text = decodeToText(raw);
    if (text === null) {
      output.value = '';
      status.hidden = false;
      return;
    }
    status.hidden = true;
    output.value = text;
    if (text.includes('://routing/')) {
      openBuilder.href = `../routing/#import=${encodeURIComponent(text)}`;
      openBuilder.hidden = false;
    }
  };

  input.addEventListener('input', update);
}

// Режим определяется по элементам страницы: #opt-urlsafe есть только
// на странице кодирования (document.currentScript в модулях недоступен).
const mode = document.getElementById('opt-urlsafe') ? 'encode' : 'decode';
if (mode === 'encode') initEncode();
else initDecode();
initCopyButtons();
initCounters();
