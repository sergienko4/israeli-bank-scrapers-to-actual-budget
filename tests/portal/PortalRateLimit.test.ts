import { describe, expect, it } from 'vitest';

import { LOGIN_MAX, OAUTH_MAX, RATE_WINDOW, STATUS_MAX } from '../../src/Portal/PortalRateLimit.js';

describe('PortalRateLimit', () => {
  it('caps password login no looser than the other auth routes (anti-brute-force)', () => {
    expect(LOGIN_MAX).toBeLessThanOrEqual(OAUTH_MAX);
    expect(OAUTH_MAX).toBeLessThanOrEqual(STATUS_MAX);
  });

  it('uses a positive request ceiling for every auth route', () => {
    for (const max of [LOGIN_MAX, OAUTH_MAX, STATUS_MAX]) expect(max).toBeGreaterThan(0);
  });

  it('shares one sliding window in @fastify/rate-limit syntax', () => {
    expect(RATE_WINDOW).toMatch(/^\d+ (second|minute|hour)s?$/);
  });
});
