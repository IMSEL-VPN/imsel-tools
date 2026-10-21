import { defaultProfile, profileFromJson } from './profile.js';

// Public exchange examples; all returned data belongs to the new profile.
export function profileTemplate(kind, labels = {}) {
  if (kind === 'legacy') return defaultProfile();
  const base = profileFromJson({
    Name: labels.name || 'My Routing', GlobalProxy: 'true', DomainStrategy: 'IPIfNonMatch',
    QueryStrategy: 'UseIP', FakeDNS: 'false', UseChunkFiles: 'true',
    RouteOrder: 'block,direct,proxy', GeoUpdateIntervalHours: 0,
    Geoipurl: 'https://github.com/Loyalsoldier/v2ray-rules-dat/releases/latest/download/geoip.dat',
    Geositeurl: 'https://github.com/v2fly/domain-list-community/releases/latest/download/dlc.dat',
    Outbounds: [{ tag: 'direct', protocol: 'freedom', settings: {} },
      { tag: 'block', protocol: 'blackhole', settings: {} }],
    Rules: [], DnsServers: [],
  });
  if (kind === 'blank') return base;
  if (kind !== 'app') throw new Error('invalidTemplate');
  base.dnsHosts = { 'domain:googleapis.cn': 'googleapis.com' };
  base.dnsServers = ['1.1.1.1', '8.8.8.8'].map((address) => ({
    address, port: '53', domains: [], enabled: true,
  }));
  base.rules = [
    { id: 'template-dns-proxy', name: labels.dnsProxy || 'DNS via proxy', action: 'proxy', ip: ['1.1.1.1'], port: '53' },
    { id: 'template-dns-direct', name: labels.dnsDirect || 'DNS direct', action: 'direct', ip: ['8.8.8.8'], port: '53' },
    { id: 'template-local', name: labels.local || 'Local networks', action: 'direct', ip: ['geoip:private'] },
    { id: 'template-all', name: labels.all || 'All ports via proxy', action: 'proxy', port: '0-65535' },
  ];
  return base;
}
