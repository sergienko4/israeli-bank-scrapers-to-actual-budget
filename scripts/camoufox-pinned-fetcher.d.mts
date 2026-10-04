/**
 * Ambient types for scripts/camoufox-pinned-fetcher.mjs, so TypeScript tests
 * can import it without `any` leaks. Declares only the camoufox-js surface the
 * installer and its contract test use.
 */

/** A pinned Camoufox archive, its platform key and the digest it must have. */
export interface IPinnedAsset {
  readonly key: string;
  readonly url: string;
  readonly sha256: string;
}

/** Installs the pinned Camoufox asset through camoufox-js. */
export class PinnedCamoufoxFetcher {
  /**
   * @param asset - Pinned archive and its digest.
   */
  constructor(asset: IPinnedAsset);

  /** Download URL of the resolved build; throws before fetchLatest. */
  readonly url: string;

  /** Camoufox version of the resolved build, e.g. 152.0.4. */
  readonly version: string;

  /** Camoufox release of the resolved build, e.g. beta.31. */
  readonly release: string;

  /**
   * Resolves the pinned build; rejects an asset for another platform.
   * @returns Resolves once url, version and release are set.
   */
  fetchLatest(): Promise<void>;

  /**
   * Downloads, digest-checks and extracts the pinned build into the
   * camoufox-js install directory and writes its version.json; records the
   * installed asset last, once upstream's install has finished.
   * @returns Resolves once installed; rejects and leaves nothing installed otherwise.
   */
  install(): Promise<void>;
}
