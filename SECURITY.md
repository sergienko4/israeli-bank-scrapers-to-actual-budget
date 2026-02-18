# Security Policy

## Overview

Israeli Bank Importer handles sensitive financial credentials and data. This document outlines security best practices and our security policies.

---

## 🔐 Credential Security

### Configuration File Protection

**CRITICAL**: Your `config.json` contains bank credentials and must be protected.

```bash
# Set restrictive permissions (owner read/write only)
chmod 600 config.json

# Verify permissions
ls -la config.json
# Should show: -rw------- (600)
```

### Never Commit Credentials

- ✅ `config.json` is in `.gitignore` by default
- ❌ **NEVER** commit `config.json` to version control
- ❌ **NEVER** share `config.json` publicly
- ❌ **NEVER** paste config contents in issues or forums

### Environment Variables (Alternative)

For CI/CD or automated deployments, consider using environment variables instead of `config.json`:

```bash
# Example for Bank Discount
ACTUAL_SERVER_URL=https://your-server.com
ACTUAL_PASSWORD=your_password
DISCOUNT_ID=your_id
DISCOUNT_PASSWORD=your_password
DISCOUNT_NUM=your_num
```

---

## 🐳 Docker Security

### Required Capabilities

The importer requires `SYS_ADMIN` capability for Chromium browser sandboxing:

```yaml
cap_add:
  - SYS_ADMIN
```

**Why is this needed?**
- Chromium requires kernel namespaces for browser sandboxing
- This is standard for headless browser automation
- Without it, the browser cannot launch

**Is this safe?**
- ✅ Safe when running **trusted code** (this open-source project)
- ✅ Container still runs as non-root user (`node`)
- ✅ No other privileged operations are performed
- ⚠️ **Only run trusted Docker images** with this capability

### Volume Mounts

Mount `config.json` as **read-only**:

```yaml
volumes:
  - ./config.json:/app/config.json:ro  # Note the :ro flag
```

This prevents the container from modifying your configuration file.

### Container User

The Dockerfile runs as non-root user `node` (UID 1000):

```dockerfile
USER node
```

This follows the principle of least privilege.

### Directory Permissions

As of v1.0, directories use secure permissions:

```bash
# Before: drwxrwxrwx (777) - INSECURE
# After:  drwxr-xr-x (755) - SECURE

# Owner (node): read, write, execute
# Group: read, execute
# Others: read, execute
```

---

## 🔒 Data Storage

### Persistent Volumes

The importer uses these volumes:

| Volume | Purpose | Sensitivity |
|--------|---------|-------------|
| `config.json` | Bank credentials | 🔴 **HIGH** |
| `data/` | Actual Budget cache | 🟡 **MEDIUM** |
| `cache/` | Scraper cache | 🟡 **MEDIUM** |
| `chrome-data/` | Browser profile (2FA) | 🟡 **MEDIUM** |

**Recommendations**:
- Store volumes on encrypted filesystem
- Limit access to authorized users only
- Regular backups of `config.json` (stored securely)
- Delete old cache periodically

### Data at Rest

- Config file contains plain-text credentials
- Consider using encrypted filesystem (LUKS, BitLocker, etc.)
- On VMs, use encrypted EBS/disk volumes

### Data in Transit

- ✅ Bank scrapers use HTTPS
- ✅ Actual Budget API uses HTTPS (if configured)
- ⚠️ Ensure your Actual server uses HTTPS in production

---

## 🚨 Vulnerability Reporting

### Reporting Security Issues

**DO NOT** open public GitHub issues for security vulnerabilities.

Instead:
1. Email security concerns to: [your-email@example.com]
2. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

We will respond within 48 hours and work on a fix.

### Security Updates

Security patches will be released as:
- **Critical**: Immediate patch release (e.g., v1.0.1)
- **High**: Within 1 week
- **Medium/Low**: Next minor release

---

## 🛡️ Best Practices

### For End Users

1. **Keep Docker Image Updated**
   ```bash
   docker pull sergienko4/israeli-bank-importer:latest
   ```

2. **Use Strong Passwords**
   - Use unique passwords for Actual Budget server
   - Enable 2FA on bank accounts where available

3. **Monitor Logs**
   ```bash
   docker-compose logs -f israeli_bank_importer
   ```
   - Check for failed login attempts
   - Check for unusual activity

4. **Limit Network Access**
   - Run on private network if possible
   - Use firewall rules to restrict outbound connections
   - Only allow connections to: banks, Actual server

5. **Regular Security Audits**
   - Review `config.json` periodically
   - Remove unused bank configurations
   - Check file permissions

### For Developers

1. **Dependency Scanning**
   ```bash
   npm audit
   docker scan israeli-bank-importer:latest
   ```

2. **Code Review**
   - All PRs require review
   - Security-sensitive changes require maintainer approval

3. **No Hardcoded Secrets**
   - Never commit credentials
   - Use environment variables or volume mounts

4. **Principle of Least Privilege**
   - Request minimum Docker capabilities
   - Run as non-root user
   - Use minimal base image

---

## 🔍 Security Features

### Current Security Measures

- ✅ Non-root container user
- ✅ Secure directory permissions (755)
- ✅ Config file not baked into image
- ✅ Read-only config mount supported
- ✅ Minimal base image (node:22-slim)
- ✅ Credentials not logged
- ✅ `.gitignore` prevents credential commits
- ✅ Dependency vulnerability scanning (npm audit)

### Planned Security Enhancements

See [IMPLEMENTATION-ROADMAP.md](IMPLEMENTATION-ROADMAP.md) for upcoming security improvements.

---

## 📋 Security Checklist

Before deploying to production:

- [ ] Set `chmod 600 config.json`
- [ ] Mount config as read-only (`:ro`)
- [ ] Use HTTPS for Actual Budget server
- [ ] Enable 2FA on bank accounts
- [ ] Run on private/secure network
- [ ] Use encrypted filesystem/volumes
- [ ] Regular Docker image updates
- [ ] Monitor logs for anomalies
- [ ] Backup `config.json` securely
- [ ] Limit `SYS_ADMIN` to trusted images only

---

## 📚 Additional Resources

- [OWASP Docker Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Docker_Security_Cheat_Sheet.html)
- [Docker Security Best Practices](https://docs.docker.com/engine/security/)
- [Node.js Security Best Practices](https://nodejs.org/en/docs/guides/security/)

---

## 📄 License

This security policy is part of the Israeli Bank Importer project and is licensed under the MIT License.

---

**Last Updated**: 2026-02-18
**Version**: 1.0.0
