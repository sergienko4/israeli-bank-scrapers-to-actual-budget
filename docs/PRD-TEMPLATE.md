# PRD: [Feature Name]

**Author:** [Name]
**Date:** YYYY-MM-DD
**Status:** Draft | In Review | Approved | In Progress | Done
**Task:** [Link to task file if applicable]

---

## 1. Context & Problem

_What problem does this solve? Why now? What triggered this work?_

---

## 2. Goals

_What does success look like? Be specific and measurable._

| Goal | Metric | Target |
|------|--------|--------|
| Example: Reduce import time | Average duration per bank | < 30s |

---

## 3. Non-Goals

_What is explicitly out of scope? This prevents scope creep._

- ...

---

## 4. User Stories

_Who benefits and how?_

- **As a** [user type], **I want** [action], **so that** [outcome]

---

## 5. Technical Design

### 5.1 Architecture

_How does this fit into the existing system? Include affected modules._

**Files to create:**
| File | Purpose |
|------|---------|
| `src/...` | ... |

**Files to modify:**
| File | Change |
|------|--------|
| `src/...` | ... |

### 5.2 Interfaces / API

_New or changed interfaces, types, function signatures._

```typescript
// Example
export interface INewService {
  method(param: Type): Promise<Result>;
}
```

### 5.3 Data Flow

_How data moves through the system. Use text diagrams if helpful._

```
Input -> Module A -> Module B -> Output
```

---

## 6. Evaluation

### 6.1 Why Do It

- ...

### 6.2 Why Not (Risks / Tradeoffs)

- ...

### 6.3 Alternatives Considered

| Option | Pros | Cons | Decision |
|--------|------|------|----------|
| A | ... | ... | Chosen / Rejected |
| B | ... | ... | Chosen / Rejected |

---

## 7. Implementation Plan

_Ordered steps. Each step should be a commit or small PR._

| # | Step | Files | Est. Effort |
|---|------|-------|-------------|
| 1 | ... | ... | ... |

---

## 8. Testing Strategy

| Test Type | What to Test | Expected Coverage |
|-----------|-------------|-------------------|
| Unit | ... | 80%+ |
| Integration | ... | Key flows |

---

## 9. Documentation Updates

_Which docs need updating after this change?_

- [ ] README.md
- [ ] CHANGELOG.md
- [ ] tasks/README.md
- [ ] Other: ...

---

## 10. Acceptance Criteria

_Checklist that must be true before this is considered done._

- [ ] ...
- [ ] All tests pass (`npm run validate`)
- [ ] Coverage thresholds met
- [ ] Documentation updated
- [ ] PR reviewed and merged

---

## 11. Open Questions

_Unresolved decisions that need input._

| Question | Options | Decision |
|----------|---------|----------|
| ... | A / B | Pending |
