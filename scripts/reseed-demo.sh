#!/bin/bash
##
# Reseed the demo with fresh data.
#
# This script:
# 1. Tears down the existing k3d cluster
# 2. Runs the full local-demo setup again from scratch
#
# The clean state ensures:
# - Database migrations run fresh
# - Phase 1 (identities) seeds properly
# - Phase 2 (encrypted commissions) runs through the API with all invoices marked Paid
# - All collection gates properly released
#
# Usage: ./scripts/reseed-demo.sh
##

set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

echo "🗑️  Tearing down old demo cluster..."
bun run local-demo &>/dev/null || true

echo "⏳ Waiting for cleanup..."
sleep 2

echo "🚀 Starting fresh demo setup..."
echo ""
bun run local-demo

echo ""
echo "✅ Demo reseeded successfully!"
echo ""
echo "Next: Open the demo URL and verify:"
echo "  - Producer sees multiple commissions with non-zero amounts"
echo "  - Manager sees all producers' commissions"
echo "  - HR shows correct draw balances"
echo "  - Executive sees financial position dashboard"
