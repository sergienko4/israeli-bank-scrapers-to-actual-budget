# Task 06: Fix Broken Documentation Links

**Priority:** 🔴 HIGH
**Effort:** 30 minutes
**Status:** 📋 TODO

---

## 🎯 Goal

Fix broken links in README.md and Docker Hub documentation that point to incorrect file paths after the documentation reorganization.

---

## 📝 Problem

After moving documentation files to `docs/` folder, several links are now broken:

❌ **Wrong:** `https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/BANKS.md`
✅ **Correct:** `https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/BANKS.md`

This affects:
- README.md (already fixed in PR #11, but need to verify)
- Docker Hub README (synced from README.md)
- Any other references

---

## 🔍 Files to Check and Fix

### Files to Audit
```
README.md
docs/BANKS.md
docs/DEPLOYMENT.md
SECURITY.md
CHANGELOG.md
```

---

## 📋 Implementation Steps

### Step 1: Audit All Links in README.md
**File:** `README.md`

Check for broken links:
```bash
# Search for any links that might be broken
grep -n "github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main" README.md
```

Expected findings:
- `BANKS.md` → should be `docs/BANKS.md` ✅ (already fixed)
- `DEPLOYMENT.md` → should be `docs/DEPLOYMENT.md` ✅ (already fixed)
- Other files should remain in root (SECURITY.md, CHANGELOG.md, LICENSE)

### Step 2: Verify Current State
**Command to check:**
```bash
cd israeli-bank-importer

# Check for references to moved files
grep -r "BANKS\.md" --include="*.md" . | grep -v "docs/BANKS.md" | grep -v node_modules
grep -r "DEPLOYMENT\.md" --include="*.md" . | grep -v "docs/DEPLOYMENT.md" | grep -v node_modules
```

### Step 3: Check Docker Hub README
Since Docker Hub pulls from README.md, and we already fixed it in PR #11, verify:

1. Go to: https://hub.docker.com/r/sergienko4/israeli-bank-importer
2. Check if links work
3. If not, the workflow needs to push updated README

### Step 4: Fix Any Remaining Issues

If any broken links found, fix them following this pattern:

**Pattern:**
```markdown
# Wrong (root level)
[BANKS.md](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/BANKS.md)

# Correct (in docs/)
[BANKS.md](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/BANKS.md)
```

**Files moved to docs/:**
- ✅ `docs/BANKS.md` (was `BANKS.md`)
- ✅ `docs/DEPLOYMENT.md` (was `DEPLOYMENT-GUIDE.md`)

**Files still in root:**
- ✅ `README.md`
- ✅ `CHANGELOG.md`
- ✅ `SECURITY.md`
- ✅ `LICENSE`

### Step 5: Verify Docker Hub Sync

Check workflow file to ensure Docker Hub description is updated:

**File:** `.github/workflows/docker-publish.yml`

Look for:
```yaml
- name: Update Docker Hub description
  uses: peter-evans/dockerhub-description@v4
  with:
    username: ${{ secrets.DOCKERHUB_USERNAME }}
    password: ${{ secrets.DOCKERHUB_TOKEN }}
    repository: ${{ env.DOCKER_IMAGE }}
    short-description: "Automatically import transactions from 18 Israeli banks into Actual Budget"
    readme-filepath: ./README.md
```

This should be in the `build-and-push` job and runs on every push.

---

## 🧪 Testing

### Test 1: Check Links in GitHub
```bash
# Clone repo fresh
git clone https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget.git temp-test
cd temp-test

# Check all doc links
echo "Testing BANKS.md link..."
curl -I https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/BANKS.md

echo "Testing DEPLOYMENT.md link..."
curl -I https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/DEPLOYMENT.md

# Should return 200 OK
```

### Test 2: Check Docker Hub Page
1. Visit: https://hub.docker.com/r/sergienko4/israeli-bank-importer
2. Click on each documentation link
3. Verify all links open correctly
4. Check "Supported Banks" link specifically

### Test 3: Check README Links Work on GitHub
1. Go to: https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget
2. Scroll through README.md
3. Click every link in the "Documentation" table
4. Verify all links work

---

## 📊 Link Inventory

### Links That Should Work (Already Fixed in PR #11)

| Link Text | URL | Status |
|-----------|-----|--------|
| BANKS.md | `.../docs/BANKS.md` | ✅ Fixed |
| docs/BANKS.md | `.../docs/BANKS.md` | ✅ Fixed |
| docs/DEPLOYMENT.md | `.../docs/DEPLOYMENT.md` | ✅ Fixed |
| SECURITY.md | `.../SECURITY.md` | ✅ Correct |
| CHANGELOG.md | `.../CHANGELOG.md` | ✅ Correct |
| LICENSE | `.../LICENSE` | ✅ Correct |
| config.json.example | `.../config.json.example` | ✅ Correct |

### Potential Issues to Check

- [ ] Internal relative links in docs/BANKS.md
- [ ] Internal relative links in docs/DEPLOYMENT.md
- [ ] Any hardcoded localhost URLs
- [ ] Broken anchor links (#sections)

---

## ✅ Acceptance Criteria

- [ ] All links in README.md work correctly
- [ ] Docker Hub documentation shows working links
- [ ] docs/BANKS.md accessible via GitHub and Docker Hub
- [ ] docs/DEPLOYMENT.md accessible via GitHub and Docker Hub
- [ ] No 404 errors when clicking any documentation link
- [ ] Relative links within docs/ folder work
- [ ] Documentation table in README has all correct paths

---

## 🔧 Quick Fix Commands

If any links are broken, use these commands:

```bash
# Fix BANKS.md references (if needed)
find . -name "*.md" -not -path "./node_modules/*" -exec sed -i 's|/blob/main/BANKS\.md|/blob/main/docs/BANKS.md|g' {} \;

# Fix DEPLOYMENT references (if needed)
find . -name "*.md" -not -path "./node_modules/*" -exec sed -i 's|/blob/main/DEPLOYMENT\.md|/blob/main/docs/DEPLOYMENT.md|g' {} \;
find . -name "*.md" -not -path "./node_modules/*" -exec sed -i 's|/blob/main/DEPLOYMENT-GUIDE\.md|/blob/main/docs/DEPLOYMENT.md|g' {} \;

# Verify no broken links remain
grep -r "blob/main/BANKS\.md" --include="*.md" . | grep -v "docs/BANKS"
grep -r "blob/main/DEPLOYMENT" --include="*.md" . | grep -v "docs/DEPLOYMENT"
```

---

## 📝 Notes

**Good News:** Most links were already fixed in PR #11!

This task is primarily about:
1. **Verification** - Ensure PR #11 fixes are working
2. **Docker Hub** - Confirm Docker Hub has updated README
3. **Internal links** - Check docs/ files don't have broken internal links
4. **Testing** - Systematically test all links

**If all links already work, this task is just verification and can be marked DONE quickly!**

---

## 🔗 Related Tasks

- PR #11 already fixed the main README.md links
- Task 05 (Enhanced releases) will include correct documentation links

---

## ⚡ Quick Verification Script

Run this to check current state:

```bash
#!/bin/bash
echo "Checking documentation links..."

# Check if files exist in correct locations
test -f docs/BANKS.md && echo "✅ docs/BANKS.md exists" || echo "❌ docs/BANKS.md missing"
test -f docs/DEPLOYMENT.md && echo "✅ docs/DEPLOYMENT.md exists" || echo "❌ docs/DEPLOYMENT.md missing"

# Check for any references to wrong paths
echo -e "\n🔍 Searching for potentially broken links..."
grep -r "blob/main/BANKS\.md" --include="*.md" . | grep -v "docs/BANKS" | grep -v node_modules
grep -r "blob/main/DEPLOYMENT" --include="*.md" . | grep -v "docs/DEPLOYMENT" | grep -v node_modules

echo -e "\n✅ Verification complete"
```

---

## 🎯 Expected Outcome

After verification/fixes:
- ✅ All documentation accessible from GitHub
- ✅ All documentation accessible from Docker Hub
- ✅ Users can follow links without 404 errors
- ✅ Professional, working documentation structure
