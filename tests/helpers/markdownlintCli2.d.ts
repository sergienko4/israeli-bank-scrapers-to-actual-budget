/**
 * Types for the markdownlint API that markdownlint-cli2 re-exports. Those
 * entry points ship without declarations, but they re-export the
 * markdownlint version markdownlint-cli2 pins, so its declarations apply.
 */

declare module 'markdownlint-cli2/markdownlint' {
  export * from 'markdownlint';
}

declare module 'markdownlint-cli2/markdownlint/promise' {
  export * from 'markdownlint/promise';
}
