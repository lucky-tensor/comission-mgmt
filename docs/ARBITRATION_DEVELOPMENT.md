# Arbitration & Simulation Development Guide

This guide explains how to develop the arbitration and producer simulation features in parallel using separate worktrees and branches.

## Features Overview

| # | Title | Branch | Worktree | Status |
|---|-------|--------|----------|--------|
| **186** | Dispute Arbitration Engine — AI-driven payout recommendations | `feat/186-dispute-arbitration-engine-ai-driven-payout-reco` | `/tmp/superfield-worktrees/comission-mgmt/feat-186-dispute-arbitration` | Closed (In Plan) |
| **187** | Producer Deal Simulation — payout + dispute-risk forecasting | `feat/187-producer-deal-simulation-payout-dispute-risk-for` | `/tmp/superfield-worktrees/comission-mgmt/feat-187-producer-simulation` | Closed (In Plan) |
| **188** | Worker Infrastructure — Claude API integration & task queue | `feat/188-dev-scout-arbitration-simulation-worker-infrastr` | `/tmp/superfield-worktrees/comission-mgmt/feat-188-worker-infrastructure` | Closed (In Plan) |

## Parallel Development Setup

### Switching Between Features

```bash
# Work on #186 (Dispute Arbitration)
cd /tmp/superfield-worktrees/comission-mgmt/feat-186-dispute-arbitration
git status

# Work on #187 (Producer Simulation)
cd /tmp/superfield-worktrees/comission-mgmt/feat-187-producer-simulation
git status

# Work on #188 (Worker Infrastructure)
cd /tmp/superfield-worktrees/comission-mgmt/feat-188-worker-infrastructure
git status

# Main repo (demo-data-integration and other work)
cd /home/lucas/superfield/demos/comission-mgmt
git status
```

### Each Worktree Has

- **Isolated git state** — separate HEAD, index, working tree
- **Independent npm/bun context** — run builds and tests without affecting other worktrees
- **Own node_modules** — dependencies cached per worktree (optional, can be shared)
- **Full history** — complete .git access (worktrees share the .git directory)

## Feature Descriptions

### #186: Dispute Arbitration Engine

**Purpose**: AI-driven payout recommendations for disputed commissions

**Current State**: Stub implementation in `apps/server/src/api/disputes.ts`
- Returns `501 Not Implemented` for dispute endpoints
- Database schema and core dispute logic exists
- Ready for AI integration

**Key Endpoints**:
- `POST /disputes/:id/arbitrate` — Submit dispute for AI arbitration
- `GET /disputes/:id` — Retrieve arbitration result
- `PATCH /disputes/:id` — Accept/reject arbitration recommendation

