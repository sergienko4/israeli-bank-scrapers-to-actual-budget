/**
 * Barrel export for the Receipt sub-modules — lets consumers import
 * one symbol per concern from a single path. Reduces import sprawl
 * (and coupling score) for the ReceiptImportHandler orchestrator.
 */

export { default as preprocessForOcr } from './OcrImagePreprocess.js';
export { default as parseReceipt } from './OcrParsing.js';
export { default as importReceipt } from './ReceiptImporter.js';
export {
  presentAccountMenu,
  presentCategoryMenu,
  presentSmartMatch,
} from './ReceiptMenuPresenter.js';
export type { IPayeeMatch } from './ReceiptPayeeMatcher.js';
export { default as findReceiptPayeeMatch } from './ReceiptPayeeMatcher.js';
export { default as ReceiptPhotoOcrPipeline } from './ReceiptPhotoOcrPipeline.js';
export type { IReceiptActualApi } from './Types.js';
