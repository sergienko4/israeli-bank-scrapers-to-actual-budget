/**
 * Graceful shutdown handler
 * Follows Single Responsibility Principle: Only handles shutdown signals
 */

import { getLogger } from '../logger/index.js';

export interface IShutdownHandler {
  isShuttingDown(): boolean;
  onShutdown(callback: () => void | Promise<void>): void;
}

export class GracefulShutdownHandler implements IShutdownHandler {
  private shuttingDown = false;
  private callbacks: Array<() => void | Promise<void>> = [];

  constructor() {
    this.setupSignalHandlers();
  }

  isShuttingDown(): boolean {
    return this.shuttingDown;
  }

  onShutdown(callback: () => void | Promise<void>): void {
    this.callbacks.push(callback);
  }

  private setupSignalHandlers(): void {
    process.on('SIGTERM', () => this.handleShutdown('SIGTERM'));
    process.on('SIGINT', () => this.handleShutdown('SIGINT'));
  }

  private async handleShutdown(signal: string): Promise<void> {
    if (this.shuttingDown) return;
    getLogger().warn(`\n⚠️  Received ${signal} signal, initiating graceful shutdown...`);
    this.shuttingDown = true;
    await this.executeCallbacks();
    getLogger().info('✅ Graceful shutdown complete');
    process.exit(0);
  }

  private async executeCallbacks(): Promise<void> {
    for (const callback of this.callbacks) {
      try { await callback(); }
      catch (error: unknown) { getLogger().error(`Error during shutdown callback: ${error instanceof Error ? error.message : String(error)}`); }
    }
  }
}
