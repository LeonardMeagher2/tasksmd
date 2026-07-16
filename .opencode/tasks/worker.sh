#!/bin/sh
# OpenCode tasks worker — POSIX shell
# Scheduled every 5 min by launchd/systemd.
# Reads TASKS.md, picks up [ ] tasks, runs them one at a time.

set -eu

PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export PROJECT_ROOT

TASKS_FILE="$PROJECT_ROOT/TASKS.md"
TASKS_DIR="$PROJECT_ROOT/.tasks"
STATE_DIR="$TASKS_DIR/.state"

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
CONFIG_FILE="$TASKS_DIR/config"
OPENCODE_BIN=""
SERVER_URL="${OPENCODE_TASKS_SERVER_URL:-}"
if [ -f "$CONFIG_FILE" ]; then
  OPENCODE_BIN="$(sed -n 's/^opencode_path=//p' "$CONFIG_FILE" | head -1)"
  if [ -z "$SERVER_URL" ]; then
    SERVER_URL="$(sed -n 's/^server_url=//p' "$CONFIG_FILE" | head -1)"
  fi
fi
if [ -z "$OPENCODE_BIN" ]; then
  OPENCODE_BIN="$(command -v opencode 2>/dev/null || true)"
fi
if [ -z "$OPENCODE_BIN" ] || [ ! -x "$OPENCODE_BIN" ]; then
  echo "opencode binary not found; update $CONFIG_FILE"
  exit 1
fi

mkdir -p "$STATE_DIR"

# ── Helpers ────────────────────────────────────────────

slugify() {
  echo "$1" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/^-\+//;s/-\+$//' | cut -c1-60
}

extract_link_text() {
  echo "$1" | sed -n 's/.*\[\([^]]*\)\]([^)]*).*/\1/p'
}

extract_link_path() {
  echo "$1" | sed -n 's/.*\[[^]]*\](\([^)]*\)).*/\1/p'
}

get_frontmatter_body() {
  awk 'BEGIN{c=0} /^---$/{c++;next} c>=2' "$TASKS_FILE"
}

frontmatter_key() {
  awk -v k="$1" '
    BEGIN{c=0} /^---$/{c++;next}
    c==1 { key=$1; sub(/:$/,"",key); if(tolower(key)==tolower(k)) {sub(/^[^:]*:[[:space:]]*/,""); print; exit} }
  ' "$TASKS_FILE"
}

is_process_alive() {
  kill -0 "$1" 2>/dev/null
}

# ── Read config ───────────────────────────────────────

if [ ! -f "$TASKS_FILE" ]; then
  echo "No TASKS.md found."
  exit 0
fi

DEFAULT_MODEL="$(frontmatter_key model || true)"
MAX_ACTIVE="${MAX_ACTIVE:-$(frontmatter_key max_active || true)}"
MAX_ACTIVE="${MAX_ACTIVE:-1}"

# ── Find next task ────────────────────────────────────

BODY_TMP=$(mktemp)
get_frontmatter_body > "$BODY_TMP" || true

TASK_IDX=""
TASK_RAW=""
IS_RETRY=false
line_num=0

# Priority 1: stale [~] whose worker process is dead
while IFS= read -r line || [ -n "$line" ]; do
  line_num=$((line_num + 1))
  state=""
  case "$line" in
    "- [~]"*) state="active" ;;
    "- [ ]"*) state="pending" ;;
    "- [x]"*) state="done" ;;
  esac
  [ -z "$state" ] && continue

  raw="${line#"- [~] "}"
  [ "$raw" = "$line" ] && raw="${line#"- [ ] "}"
  [ "$raw" = "$line" ] && raw="${line#"- [x] "}"

  if [ "$state" = "active" ]; then
    slug="$(slugify "$(extract_link_text "$raw" || echo "$raw")")"
    state_file="$STATE_DIR/$slug.md"
    if [ -f "$state_file" ]; then
      status="$(sed -n 's/^status:[[:space:]]*//p' "$state_file" | head -1)"
      pid="$(sed -n 's/^pid:[[:space:]]*\([0-9]*\).*/\1/p' "$state_file")"
      if [ "$status" = success ]; then
        continue
      fi
      if [ "${status:-running}" = running ] && [ -n "$pid" ] && is_process_alive "$pid"; then
        echo "Task $slug is still running (pid $pid). Skipping."
        rm -f "$BODY_TMP"
        exit 0
      fi
    fi
    TASK_IDX=$line_num; TASK_RAW="$raw"; IS_RETRY=true
    break
  fi
done < "$BODY_TMP"

