/**
 * Page-object helpers for the config portal's Banks section (searchable
 * master–detail). Every suite drives the master list and detail pane through
 * these stable `data-*` selectors so the row/detail contract lives in one place.
 */

import type { Page } from 'playwright-core';

/**
 * Selects a bank in the master list and waits for its detail card. Works for
 * both already-added rows (review/edit) and freshly-templated ones.
 * @param page - Authenticated portal page on the Banks section.
 * @param id - Catalog bank id (or legacy config key) shown on the row.
 * @returns Resolves once the bank's detail card is visible.
 */
export async function selectBank(page: Page, id: string): Promise<void> {
  await page.click(`[data-bank-row="${id}"]`);
  await page.locator(`[data-bank="${id}"]`).waitFor({ state: 'visible' });
}

/**
 * Navigates to the Banks section and selects the seeded discount bank, so the
 * detail pane is deterministically parked on its card.
 * @param page - Authenticated portal page.
 * @returns Resolves once the discount detail card is visible.
 */
export async function gotoBanks(page: Page): Promise<void> {
  await page.click('#nav button[data-section="banks"]');
  await selectBank(page, 'discount');
}

/**
 * Adds a bank by clicking its addable master-list row, which templates the bank
 * and selects it.
 * @param page - Authenticated portal page on the Banks section.
 * @param id - Catalog bank id to add.
 * @returns Resolves once the new bank's detail card is visible.
 */
export async function addBank(page: Page, id: string): Promise<void> {
  await selectBank(page, id);
}

/**
 * Removes the currently-selected bank via its detail-card Remove button and
 * waits for the card to detach.
 * @param page - Authenticated portal page with the bank's detail card shown.
 * @param id - Config key of the bank to remove.
 * @returns Resolves once the bank's detail card is gone.
 */
export async function removeBank(page: Page, id: string): Promise<void> {
  await page.click(`[data-remove-bank="${id}"]`);
  await page.locator(`[data-bank="${id}"]`).waitFor({ state: 'detached' });
}
