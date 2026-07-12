import { describe, expect, it } from 'vitest';
import { ipMatchesRule, isIpAllowed, jsonIpRules } from './ip-allowlist';

describe('administrator IP allowlists', () => {
  it('matches exact addresses and IPv4 CIDR ranges', () => {
    expect(ipMatchesRule('192.168.5.20', '192.168.5.0/24')).toBe(true);
    expect(ipMatchesRule('192.168.6.20', '192.168.5.0/24')).toBe(false);
    expect(ipMatchesRule('::1', '::1')).toBe(true);
  });

  it('fails closed for malformed rules and ignores non-string JSON values', () => {
    expect(ipMatchesRule('10.0.0.1', 'not-a-cidr/24')).toBe(false);
    expect(jsonIpRules(['10.0.0.0/8', 42, null])).toEqual(['10.0.0.0/8']);
    expect(isIpAllowed('10.0.0.1', ['10.0.0.0/8'])).toBe(true);
  });
});
