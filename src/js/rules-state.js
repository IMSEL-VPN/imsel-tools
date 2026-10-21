import { validateProfileGraph } from './profile-graph.js';

export const RULE_ACTIONS = ['proxy', 'direct', 'block', 'dns', 'custom'];
export const RULE_LISTS = ['domain', 'ip', 'process', 'protocol'];
export const cloneRulesData = (value) => JSON.parse(JSON.stringify(value));
export const splitRuleLines = (value) => value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
let sequence = 0;

export function ruleActionOrder(profile) {
  const known = ['block', 'direct', 'proxy'];
  let order = [...new Set((profile.routeOrder ?? '').split(',').map((v) => v.trim().toLowerCase())
    .filter((v) => known.includes(v)))];
  if (!order.length) order = known;
  else order = [...order, ...['proxy', 'direct', 'block'].filter((v) => !order.includes(v))];
  return ['dns', ...order, 'custom'];
}

export function createRule(existingRules = []) {
  const ids = new Set(existingRules.map((rule) => rule.id));
  let id;
  do { id = `rule-${globalThis.crypto?.randomUUID?.() ?? ++sequence}`; } while (ids.has(id));
  return { id, name: '', action: 'direct', enabled: true, locked: false,
    domain: [], ip: [], port: '', network: '', process: [], protocol: [], customTag: '' };
}

export function rulesFromLegacy(profile) {
  if (profile.rules !== undefined) return cloneRulesData(profile.rules);
  const rules = [];
  for (const action of ruleActionOrder(profile)) {
    if (!['block', 'direct', 'proxy'].includes(action)) continue;
    for (const [field, suffix] of [['domain', 'Sites'], ['ip', 'Ip']]) {
      const values = profile[`${action}${suffix}`] ?? [];
      if (!values.some((value) => value.trim())) continue;
      const rule = createRule(rules);
      rule.action = action;
      rule[field] = cloneRulesData(values);
      rules.push(rule);
    }
  }
  return rules;
}

// Only edited list fields are strings; untouched arrays and absent fields stay exact.
export function serializeRules(profile, drafts) {
  try {
    if (!Array.isArray(drafts)) return null;
    const rules = cloneRulesData(drafts), ids = new Set();
    for (const rule of rules) {
      if (!rule || typeof rule !== 'object' || Array.isArray(rule)
        || !RULE_ACTIONS.includes(rule.action)) return null;
      for (const key of RULE_LISTS) {
        if (typeof rule[key] === 'string') rule[key] = splitRuleLines(rule[key]);
        if (rule[key] !== undefined && (!Array.isArray(rule[key])
          || rule[key].some((value) => typeof value !== 'string'))) return null;
      }
      for (const key of ['id', 'name', 'port', 'network', 'customTag']) {
        if (rule[key] !== undefined && typeof rule[key] !== 'string') return null;
      }
      for (const key of ['enabled', 'locked']) {
        if (rule[key] !== undefined && typeof rule[key] !== 'boolean') return null;
      }
      if (rule.id !== undefined) {
        if (rule.id !== '' && (!rule.id.trim() || ids.has(rule.id))) return null;
        if (rule.id !== '') ids.add(rule.id);
      }
      if (rule.action === 'custom' && (typeof rule.customTag !== 'string'
        || !rule.customTag.trim() || rule.customTag !== rule.customTag.trim())) return null;
    }
    validateProfileGraph({ ...profile, rules });
    return rules;
  } catch (_) { return null; }
}

export const validateRules = (profile, drafts) => serializeRules(profile, drafts) !== null;
