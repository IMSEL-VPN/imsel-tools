const PREFIXES = { udp: '', tcp: 'tcp://', https: 'https://',
  'tcp+local': 'tcp+local://', 'https+local': 'https+local://', 'quic+local': 'quic+local://' };
export { PREFIXES };

export function dnsTransport(address) {
  if (typeof address !== 'string') return 'custom';
  if (address.toLowerCase() === 'localhost') return 'system';
  for (const [type, prefix] of Object.entries(PREFIXES)) {
    if (prefix && address.toLowerCase().startsWith(prefix)) return type;
  }
  return address === 'fakedns' || /^[a-z][\w+.-]*:\/\//i.test(address)
    || /^[a-z][\w+.-]*:[^:]+$/i.test(address) && !/:\d+(?:[/?]|$)/.test(address) ? 'custom' : 'udp';
}

export function setDnsTransport(address, type) {
  if (type === 'custom' || !Object.hasOwn(PREFIXES, type) && type !== 'system') return address;
  if (type === 'system') return 'localhost';
  let endpoint = address.toLowerCase() === 'localhost' ? '' : address.replace(/^[a-z][\w+.-]*:\/\//i, '');
  if (!type.startsWith('https')) endpoint = endpoint.split(/[/?#]/)[0];
  if (type !== 'udp' && /^[\da-f:]+$/i.test(endpoint) && endpoint.split(':').length > 2) endpoint = `[${endpoint}]`;
  if (type.startsWith('https') && endpoint && !/^[^/?#]+\//.test(endpoint)) {
    endpoint = endpoint.replace(/(?=[?#]|$)/, '/dns-query');
  }
  return PREFIXES[type] + endpoint;
}

export function dnsRows(profile) {
  if (profile.dnsServers !== undefined) return profile.dnsServers.map((row) => ({
    address: row?.address, port: row?.port === undefined ? '' : row.port,
    domains: row?.domains === undefined ? [] : Array.isArray(row.domains) ? [...row.domains] : row.domains,
    enabled: row?.enabled === undefined ? true : row.enabled,
  }));
  return ['remote', 'domestic'].flatMap((slot) => {
    const domain = (profile[`${slot}DnsDomain`] || '').trim();
    const ip = (profile[`${slot}DnsIp`] || '').trim();
    if (!domain && !ip) return [];
    const doh = (profile[`${slot}DnsType`] || '').trim().toLowerCase() === 'doh';
    const address = doh ? domain || `https://${ip}/dns-query` : ip || domain;
    return [{ address, port: doh || /^https:\/\//i.test(address) ? '' : '53', domains: [], enabled: true }];
  });
}

function validAddress(address) {
  if (typeof address !== 'string' || address === '' || /[\s#\\@]/.test(address)) return false;
  const scheme = address.match(/^([a-z][\w+.-]*):/i)?.[1];
  if (scheme && (Object.hasOwn(PREFIXES, scheme.toLowerCase()) || address.includes('://'))) {
    if (!new RegExp(`^${scheme.replaceAll('+', '\\+')}://[^/?#]+`, 'i').test(address)) return false;
    if (/%(?![\da-f]{2})/i.test(address)) return false;
    try {
      const authority = address.split('://')[1].split(/[/?#]/)[0];
      const url = new URL(address.replace(/^[^:]+:/, 'https:'));
      return url.hostname !== '' && url.username === '' && url.password === ''
        && !authority.includes('@') && !authority.endsWith(':')
        && (url.port === '' || Number(url.port) >= 1);
    } catch (_) { return false; }
  }
  if (scheme && dnsTransport(address) === 'custom' && !scheme.includes('.')) return true;
  if (/^(?:\[[^\]]+\]|[^:]+):[^:]*$/.test(address)) {
    try {
      const url = new URL(`https://${address}`);
      const authority = address.split(/[/?]/)[0];
      const port = authority.slice(authority.lastIndexOf(':') + 1);
      return url.hostname !== '' && /^\d+$/.test(port) && Number(port) >= 1 && Number(port) <= 65535;
    } catch (_) { return false; }
  }
  return !/[/?]/.test(address);
}

export function validateDnsRows(rows) {
  return Array.isArray(rows) && rows.every((row) => row && validAddress(row.address) && typeof row.port === 'string'
    && (row.port === '' || /^\d+$/.test(row.port) && Number(row.port) >= 1 && Number(row.port) <= 65535)
    && typeof row.enabled === 'boolean'
    && (typeof row.domains === 'string' || Array.isArray(row.domains)
      && row.domains.every((domain) => typeof domain === 'string')));
}

export function serializeDnsRows(rows) {
  if (!validateDnsRows(rows)) return null;
  return rows.map(({ address, port, domains, enabled }) => ({ address, port,
    domains: typeof domains === 'string'
      ? domains.split(/\r?\n/).map((domain) => domain.trim()).filter(Boolean) : [...domains], enabled }));
}
