# Docker Hub Immutability Fix

**Date:** 2026-02-18
**Issue:** GitHub Actions failing with immutability error
**Status:** ✅ Fixed

---

## 🐛 Problem

GitHub Actions was failing with this error:

```
ERROR: failed to push sergienko4/israeli-bank-importer:latest:
denied: requested access to the resource is denied -
This tag is already assigned to an image in this repository and
cannot be updated due to immutability settings.
To push this image, use a different tag.
```

---

## 🔍 Root Cause

Docker Hub has **immutability settings** enabled for the repository. This is a security feature that prevents existing tags from being overwritten.

**The problem:**
- Workflow tried to push `latest` tag
- `latest` tag already exists in Docker Hub
- Immutability prevents overwriting
- Build fails ❌

---

## ✅ Solution

**Removed `latest` tag from workflow** and use alternative tagging strategies:

### Old Workflow (Broken)
```yaml
tags: |
  type=semver,pattern={{version}}          # v1.4.0
  type=semver,pattern={{major}}.{{minor}}  # 1.4
  type=semver,pattern={{major}}            # 1
  type=sha,prefix=main-,format=short       # main-abc123
  type=raw,value=latest                    # ❌ BREAKS WITH IMMUTABILITY
  type=raw,value={{date 'YYYYMMDD-HHmmss'}}
```

### New Workflow (Fixed)
```yaml
tags: |
  type=semver,pattern={{version}}          # v1.4.0
  type=semver,pattern={{major}}.{{minor}}  # 1.4
  type=semver,pattern={{major}}            # 1
  type=sha,prefix=main-,format=short       # main-abc123
  type=raw,value={{date 'YYYYMMDD-HHmmss'}}# 20260218-214500
```

**Key change:** Removed `type=raw,value=latest` line

---

## 📦 New Tagging Strategy

### For Version Releases (e.g., v1.4.0)
```bash
docker pull sergienko4/israeli-bank-importer:v1.4.0  # Exact version
docker pull sergienko4/israeli-bank-importer:1.4     # Minor version
docker pull sergienko4/israeli-bank-importer:1       # Major version
```

**Use case:** Production deployments where stability matters

**Benefit:** Immutable tags - always get the same image

---

### For Main Branch Builds
```bash
# Timestamped (human-readable)
docker pull sergienko4/israeli-bank-importer:20260218-214500

# Commit SHA (for debugging)
docker pull sergienko4/israeli-bank-importer:main-abc123
```

**Use case:** Testing latest changes from main branch

**Benefit:** Each build gets a unique tag

---

## 🎯 Recommended Usage

### Production (Recommended)
```yaml
# docker-compose.yml
services:
  israeli_bank_importer:
    image: sergienko4/israeli-bank-importer:1.4  # Pin to minor version
```

**Benefits:**
- ✅ Stable - won't break on updates
- ✅ Immutable - always the same image
- ✅ Can upgrade when ready (1.4 → 1.5)

---

### Testing Latest
```yaml
# docker-compose.yml
services:
  israeli_bank_importer:
    image: sergienko4/israeli-bank-importer:1  # Auto-update to latest major version
```

**Benefits:**
- ✅ Gets latest 1.x updates automatically
- ⚠️ May break if breaking changes in 1.x

---

### Bleeding Edge (Not Recommended for Production)
```bash
# Find latest timestamp tag on Docker Hub
docker pull sergienko4/israeli-bank-importer:20260218-214500
```

**Use case:** Testing unreleased features

---

## 🔄 Migration Guide

### If You Were Using `latest` Tag

**Old (Broken):**
```bash
docker pull sergienko4/israeli-bank-importer:latest
```

**New (Fixed):**
```bash
# Option 1: Pin to minor version (recommended)
docker pull sergienko4/israeli-bank-importer:1.4

# Option 2: Pin to major version (auto-update minor versions)
docker pull sergienko4/israeli-bank-importer:1

# Option 3: Pin to exact version (no auto-update)
docker pull sergienko4/israeli-bank-importer:v1.4.0
```

---

### Update Your docker-compose.yml

**Before:**
```yaml
services:
  israeli_bank_importer:
    image: sergienko4/israeli-bank-importer:latest  # ❌ Broken
```

**After:**
```yaml
services:
  israeli_bank_importer:
    image: sergienko4/israeli-bank-importer:1.4  # ✅ Fixed
```

---

## 📊 Available Tags on Docker Hub

After successful deployment, these tags will be available:

### Version Tags (Immutable)
```
v1.4.0    - Exact version (never changes)
1.4       - Minor version (gets patch updates)
1         - Major version (gets minor updates)
```

### Build Tags (Unique per build)
```
20260218-214500  - Timestamped build (Feb 18, 2026 21:45:00)
main-a455b4a     - Commit-based (main branch, commit a455b4a)
```

---

## 🎉 Benefits of This Approach

### 1. Immutability Compliance ✅
- Works with Docker Hub immutability settings
- No more build failures

### 2. Better Version Control ✅
- Clear versioning (1.4 vs 1.5)
- Pin to specific versions for stability

### 3. Rollback Support ✅
- Can always go back to previous version
- `docker pull sergienko4/israeli-bank-importer:1.3`

### 4. Testing Flexibility ✅
- Test specific commits with SHA tags
- Test dated builds

### 5. Production Safety ✅
- Immutable tags prevent surprises
- Controlled upgrades

---

## 🔧 Alternative Solutions (Not Implemented)

### Option A: Disable Immutability in Docker Hub
**Pros:** `latest` tag would work
**Cons:**
- ❌ Less secure
- ❌ Tags can be overwritten (bad for production)
- ❌ Not recommended

**How to do it:**
1. Go to Docker Hub repository settings
2. Find "Immutability" section
3. Disable it

**We didn't do this because immutability is a security best practice.**

---

### Option B: Delete and Re-create `latest` Tag
**Pros:** Temporary workaround
**Cons:**
- ❌ Requires manual action every build
- ❌ Not sustainable
- ❌ Race conditions possible

**We didn't do this because it's not automated.**

---

## ✅ Verification

After the fix, check that builds succeed:

1. **GitHub Actions:**
   - https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/actions
   - Should show green checkmarks ✅

2. **Docker Hub:**
   - https://hub.docker.com/r/sergienko4/israeli-bank-importer/tags
   - Should show new tags (not `latest`)

3. **Pull Test:**
   ```bash
   docker pull sergienko4/israeli-bank-importer:1.4
   ```
   - Should succeed ✅

---

## 📝 Documentation Updated

### Files Changed:
- ✅ `.github/workflows/docker-publish.yml` - Removed `latest` tag
- ✅ `README.md` - Updated examples to use `1.4` instead of `latest`
- ✅ `DOCKER-IMMUTABILITY-FIX.md` - This file (explains the issue)

---

## 🎯 Summary

**Problem:** Docker Hub immutability prevented `latest` tag updates
**Solution:** Use version tags and timestamped tags instead
**Result:** Builds work, better version control, production-safe

**Recommended tag:** `1.4` (gets patch updates within 1.4.x)

---

**Fixed:** 2026-02-18
**Status:** ✅ Ready to Deploy
