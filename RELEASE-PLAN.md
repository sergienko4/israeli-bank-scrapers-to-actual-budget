# Release Plan - v1.0.0

This document outlines the steps to release the project to GitHub and Docker Hub.

---

## ✅ Pre-Release Checklist

- [x] All sensitive data removed from code
- [x] .gitignore configured properly
- [x] README.md completed
- [x] BANKS.md documented
- [x] DEPLOYMENT-GUIDE.md created
- [x] config.json.example created
- [x] LICENSE file added (MIT)
- [x] .dockerignore optimized
- [ ] Test Docker build locally
- [ ] Test import with real credentials
- [ ] Create GitHub repository
- [ ] Push to GitHub
- [ ] Create GitHub release v1.0.0
- [ ] Build and push to Docker Hub

---

## Step 1: Test Locally

```bash
# Build Docker image
docker build -t israeli-bank-importer:latest .

# Test run
docker run --rm --cap-add SYS_ADMIN \
  -v $(pwd)/config.json:/app/config.json \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/cache:/app/cache \
  -v $(pwd)/chrome-data:/app/chrome-data \
  israeli-bank-importer:latest

# Verify transactions imported to Actual Budget
```

---

## Step 2: Create GitHub Repository

1. Go to https://github.com/new
2. Repository name: `israeli-bank-scrapers-to-actual-budget`
3. Description: `Automatically import transactions from 18 Israeli banks and credit cards into Actual Budget`
4. Public repository
5. **Do NOT initialize** with README (we have one)
6. Click "Create repository"

---

## Step 3: Push to GitHub

```bash
cd C:\Users\esergienko\Downloads\actual-budget\israeli-bank-importer

# Initialize git (already done)
git init

# Set user config
git config user.name "sergienko4"
git config user.email "sergienko4@users.noreply.github.com"

# Stage all files
git add .

# Check what will be committed
git status

# Create initial commit
git commit -m "Initial release v1.0.0

- Support for 18 Israeli banks and credit cards
- Automated scheduled imports with cron
- Duplicate detection
- 2FA support with chrome-data persistence
- Docker-based deployment
- Comprehensive documentation

Powered by israeli-bank-scrapers by @eshaham
Compatible with Actual Budget v26.2.0+"

# Add remote
git remote add origin https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget.git

# Push to GitHub
git branch -M main
git push -u origin main
```

---

## Step 4: Create GitHub Release

**Option A: Using GitHub Web Interface**

1. Go to https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/releases
2. Click "Create a new release"
3. Tag: `v1.0.0`
4. Target: `main`
5. Title: `v1.0.0 - Initial Release`
6. Description:

```markdown
# 🎉 Initial Release - v1.0.0

Automatically import transactions from **18 Israeli banks and credit cards** into Actual Budget.

## ✨ Features

- ✅ **18 financial institutions** - All major Israeli banks and credit cards
- ✅ **Automatic scheduled imports** - Cron-based scheduling
- ✅ **Duplicate detection** - Safe to run multiple times
- ✅ **2FA support** - Browser session persistence
- ✅ **Date filtering** - Import only recent transactions
- ✅ **Multiple accounts** - Map different accounts
- ✅ **Docker-native** - Easy deployment
- ✅ **Optional reconciliation** - Auto-balance matching

## 🏦 Supported Banks

### Banks (11)
Bank Hapoalim, Leumi, Discount, Mizrahi Tefahot, Mercantile, Otsar Hahayal, Bank of Jerusalem, International Bank, Massad, Yahav

### Credit Cards (7)
Cal (Visa Cal), Max, Isracard, Amex Israel, Beyahad Bishvilha, Behatsdaa, Pagi, OneZero

## 🚀 Quick Start

See [README.md](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget#readme) for installation instructions.

## 📦 Docker Image

Available on Docker Hub:
```bash
docker pull sergienko4/israeli-bank-importer:1.0.0
```

## 🤝 Credits

Powered by [israeli-bank-scrapers](https://github.com/eshaham/israeli-bank-scrapers) by @eshaham

## 📄 License

MIT License
```

7. Click "Publish release"

**Option B: Using GitHub CLI**

```bash
gh release create v1.0.0 \
  --title "v1.0.0 - Initial Release" \
  --notes "See release notes above"
```

---

## Step 5: Docker Hub Setup

### 5.1 Create Docker Hub Repository

1. Go to https://hub.docker.com/
2. Click "Create Repository"
3. Name: `israeli-bank-importer`
4. Description: `Automatically import transactions from 18 Israeli banks into Actual Budget. Powered by israeli-bank-scrapers.`
5. Visibility: Public
6. Click "Create"

