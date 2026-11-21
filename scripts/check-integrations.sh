#!/usr/bin/env bash
# Check which third-party integrations are configured across all four apps.
#
# Usage: bash scripts/check-integrations.sh
#
# Exit code 0 = all required keys present, 1 = something missing.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

apps=(
  "SchoolAI:$ROOT/school-mis"
  "SpectrumAI:$ROOT/autism"
  "DiagnoAI:$ROOT/LabRegisters/saas-starter"
  "NucleoAI:$ROOT/complete apps/Nucleo-one"
)

# key|required|description
keys=(
  "DATABASE_URL|yes|Postgres connection string"
  "BETTER_AUTH_SECRET|yes|Session signing secret"
  "STRIPE_SECRET_KEY|yes|Stripe API key (sk_live_… for production)"
  "STRIPE_WEBHOOK_SECRET|yes|Stripe webhook signing secret"
  "RESEND_API_KEY|yes|Resend transactional email"
  "EMAIL_FROM|yes|Verified sender address"
  "OPENAI_API_KEY|no|AI features"
  "TWILIO_ACCOUNT_SID|no|SMS / WhatsApp"
  "TWILIO_AUTH_TOKEN|no|SMS / WhatsApp"
  "TWILIO_FROM_NUMBER|no|SMS / WhatsApp sender"
)

missing_required=0

read_env() {
  local dir="$1" key="$2"
  local value=""
  for f in "$dir/.env" "$dir/.dev.vars"; do
    [ -f "$f" ] || continue
    value="$(grep -E "^${key}=" "$f" 2>/dev/null | tail -1 | cut -d= -f2- | sed 's/^["'\'']//; s/["'\'']$//')"
    [ -n "$value" ] && break
  done
  printf '%s' "$value"
}

for entry in "${apps[@]}"; do
  name="${entry%%:*}"
  dir="${entry#*:}"
  echo ""
  echo "=== $name ==="
  if [ ! -d "$dir" ]; then
    echo "  (directory not found: $dir)"
    continue
  fi
  for spec in "${keys[@]}"; do
    key="${spec%%|*}"
    rest="${spec#*|}"
    required="${rest%%|*}"
    desc="${rest#*|}"
    value="$(read_env "$dir" "$key")"
    if [ -z "$value" ]; then
      if [ "$required" = "yes" ]; then
        echo "  ✗ $key — MISSING ($desc)"
        missing_required=$((missing_required + 1))
      else
        echo "  ○ $key — not set ($desc)"
      fi
    else
      # Flag test-mode Stripe keys.
      if [ "$key" = "STRIPE_SECRET_KEY" ] && [[ "$value" == sk_test_* ]]; then
        echo "  ! $key — set but TEST MODE (use sk_live_… for production)"
      else
        echo "  ✓ $key — set"
      fi
    fi
  done
done

echo ""
if [ "$missing_required" -eq 0 ]; then
  echo "All required keys are present."
  exit 0
else
  echo "$missing_required required key(s) missing. See .env.example in each app."
  exit 1
fi
