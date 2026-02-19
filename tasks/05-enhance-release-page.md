# Task 05: Enhance GitHub Release Page

**Priority:** 🟡 MEDIUM
**Effort:** 2-3 hours
**Status:** 📋 TODO

---

## 🎯 Goal

Make GitHub release pages more informative and professional with detailed release notes, upgrade instructions, Docker tags, and useful metadata.

---

## 📝 Current State (Problems)

Currently the release page shows:
- ❌ Very minimal information
- ❌ Just extracted changelog (if exists)
- ❌ No Docker pull commands
- ❌ No upgrade instructions
- ❌ No breaking changes highlights
- ❌ Missing metadata (Docker image size, etc.)

---

## 🎯 Desired State

Release page should include:
- ✅ **Summary** - What's new in this release
- ✅ **Breaking Changes** - Highlighted prominently
- ✅ **New Features** - With emojis and descriptions
- ✅ **Bug Fixes** - Listed clearly
- ✅ **Docker Information**
  - Pull commands for different tags
  - Image size
  - Platform support (amd64, arm64)
- ✅ **Upgrade Instructions** - How to upgrade
- ✅ **Full Changelog** - Link to CHANGELOG.md
- ✅ **Contributors** - Thank contributors
- ✅ **Metrics** - Release stats (lines of code, files changed)

---

## 🗂️ Files to Create/Modify

### Modified Files
```
.github/workflows/docker-publish.yml (enhance create-release job)
CHANGELOG.md (ensure proper formatting)
```

### New Files
```
.github/release-template.md (optional - template for manual releases)
```

---

## 📋 Implementation Steps

### Step 1: Update Workflow Release Job
**File:** `.github/workflows/docker-publish.yml`

Replace the current `create-release` job with enhanced version:

