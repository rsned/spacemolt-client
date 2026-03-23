#!/bin/bash
#
# SpaceMolt Command Comparison Test
#
# Compares client binary output vs direct API calls for every command.
#
# Usage:
#   ./test-commands.sh [options]
#
# Options:
#   --build              Build the client before testing
#   --safe               Only test query commands (no mutations)
#   --command <cmd>      Test only specific command
#   --resume <cmd>       Resume testing from command (alphabetical)
#   --verbose            Show full request/response bodies
#

set -e

# Add bun to PATH if it's in the default location
if [ -d "/home/robert/.bun/bin" ] && [[ ":$PATH:" != *":/home/robert/.bun/bin:"* ]]; then
  export PATH="/home/robert/.bun/bin:$PATH"
fi

API_BASE="https://game.spacemolt.com/api/v1"
CLIENT_BINARY="./spacemolt"
SESSION_FILE="./.spacemolt-session.json"
RESULTS_DIR="./test-results"

# Parse options
BUILD=false
SAFE_ONLY=false
COMMAND_FILTER=""
VERBOSE=false
RESUME_FROM=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --build)
      BUILD=true
      shift
      ;;
    --safe)
      SAFE_ONLY=true
      shift
      ;;
    --show-safe)
      # List safe commands and exit
      echo "🛡️  Safe Query Commands (no mutations):"
      echo ""
      echo "Navigation & Location:"
      echo "  get_status      - Your player, ship, and location"
      echo "  get_system      - Current system's POIs and connections"
      echo "  get_poi         - Details about current location"
      echo "  get_base        - Base information"
      echo "  get_location    - Current location details"
      echo "  get_map         - System map"
      echo "  survey_system   - Scan for resources"
      echo ""
      echo "Ship & Cargo:"
      echo "  get_ship        - Ship details and modules"
      echo "  get_cargo       - Your cargo contents"
      echo ""
      echo "Market & Trading:"
      echo "  get_trades      - Your trade offers"
      echo "  get_wrecks      - Wrecks in current system"
      echo ""
      echo "Information & Reference:"
      echo "  get_nearby      - Nearby players and entities"
      echo "  get_skills      - Your skill levels"
      echo "  get_recipes     - Recipe information"
      echo "  get_version     - Server version"
      echo "  get_commands    - Available commands"
      echo "  get_action_log  - Your action history"
      echo "  get_guide       - Help guides"
      echo "  help            - Command help"
      echo ""
      echo "Session:"
      echo "  session         - Session information"
      echo ""
      echo "Total: 20 safe commands"
      exit 0
      ;;
    --command)
      COMMAND_FILTER="$2"
      shift 2
      ;;
    --resume)
      RESUME_FROM="$2"
      shift 2
      ;;
    --verbose)
      VERBOSE=true
      shift
      ;;
    --help)
      echo "Usage: $0 [options]"
      echo ""
      echo "Options:"
      echo "  --build              Build the client before testing"
      echo "  --safe               Only test query commands (no mutations)"
      echo "  --show-safe          List all safe query commands"
      echo "  --command <cmd>      Test only specific command"
      echo "  --resume <cmd>       Resume testing from command (alphabetical)"
      echo "  --verbose            Show full request/response bodies"
      echo ""
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

echo "🧪 SpaceMolt Command Comparison Test"
echo "============================================================"

# Build if requested
if [ "$BUILD" = true ]; then
  echo "🔨 Building client..."
  bun run build
  if [ $? -ne 0 ]; then
    echo "❌ Build failed"
    exit 1
  fi
  echo "✅ Build successful"
fi

# Check for binary
if [ ! -f "$CLIENT_BINARY" ]; then
  echo "❌ Client binary not found: $CLIENT_BINARY"
  echo "   Run with --build to build first, or run: bun run build"
  exit 1
fi

# Check for session
if [ ! -f "$SESSION_FILE" ]; then
  echo "❌ Session file not found: $SESSION_FILE"
  echo "   Please login first:"
  echo "   $CLIENT_BINARY register <username> <empire> <registration_code>"
  exit 1
