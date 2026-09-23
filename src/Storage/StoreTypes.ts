/**
 * Shapes returned by {@link SecureJsonStore}.
 *
 * <p>Separate from the store itself so a consumer can depend on the result
 * types without pulling in the implementation.
 */

/**
 * What was found at the store path.
 *
 * <p>`absent` and `damaged` are deliberately distinct. Collapsing them is how
 * a corrupt file silently becomes "no tokens yet": the run then logs in cold,
 * overwrites the evidence, and nobody learns the file was broken.
 */
export type StoreState = 'absent' | 'healthy' | 'damaged';

/** The outcome of reading a store. */
export interface IStoreSnapshot {
  /** Whether the store was missing, readable, or unusable. */
  readonly state: StoreState;

  /**
   * Records keyed by the caller's identifier.
   *
   * <p>Always a null-prototype object, and always empty unless the state is
   * `healthy`.
   */
  readonly records: Readonly<Record<string, unknown>>;

  /**
   * One operator-facing line explaining the state.
   *
   * <p>Safe to log: it carries paths, counts and errnos, never stored values.
   */
  readonly summary: string;
}

/** What a caller wants persisted, and what to do with what is already there. */
export interface ICommitRequest {
  /** Records to persist, replacing the file's contents entirely. */
  readonly records: Readonly<Record<string, unknown>>;

  /**
   * Whether the file currently at the path should be moved aside first.
   *
   * <p>Set this when a read reported `damaged`. The store owns the ordering
   * because getting it wrong strands the canonical path.
   */
  readonly shouldQuarantine: boolean;
}

/** What a completed commit did. */
export interface ICommitReport {
  /** Path the records now live at. */
  readonly path: string;

  /** Whether a damaged predecessor was moved aside. */
  readonly wasQuarantined: boolean;

  /** One operator-facing line, free of stored values. */
  readonly summary: string;
}

/** What a sweep of abandoned staging files did. */
export interface ISweepReport {
  /** How many stale staged files were deleted. */
  readonly removedCount: number;

  /** One operator-facing line, free of stored values. */
  readonly summary: string;
}

/** Brand proving a value came from `ownRequest` and nowhere else. */
declare const OWNERSHIP: unique symbol;

/**
 * Records the store has copied and now owns: frozen, prototype-less, plain.
 *
 * <p>Only `ownRequest` can produce one. The brand is declared, never
 * assigned, so it exists for the compiler and not at runtime: no caller can
 * hand-build a value of this type and skip the copying that makes it safe.
 */
export interface IOwnedRecords {
  /** Present only on the type; blocks structural forgery. */
  readonly [OWNERSHIP]: true;
  /** The copied records, safe to serialise without re-reading anything. */
  readonly values: Record<string, unknown>;
}

/** A commit request read exactly once, with its records already owned. */
export interface IOwnedRequest {
  /** Records lifted out of the caller's object. */
  readonly records: IOwnedRecords;
  /** Whether a damaged predecessor should be moved aside first. */
  readonly shouldQuarantine: boolean;
}
