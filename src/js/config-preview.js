// Demonstrative profile-derived preview, not an exact launch configuration.
// This module deliberately supports only independent outbound topologies.
const CODES = new Set([
  'invalidBase', 'selectProxy', 'unsupportedTopology',
  'invalidTarget', 'invalidDns', 'invalidProfile',
]);
const object = (value) => value !== null && typeof value === 'object'
  && !Array.isArray(value);
const text = (value) => typeof value === 'string' && value.trim() !== '';
const strings = (value) => Array.isArray(value)
  && value.every((item) => typeof item === 'string');
const present = (value) => value !== undefined && value !== null;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function clone(value, code) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_) {
    fail(code);
  }
}

function validateOutbound(outbound, code) {
  if (!object(outbound) || !text(outbound.tag) || !text(outbound.protocol)
    || outbound.tag !== outbound.tag.trim()
    || outbound.protocol !== outbound.protocol.trim()
    || (outbound.settings !== undefined && !object(outbound.settings))
    || (outbound.streamSettings !== undefined && !object(outbound.streamSettings))) {
    fail(code);
  }
  const sockopt = outbound.streamSettings?.sockopt;
  if (sockopt !== undefined && !object(sockopt)) fail(code);
  if (outbound.protocol.toLowerCase() === 'loopback'
    || Object.hasOwn(outbound, 'proxySettings') || Object.hasOwn(outbound, 'detour')
    || (sockopt && Object.hasOwn(sockopt, 'dialerProxy'))) fail('unsupportedTopology');
}

function validateBase(base) {
  if (!object(base) || !Array.isArray(base.outbounds) || !base.outbounds.length) {
    fail('invalidBase');
  }
  for (const key of ['reverse', 'observatory', 'burstObservatory', 'detour', 'api']) {
    if (Object.hasOwn(base, key)) fail('unsupportedTopology');
  }
  const tags = new Map();
  for (const outbound of base.outbounds) {
    validateOutbound(outbound, 'invalidBase');
    if (tags.has(outbound.tag)) fail('invalidBase');
    tags.set(outbound.tag, outbound);
  }
  if (base.inbounds !== undefined) {
    if (!Array.isArray(base.inbounds)) fail('invalidBase');
    const inboundTags = new Set();
    for (const inbound of base.inbounds) {
      if (!object(inbound) || !text(inbound.protocol)
        || (inbound.settings !== undefined && !object(inbound.settings))
        || (inbound.streamSettings !== undefined && !object(inbound.streamSettings))
        || (inbound.listen !== undefined && !text(inbound.listen))
        || (inbound.port !== undefined && !(text(inbound.port)
          || (Number.isInteger(inbound.port) && inbound.port >= 1 && inbound.port <= 65535)))
        || (inbound.tag !== undefined && (!text(inbound.tag)
          || inbound.tag !== inbound.tag.trim() || inboundTags.has(inbound.tag)))
        || (inbound.sniffing !== undefined && (!object(inbound.sniffing)
          || (inbound.sniffing.enabled !== undefined
            && typeof inbound.sniffing.enabled !== 'boolean')
          || (inbound.sniffing.destOverride !== undefined
            && !strings(inbound.sniffing.destOverride))))) fail('invalidBase');
      if (inbound.tag !== undefined) inboundTags.add(inbound.tag);
      if (inbound.protocol.toLowerCase() === 'loopback') fail('unsupportedTopology');
    }
  }
  if (base.dns !== undefined) {
    if (!object(base.dns)
      || (base.dns.hosts !== undefined && !object(base.dns.hosts))
      || (base.dns.queryStrategy !== undefined && !text(base.dns.queryStrategy))
      || (base.dns.servers !== undefined && (!Array.isArray(base.dns.servers)
        || base.dns.servers.some((server) => !(text(server)
          || (object(server) && text(server.address)
            && (server.port === undefined || (Number.isInteger(server.port)
              && server.port >= 1 && server.port <= 65535))
            && (server.domains === undefined || strings(server.domains)))))))) {
      fail('invalidBase');
    }
  }
  if (base.routing !== undefined) {
    if (!object(base.routing)
      || (base.routing.rules !== undefined && !Array.isArray(base.routing.rules))
      || (base.routing.domainStrategy !== undefined && !text(base.routing.domainStrategy))
      || (base.routing.domainMatcher !== undefined && !text(base.routing.domainMatcher))
      || (base.routing.balancers !== undefined && !Array.isArray(base.routing.balancers))) {
      fail('invalidBase');
    }
    if (base.routing.balancers?.length) fail('unsupportedTopology');
    for (const rule of base.routing.rules ?? []) {
      if (!object(rule)) fail('invalidBase');
      if (Object.hasOwn(rule, 'inboundTag') || Object.hasOwn(rule, 'balancerTag')) {
        fail('unsupportedTopology');
      }
      if (rule.protocol !== undefined && !strings(rule.protocol)) fail('invalidBase');
      if (rule.protocol?.some((item) => item.toLowerCase() === 'dns')) {
        fail('unsupportedTopology');
      }
      if (!text(rule.outboundTag) || !tags.has(rule.outboundTag)) fail('invalidBase');
      if (tags.get(rule.outboundTag).protocol.toLowerCase() === 'dns') {
        fail('unsupportedTopology');
      }
      for (const field of ['domain', 'ip', 'source', 'user']) {
        if (rule[field] !== undefined && !strings(rule[field])) fail('invalidBase');
      }
      for (const field of ['port', 'sourcePort', 'network']) {
        if (rule[field] !== undefined && typeof rule[field] !== 'string') fail('invalidBase');
      }
    }
  }
  return tags;
}