```yaml
  create-release:
    runs-on: ubuntu-latest
    needs: [auto-version, build-and-push]
    if: needs.auto-version.outputs.new_tag != ''

    steps:
      - name: Checkout code
        uses: actions/checkout@v4
        with:
          ref: ${{ needs.auto-version.outputs.new_tag }}
          fetch-depth: 0  # Need full history for changelog

      - name: Get previous tag
        id: previous_tag
        run: |
          PREVIOUS_TAG=$(git describe --tags --abbrev=0 ${{ needs.auto-version.outputs.new_tag }}^ 2>/dev/null || echo "")
          echo "previous_tag=$PREVIOUS_TAG" >> $GITHUB_OUTPUT
          echo "Previous tag: $PREVIOUS_TAG"

      - name: Generate changelog
        id: changelog
        run: |
          VERSION="${{ needs.auto-version.outputs.new_tag }}"
          PREV_TAG="${{ steps.previous_tag.outputs.previous_tag }}"

          # Extract section from CHANGELOG.md
          awk "/## \[${VERSION#v}\]/{flag=1; next} /## \[/{flag=0} flag" CHANGELOG.md > release_changelog.md

          # If empty, generate from git commits
          if [ ! -s release_changelog.md ]; then
            echo "### Changes" > release_changelog.md
            if [ -n "$PREV_TAG" ]; then
              git log $PREV_TAG..$VERSION --pretty=format:"- %s" >> release_changelog.md
            else
              git log $VERSION --pretty=format:"- %s" >> release_changelog.md
            fi
          fi

      - name: Get Docker image metadata
        id: docker_meta
        run: |
          # Get image size (requires Docker Hub API or skip for now)
          # For now, we'll use placeholder
          echo "image_size=~1.5 GB" >> $GITHUB_OUTPUT
          echo "platforms=linux/amd64, linux/arm64" >> $GITHUB_OUTPUT

      - name: Count commits and changes
        id: stats
        run: |
          VERSION="${{ needs.auto-version.outputs.new_tag }}"
          PREV_TAG="${{ steps.previous_tag.outputs.previous_tag }}"

          if [ -n "$PREV_TAG" ]; then
            COMMIT_COUNT=$(git rev-list --count $PREV_TAG..$VERSION)
            FILES_CHANGED=$(git diff --name-only $PREV_TAG..$VERSION | wc -l)
            LINES_ADDED=$(git diff --shortstat $PREV_TAG..$VERSION | grep -oP '\d+(?= insertion)' || echo "0")
            LINES_DELETED=$(git diff --shortstat $PREV_TAG..$VERSION | grep -oP '\d+(?= deletion)' || echo "0")
          else
            COMMIT_COUNT=$(git rev-list --count HEAD)
            FILES_CHANGED="N/A"
            LINES_ADDED="N/A"
            LINES_DELETED="N/A"
          fi

          echo "commit_count=$COMMIT_COUNT" >> $GITHUB_OUTPUT
          echo "files_changed=$FILES_CHANGED" >> $GITHUB_OUTPUT
          echo "lines_added=$LINES_ADDED" >> $GITHUB_OUTPUT
          echo "lines_deleted=$LINES_DELETED" >> $GITHUB_OUTPUT

      - name: Build release body
        id: release_body
        run: |
          VERSION="${{ needs.auto-version.outputs.new_tag }}"
          cat > release_body.md <<'RELEASE_EOF'
          # 🎉 Israeli Bank Importer ${{ needs.auto-version.outputs.new_tag }}

          ## 📦 What's New

          $(cat release_changelog.md)

          ---

          ## 🐳 Docker Installation

          ### Quick Start
          ```bash
          # Pull the latest version
          docker pull sergienko4/israeli-bank-importer:${{ needs.auto-version.outputs.new_tag }}

          # Or use without 'v' prefix
          docker pull sergienko4/israeli-bank-importer:${VERSION#v}
          ```

          ### Docker Run
          ```bash
          docker run --rm --cap-add SYS_ADMIN \
            -v $(pwd)/config.json:/app/config.json \
            -v $(pwd)/data:/app/data \
            -v $(pwd)/cache:/app/cache \
            -v $(pwd)/chrome-data:/app/chrome-data \
            sergienko4/israeli-bank-importer:${{ needs.auto-version.outputs.new_tag }}
          ```

          ### Docker Compose
          ```yaml
          services:
            israeli_bank_importer:
              image: sergienko4/israeli-bank-importer:${{ needs.auto-version.outputs.new_tag }}
              restart: always
              cap_add:
                - SYS_ADMIN
              volumes:
                - ./config.json:/app/config.json:ro
                - ./data:/app/data
                - ./cache:/app/cache
                - ./chrome-data:/app/chrome-data
              environment:
                - TZ=Asia/Jerusalem
                - SCHEDULE=0 */8 * * *
          ```

          ---

          ## 📋 Available Docker Tags

          | Tag | Description | Use Case |
          |-----|-------------|----------|
          | `${{ needs.auto-version.outputs.new_tag }}` | Full semver with v prefix | Exact version pinning |
          | `${VERSION#v}` | Semver without v prefix | Version pinning |
          | `latest` | Always latest release | Auto-updates (not recommended for production) |

          ---

          ## 🔄 Upgrading from Previous Version

          ### If using specific version tag
          ```bash
          # Update docker-compose.yml to new version
          # Then pull and restart
          docker-compose pull
          docker-compose up -d
          ```

          ### If using latest tag
          ```bash
          # Just pull and restart
          docker-compose pull
          docker-compose up -d
          ```

          ### Configuration Changes
          Check [CHANGELOG.md](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/CHANGELOG.md#${VERSION#v}) for any breaking changes or new configuration options.

          ---

          ## 📊 Release Statistics

          - 📝 Commits: ${{ steps.stats.outputs.commit_count }}
          - 📂 Files changed: ${{ steps.stats.outputs.files_changed }}
          - ➕ Lines added: ${{ steps.stats.outputs.lines_added }}
          - ➖ Lines deleted: ${{ steps.stats.outputs.lines_deleted }}
          - 🐳 Image size: ${{ steps.docker_meta.outputs.image_size }}
          - 🖥️ Platforms: ${{ steps.docker_meta.outputs.platforms }}

          ---

          ## 📚 Documentation

          - [Main README](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget#readme)
          - [Supported Banks](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/BANKS.md)
          - [Deployment Guide](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/DEPLOYMENT.md)
          - [Security Guidelines](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/SECURITY.md)
          - [Full Changelog](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/CHANGELOG.md)

          ---

          ## 🙏 Contributors

          Thank you to everyone who contributed to this release! 🎉

          ---

          ## ⭐ Support This Project

          If this tool saves you time, please:
          - ⭐ Star the repository
          - 🐛 Report issues
          - 💡 Suggest improvements
          - 📢 Share with others

          ---

          ## 📦 Docker Hub

          View on Docker Hub: https://hub.docker.com/r/sergienko4/israeli-bank-importer

          ---

          **Full Changelog**: https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/compare/${{ steps.previous_tag.outputs.previous_tag }}...${{ needs.auto-version.outputs.new_tag }}
          RELEASE_EOF

          # Expand variables in the release body
          envsubst < release_body.md > release_body_final.md

      - name: Create GitHub Release
        uses: softprops/action-gh-release@v1
        with:
          tag_name: ${{ needs.auto-version.outputs.new_tag }}
          name: Israeli Bank Importer ${{ needs.auto-version.outputs.new_tag }}
          body_path: release_body_final.md
          draft: false
          prerelease: false
          generate_release_notes: false  # We create our own detailed notes
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### Step 2: Improve CHANGELOG.md Format
**File:** `CHANGELOG.md`

Ensure each version follows this structure:

```markdown
## [1.5.0] - 2026-02-20

### 🎉 Highlights
Brief summary of the most important changes

### ⚠️ Breaking Changes
- List any breaking changes here
- These will be extracted and highlighted

### ✨ New Features
- Feature 1 with emoji
- Feature 2 with emoji

### 🐛 Bug Fixes
- Fix 1
- Fix 2

### 📚 Documentation
- Doc updates

### 🔧 Internal
- Refactoring, code quality improvements
```

### Step 3: Add Release Template (Optional)
**File:** `.github/release-template.md`

For manual releases, provide a template:

```markdown
## 🎉 What's New

[Brief summary of changes]

### ⚠️ Breaking Changes
- [List breaking changes, or remove this section]

### ✨ New Features
- [Feature 1]
- [Feature 2]

### 🐛 Bug Fixes
- [Fix 1]
- [Fix 2]

---

## 🐳 Docker Installation

[Automated section - will be filled by workflow]

---

## 📚 Full Changelog

See [CHANGELOG.md](CHANGELOG.md) for complete details.
```

---

## ✅ Acceptance Criteria

- [ ] Release page shows comprehensive information
- [ ] Docker pull commands are present
- [ ] Upgrade instructions included
- [ ] Release statistics shown
- [ ] Links to documentation working
- [ ] Changelog properly formatted
- [ ] Breaking changes highlighted (if any)
- [ ] Multiple Docker tag options shown
- [ ] Contributors acknowledged
- [ ] Previous version comparison link present

---

## 🧪 Testing

### Test with Next Release
1. Make a change and commit
2. Merge to main (triggers auto-version)
3. Check the created release page
4. Verify all sections are present
5. Test Docker pull commands work
6. Check links are valid

### Manual Test (Optional)
```bash
# Create a test release manually
gh release create v1.4.1-test \
  --title "Test Release" \
  --notes-file release_body_final.md \
  --draft
```

---

## 📊 Before/After Comparison

### Before (Current State)
```
# Release v1.0.3

## Summary
- Add comprehensive security test results for v1.4.1
- Security Update v1.4.1 - Comprehensive security hardening

Co-Authored-By: Claude Sonnet 4.5 (1M context) <noreply@anthropic.com>
```
**Problems:** Minimal info, no Docker commands, no upgrade guide

### After (Enhanced State)
```
# 🎉 Israeli Bank Importer v1.0.3

## 📦 What's New
[Detailed changelog with categories]

## 🐳 Docker Installation
[Pull commands, docker-compose example]

## 📋 Available Docker Tags
[Table of tag options]

## 🔄 Upgrading
[Clear upgrade instructions]

## 📊 Release Statistics
[Commit count, lines changed, etc.]

## 📚 Documentation
[Links to all docs]

## 🙏 Contributors
[Thank contributors]
```
**Benefits:** Professional, informative, actionable

---

## 🔗 Related Tasks

- None (standalone improvement)

---

## 💡 Future Enhancements

Add in later releases:
- Automatic contributor list from git
- Benchmark comparisons (if metrics tracked)
- Security scan results summary
- Dependency updates list
- Migration guide for breaking changes
- Video demo/screenshot (if applicable)

---

## 📝 Notes

- Use environment variable substitution for dynamic values
- Keep format consistent across all releases
- Breaking changes should be prominently displayed
- Docker commands should be copy-paste ready
- Test release creation before merging

---

## 🎨 Example Enhanced Release

See this example for reference:
https://github.com/actualbudget/actual/releases/tag/v26.2.0

Good release pages include:
- Clear what's new summary
- Installation/upgrade instructions
- Docker/npm commands
- Breaking changes highlighted
- Contributors thanked
- Links to documentation
