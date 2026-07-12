const ipv4ToInteger = (value: string): number | null => {
  const normalized = value.startsWith('::ffff:') ? value.slice(7) : value;
  const parts = normalized.split('.');
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => Number(part));
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return null;
  return octets.reduce((result, octet) => ((result << 8) | octet) >>> 0, 0);
};

export const ipMatchesRule = (ipAddress: string, rule: string): boolean => {
  const candidate = ipAddress.trim().toLocaleLowerCase('en-US');
  const normalizedRule = rule.trim().toLocaleLowerCase('en-US');
  if (!normalizedRule.includes('/')) return candidate === normalizedRule;
  const [network = '', prefixText = ''] = normalizedRule.split('/');
  const addressValue = ipv4ToInteger(candidate);
  const networkValue = ipv4ToInteger(network);
  const prefix = Number(prefixText);
  if (
    addressValue === null ||
    networkValue === null ||
    !Number.isInteger(prefix) ||
    prefix < 0 ||
    prefix > 32
  ) {
    return false;
  }
  const mask = prefix === 0 ? 0 : (0xffff_ffff << (32 - prefix)) >>> 0;
  return (addressValue & mask) === (networkValue & mask);
};

export const isIpAllowed = (ipAddress: string, rules: readonly string[]): boolean =>
  rules.length === 0 || rules.some((rule) => ipMatchesRule(ipAddress, rule));

export const jsonIpRules = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
