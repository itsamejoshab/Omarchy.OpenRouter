#!/usr/bin/env bash
# OpenRouter programming-model prices, without an API key.
#
# No args: GET ${OPENROUTER_API_BASE:-https://openrouter.ai/api/v1}/models
#   ?category=programming&sort=top-weekly
#   No Authorization header, no limit, and the response body's data array is
#   the models array, in that order. This script does not interpret prices.
#   Always exits 0 with {"ok":true,"models":[...]} or {"ok":false,"error":"..."}.
#
# load: print {"ok":true,"state": <object or null>} from price-history.json
#   beside today-spend.json. A missing, unreadable, or wrong-shaped file is
#   null state.
# save: read one JSON document on stdin and replace price-history.json
#   atomically (temp file in the same directory, then rename), mode 600.
#   The bytes written are the document passed in, not a recomputation.
#   Prints {"ok":true}.

set -uo pipefail

readonly CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
readonly STATE_DIR="$CONFIG_HOME/omarchy/openrouter"
readonly HISTORY_FILE="$STATE_DIR/price-history.json"
readonly API="${OPENROUTER_API_BASE:-https://openrouter.ai/api/v1}"

emit() {
  jq -n "$@"
  exit 0
}

fail() {
  emit --arg error "$1" '{ok: false, error: $error}'
}

command -v jq >/dev/null 2>&1 || {
  printf '{"ok":false,"error":"jq is not installed"}\n'
  exit 0
}

load_state() {
  if [[ ! -r $HISTORY_FILE ]]; then
    emit '{ok: true, state: null}'
  fi
  if jq -e 'type == "object"' "$HISTORY_FILE" >/dev/null 2>&1; then
    jq -n --argjson state "$(cat "$HISTORY_FILE")" '{ok: true, state: $state}'
    exit 0
  fi
  emit '{ok: true, state: null}'
}

save_state() {
  local doc tmp
  # One line. `read` returns on the newline instead of waiting for the writer
  # to close the pipe, and the timeout fails cleanly if nothing arrives.
  IFS= read -r -t 15 doc || doc="${doc:-}"
  jq -e 'type == "object"' >/dev/null 2>&1 <<<"$doc" || fail "Could not read price history"
  umask 077
  mkdir -p "$STATE_DIR" 2>/dev/null || fail "Could not create $STATE_DIR"
  tmp=$(mktemp "$STATE_DIR/.price-history.XXXXXX" 2>/dev/null) || fail "Could not write to $STATE_DIR"
  if ! printf '%s\n' "$doc" > "$tmp"; then
    rm -f "$tmp"
    fail "Could not write price history"
  fi
  chmod 600 "$tmp" 2>/dev/null
  if ! mv -f "$tmp" "$HISTORY_FILE"; then
    rm -f "$tmp"
    fail "Could not replace $HISTORY_FILE"
  fi
  emit '{ok: true}'
}

case "${1:-}" in
  load) load_state ;;
  save) save_state ;;
  "") ;;
  *) fail "Unknown prices command" ;;
esac

command -v curl >/dev/null 2>&1 || fail "curl is not installed"

HTTP_STATUS=""
HTTP_BODY=""

raw=$(
  printf 'silent\nshow-error\nmax-time = 12\nretry = 1\nuser-agent = "omarchy-openrouter/1.0"\nurl = "%s"\n' \
    "$API/models?category=programming&sort=top-weekly" | curl --config - --write-out $'\n%{http_code}' 2>/dev/null
) || true
HTTP_STATUS="${raw##*$'\n'}"
HTTP_BODY="${raw%$'\n'*}"
if [[ ! $HTTP_STATUS =~ ^[0-9]{3}$ ]]; then
  HTTP_STATUS="000"
  HTTP_BODY=""
fi

if [[ $HTTP_STATUS == 200 ]] && jq -e '.data | type == "array"' >/dev/null 2>&1 <<<"$HTTP_BODY"; then
  jq -c '{ok: true, models: .data}' <<<"$HTTP_BODY"
  exit 0
fi

message=$(jq -r 'if type == "object" then (.error.message // .message // empty) else empty end' <<<"$HTTP_BODY" 2>/dev/null || true)
if [[ -z $message ]]; then
  case $HTTP_STATUS in
    000) message="Could not reach openrouter.ai" ;;
    *) message="OpenRouter returned HTTP $HTTP_STATUS" ;;
  esac
fi
fail "$message"
