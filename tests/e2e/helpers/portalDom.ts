/**
 * Jedison-DOM interaction helpers for the portal E2E suite.
 *
 * The portal SPA renders the whole config form with the vendored jedison library
 * from the generated JSON Schema, so every control has a deterministic id and
 * every editor sits in a `[data-path]` container keyed by its instance path.
 * These helpers translate a config's dotted path (e.g. `banks.discount.daysBack`)
 * into the jedison selectors the browser actually exposes:
 *   - control id     `root-banks-discount-daysBack`  (dots → dashes)
 *   - container path  `#/banks/discount/daysBack`      (dots → slashes)
 * Arrays render add/delete buttons (`.jedi-array-add` / `.jedi-array-delete`) and
 * numbered items (`.jedi-array-item[jedi-array-item-index="N"]`); jedison guards
 * item deletion behind `window.confirm`, so tests must accept browser dialogs.
 */

import type { Locator, Page } from 'playwright-core';

/**
 * Converts a dotted config path to the jedison control id it renders.
 * @param path - Dotted config path, e.g. "banks.discount.daysBack".
 * @returns The control element id, e.g. "root-banks-discount-daysBack".
 */
export function fieldId(path: string): string {
  return `root-${path.replaceAll('.', '-')}`;
}

/**
 * Converts a dotted config path to a jedison container `[data-path]` selector.
 * @param path - Dotted config path, e.g. "portal.google".
 * @returns A CSS selector for that editor container, e.g. [data-path="#/portal/google"].
 */
export function pathSelector(path: string): string {
  return `[data-path="#/${path.replaceAll('.', '/')}"]`;
}

/**
 * Locates a jedison-rendered control (input/select/textarea) by dotted path.
 * @param page - Active page.
 * @param path - Dotted config path, e.g. "banks.discount.daysBack".
 * @returns A locator for that field's control.
 */
export function field(page: Page, path: string): Locator {
  return page.locator(`#${fieldId(path)}`);
}

/**
 * Locates a jedison editor container by dotted config path.
 * @param page - Active page.
 * @param path - Dotted config path, e.g. "banks.discount".
 * @returns A locator for that editor container.
 */
export function node(page: Page, path: string): Locator {
  return page.locator(pathSelector(path));
}

/**
 * Locates the "Add item" button of a jedison array by its dotted path.
 *
 * Scoped to the array's own container and taken first so a nested child array's
 * add button (rendered deeper in the DOM) can never be selected by mistake.
 * @param page - Active page.
 * @param path - Dotted path of the array, e.g. "banks.discount.targets".
 * @returns A locator for the array's add button.
 */
export function arrayAdd(page: Page, path: string): Locator {
  return node(page, path).locator('.jedi-array-add').first();
}

/**
 * Locates the item rows of a jedison array by its dotted path.
 * @param page - Active page.
 * @param path - Dotted path of the array, e.g. "banks.discount.targets".
 * @returns A locator matching the array's item rows.
 */
export function arrayItems(page: Page, path: string): Locator {
  return node(page, path).locator('.jedi-array-item');
}

/**
 * Locates a single jedison array item row by its zero-based index.
 * @param page - Active page.
 * @param path - Dotted path of the array, e.g. "banks.discount.targets".
 * @param index - Zero-based item index.
 * @returns A locator for that item row.
 */
export function arrayItem(page: Page, path: string, index: number): Locator {
  return node(page, path).locator(`.jedi-array-item[jedi-array-item-index="${index}"]`).first();
}

/**
 * Locates the delete button of a jedison array item by its index.
 * @param page - Active page.
 * @param path - Dotted path of the array, e.g. "banks.discount.targets".
 * @param index - Zero-based item index to delete.
 * @returns A locator for that item's delete button.
 */
export function arrayDelete(page: Page, path: string, index: number): Locator {
  return arrayItem(page, path, index).locator('.jedi-array-delete').first();
}

/** How many times to click a jedison "Add item" button before giving up. */
const ADD_ITEM_ATTEMPTS = 5;

/** Milliseconds to let jedison mount a freshly-added item before re-checking. */
const ADD_ITEM_SETTLE_MS = 400;

/**
 * Appends a jedison array item and returns the new item's zero-based index.
 *
 * The first "Add item" click after a scroll/edit is occasionally swallowed by
 * jedison in Camoufox/Firefox, so the click is retried until the new item's
 * container attaches. A final `waitFor` surfaces a clear error if it never does.
 * @param page - Active page.
 * @param path - Dotted path of the array, e.g. "banks.discount.targets".
 * @returns The index of the freshly appended item.
 */
export async function appendArrayItem(page: Page, path: string): Promise<number> {
  const nextIndex = await arrayItems(page, path).count();
  const add = arrayAdd(page, path);
  const item = node(page, `${path}.${nextIndex}`);
  await add.scrollIntoViewIfNeeded();
  for (let attempt = 0; attempt < ADD_ITEM_ATTEMPTS; attempt += 1) {
    await add.click();
    await page.waitForTimeout(ADD_ITEM_SETTLE_MS);
    if ((await item.count()) > 0) break;
  }
  await item.waitFor({ state: 'attached' });
  return nextIndex;
}

/**
 * Locates the reveal (eye) toggle app.js injects next to a jedison secret input.
 * @param page - Active page.
 * @param path - Dotted path of the secret field, e.g. "banks.discount.password".
 * @returns A locator for the secret's reveal toggle button.
 */
export function secretReveal(page: Page, path: string): Locator {
  return page.locator('.secret-wrap', { has: field(page, path) }).locator('.reveal');
}

/**
 * Auto-accepts every browser dialog on the page.
 *
 * jedison guards array item deletion behind `window.confirm`; without a handler
 * Playwright auto-dismisses the prompt and the deletion is cancelled, so tests
 * that remove targets, translations or watch rules must register this first.
 * @param page - Active page to attach the handler to.
 * @returns Nothing.
 */
export function acceptDialogs(page: Page): void {
  page.on('dialog', (dialog) => { void dialog.accept(); });
}