function dnsConfig(p) {
  const servers = [];
  if (p.fakeDns) servers.push({ address: 'fakedns' });
  if (p.dnsServers !== undefined) {
    if (!Array.isArray(p.dnsServers)) fail('invalidDns');
    for (const server of p.dnsServers) {
      if (!object(server) || !text(server.address) || /\s/.test(server.address)
        || (server.enabled !== undefined && typeof server.enabled !== 'boolean')
        || (server.domains !== undefined && !strings(server.domains))
        || (server.port !== undefined && typeof server.port !== 'string')) fail('invalidDns');
      const port = server.port ?? '';
      if (port !== '' && (!/^\d+$/.test(port) || Number(port) < 1
        || Number(port) > 65535)) fail('invalidDns');
      if (server.enabled === false) continue;
      const entry = { address: server.address };
      if (port !== '') entry.port = Number(port);
      else if (!/^https:\/\//i.test(server.address)) entry.port = 53;
      if (server.domains?.length) entry.domains = [...server.domains];
      servers.push(entry);
    }
  } else {
    for (const prefix of ['remote', 'domestic']) {
      const type = p[`${prefix}DnsType`];
      const domain = p[`${prefix}DnsDomain`];
      const ip = p[`${prefix}DnsIp`];
      if ([type, domain, ip].some((v) => present(v) && typeof v !== 'string')) {
        fail('invalidDns');
      }
      let address;
      if (type?.toLowerCase() === 'doh') {
        const host = ip?.includes(':') && !ip.startsWith('[') ? `[${ip}]` : ip;
        address = domain || (host ? `https://${host}/dns-query` : '');
      } else address = ip || domain;
      if (address) {
        if (!text(address) || /\s/.test(address)) fail('invalidDns');
        servers.push({ address });
      }
    }
  }
  servers.push('localhost');
  const query = p.queryStrategy;
  if (present(query) && !['none', 'UseIP', 'UseIPv4', 'UseIPv6'].includes(query)) {
    fail('invalidDns');
  }
  const dns = { servers, queryStrategy: !present(query) || query === 'none' ? 'UseIP' : query };
  if (p.dnsHosts !== undefined) {
    if (!object(p.dnsHosts)) fail('invalidDns');
    if (Object.keys(p.dnsHosts).length) dns.hosts = clone(p.dnsHosts, 'invalidDns');
  }
  return dns;
}

function profileRules(p) {
  if (p.rules !== undefined) {
    if (!Array.isArray(p.rules)) fail('invalidProfile');
    return p.rules.map((rule) => {
      if (!object(rule) || !['proxy', 'direct', 'block', 'dns', 'custom'].includes(rule.action)
        || (rule.enabled !== undefined && typeof rule.enabled !== 'boolean')) {
        fail('invalidProfile');
      }
      for (const field of ['domain', 'ip', 'process', 'protocol']) {
        if (rule[field] !== undefined && !strings(rule[field])) fail('invalidProfile');
      }
      for (const field of ['port', 'network', 'customTag']) {
        if (rule[field] !== undefined && typeof rule[field] !== 'string') fail('invalidProfile');
      }
      return rule;
    });
  }
  const rules = [];
  for (const action of ['proxy', 'direct', 'block']) {
    for (const [suffix, field] of [['Sites', 'domain'], ['Ip', 'ip']]) {
      const values = p[action + suffix];
      if (values !== undefined && !strings(values)) fail('invalidProfile');
      if (values?.length) rules.push({ action, [field]: [...values] });
    }
  }
  return rules;
}

/** Build an independent JSON preview. Errors expose stable codes, never input data. */
export function buildConfigPreview(profile, base = null, proxyTag = '') {
  try {
    if (!object(profile)) fail('invalidProfile');
    const p = clone(profile, 'invalidProfile');
    for (const key of ['globalProxy', 'fakeDns']) {
      if (p[key] !== undefined && typeof p[key] !== 'boolean') fail('invalidProfile');
    }
    const template = base === null;
    const config = template ? {
      log: { loglevel: 'warning' },
      inbounds: [{ tag: 'socks', listen: '127.0.0.1', port: 10808, protocol: 'socks',
        settings: { udp: true }, sniffing: { enabled: true,
          destOverride: p.fakeDns ? ['http', 'tls', 'fakedns'] : ['http', 'tls'] } }],
      outbounds: [{ tag: 'proxy', protocol: 'socks',
        settings: { servers: [{ address: 'proxy.example.invalid', port: 1080 }] } }],
    } : clone(base, 'invalidBase');
    const tags = validateBase(config);
    const selected = template ? 'proxy' : proxyTag;
    if (!text(selected) || !tags.has(selected)
      || ['freedom', 'blackhole', 'dns'].includes(tags.get(selected).protocol.toLowerCase())) {
      fail('selectProxy');
    }
    const sourceRules = profileRules(p).filter((rule) => rule.enabled !== false);
    // Reserve custom names before allocating helpers, regardless of rule order.
    const inboundTags = new Set((config.inbounds ?? []).map((inbound) => inbound.tag));
    const reserved = new Set(inboundTags);
    for (const rule of sourceRules) {
      if (rule.action === 'custom' && rule.customTag?.trim()) reserved.add(rule.customTag.trim());
    }
    const explicit = p.outbounds !== undefined;
    if (explicit) {
      if (!Array.isArray(p.outbounds)) fail('invalidProfile');
      for (const outbound of p.outbounds) {
        validateOutbound(outbound, 'invalidTarget');
        if (tags.has(outbound.tag) || inboundTags.has(outbound.tag)
          || ['proxy', 'socks', 'http', 'socks-lan'].includes(outbound.tag.toLowerCase())) {
          fail('invalidTarget');
        }
        tags.set(outbound.tag, outbound);
        config.outbounds.push(outbound);
      }
    }
    const helpers = new Map();
    function helper(kind) {
      if (helpers.has(kind)) return helpers.get(kind);
      const protocol = { direct: 'freedom', block: 'blackhole', dns: 'dns' }[kind];
      if (explicit && kind !== 'dns') {
        const outbound = p.outbounds.find((item) => item.tag === kind);
        if (!outbound || outbound.protocol !== protocol) fail('invalidTarget');
        helpers.set(kind, kind);
        return kind;
      }
      if (explicit && p.outbounds.some((item) => item.tag === 'dns')) {
        if (tags.get('dns').protocol !== 'dns') fail('invalidTarget');
        helpers.set(kind, 'dns');
        return 'dns';
      }
      let tag = `preview-${kind}`;
      for (let n = 2; tags.has(tag) || reserved.has(tag); n++) tag = `preview-${kind}-${n}`;
      const settings = {};
      if (kind === 'direct' && present(p.directDomainStrategy)
        && p.directDomainStrategy !== 'AsIs') {
        if (!['UseIP', 'UseIPv4', 'UseIPv6'].includes(p.directDomainStrategy)) fail('invalidProfile');
        settings.domainStrategy = p.directDomainStrategy;
      }
      const outbound = { tag, protocol, settings };
      tags.set(tag, outbound);
      config.outbounds.push(outbound);
      helpers.set(kind, tag);
      return tag;
    }
    function target(rule) {
      if (rule.action === 'proxy') return selected;
      if (rule.action !== 'custom') return helper(rule.action);
      const tag = rule.customTag?.trim() || 'direct';
      if (tag === 'proxy') return selected;
      if (['direct', 'block', 'dns'].includes(tag)) return helper(tag);
      if (inboundTags.has(tag)) fail('invalidTarget');
      if (tags.has(tag)) return tag;
      if (explicit || ['socks', 'http', 'socks-lan'].includes(tag.toLowerCase())) fail('invalidTarget');
      const outbound = { tag, protocol: 'freedom', settings: {} };
      tags.set(tag, outbound);
      config.outbounds.push(outbound);
      return tag;
    }
    if (present(p.routeOrder) && typeof p.routeOrder !== 'string') fail('invalidProfile');
    const order = [];
    for (const token of (p.routeOrder ?? 'block,direct,proxy').split(',')) {
      const name = token.trim().toLowerCase();
      if (['proxy', 'direct', 'block'].includes(name) && !order.includes(name)) order.push(name);
    }
    if (!order.length) order.push('block', 'direct', 'proxy');
    for (const action of ['proxy', 'direct', 'block']) {
      if (!order.includes(action)) order.push(action);
    }
    const rules = [];
    if (p.fakeDns) {
      const socks = (config.inbounds ?? []).filter((inbound) => inbound.protocol === 'socks');
      if ((!template && Object.hasOwn(config, 'fakedns')) || socks.length !== 1
        || !text(socks[0].tag) || socks[0].sniffing?.enabled !== true
        || !socks[0].sniffing?.destOverride?.includes('fakedns')) fail('unsupportedTopology');
      config.fakedns = [
        { ipPool: '198.18.0.0/15', poolSize: 65535 },
        { ipPool: 'fc00::/18', poolSize: 65535 },
      ];
      rules.push({ type: 'field', inboundTag: [socks[0].tag], port: '53', outboundTag: helper('dns') });
    } else delete config.fakedns;
    for (const action of ['dns', ...order, 'custom']) {
      for (const source of sourceRules.filter((rule) => rule.action === action)) {
        const rule = { type: 'field' };
        for (const field of ['domain', 'ip', 'process', 'protocol']) {
          if (source[field]?.length) rule[field] = [...source[field]];
        }
        for (const field of ['port', 'network']) {
          if (source[field]) rule[field] = source[field];
        }
        if (Object.keys(rule).length === 1) rule.network = 'tcp,udp';
        rule.outboundTag = target(source);
        rules.push(rule);
      }
    }
    rules.push({ type: 'field', network: 'tcp,udp',
      outboundTag: p.globalProxy === false ? helper('direct') : selected });
    const strategy = p.domainStrategy;
    if (present(strategy) && !['none', 'AsIs', 'IPIfNonMatch', 'IPOnDemand'].includes(strategy)) {
      fail('invalidProfile');
    }
    config.routing = { ...config.routing,
      domainStrategy: !present(strategy) ? 'IPIfNonMatch' : strategy === 'none' ? 'AsIs' : strategy,
      rules };
    config.dns = dnsConfig(p);
    return config;
  } catch (error) {
    if (error instanceof Error && CODES.has(error.code)) fail(error.code);
    fail('invalidProfile');
  }
}
