/**
 * Graceful shutdown handler
 * Follows Single Responsibility Principle: Only handles shutdown signals
 */

import { getLogger } from '../Logger/Index.js';

export interface IShutdownHandler {
  isShuttingDown(): boolean;
  onShutdown(callback: () => void | Promise<void>): void;
}

/** Listens for SIGTERM/SIGINT and runs registered cleanup callbacks before exit. */
export class GracefulShutdownHandler implements IShutdownHandler {
  private shuttingDown = false;
  private callbacks: Array<() => void | Promise<void>> = [];

  /** Registers process signal handlers for SIGTERM and SIGINT. */
  constructor() {
    this.setupSignalHandlers();
  }

  /**
   * Returns whether a shutdown has been initiated.
   * @returns True once a shutdown signal has been received.
   */
  isShuttingDown(): boolean {
    return this.shuttingDown;
  }

  /**
   * Registers a callback to run during graceful shutdown.
   * @param callback - Function to invoke when the process is shutting down.
   */
  onShutdown(callback: () => void | Promise<void>): void {
    this.callbacks.push(callback);
  }

  /** Attaches SIGTERM and SIGINT listeners to the Node.js process. */
  private setupSignalHandlers(): void {
    process.on('SIGTERM', () => { void this.handleShutdown('SIGTERM'); });
    process.on('SIGINT', () => { void this.handleShutdown('SIGINT'); });
  }

  /**
   * Runs all registered callbacks and exits the process cleanly.
   * @param signal - The OS signal name that triggered the shutdown.
   */
  private async handleShutdown(signal: string): Promise<void> {
    if (this.shuttingDown) return;
    getLogger().warn(`\n⚠️  Received ${signal} signal, initiating graceful shutdown...`);
    this.shuttingDown = true;
    await this.executeCallbacks();
    getLogger().info('✅ Graceful shutdown complete');
    process.exit(0);
  }

  /** Runs each registered shutdown callback, logging errors without aborting. */
  private async executeCallbacks(): Promise<void> {
    for (const callback of this.callbacks) {
      try { await callback(); }
      catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        getLogger().error(`Error during shutdown callback: ${msg}`);
      }
    }
  }
}
