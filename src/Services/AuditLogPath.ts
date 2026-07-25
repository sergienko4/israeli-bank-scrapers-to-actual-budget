/**
 * Resolves the audit-log file path shared by the importer (writer) and the
 * portal's /api/status reader. `AUDIT_LOG_PATH` overrides the default so both
 * processes can point at one file on a shared volume.
 */

const DEFAULT_AUDIT_LOG_PATH = '/app/data/audit-log.json';

/**
 * Resolves the audit-log file path from `AUDIT_LOG_PATH`, falling back to the
 * default Docker data path when the env var is unset or blank.
 * @returns The absolute audit-log file path.
 */
export default function resolveAuditLogPath(): string {
  const override = process.env.AUDIT_LOG_PATH?.trim();
  return override !== undefined && override.length > 0 ? override : DEFAULT_AUDIT_LOG_PATH;
}
