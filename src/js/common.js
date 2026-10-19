// Общие UI-хелперы: копирование в буфер и счётчики символов.
function initCopyButtons() {
  const wasCopied = new WeakMap();
  document.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-copy]');
    if (!btn) return;
    const target = document.getElementById(btn.dataset.copy);
    if (!target) return;
    const text = 'value' in target ? target.value : target.textContent;
    const done = () => {
      if (wasCopied.has(btn)) clearTimeout(wasCopied.get(btn));
      btn.classList.add('is-copied');
      const prev = btn.textContent;
      btn.textContent = document.body.dataset.copied || 'OK';
      wasCopied.set(
        btn,
        setTimeout(() => {
          btn.classList.remove('is-copied');
          btn.textContent = prev;
        }, 1500),
      );
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, done);
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (_) { /* noop */ }
      ta.remove();
      done();
    }
  });
}

function initCounters() {
  const units = document.body.dataset.charsLabel || '';
  document.querySelectorAll('[data-counter]').forEach((span) => {
    const target = document.getElementById(span.dataset.counter);
    if (!target) return;
    const update = () => {
      span.textContent = `${target.value.length} ${units}`;
    };
    target.addEventListener('input', update);
    update();
  });
}

function showStatus(el, text, isError) {
  if (!el) return;
  el.hidden = false;
  el.textContent = text;
  el.classList.toggle('status-ok', !isError);
  el.classList.toggle('status-error', isError);
}

export { initCopyButtons, initCounters, showStatus };
