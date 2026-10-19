// Модель профиля маршрутизации — точный порт семантики приложения
// (внешний формат обмена: PascalCase JSON + строки-булевы, Base64).
import { encodeText } from './codec.js';

export const LINK_ERRORS = {
  invalidLink: 'invalidLink',
  unsupportedScheme: 'unsupportedScheme',
  missingPayload: 'missingPayload',
  unsupportedCommand: 'unsupportedCommand',
  invalidBase64: 'invalidBase64',
  invalidJson: 'invalidJson',
};

export const DOMAIN_STRATEGIES = ['AsIs', 'IPIfNonMatch', 'IPOnDemand'];
export const DIRECT_DOMAIN_STRATEGIES = ['AsIs', 'UseIP', 'UseIPv4', 'UseIPv6'];
export const ROUTE_ORDERS = [
  { value: 'block,direct,proxy', label: 'Block → Direct → Proxy' },
  { value: 'block,proxy,direct', label: 'Block → Proxy → Direct' },
  { value: 'proxy,direct,block', label: 'Proxy → Direct → Block' },
  { value: 'proxy,block,direct', label: 'Proxy → Block → Direct' },
  { value: 'direct,proxy,block', label: 'Direct → Proxy → Block' },
  { value: 'direct,block,proxy', label: 'Direct → Block → Proxy' },
];

function asString(json, a, b) {
  const v = json[a] !== undefined ? json[a] : json[b];
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length === 0 ? null : s;
}

function asBoolStr(json, a, b, defaultValue) {
  const s = asString(json, a, b);
  if (s === null) return defaultValue;
  const lower = s.toLowerCase();
  return lower === 'true' || lower === '1';
}

function asStringList(json, a, b) {
  const v = json[a] !== undefined ? json[a] : json[b];
  if (Array.isArray(v)) {
    return v.filter((e) => typeof e === 'string' && e.length > 0);
  }
  if (typeof v === 'string' && v.length > 0) return [v];
  return [];
}

function asStringMap(json, a, b) {
  const v = json[a] !== undefined ? json[a] : json[b];
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return {};
  const out = {};
  for (const [k, val] of Object.entries(v)) {
    out[k] = val === null || val === undefined ? '' : String(val);
  }
  return out;
}

