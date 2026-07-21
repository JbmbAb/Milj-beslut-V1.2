#!/bin/bash
# staging-setup.sh — Initialize and run staging E2E tests

set -e

echo "🚀 Staging E2E Setup"
echo "===================="

# 1. Check environment
echo "✓ Checking prerequisites..."
if ! command -v node &> /dev/null; then
  echo "❌ Node.js required"
  exit 1
fi

if ! command -v npx &> /dev/null; then
  echo "❌ npm required"
  exit 1
fi

# 2. Load staging config
echo "✓ Loading staging configuration..."
if [ ! -f .env.staging ]; then
  echo "❌ .env.staging not found"
  exit 1
fi
export $(cat .env.staging | xargs)

# 3. Ensure Playwright installed
echo "✓ Installing Playwright browsers..."
npx playwright install --with-deps 2>/dev/null || true

# 4. Check if local server running
echo "✓ Checking if dev server is running on $PLAYWRIGHT_BASE_URL..."
if ! curl -s "$PLAYWRIGHT_BASE_URL/health" > /dev/null 2>&1; then
  echo "⚠️  Dev server not running. Start with: npm run dev"
  echo "   Then run this script again"
  exit 1
fi

# 5. Run Fas 4 E2E tests sequentially
echo ""
echo "🧪 Running Fas 4 E2E Tests (Staging Proof)"
echo "=========================================="
echo ""

MODULES=(
  "staging-enskilt-avlopp.spec.ts:Sewage (enskilt avlopp)"
  "staging-c-anmalan-mass.spec.ts:Mass (C-anmälan)"
  "staging-lokaliseringsutredning.spec.ts:Localization (lokaliseringsutredning)"
)

PASSED=0
FAILED=0

for module in "${MODULES[@]}"; do
  FILE=$(echo $module | cut -d: -f1)
  NAME=$(echo $module | cut -d: -f2)

  echo "▶️  Testing: $NAME"
  echo "   File: tests/e2e/$FILE"

  if npm run e2e:staging -- "tests/e2e/$FILE" 2>&1 | tail -20; then
    echo "✅ PASSED: $NAME"
    ((PASSED++))
  else
    echo "❌ FAILED: $NAME"
    ((FAILED++))
  fi
  echo ""
done

# 6. Summary
echo "📊 E2E Test Summary"
echo "=================="
echo "✅ Passed: $PASSED/3"
echo "❌ Failed: $FAILED/3"

if [ $FAILED -eq 0 ]; then
  echo ""
  echo "🎉 All Fas 4 E2E tests passed!"
  echo "✨ Platform ready for production deployment"
  exit 0
else
  echo ""
  echo "⚠️  Some tests failed. Review logs above."
  exit 1
fi