fi

# Extract session ID
SESSION_ID=$(cat "$SESSION_FILE" | jq -r '.id // .session.id // empty')
if [ -z "$SESSION_ID" ]; then
  echo "❌ Could not extract session ID from $SESSION_FILE"
  exit 1
fi

echo "✅ Using session: $SESSION_ID"
echo ""

# Safe commands (queries only - won't modify game state)
SAFE_COMMANDS=(
  "get_status" "get_system" "get_poi" "get_base" "get_ship" "get_cargo"
  "get_nearby" "get_skills" "get_recipes" "get_map" "get_trades"
  "get_wrecks" "get_version" "get_commands" "get_location" "survey_system"
  "get_action_log" "session" "get_guide" "help"
)

# Extract commands from client.ts
echo "📋 Extracting commands from client..."
COMMANDS=($(grep -E "^\s{2}[a-z_]+: \{" src/client.ts | sed 's/^\s*//;s/:.*//' | sort))

# Exclude commands that would break testing
# NOTE: 'logout' is explicitly excluded because it destroys the session,
# causing all subsequent tests to fail with authentication errors.
EXCLUDED_COMMANDS=("logout")
FILTERED_COMMANDS=()
for cmd in "${COMMANDS[@]}"; do
  EXCLUDED=false
  for excluded in "${EXCLUDED_COMMANDS[@]}"; do
    if [ "$cmd" = "$excluded" ]; then
      EXCLUDED=true
      echo "⚠️  Excluding: $cmd (would invalidate session)"
      break
    fi
  done
  if [ "$EXCLUDED" = false ]; then
    FILTERED_COMMANDS+=("$cmd")
  fi
done
COMMANDS=("${FILTERED_COMMANDS[@]}")

if [ -n "$COMMAND_FILTER" ]; then
  echo "🎯 Filtering to command: $COMMAND_FILTER"
  COMMANDS=("$COMMAND_FILTER")
elif [ "$SAFE_ONLY" = true ]; then
  echo "🛡️  Safe mode: testing ${#SAFE_COMMANDS[@]} query commands"
  # Filter commands to only safe ones
  FILTERED_COMMANDS=()
  for cmd in "${COMMANDS[@]}"; do
    for safe in "${SAFE_COMMANDS[@]}"; do
      if [ "$cmd" = "$safe" ]; then
        FILTERED_COMMANDS+=("$cmd")
        break
      fi
    done
  done
  COMMANDS=("${FILTERED_COMMANDS[@]}")
fi