### 5.2 Login to Docker Hub

```bash
docker login
# Username: sergienko4
# Password: [your Docker Hub password]
```

### 5.3 Build Multi-Platform Image

**Option A: Simple build (x86_64 only)**

```bash
cd C:\Users\esergienko\Downloads\actual-budget\israeli-bank-importer

# Build and tag (simplified - only 2 tags)
docker build -t sergienko4/israeli-bank-importer:1.0.0 \
             -t sergienko4/israeli-bank-importer:latest .

# Push to Docker Hub
docker push sergienko4/israeli-bank-importer:1.0.0
docker push sergienko4/israeli-bank-importer:latest
```

**Option B: Multi-platform build (recommended - supports ARM)**

```bash
# Create buildx builder (first time only)
docker buildx create --use --name multiplatform-builder

# Build for multiple platforms and push (simplified - only 2 tags)
docker buildx build --platform linux/amd64,linux/arm64 \
  -t sergienko4/israeli-bank-importer:1.0.0 \
  -t sergienko4/israeli-bank-importer:latest \
  --push .
```

### 5.4 Update Docker Hub Description

Go to https://hub.docker.com/r/sergienko4/israeli-bank-importer and add:

**Full Description:**
```markdown
# Israeli Bank Scrapers to Actual Budget

Automatically import transactions from 18 Israeli banks and credit cards into Actual Budget.

Powered by [israeli-bank-scrapers](https://github.com/eshaham/israeli-bank-scrapers) by eshaham.

## Quick Start

```bash
docker pull sergienko4/israeli-bank-importer:latest
docker run --rm --cap-add SYS_ADMIN \
  -v $(pwd)/config.json:/app/config.json \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/cache:/app/cache \
  -v $(pwd)/chrome-data:/app/chrome-data \
  sergienko4/israeli-bank-importer:latest
```

## Documentation

- GitHub: https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget
- Supported Banks: See README.md
- Configuration: See config.json.example

## Tags

- `latest` - Latest stable release (auto-updates)
- `1.0.0` - Specific version (pinned, stable)

## License

MIT License
```

---

## Step 6: Post-Release

### 6.1 Verify Everything Works

```bash
# Pull from Docker Hub
docker pull sergienko4/israeli-bank-importer:latest

# Test run
docker run --rm --cap-add SYS_ADMIN \
  -v $(pwd)/config.json:/app/config.json \
  -v $(pwd)/data:/app/data \
  sergienko4/israeli-bank-importer:latest

# Verify transactions imported
```

### 6.2 Update Repository Topics (GitHub)

Go to repository settings and add topics:
- `actual-budget`
- `israeli-banks`
- `banking`
- `automation`
- `docker`
- `finance`
- `budgeting`
- `israeli-bank-scrapers`

### 6.3 Share with Community

Consider sharing on:
- Actual Budget Discord/Forum
- Israeli developer communities
- Personal blog/social media

---

## 🎯 Success Criteria

- [x] GitHub repository created and code pushed
- [ ] GitHub release v1.0.0 created
- [ ] Docker Hub image published (sergienko4/israeli-bank-importer:1.0.0)
- [ ] Users can `docker pull` and run without building
- [ ] README visible on GitHub
- [ ] All documentation accessible

---

## 📋 Version Tags Strategy

**Git tags:**
- `v1.0.0` - Exact version

**Docker tags (simplified strategy):**
- `latest` - Always points to newest stable release
- `1.0.0` - Exact version (never changes, pinned)

**Benefits:**
- Users can pin to exact version for stability: `sergienko4/israeli-bank-importer:1.0.0`
- Or auto-update to latest: `sergienko4/israeli-bank-importer:latest`
- Simple and easy to understand

---

## 🔄 Future Releases

For v1.0.1, v1.1.0, etc.:

1. Make changes
2. Update version in package.json
3. Commit: `git commit -m "Release v1.x.x"`
4. Tag: `git tag v1.x.x`
5. Push: `git push && git push --tags`
6. Create GitHub release
7. Build and push Docker image with 2 tags:
   ```bash
   docker build -t sergienko4/israeli-bank-importer:1.x.x \
                -t sergienko4/israeli-bank-importer:latest .
   docker push sergienko4/israeli-bank-importer:1.x.x
   docker push sergienko4/israeli-bank-importer:latest
   ```

---

**Ready to release! 🚀**
