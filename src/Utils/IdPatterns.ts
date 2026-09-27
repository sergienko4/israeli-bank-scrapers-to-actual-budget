/**
 * Shapes of the ids this codebase mints, for checking ids read back from disk
 * or taken from a request before they are trusted.
 */

/**
 * The lowercase form `crypto.randomUUID()` produces.
 *
 * <p>Anchored and fixed-length, so a value that passes can be put into a file
 * name without carrying a separator or a relative-path segment.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export default UUID_PATTERN;
