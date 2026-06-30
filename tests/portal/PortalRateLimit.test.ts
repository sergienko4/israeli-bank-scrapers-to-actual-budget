import { describe, expect, it } from 'vitest';

import { LOGIN_RATE_LIMIT, OAUTH_RATE_LIMIT, STATUS_RATE_LIMIT } from '../../src/Portal/PortalRateLimit.js';

describe('PortalRateLimit', () => {
  it('applies a strict per-route limit to the password-login endpoint', () => {
    expect(LOGIN_RATE_LIMIT.config?.rateLimit).toEqual({ max: 10, timeWindow: '1 minute' });
  });

  it('applies a generous per-route limit to the polled status endpoint', () => {
    expect(STATUS_RATE_LIMIT.config?.rateLimit).toEqual({ max: 60, timeWindow: '1 minute' });
  });

  it('applies a per-route limit to the Google OAuth endpoints', () => {
    expect(OAUTH_RATE_LIMIT.config?.rateLimit).toEqual({ max: 20, timeWindow: '1 minute' });
  });
});
