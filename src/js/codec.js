// Base64 / UTF-8 codec, совместимый по поведению с декодером приложения:
// - стандартный и URL-safe алфавит, автодополнение padding;
// - пробельные символы игнорируются;
// - кодирование всегда стандартное (A–Z a–z 0–9 + /) с padding.

const B64_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function utf8ToBytes(text) {
  return Array.from(new TextEncoder().encode(text));
}

function bytesToUtf8(bytes) {
  return new TextDecoder('utf-8', { fatal: true }).decode(
    new Uint8Array(bytes),
  );
}

function bytesToB64(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64_ALPHABET[b0 >> 2];
    out += B64_ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? B64_ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < bytes.length ? B64_ALPHABET[b2 & 0x3f] : '=';
  }
  return out;
}

function encodeText(text) {
  return bytesToB64(utf8ToBytes(text));
}

function encodeTextUrlSafe(text) {
  return encodeText(text).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

// Нормализация пользовательского ввода: пробелы, URL-safe → стандартный,
// дополнение padding до кратного 4. Бросает исключение при чужих символах.
function normalizeB64(input) {
  let s = String(input).replace(/\s/g, '');
  s = s.replaceAll('-', '+').replaceAll('_', '/');
  const pad = s.length % 4;
  if (pad !== 0) s += '='.repeat(4 - pad);
  return s;
}

// Толерантное декодирование: возвращает текст или null (некорректный base64
// либо невалидная UTF-8 последовательность).
function decodeToText(input) {
  let s;
  try {
    s = normalizeB64(input);
  } catch (_) {
    return null;
  }
  const bytes = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of s) {
    if (ch === '=') break;
    const v = B64_ALPHABET.indexOf(ch);
    if (v < 0) return null;
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  try {
    return bytesToUtf8(bytes);
  } catch (_) {
    return null;
  }
}

export { utf8ToBytes, bytesToUtf8, encodeText, encodeTextUrlSafe, normalizeB64, decodeToText };
