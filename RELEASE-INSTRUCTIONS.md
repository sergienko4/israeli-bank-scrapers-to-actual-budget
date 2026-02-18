# Release Instructions

**Current Status:** Phase 4 Complete - Ready for Release

---

## ✅ What's Been Done

### 1. Git Changes ✅
- ✅ All code changes committed to `phase4-idempotent-reconciliation` branch
- ✅ Pushed to GitHub: https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget
- ✅ Ready to merge to main

### 2. Documentation ✅
- ✅ CHANGELOG.md created with full version history
- ✅ CODE-ANALYSIS.md added with improvement roadmap
- ✅ README.md updated with Phase 4 features
- ✅ All obsolete files removed

### 3. Automated Workflows ✅
- ✅ GitHub Actions workflow updated to automatically:
  - Build Docker image on main branch pushes
  - Push to Docker Hub with `latest` tag
  - Create GitHub releases when version tags are pushed
  - Extract changelog for release notes

---

## 🚀 How to Release (Two Options)

### Option 1: Automatic Release (Recommended) 🤖

This will trigger automated builds and release creation:

```bash
# 1. Merge phase4 branch to main
git checkout main
git merge phase4-idempotent-reconciliation
git push origin main

# 2. Create and push version tag
git tag v1.4.0
git push origin v1.4.0
```

**What happens automatically:**
- ✅ GitHub Actions builds Docker image for multiple platforms (amd64, arm64)
- ✅ Pushes to Docker Hub with tags: `latest`, `v1.4.0`, `1.4`, `1`
- ✅ Updates Docker Hub description from README.md
- ✅ Creates GitHub Release with changelog content
- ✅ Generates release notes

**Status:** Will be live in ~5-10 minutes after push

---

### Option 2: Manual Docker Push 🔧

If you want to push the Docker image manually:

```bash
# 1. Login to Docker Hub
docker login
# Enter username: sergienko4
# Enter password: [your Docker Hub token]

# 2. Tag the image
docker tag israeli-bank-importer:latest sergienko4/israeli-bank-importer:latest
docker tag israeli-bank-importer:latest sergienko4/israeli-bank-importer:v1.4.0
docker tag israeli-bank-importer:latest sergienko4/israeli-bank-importer:1.4
docker tag israeli-bank-importer:latest sergienko4/israeli-bank-importer:1

# 3. Push all tags
docker push sergienko4/israeli-bank-importer:latest
docker push sergienko4/israeli-bank-importer:v1.4.0
docker push sergienko4/israeli-bank-importer:1.4
docker push sergienko4/israeli-bank-importer:1
```

**Then still do the git merge and tag:**
```bash
git checkout main
git merge phase4-idempotent-reconciliation
git push origin main
git tag v1.4.0
git push origin v1.4.0
```

---

## 📋 Pre-Release Checklist

Before releasing, verify:

- [x] All tests passing
- [x] Docker image builds successfully
- [x] TypeScript compiles without errors
- [x] Documentation updated
- [x] CHANGELOG.md updated
- [x] Git branch pushed to GitHub
- [x] Workflow tested (automated releases configured)

---

## 🎯 Recommended Release Process

**I recommend Option 1 (Automatic)** because:
- ✅ Builds for multiple platforms (amd64 + arm64)
- ✅ Uses GitHub Actions cache for faster builds
- ✅ Consistent tagging and versioning
- ✅ Automatic release notes generation
- ✅ Updates Docker Hub description automatically

**Steps:**

### Step 1: Merge to Main
```bash
cd /path/to/israeli-bank-importer
git checkout main
git pull origin main  # Get latest
git merge phase4-idempotent-reconciliation
git push origin main
```

**What happens:** GitHub Actions starts building and pushing to Docker Hub with `latest` tag

---

### Step 2: Create Release Tag
```bash
git tag -a v1.4.0 -m "Phase 4: Idempotent Reconciliation + Observability

Major release with idempotent reconciliation, comprehensive metrics,
and advanced validation."

git push origin v1.4.0
```

**What happens:**
- GitHub Actions builds and pushes with version tags (`v1.4.0`, `1.4`, `1`)
- Creates GitHub Release with changelog from CHANGELOG.md
- Users can see release notes on GitHub

---

### Step 3: Verify Release

**Check Docker Hub:**
- https://hub.docker.com/r/sergienko4/israeli-bank-importer/tags

**Expected tags:**
- `latest`
- `v1.4.0`
- `1.4`
- `1`
- `main-<commit-sha>`

**Check GitHub Releases:**
- https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/releases

**Expected:**
- Release v1.4.0 created
- Changelog content displayed
- Auto-generated release notes

---

## 📦 What Users Will See

### Docker Hub
```bash
docker pull sergienko4/israeli-bank-importer:latest
docker pull sergienko4/israeli-bank-importer:v1.4.0
docker pull sergienko4/israeli-bank-importer:1.4
docker pull sergienko4/israeli-bank-importer:1
```

All these will pull the Phase 4 image with:
- ✅ Idempotent reconciliation
- ✅ Metrics collection
- ✅ Advanced validation

### GitHub Release Page
Users will see:
```
v1.4.0 - Phase 4: Idempotent Reconciliation + Observability

Major release adding:
- Idempotent reconciliation (no duplicates)
- Comprehensive metrics collection
- Advanced configuration validation
- Full observability

[Full changelog from CHANGELOG.md]
```

---

## 🔍 Monitoring the Release

### GitHub Actions Progress
1. Go to: https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/actions
2. You'll see "Docker Build and Push" workflow running
3. Monitor the progress (usually takes 5-10 minutes)

### Troubleshooting
If the workflow fails:
- Check GitHub Actions logs
- Verify Docker Hub credentials are set in GitHub Secrets:
  - `DOCKERHUB_USERNAME`
  - `DOCKERHUB_TOKEN`

---

## 📝 Post-Release Checklist

After release:
- [ ] Verify Docker Hub has all tags
- [ ] Verify GitHub Release created
- [ ] Test pulling the image: `docker pull sergienko4/israeli-bank-importer:latest`
- [ ] Test running the image
- [ ] Update any external documentation (if applicable)
- [ ] Announce the release (if desired)

---

## 🎉 Release Summary

**Version:** v1.4.0
**Branch:** phase4-idempotent-reconciliation → main
**Status:** Ready to merge and release

**Changes:**
- 3,471 lines added
- 265 lines removed
- 12 files changed
- 2 new services added
- Full metrics and validation

**Docker Image:**
- Repository: sergienko4/israeli-bank-importer
- Tags: latest, v1.4.0, 1.4, 1
- Platforms: linux/amd64, linux/arm64
- Size: ~650MB

**Ready for Production:** YES ✅

---

## 🚦 Current Status

```
✅ Code changes complete
✅ Tests passing
✅ Documentation updated
✅ Docker image built
✅ Git committed and pushed
✅ Automated workflows configured
⏸️  Waiting for: Merge to main + tag
```

---

**Next Action:** Run Option 1 commands to complete the release!

```bash
# Quick release commands:
git checkout main
git merge phase4-idempotent-reconciliation
git push origin main
git tag v1.4.0
git push origin v1.4.0

# Then monitor: https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/actions
```
