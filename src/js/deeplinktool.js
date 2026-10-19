// Генератор диплинков: справочник схем + анализатор ссылок.
import { initCopyButtons } from './common.js';
import { parseRoutingLink, profileToJson } from './profile.js';

const $ = (id) => document.getElementById(id);

const KIND_LABELS = {
  routing: 'kindRouting',
  shareEnc: 'kindShareEnc',
  sharePlain: 'kindSharePlain',
  unknown: 'kindUnknown',
};

function label(kind) {
  const labels = $('dl-check').dataset;
  return labels[kind] || kind;
}

function classify(raw) {
  const link = raw.trim();
  if (link === '') return { kind: 'unknown' };
  try {
    const result = parseRoutingLink(link);
    return { kind: 'routing', profile: result.profile, link };
  } catch (_) {
    /* не routing-ссылка — проверяем раздачи */
  }
  if (/^[a-z][a-z0-9+.-]*:\/\/sub\/e1\//i.test(link)) {
    return { kind: 'shareEnc', link };
  }
  if (/^[a-z][a-z0-9+.-]*:\/\/sub\/p1\//i.test(link)) {
    return { kind: 'sharePlain', link };
  }
  return { kind: 'unknown' };
}

function analyze() {
  const result = classify($('dl-input').value);
  const box = $('dl-result');
  const jsonBox = $('dl-json');
  const openBuilder = $('dl-open-builder');
  box.hidden = false;
  $('dl-kind').textContent = label(KIND_LABELS[result.kind]);
  if (result.kind === 'routing') {
    jsonBox.hidden = false;
    jsonBox.value = JSON.stringify(profileToJson(result.profile), null, 2);
    openBuilder.href = `../routing/#import=${encodeURIComponent(result.link)}`;
    openBuilder.hidden = false;
  } else {
    jsonBox.hidden = true;
    jsonBox.value = '';
    openBuilder.hidden = true;
  }
}

function init() {
  $('dl-check').addEventListener('click', analyze);
  $('dl-input').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      analyze();
    }
  });
  initCopyButtons();
}

init();