if [ -z "$TASK_IDX" ] && ! "$IS_RETRY"; then
  active_count="$(grep -c '^- \[~\]' "$BODY_TMP" 2>/dev/null || true)"
  if [ "$active_count" -ge "$MAX_ACTIVE" ]; then
    echo "Active tasks ($active_count) >= max_active ($MAX_ACTIVE). Exiting."
    rm -f "$BODY_TMP"
    exit 0
  fi

  line_num=0
  while IFS= read -r line || [ -n "$line" ]; do
    line_num=$((line_num + 1))
    case "$line" in
      "- [ ]"*)
        raw="${line#"- [ ] "}"
        TASK_IDX=$line_num; TASK_RAW="$raw"
        break
        ;;
    esac
  done < "$BODY_TMP"
fi

rm -f "$BODY_TMP"

if [ -z "$TASK_IDX" ]; then
  echo "No pending tasks."
  exit 0
fi

link_text="$(extract_link_text "$TASK_RAW" || echo "")"
SLUG="$(slugify "${link_text:-$TASK_RAW}")"
echo "Task: $TASK_RAW"
echo "Slug: $SLUG"
echo "Retry: $IS_RETRY"

# ── Resolve prompt, model, session ────────────────────

MODEL="$DEFAULT_MODEL"
PROMPT=""
SESSION_ID=""

link_path="$(extract_link_path "$TASK_RAW" || echo "")"
if [ -n "$link_path" ]; then
  task_file="$PROJECT_ROOT/$link_path"
  if [ ! -f "$task_file" ]; then
    echo "Linked task file not found: $task_file"
    exit 1
  fi
  task_model="$(awk 'BEGIN{c=0} /^---$/{c++;next} c==1 && /^model:/{print $2; exit}' "$task_file")"
  MODEL="${task_model:-$DEFAULT_MODEL}"
  PROMPT="$TASK_RAW"
else
  PROMPT="$TASK_RAW"
fi

PROMPT="@tasks\n\nTask from TASKS.md:\n$PROMPT"

state_file="$STATE_DIR/$SLUG.md"
if [ "$IS_RETRY" = true ] && [ -f "$state_file" ]; then
  SESSION_ID="$(sed -n 's/^session:[[:space:]]*//p' "$state_file")"
fi

# ── Mark as in-progress ───────────────────────────────

if [ "$IS_RETRY" = false ]; then
  body_start="$(awk 'BEGIN{c=0} /^---$/{c++;next} c==2{print NR; exit}' "$TASKS_FILE")"
  body_start="${body_start:-1}"
  tmp_edit=$(mktemp)
  awk -v idx="$TASK_IDX" -v start="$body_start" '
    NR < start { print; next }
    NR == start + idx - 1 { sub(/^- \[ \]/, "- [~]") }
    { print }
  ' "$TASKS_FILE" > "$tmp_edit" && mv "$tmp_edit" "$TASKS_FILE"
fi

# ── Run opencode ──────────────────────────────────────

OUTPUT_FILE=$(mktemp)

set -- "run" "--auto" "--format" "json" "--title" "task:$SLUG"
[ -n "$SERVER_URL" ] && set -- "$@" "--attach" "$SERVER_URL"
set -- "$@" "--agent" "build"
[ -n "$MODEL" ] && set -- "$@" "--model" "$MODEL"
if [ -n "$SESSION_ID" ]; then
  set -- "$@" "--session" "$SESSION_ID"
else
  set -- "$@" "$PROMPT"
fi

echo "Running: $OPENCODE_BIN $*"

(cd "$PROJECT_ROOT" && "$OPENCODE_BIN" "$@" > "$OUTPUT_FILE" 2>&1) &
CHILD_PID=$!

printf 'pid: %s\nstatus: running\n' "$CHILD_PID" > "$state_file"

set +e; wait "$CHILD_PID"; EXIT_CODE=$?; set -e

OUTPUT="$(cat "$OUTPUT_FILE" 2>/dev/null || true)"
SESSION_ID="$(echo "$OUTPUT" | grep -o '"sessionID":"[^"]*"' | head -1 | cut -d'"' -f4 || true)"
rm -f "$OUTPUT_FILE"

cat > "$state_file" <<- ENDSTATE
pid: $CHILD_PID
session: ${SESSION_ID:-}
status: $([ "$EXIT_CODE" = 0 ] && echo success || echo failed)
exit_code: $EXIT_CODE

output:
$(echo "$OUTPUT" | head -c 2000)
ENDSTATE

# ── Handle result ─────────────────────────────────────

if [ "$EXIT_CODE" = 0 ]; then
  echo "Task finished: $SLUG (review and mark [x] when complete)"
else
  echo "Failed (exit $EXIT_CODE). State saved."
fi

exit "$EXIT_CODE"
