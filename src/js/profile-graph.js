// Structural checks for the public profile format, not a connectivity test.
export function validateProfileGraph(profile) {
  const invalid = () => { throw 'invalidProfile'; };
  const outbounds = profile.outbounds ?? [
    { tag: 'direct', protocol: 'freedom' }, { tag: 'block', protocol: 'blackhole' },
  ];
  const edges = new Map();
  const reserved = new Set(['proxy', 'socks', 'socks-lan', 'http']);
  const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  const optionalObject = (value) => {
    if (value === undefined || value === null) return {};
    if (!object(value)) invalid();
    return value;
  };
  const reference = (value) => {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string' || !value.trim() || value !== value.trim()) invalid();
    return value;
  };
  for (const item of outbounds) {
    if (typeof item.tag !== 'string' || !item.tag.trim() || item.tag !== item.tag.trim()
      || reserved.has(item.tag) || edges.has(item.tag)
      || typeof item.protocol !== 'string' || !item.protocol.trim()) invalid();
    const proxy = reference(optionalObject(item.proxySettings).tag);
    if (item.proxySettings !== undefined && item.proxySettings !== null && !proxy) invalid();
    const stream = optionalObject(item.streamSettings);
    const dialer = reference(optionalObject(stream.sockopt).dialerProxy);
    if (proxy && dialer) invalid();
    edges.set(item.tag, proxy ?? dialer);
  }
  for (const target of edges.values()) if (target && !edges.has(target)) invalid();
  const checked = new Set();
  for (const tag of edges.keys()) {
    const path = new Set();
    let node = tag;
    while (node && !checked.has(node)) {
      if (path.has(node)) invalid();
      path.add(node);
      node = edges.get(node);
    }
    for (const visited of path) checked.add(visited);
  }
  if (!profile.globalProxy && !edges.has('direct')) invalid();
  const rules = profile.rules ?? [
    ...((profile.directSites?.length || profile.directIp?.length) ? [{ action: 'direct', enabled: false }] : []),
    ...((profile.proxySites?.length || profile.proxyIp?.length) ? [{ action: 'proxy', enabled: false }] : []),
    ...((profile.blockSites?.length || profile.blockIp?.length) ? [{ action: 'block', enabled: false }] : []),
  ];
  for (const rule of rules) {
    for (const key of ['domain', 'ip', 'process', 'protocol']) {
      if ((rule[key] ?? []).some((value) => value.trim() === '')) invalid();
    }
    const target = rule.action === 'custom' ? rule.customTag : rule.action;
    const implicitDns = target === 'dns'
      && (rule.action === 'dns' || profile.outbounds === undefined);
    if (target !== 'proxy' && !implicitDns && !edges.has(target)) invalid();
    if (rule.enabled !== false) {
      const hasList = ['domain', 'ip', 'process', 'protocol'].some((key) =>
        (rule[key] ?? []).some((value) => value.trim() !== ''));
      const hasText = ['port', 'network'].some((key) => (rule[key] ?? '').trim() !== '');
      if (!hasList && !hasText) invalid();
    }
  }
}
