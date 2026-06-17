#!/bin/bash
##
# Switch to a feature worktree for arbitration/simulation development.
#
# Usage:
#   ./scripts/switch-worktree.sh 186    # Switch to dispute arbitration
#   ./scripts/switch-worktree.sh 187    # Switch to producer simulation
#   ./scripts/switch-worktree.sh 188    # Switch to worker infrastructure
#   ./scripts/switch-worktree.sh main   # Switch to main repo
#   ./scripts/switch-worktree.sh list   # List all worktrees
##

set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORKTREE_BASE="/tmp/superfield-worktrees/comission-mgmt"

case "${1:-help}" in
  186)
    TARGET="$WORKTREE_BASE/feat-186-dispute-arbitration"
    echo "Switching to #186 (Dispute Arbitration)..."
    ;;
  187)
    TARGET="$WORKTREE_BASE/feat-187-producer-simulation"
    echo "Switching to #187 (Producer Simulation)..."
    ;;
  188)
    TARGET="$WORKTREE_BASE/feat-188-worker-infrastructure"
    echo "Switching to #188 (Worker Infrastructure)..."
    ;;
  main)
    TARGET="$REPO_ROOT"
    echo "Switching to main repo..."
    ;;
  list)
    echo "=== Available Worktrees ==="
    git -C "$REPO_ROOT" worktree list
    exit 0
    ;;
  status)
    echo "=== Worktree Status ==="
    git -C "$REPO_ROOT" worktree list --porcelain
    exit 0
    ;;
  help|*)
    echo "Usage: ./scripts/switch-worktree.sh [186|187|188|main|list|status]"
    echo ""
    echo "Targets:"
    echo "  186    - Dispute Arbitration Engine"
    echo "  187    - Producer Deal Simulation"
    echo "  188    - Worker Infrastructure"
    echo "  main   - Main repository"
    echo "  list   - List all worktrees"
    echo "  status - Show worktree status"
    exit 0
    ;;
esac

if [ ! -d "$TARGET" ]; then
  echo "Error: Worktree not found at $TARGET"
  echo ""
  echo "Available worktrees:"
  git -C "$REPO_ROOT" worktree list
  exit 1
fi

# Show what we're switching to
echo "Worktree: $TARGET"
echo ""

# Try to use direnv if available, otherwise just cd
if command -v direnv &> /dev/null; then
  direnv allow "$TARGET" 2>/dev/null || true
fi

cd "$TARGET"
pwd
echo ""
git status --short
