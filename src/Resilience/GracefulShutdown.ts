/**
 * Graceful shutdown handler
 * Follows Single Responsibility Principle: Only handles shutdown signals
 */

import { getLogger } from '../Logger/Index.js';
import type { Procedure } from '../Types/Index.js';
import { fail, isFail, succeed } from '../Types/Index.js';
import { errorMessage, mapInOrder } from '../Utils/Index.js';

/** Callback function type for shutdown handlers. */
export type ShutdownCallback = () =>
  Procedure<{ status: string }> | Promise<Procedure<{ status: string }>>;

export interface IShutdownHandler {
  isShuttingDown(): boolean;
  onShutdown(callback: ShutdownCallback): Procedure<{ status: string }>;
}

/** Listens for SIGTERM/SIGINT and runs registered cleanup callbacks before exit. */
export class GracefulShutdownHandler implements IShutdownHandler {
  private _shuttingDown = false;
  private readonly _callbacks: ShutdownCallback[] = [];

  /** Registers process signal handlers for SIGTERM and SIGINT. */
  constructor() {
    this.setupSignalHandlers();
  }

  /**
   * Returns whether a shutdown has been initiated.
   * @returns True once a shutdown signal has been received.
   */
  public isShuttingDown(): boolean {
    return this._shuttingDown;
  }

  /**
   * Registers a callback to run during graceful shutdown.
   * @param callback - Function to invoke when the process is shutting down.
   * @returns Procedure indicating the callback was registered.
   */
  public onShutdown(callback: ShutdownCallback): Procedure<{ status: string }> {
    this._callbacks.push(callback);
    return succeed({ status: 'registered' });
  }

  /**
   * Attaches SIGTERM and SIGINT listeners to the Node.js process.
   * @returns Procedure indicating the signal handlers were attached.
   */
  private setupSignalHandlers(): Procedure<{ status: string }> {
    process.on('SIGTERM', () => { void this.handleShutdown('SIGTERM'); });
    process.on('SIGINT', () => { void this.handleShutdown('SIGINT'); });
    return succeed({ status: 'handlers-attached' });
  }

  /**
   * Runs all registered callbacks and exits the process cleanly.
   * @param signal - The OS signal name that triggered the shutdown.
   * @returns Procedure indicating the shutdown status.
   */
  private async handleShutdown(signal: string): Promise<Procedure<{ status: string }>> {
    if (this._shuttingDown) return succeed({ status: 'already-shutting-down' });
    getLogger().warn(`\n⚠️  Received ${signal} signal, initiating graceful shutdown...`);
    this._shuttingDown = true;
    await this.executeCallbacks();
    getLogger().info('✅ Graceful shutdown complete');
    process.exit(0);
  }

  /**
   * Runs each registered shutdown callback sequentially, logging failures without aborting.
   * @returns Procedure indicating all callbacks have been executed.
   */
  private async executeCallbacks(): Promise<Procedure<{ status: string }>> {
    const outcomes = mapInOrder(
      this._callbacks, callback => GracefulShutdownHandler.settleCallback(callback)
    );
    for await (const outcome of outcomes) {
      if (isFail(outcome)) getLogger().error(outcome.message);
    }
    return succeed({ status: 'callbacks-complete' });
  }

  /**
   * Executes one shutdown callback, turning a failed Procedure or a thrown error
   * into a failure whose message is ready to log.
   * @param callback - The registered shutdown callback to run.
   * @returns The callback's result, or a failure describing what went wrong.
   */
  private static async settleCallback(
    callback: ShutdownCallback
  ): Promise<Procedure<{ status: string }>> {
    try {
      const result = await callback();
      return isFail(result) ? fail(`Shutdown callback failed: ${result.message}`) : result;
    } catch (error: unknown) {
      return fail(`Error during shutdown callback: ${errorMessage(error)}`);
    }
  }
}
