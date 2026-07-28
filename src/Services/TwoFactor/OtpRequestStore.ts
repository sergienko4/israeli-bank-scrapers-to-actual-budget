/**
 * File-backed registry of pending app-OTP requests, shared across the process
 * boundary between the import child (which needs an OTP during a 2FA bank login)
 * and the portal (which receives the code the user enters in the mobile app).
 *
 * The import child {@link create}s a request and polls {@link get} until the
 * portal {@link submit}s a code; it then {@link remove}s the entry. Codes live
 * in the file only briefly, between submit and consumption, and are never logged
 * by this module. Corrupt or missing files read as an empty list, mirroring
 * {@link DeviceTokenStore}.
 *
 * Every write replaces the file atomically (temp file + rename) so a concurrent
 * reader never observes a partial file. The importer scrapes banks sequentially,
 * so at most one OTP request is active per importer at a time, and the portal
 * attaches a code only once per request; concurrent read-modify-write conflicts
 * on the shared file therefore do not arise in normal single-importer operation.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

import resolveOtpRequestsPath from './OtpRequestPath.js';

/** A single pending (or code-carrying) OTP request. */
export interface IOtpRequest {
  /** Opaque request id the app submits its code against. */
  id: string;
  /** Bank id the OTP is for (shown to the user). */
  bankId: string;
  /** Creation time, epoch ms. */
  createdAt: number;
  /** Expiry time, epoch ms; the request is dead once now exceeds it. */
  deadline: number;
  /** The submitted OTP code, present only after the app submits it. */
  code?: string;
}

/** Persists pending OTP requests to a JSON file on a shared volume. */
export default class OtpRequestStore {
  /**
   * Creates a store backed by the given file.
   * @param filePath - Path to the OTP-requests JSON file.
   */
  constructor(private readonly filePath = resolveOtpRequestsPath()) {}

  /**
   * Creates a new pending OTP request and persists it.
   * @param bankId - The bank the OTP is for.
   * @param ttlMs - Time-to-live in milliseconds before the request expires.
   * @param now - Current time in epoch ms (defaults to Date.now()).
   * @returns The created request (without a code).
   */
  public create(bankId: string, ttlMs: number, now: number = Date.now()): IOtpRequest {
    const request: IOtpRequest = {
      id: randomUUID(), bankId, createdAt: now, deadline: now + ttlMs,
    };
    const kept = this.readAll().filter((entry) => entry.deadline > now);
    this.write([...kept, request]);
    return request;
  }

  /**
   * Lists the pending requests that have not expired and have no code yet.
   * @param now - Current time in epoch ms (defaults to Date.now()).
   * @returns The live pending requests (codes are never populated here).
   */
  public pending(now: number = Date.now()): IOtpRequest[] {
    return this.readAll().filter((entry) => entry.code === undefined && entry.deadline > now);
  }

  /**
   * Reads a single request by id.
   * @param id - The request id.
   * @returns The request, or null when it is absent.
   */
  public get(id: string): IOtpRequest | null {
    return this.readAll().find((entry) => entry.id === id) ?? null;
  }

  /**
   * Attaches a submitted code to a live pending request.
   * @param id - The request id to submit against.
   * @param code - The OTP code entered by the user.
   * @param now - Current time in epoch ms (defaults to Date.now()).
   * @returns True when a live pending request was updated, else false.
   */
  public submit(id: string, code: string, now: number = Date.now()): boolean {
    const all = this.readAll();
    const target = all.find((entry) => entry.id === id);
    if (!target || target.code !== undefined || target.deadline <= now) {
      return false;
    }
    const next = all.map((entry) => (entry.id === id ? { ...entry, code } : entry));
    this.write(next);
    return true;
  }

  /**
   * Removes a request (used after a code is consumed or the request expires).
   * @param id - The request id to remove.
   */
  public remove(id: string): void {
    const remaining = this.readAll().filter((entry) => entry.id !== id);
    this.write(remaining);
  }

  /**
   * Reads and validates the stored requests.
   * @returns The stored requests, or an empty array when absent/corrupt.
   */
  private readAll(): IOtpRequest[] {
    if (!existsSync(this.filePath)) return [];
    try {
      const raw = readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((entry) => OtpRequestStore.isRequest(entry));
    } catch {
      return [];
    }
  }

  /**
   * Serialises and atomically replaces the request file (temp file + rename).
   * @param requests - The full request list to persist.
   * @returns Nothing; the file is replaced before returning.
   */
  private write(requests: IOtpRequest[]): void {
    const serialized = JSON.stringify(requests, null, 2);
    const token = randomUUID();
    const tempPath = `${this.filePath}.${token}.tmp`;
    writeFileSync(tempPath, serialized);
    renameSync(tempPath, this.filePath);
  }

  /**
   * Type guard for a well-formed persisted request.
   * @param value - A parsed array entry.
   * @returns True when the entry has the required request shape.
   */
  private static isRequest(value: unknown): value is IOtpRequest {
    if (typeof value !== 'object' || value === null) return false;
    const entry = value as Record<string, unknown>;
    return typeof entry.id === 'string'
      && typeof entry.bankId === 'string'
      && typeof entry.createdAt === 'number'
      && typeof entry.deadline === 'number'
      && (entry.code === undefined || typeof entry.code === 'string');
  }
}
