# 📋 Tasks

This folder contains detailed task documentation for future improvements to the Israeli Bank Importer.

---

## 🎯 Task List

| # | Task | Priority | Effort | Status |
|---|------|----------|--------|--------|
| 01 | [Add Unit Tests + GitHub Actions CI](01-add-unit-tests.md) | 🔴 HIGH | 2-3 days | 📋 TODO |
| 02 | [Extract Transaction Service](02-extract-transaction-service.md) | 🟢 LOW | 2-3 hours | 📋 TODO |
| 03 | [Add Notifications (Telegram)](03-add-notifications.md) | 🟡 MEDIUM | 4-5 hours | 📋 TODO |
| 04 | [Centralize Utilities (DRY)](04-centralize-utilities.md) | 🟢 LOW | 30 min | 📋 TODO |

---

## 🚀 Getting Started

1. **Pick a task** - Start with Task 04 (easiest) or Task 01 (most important)
2. **Read the task file** - Each task has detailed steps
3. **Create a branch** - `git checkout -b task-XX-description`
4. **Follow the steps** - Implement as documented
5. **Test thoroughly** - Manual + unit tests
6. **Create PR** - Link to task file in description
7. **Update status** - Mark as ✅ DONE in this README

---

## 📊 Priority Legend

- 🔴 **HIGH** - Important for quality/reliability
- 🟡 **MEDIUM** - Improves UX/maintainability
- 🟢 **LOW** - Nice to have, not critical
- 🟠 **OPTIONAL** - Only if needed

---

## 🔄 Status Legend

- 📋 **TODO** - Not started
- 🚧 **IN PROGRESS** - Currently working on it
- 🔍 **IN REVIEW** - PR created, awaiting review
- ✅ **DONE** - Completed and merged

---

## 💡 Recommended Order

### For Quality First (Recommended)
1. **Task 04** (30 min warm-up - DRY utilities)
2. **Task 01** (foundation - tests + CI/CD)
3. **Task 02** (refactoring - clean code)
4. **Task 03** (feature - notifications)

### For Features First
1. **Task 04** (quick win)
2. **Task 03** (useful notifications)
3. **Task 02** (cleaner code)
4. **Task 01** (protect your work)

---

## 🎯 Task 01 Highlights

**Most Important Task:**
- Adds unit tests for all services
- **GitHub Actions CI/CD integration**
- Runs tests automatically on every push/PR
- Blocks merges if tests fail
- Generates coverage reports
- Professional development workflow

---

## 📝 Task Template

When creating new tasks, use this template:

```markdown
# Task XX: Task Name

**Priority:** 🔴/🟡/🟢/🟠
**Effort:** X hours/days
**Status:** 📋 TODO

## 🎯 Goal
## 📝 Requirements
## 📦 Dependencies to Add
## 🗂️ Files to Create/Modify
## 📋 Implementation Steps
## ✅ Acceptance Criteria
## 🧪 Testing
## 🔗 Related Tasks
## 📝 Notes
```

---

## 🤝 Contributing

Feel free to:
- ✅ Pick any task and work on it
- ✅ Suggest new tasks (create PR with new task file)
- ✅ Improve existing task documentation
- ✅ Ask questions via issues

---

## 📚 Resources

- [Main README](../README.md)
- [CHANGELOG](../CHANGELOG.md)
- [GitHub Actions Workflows](../.github/workflows/)
- [Docker Hub](https://hub.docker.com/r/sergienko4/israeli-bank-importer)

---

**Last Updated:** 2026-02-18
