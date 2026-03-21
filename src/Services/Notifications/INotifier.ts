/**
 * Notification channel interface
 * Follows Open/Closed Principle: Add new channels without modifying existing code
 */

import type { IImportSummary } from '../MetricsService.js';

export interface INotifier {
  sendSummary(summary: IImportSummary): Promise<void>;
  sendError(error: string): Promise<void>;
  sendMessage(text: string): Promise<void>;
}
