/**
 * Audit-log wiring: the log at `AUDIT_LOG_PATH` on the real filesystem. The
 * importer writes it and the portal and Telegram read it, all through here,
 * so every process resolves the path the same way.
 */

import createNodeFileSystem from '../Storage/NodeFileSystem.js';
import resolveAuditLogPath from './AuditLogPath.js';
import { AuditLogService } from './AuditLogService.js';

/**
 * Opens the audit log.
 *
 * Opening it touches no file.
 * @returns The log at `AUDIT_LOG_PATH`.
 */
export default function openAuditLog(): AuditLogService {
  return new AuditLogService(createNodeFileSystem(), resolveAuditLogPath());
}
