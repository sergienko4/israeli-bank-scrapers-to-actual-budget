/**
 * OcrImagePreprocess — sharp pipeline that prepares receipt images
 * for tesseract.js OCR. Upscales small images, converts to greyscale,
 * and applies a binary threshold to boost Hebrew character recognition.
 *
 * Pure I/O wrapper over `sharp`. No logging, no error handling — the
 * orchestrator (ReceiptOcrService.recognize) owns the failure path.
 */

import sharp from 'sharp';

/** Minimum width (px) below which the image is upscaled before OCR. */
const MIN_WIDTH_PX = 1500;
/** Binary threshold for greyscale → black/white conversion (0-255). */
const BINARY_THRESHOLD = 140;

/**
 * Preprocesses an image buffer for receipt OCR.
 *
 * Applies EXIF orientation rotation FIRST so phone-sideways receipts
 * (which carry an EXIF orientation tag instead of being physically
 * rotated) are uprighted before any pixel-aware step. Skipping this
 * leaves sideways text in the OCR pipeline and tanks tesseract.js
 * accuracy on Hebrew.
 * @param imageBuffer - Raw image bytes (JPEG/PNG).
 * @returns Preprocessed PNG buffer ready for tesseract.js.
 */
export default async function preprocessForOcr(imageBuffer: Buffer): Promise<Buffer> {
  const metadata = await sharp(imageBuffer).metadata();
  const width = metadata.width || 0;
  let pipeline = sharp(imageBuffer).rotate();
  if (width < MIN_WIDTH_PX) pipeline = pipeline.resize(MIN_WIDTH_PX);
  return await pipeline.greyscale().threshold(BINARY_THRESHOLD).png().toBuffer();
}