function asInt(json, a, b) {
  const v = json[a] !== undefined ? json[a] : json[b];
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === 'string') {
    const n = parseInt(v, 10);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

function knownDirectStrategy(raw) {
  if (typeof raw !== 'string') return null;
  const normalized = raw.trim().toLowerCase();
  const found = DIRECT_DOMAIN_STRATEGIES.find(
    (s) => s.toLowerCase() === normalized,
  );
  return found === undefined ? null : found;
}

// fromJson: оба регистра ключей, безопасные дефолты для отсутствующих полей.
export function profileFromJson(json) {
  return {
    name: asString(json, 'Name', 'name'),
    globalProxy: asBoolStr(json, 'GlobalProxy', 'globalProxy', true),
    remoteDnsType: asString(json, 'RemoteDNSType', 'remoteDnsType'),
    remoteDnsDomain: asString(json, 'RemoteDNSDomain', 'remoteDnsDomain'),
    remoteDnsIp: asString(json, 'RemoteDNSIP', 'remoteDnsIp'),
    domesticDnsType: asString(json, 'DomesticDNSType', 'domesticDnsType'),
    domesticDnsDomain: asString(json, 'DomesticDNSDomain', 'domesticDnsDomain'),
    domesticDnsIp: asString(json, 'DomesticDNSIP', 'domesticDnsIp'),
    dnsHosts: asStringMap(json, 'DnsHosts', 'dnsHosts'),
    fakeDns: asBoolStr(json, 'FakeDNS', 'fakeDnsEnabled', false),
    directSites: asStringList(json, 'DirectSites', 'directSites'),
    directIp: asStringList(json, 'DirectIp', 'directIp'),
    proxySites: asStringList(json, 'ProxySites', 'proxySites'),
    proxyIp: asStringList(json, 'ProxyIp', 'proxyIp'),
    blockSites: asStringList(json, 'BlockSites', 'blockSites'),
    blockIp: asStringList(json, 'BlockIp', 'blockIp'),
    geoipUrl: asString(json, 'Geoipurl', 'geoipUrl'),
    geositeUrl: asString(json, 'Geositeurl', 'geositeUrl'),
    domainStrategy: asString(json, 'DomainStrategy', 'domainStrategy'),
    directDomainStrategy: knownDirectStrategy(
      json['DirectDomainStrategy'] !== undefined
        ? json['DirectDomainStrategy']
        : json['directDomainStrategy'],
    ),
    routeOrder: asString(json, 'RouteOrder', 'routeOrder'),
    useChunkFiles: asBoolStr(json, 'UseChunkFiles', 'useChunkFiles', false),
    lastUpdated: asInt(json, 'LastUpdated', 'lastUpdatedDate'),
  };
}

// toJson: PascalCase, булевы поля строками, порядок ключей как в приложении.
// DirectDomainStrategy включается только при известном значении,
// RouteOrder — только при заданном, LastUpdated — всегда строкой.
export function profileToJson(p) {
  const out = {};
  out['Name'] = p.name ?? '';
  out['GlobalProxy'] = String(p.globalProxy);
  out['RemoteDNSType'] = p.remoteDnsType ?? '';
  out['RemoteDNSDomain'] = p.remoteDnsDomain ?? '';
  out['RemoteDNSIP'] = p.remoteDnsIp ?? '';
  out['DomesticDNSType'] = p.domesticDnsType ?? '';
  out['DomesticDNSDomain'] = p.domesticDnsDomain ?? '';
  out['DomesticDNSIP'] = p.domesticDnsIp ?? '';
  out['DnsHosts'] = p.dnsHosts;
  out['FakeDNS'] = String(p.fakeDns);
  out['DirectSites'] = p.directSites;
  out['DirectIp'] = p.directIp;
  out['ProxySites'] = p.proxySites;
  out['ProxyIp'] = p.proxyIp;
  out['BlockSites'] = p.blockSites;
  out['BlockIp'] = p.blockIp;
  out['Geoipurl'] = p.geoipUrl ?? '';
  out['Geositeurl'] = p.geositeUrl ?? '';
  out['DomainStrategy'] = p.domainStrategy ?? '';
  const strategy = knownDirectStrategy(p.directDomainStrategy);
  if (strategy !== null) out['DirectDomainStrategy'] = strategy;
  if (p.routeOrder !== null && p.routeOrder !== undefined) {
    out['RouteOrder'] = p.routeOrder;
  }
  out['UseChunkFiles'] = String(p.useChunkFiles);
  out['LastUpdated'] = p.lastUpdated === null || p.lastUpdated === undefined
    ? ''
    : String(p.lastUpdated);
  return out;
}

export function encodeProfileB64(profile) {
  return encodeText(JSON.stringify(profileToJson(profile)));
}

export function buildLink(profile, command) {
  const cmd = command === 'onadd' ? 'onadd' : 'add';
  return `imsel://routing/${cmd}/${encodeProfileB64(profile)}`;
}

function isRoutingUri(url) {
  const scheme = url.protocol.replace(/:$/, '').toLowerCase();
  if (scheme === 'http' || scheme === 'https') {
    throw LINK_ERRORS.unsupportedScheme;
  }
  if (url.hostname.toLowerCase() !== 'routing') throw LINK_ERRORS.invalidLink;
  if (url.username !== '' || url.password !== '') throw LINK_ERRORS.invalidLink;
  if (url.port !== '') throw LINK_ERRORS.invalidLink;
  if (url.search !== '') throw LINK_ERRORS.invalidLink;
  if (url.hash !== '') throw LINK_ERRORS.invalidLink;
}

function decodePayload(raw) {
  let decoded;
  try {
    decoded = decodeURIComponent(raw);
  } catch (_) {
    throw LINK_ERRORS.invalidLink;
  }
  const { decodeToText } = codecModule;
  const text = decodeToText(decoded);
  if (text === null) throw LINK_ERRORS.invalidBase64;
  return text;
}

// Ленивая загрузка codec (разрешение циклической зависимости не требуется,
// но держим единый путь импорта для Node-тестов и браузера).
import * as codecModule from './codec.js';

// parseRoutingLink: любая схема кроме http(s), host == routing,
// команды add/onadd/off (off не поддерживается), base64 → JSON-объект.
export function parseRoutingLink(input) {
  const s = String(input).trim();
  if (!s.includes('://')) throw LINK_ERRORS.invalidLink;
  let url;
  try {
    url = new URL(s);
  } catch (_) {
    throw LINK_ERRORS.invalidLink;
  }
  if (!url.protocol) throw LINK_ERRORS.invalidLink;
  isRoutingUri(url);
  const segments = url.pathname.replace(/^\/+/, '').split('/');
  if (segments.length === 0 || segments[0] === '') {
    throw LINK_ERRORS.missingPayload;
  }
  const first = segments[0].toLowerCase();
  const hasCommand = ['add', 'onadd', 'off'].includes(first);
  if (hasCommand && first === 'off') throw LINK_ERRORS.unsupportedCommand;
  const payloadRaw = hasCommand ? segments.slice(1).join('/') : segments.join('/');
  if (payloadRaw.trim() === '') throw LINK_ERRORS.missingPayload;
  const text = decodePayload(payloadRaw);
  let json;
  try {
    json = JSON.parse(text);
  } catch (_) {
    throw LINK_ERRORS.invalidJson;
  }
  if (json === null || typeof json !== 'object' || Array.isArray(json)) {
    throw LINK_ERRORS.invalidJson;
  }
  return { command: hasCommand ? first : null, profile: profileFromJson(json) };
}

export function tryParseRoutingLink(input) {
  try {
    return parseRoutingLink(input);
  } catch (_) {
    return null;
  }
}

export function defaultProfile() {
  return {
    name: 'My Routing',
    globalProxy: true,
    remoteDnsType: 'DoH',
    remoteDnsDomain: 'https://cloudflare-dns.com/dns-query',
    remoteDnsIp: '1.1.1.1',
    domesticDnsType: 'DoH',
    domesticDnsDomain: 'https://dns.google/dns-query',
    domesticDnsIp: '8.8.8.8',
    dnsHosts: { 'cloudflare-dns.com': '1.1.1.1', 'dns.google': '8.8.8.8' },
    fakeDns: false,
    directSites: [],
    directIp: [
      '10.0.0.0/8',
      '172.16.0.0/12',
      '192.168.0.0/16',
      '169.254.0.0/16',
      '224.0.0.0/4',
      '255.255.255.255',
    ],
    proxySites: [],
    proxyIp: [],
    blockSites: [],
    blockIp: [],
    geoipUrl:
      'https://github.com/Loyalsoldier/v2ray-rules-dat/releases/latest/download/geoip.dat',
    geositeUrl:
      'https://github.com/Loyalsoldier/v2ray-rules-dat/releases/latest/download/geosite.dat',
    domainStrategy: 'IPIfNonMatch',
    directDomainStrategy: 'AsIs',
    routeOrder: 'block,direct,proxy',
    useChunkFiles: true,
    lastUpdated: null,
  };
}