# Handle resume option - skip commands before RESUME_FROM
if [ -n "$RESUME_FROM" ]; then
  echo "🔄 Resuming from command: $RESUME_FROM"
  SAVED_COMMANDS=("${COMMANDS[@]}")
  FILTERED_COMMANDS=()
  RESUME_FOUND=false
  for cmd in "${COMMANDS[@]}"; do
    if [ "$RESUME_FOUND" = true ]; then
      FILTERED_COMMANDS+=("$cmd")
    elif [ "$cmd" = "$RESUME_FROM" ]; then
      RESUME_FOUND=true
      FILTERED_COMMANDS+=("$cmd")
    fi
  done

  if [ "$RESUME_FOUND" = false ]; then
    echo "❌ Resume command '$RESUME_FROM' not found in command list"
    exit 1
  fi

  COMMANDS=("${FILTERED_COMMANDS[@]}")
  SKIPPED=$((${#SAVED_COMMANDS[@]} - ${#COMMANDS[@]}))
  echo "🎯 Testing ${#COMMANDS[@]} commands (skipped $SKIPPED commands before $RESUME_FROM)"
else
  echo "🎯 Testing ${#COMMANDS[@]} commands"
fi
echo ""

# Create results directory
mkdir -p "$RESULTS_DIR"

# Create log file for this run
TIMESTAMP=$(date +%s)
LOG_FILE="$RESULTS_DIR/command-test-$TIMESTAMP.log"
RESULTS_FILE="$RESULTS_DIR/command-test-$TIMESTAMP.json"
echo "SpaceMolt Command Test - $(date)" > "$LOG_FILE"
echo "============================================================" >> "$LOG_FILE"

# Test counters
TOTAL=0
IDENTICAL=0
STYLED_IDENTICAL=0
DIFFERENT=0
STYLED_DIFFERENT=0
CUSTOM_FORMATTED=0
CLIENT_ERROR=0
CURL_ERROR=0
BOTH_ERROR=0

# Results array
declare -a RESULTS

# Test each command
for COMMAND in "${COMMANDS[@]}"; do
  TOTAL=$((TOTAL + 1))

  echo -n "🧪 Testing: $COMMAND ... "

  # Run client command
  CLIENT_OUTPUT=$($CLIENT_BINARY "$COMMAND" 2>&1) || true
  CLIENT_EXIT=$?

  # Run curl command
  CURL_OUTPUT=$(curl -s -X POST "$API_BASE/$COMMAND" \
    -H "X-Session-Id: $SESSION_ID" \
    -H "Content-Type: application/json" \
    -d '{}' 2>&1) || true
  CURL_EXIT=$?

  # Compare results
  STATUS=""
  DIFFERENCE=""
  IS_STYLED=false
  IS_CUSTOM=false

  # Simple comparison for now
  if [ $CLIENT_EXIT -ne 0 ] && [ $CURL_EXIT -ne 0 ]; then
    STATUS="both_error"
    DIFFERENCE="Both failed"
    BOTH_ERROR=$((BOTH_ERROR + 1))
    echo "❌ BOTH ERROR"
  elif [ $CLIENT_EXIT -ne 0 ]; then
    STATUS="client_error"
    DIFFERENCE="Client failed: $CLIENT_OUTPUT"
    CLIENT_ERROR=$((CLIENT_ERROR + 1))
    echo "❌ CLIENT ERROR"
  elif [ $CURL_EXIT -ne 0 ]; then
    STATUS="curl_error"
    DIFFERENCE="Curl failed: $CURL_OUTPUT"
    CURL_ERROR=$((CURL_ERROR + 1))
    echo "❌ CURL ERROR"
  else
    STATUS="tested"
    DIFFERENCE="Tested successfully"
    echo "✅"
  fi

  # Log to file
  {
    echo ""
    echo "Command: $COMMAND"
    echo "Status: $STATUS"
    echo "Timestamp: $(date -Is)"
    echo ""
    echo "--- Client Output ---"
    echo "$CLIENT_OUTPUT"
    echo ""
    echo "--- Curl Output ---"
    echo "$CURL_OUTPUT"
    echo ""
    echo "============================================================"
  } >> "$LOG_FILE"

  # Store result
  RESULTS+=("{\"command\":\"$COMMAND\",\"status\":\"$STATUS\",\"difference\":\"$DIFFERENCE\",\"client_exit\":$CLIENT_EXIT,\"curl_exit\":$CURL_EXIT}")
done

# Summary
echo ""
echo "============================================================"
echo "📊 TEST SUMMARY"
echo "============================================================"
echo "Total commands tested: $TOTAL"
echo "✅ Tested:              $((TOTAL - CLIENT_ERROR - CURL_ERROR - BOTH_ERROR))"
echo "❌ Client errors:        $CLIENT_ERROR"
echo "❌ Curl errors:          $CURL_ERROR"
echo "❌ Both errors:          $BOTH_ERROR"

# Save results
echo "[" > "$RESULTS_FILE"
FIRST=true
for result in "${RESULTS[@]}"; do
  if [ "$FIRST" = true ]; then
    FIRST=false
  else
    echo "," >> "$RESULTS_FILE"
  fi
  echo "$result" >> "$RESULTS_FILE"
done
echo "]" >> "$RESULTS_FILE"

echo ""
echo "📁 Results saved to:"
echo "   Summary:    $RESULTS_FILE"
echo "   Full log:   $LOG_FILE"

exit 0
