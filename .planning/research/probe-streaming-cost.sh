#!/usr/bin/env bash
# Probe: does OpenRouter's NATIVE Anthropic Messages endpoint emit `usage.cost`
# in the final streaming SSE event? (v1.3 research empirical check)
#
# SAFETY: hits OpenRouter only, with a non-Anthropic :free model. Never Anthropic.
# Usage:  OPENROUTER_API_KEY=sk-or-... ./probe-streaming-cost.sh
# Optional: MODEL=deepseek/deepseek-v4-flash ./probe-streaming-cost.sh
# Default is a PAID model (deepseek/deepseek-v4-flash) to confirm cost on a real billed request.

set -euo pipefail

: "${OPENROUTER_API_KEY:?Set OPENROUTER_API_KEY (sk-or-...) — your OpenRouter key}"
MODEL="${MODEL:-deepseek/deepseek-v4-flash}"

echo "== Probing https://openrouter.ai/api/v1/messages (streaming) with model: $MODEL =="
echo "== Looking for usage.cost in the final SSE events ==" >&2

# Note: "usage":{"include":true} opts into OpenRouter usage accounting (cost field).
RAW=$(curl -sS -N https://openrouter.ai/api/v1/messages \
  -H "Authorization: Bearer ${OPENROUTER_API_KEY}" \
  -H "Content-Type: application/json" \
  -H "anthropic-version: 2023-06-01" \
  -d "{
    \"model\": \"${MODEL}\",
    \"max_tokens\": 32,
    \"stream\": true,
    \"usage\": { \"include\": true },
    \"messages\": [{ \"role\": \"user\", \"content\": \"Say hi in 3 words.\" }]
  }")

echo "----- LAST 25 LINES OF SSE STREAM -----"
printf '%s\n' "$RAW" | tail -25

echo
echo "----- usage / cost occurrences -----"
if printf '%s\n' "$RAW" | grep -Eo '"cost"[^,}]*' | head; then
  echo "==> 'cost' FOUND in stream (hypothesis CONFIRMED: real cost available on native streaming)"
else
  echo "==> 'cost' NOT found. Try without :free model, or confirm usage.include is honored."
fi
echo
echo "----- which SSE event(s) carry usage -----"
printf '%s\n' "$RAW" | grep -nE '^event:|"usage"' | tail -15
