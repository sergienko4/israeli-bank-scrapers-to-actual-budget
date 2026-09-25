/**
 * A held value and a secret key that share characters.
 *
 * <p>Kept in its own file: the values it registers stay in the process-wide
 * list for the rest of the file, and `secret` would mask that word in every
 * other test's keys.
 */
import { describe, expect, it } from 'vitest';

import redactSecrets from '../../src/Logger/SecretRedaction.js';
import { registerSecretValues } from '../../src/Logger/SecretValues.js';

/** A value the process does not hold, sent under a secret key. */
const UNHELD = 'Sess-9f8e7d';

/** A held value that is part of a secret key, as a short user name can be. */
const IN_A_KEY = 'secret';

/** A held value that holds a secret key and a value after it. */
const HOLDS_A_KEY = 'Nm4-token=Qa7Wb2';

/** A held value that starts inside a key's value and runs past it. */
const PAST_A_VALUE = 'Wx5 Yz8';

/** A held value that starts with the key's separator, where both rules start. */
const AT_THE_SEPARATOR = '=Tk5Rw9';

/** Each text, and what the masker must write for it. */
const CASES: readonly (readonly [string, string])[] = [
  [`{"client_secret":"${UNHELD}"}`, '{"client_[REDACTED]":"[REDACTED]"}'],
  [`client_secret=${UNHELD} rejected`, 'client_[REDACTED]=[REDACTED] rejected'],
  [`login ${HOLDS_A_KEY} failed`, 'login [REDACTED] failed'],
  [`token=${PAST_A_VALUE} end`, 'token=[REDACTED] end'],
  [`token${AT_THE_SEPARATOR} end`, 'token=[REDACTED] end'],
];

describe('redactSecrets with a held value that shares characters with a secret key', () => {
  registerSecretValues([IN_A_KEY, HOLDS_A_KEY, PAST_A_VALUE, AT_THE_SEPARATOR]);

  it.each(CASES)('masks %j as %j', (text, masked) => {
    expect(redactSecrets(text)).toBe(masked);
  });

  it.each(CASES)('masking %j twice changes nothing', text => {
    const once = redactSecrets(text);

    expect(redactSecrets(once)).toBe(once);
  });

  it('shows no value it was sent under a key whose name holds a held value', () => {
    const shown = CASES.map(([text]) => redactSecrets(text)).filter(out => out.includes(UNHELD));

    expect(shown).toEqual([]);
  });
});