**Implementation Checklist**:
- [ ] Integrate Claude API (via #188 worker infrastructure)
- [ ] Build dispute analysis prompt (context from commission records, split history)
- [ ] Implement payout recommendation logic
- [ ] Add reasoning/explanation field to disputes
- [ ] Store arbitration result in database
- [ ] E2E test: Submit dispute → AI arbitration → Accept recommendation

**Key Files**:
- `apps/server/src/api/disputes.ts`
- `packages/db/src/disputes.ts`
- `packages/core/disputes.ts` (API contract)

---

### #187: Producer Deal Simulation

**Purpose**: Payout and dispute-risk forecasting for hypothetical and actual deals

**Current State**: Stub implementation in `apps/server/src/api/simulations.ts`
- Returns `501 Not Implemented` for simulation endpoints
- Ready for calculation and AI analysis

**Key Endpoints**:
- `POST /producer/simulations/actual` — Forecast on existing placement
- `POST /producer/simulations/hypothetical` — Custom deal parameters
- `GET /producer/simulations` — Simulation history

**Implementation Checklist**:
- [ ] Implement actual deal simulation (commission calculation)
- [ ] Implement hypothetical simulation (custom parameters)
- [ ] Integrate Claude API for dispute-risk scoring
- [ ] Generate plain-language reasoning (why this payout, risk factors)
- [ ] Cache simulation results
- [ ] E2E test: Simulate deal → Get payout + risk + reasoning

**Key Files**:
- `apps/server/src/api/simulations.ts`
- `packages/core/producer-simulation.ts` (API contract)
- `apps/web/src/components/portal/DealSimulator.tsx` (UI, already connected)

**Related Types**:
```typescript
interface DealSimulationForecast {
  payout_estimate: number;      // Calculated payout
  dispute_risk: string;          // e.g. "low", "medium", "high"
  reasoning: string;             // AI explanation
}
```

---

### #188: Worker Infrastructure

**Purpose**: Backend infrastructure for Claude API integration and long-running tasks

**Current State**: Database schema exists (`worker_queue`, `simulation_runs`, `arbitration_results`)
- Ready to wire up Claude API client
- Queue mechanism in place

**Key Responsibilities**:
- [ ] Initialize Claude API client (via env ANTHROPIC_API_KEY)
- [ ] Worker queue consumer (poll, execute, store results)
- [ ] Task queue view API endpoints (for debugging/monitoring)
- [ ] Error handling and retry logic
- [ ] Timeout and circuit-breaker patterns

**Implementation Checklist**:
- [ ] Set up `AnthropicSDK` with proper model selection
- [ ] Implement worker queue processor (bun background task or separate worker service)
- [ ] Define prompt templates for dispute analysis and deal simulation
- [ ] Add monitoring/logging endpoints
- [ ] E2E test: Queue task → Worker processes → Result stored

**Key Files**:
- `packages/db/src/worker-queue.ts`
- `apps/worker/` (if separate worker service, or `apps/server/workers/`)
- `packages/core/worker.ts` (API contracts)

---

## Development Workflow

### For Each Feature

1. **Navigate to feature worktree**
   ```bash
   cd /tmp/superfield-worktrees/comission-mgmt/feat-NNN-description
   ```

2. **Check current state**
   ```bash
   git status
   git log --oneline -5
   ```

3. **Create a topic branch** (if not already on one)
   ```bash
   git checkout -b fix/186-implement-arbitration-analysis
   ```

4. **Make changes**
   ```bash
   # Edit files
   bun tsc --noEmit
   bunx eslint .
   ```

5. **Commit with clear messages**
   ```bash
   git commit -m "feat(#186): implement dispute arbitration prompt and analysis"
   ```

6. **Push to remote**
   ```bash
   git push origin fix/186-implement-arbitration-analysis
   ```

7. **Create PR**
   ```bash
   cd /home/lucas/superfield/demos/comission-mgmt  # Go back to main repo
   gh pr create --base feat/186-dispute-arbitration-engine-ai-driven-payout-reco \
     --title "feat(#186): implement dispute arbitration" \
     --body "..."
   ```

### For Integration Work

When features need to integrate (e.g., #187 calls #188):

```bash
# In #187 worktree
cd /tmp/superfield-worktrees/comission-mgmt/feat-187-producer-simulation

# Import types from #188
# Both worktrees share git history, so types are available
import { WorkerQueueTask } from 'db/worker-queue'
```

## Dependency Graph

```
#187 (Producer Simulation)
  ├─ depends on → #188 (Worker Infrastructure)
  │                └─ Claude API client
  │                └─ Task queue
  │                └─ Result storage
  └─ depends on → commission calculation (existing)

#186 (Dispute Arbitration)
  ├─ depends on → #188 (Worker Infrastructure)
  │                └─ Claude API client
  │                └─ Task queue
  │                └─ Result storage
  └─ depends on → dispute schema (existing)
```

**Development Order**:
1. Start with **#188** (foundation)
2. Parallel: **#186** and **#187** (both depend on #188)

## Testing

### Unit Tests (per worktree)
```bash
cd /tmp/superfield-worktrees/comission-mgmt/feat-187-producer-simulation
bun test tests/api/producer-simulations/
```

### Integration Tests (via main repo after merge)
```bash
cd /home/lucas/superfield/demos/comission-mgmt
bun test tests/e2e/stories/producer.stories.e2e.ts
```

### Manual Testing (after local-demo)
```bash
bun run local-demo
# Open http://localhost:4600
# Navigate to Producer → Tools → Deal Simulator
# Test actual/hypothetical simulations
```

## Syncing Between Worktrees

Since all worktrees share the git directory:

```bash
# Fetch latest from all branches
git fetch origin

# In each worktree, you can see all branches
git branch -a

# Rebase on latest main if needed
git rebase origin/main
```

## Cleanup

When a feature is complete and merged:

```bash
# Remove worktree
git worktree remove /tmp/superfield-worktrees/comission-mgmt/feat-186-dispute-arbitration

# Verify
git worktree list
```

## Common Issues

### "Worktree locked" error
```bash
# If a worktree process crashes, it leaves a lock file
rm /path/to/worktree/.git
git worktree prune
```

### "Git detached HEAD"
```bash
# If rebasing, you might end up detached
git checkout feat/186-dispute-arbitration-engine-ai-driven-payout-reco
git rebase origin/main
```

### Conflicts when syncing branches
```bash
# Resolve in the worktree, then push
git add .
git commit -m "chore: resolve merge conflicts"
git push origin feat/186-dispute-arbitration-engine-ai-driven-payout-reco
```

## References

- **Issues**: #186 (Arbitration), #187 (Simulation), #188 (Infrastructure)
- **Phase**: `arbitration-simulation` (in Plan)
- **API Docs**: docs/prd.md §5.12 (AI-driven features)
- **Architecture**: docs/architecture/phase-arbitration-simulation.md (if exists)
- **Claude API**: https://docs.anthropic.com/claude/

---

**Last Updated**: 2026-06-17
**Worktree Locations**: `/tmp/superfield-worktrees/comission-mgmt/feat-{186,187,188}-*`
