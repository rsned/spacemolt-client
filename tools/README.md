# SpaceMolt Testing Tools

This directory contains automated testing tools to compare the SpaceMolt client binary against direct API calls.

## Overview

### `test-commands.sh` - Bash Test Script

Quick bash script that tests all commands and compares outputs against direct API calls.

**Requirements:**
- `bash` - Standard shell
- `jq` - JSON processor for comparison
- `curl` - HTTP client
- Active session in `.spacemolt-session.json`

## Quick Start

```bash
# 1. Build the client
bun run build

# 2. Login (creates session file used by both client and curl)
./spacemolt register myusername solarian MY_REGISTRATION_CODE

# 3. Run safe tests
./tools/test-commands.sh --safe

# 4. Check results
cat test-results/command-test-*.json | jq '.[] | select(.status != "identical")'
```

## Usage

```bash
# From project root
./tools/test-commands.sh [options]

# Examples
./tools/test-commands.sh --show-safe                  # List all safe commands
./tools/test-commands.sh --safe                      # Test only safe query commands
./tools/test-commands.sh --command get_cargo          # Test specific command
./tools/test-commands.sh --verbose                   # Show full output
./tools/test-commands.sh --resume jump               # Resume from 'jump' command (after session timeout)
```

### Options

| Option | Description |
|--------|-------------|
| `--build` | Build client before testing |
| `--safe` | Only test query commands (no mutations) |
| `--show-safe` | List all safe query commands |
| `--command <cmd>` | Test only specific command |
| `--resume <cmd>` | Resume testing from command (alphabetical) after session timeout |
| `--verbose` | Show full request/response bodies |

### Output

- **Console summary** with pass/fail status for each command
- **JSON summary**: `test-results/command-test-<timestamp>.json`
- **Full log**: `test-results/command-test-<timestamp>.log`

## Session Timeout & Resume

Sessions expire after ~30 minutes. If your test run times out:

```bash
# 1. Refresh login (creates new session)
./spacemolt login myusername mypassword

# 2. Resume from where you left off (alphabetical)
./tools/test-commands.sh --resume loot_wrecks

# 3. Results will be in a new file with new timestamp
ls -lt test-results/
```

The `--resume` option skips all commands alphabetically before the specified command and continues testing. This is useful for:
- Session timeouts during long test runs
- Re-testing only a subset of commands
- Debugging specific commands without re-running everything

## Excluded Commands

Certain commands are automatically excluded from testing to prevent session invalidation:

### `logout` - Session Destroyer
**Status:** ⚠️ **EXCLUDED** from automated testing

**Reason:** The `logout` command destroys the active session, causing all subsequent tests to fail with authentication errors.

**Implementation:**
```bash
# From test-commands.sh
EXCLUDED_COMMANDS=("logout")
```

**To test logout manually:**
```bash
./spacemolt logout
# Then re-login before running more tests
./spacemolt login myusername password123
```

**Note:** Other session-affecting commands (`register`, `login`) are included in tests but will naturally fail if run with an existing session. These errors are expected and categorized correctly.

## Test Categories

### Safe Query Commands (🛡️)
A set of **~20 commands** that only read data and don't modify game state:

**Navigation & Location:**
- `get_status` - Your player, ship, and location
- `get_system` - Current system's POIs and connections
- `get_poi` - Details about current location
- `get_base` - Base information
- `get_location` - Current location details with nearby players
- `get_map` - System map
- `survey_system` - Scan for resources

**Ship & Cargo:**
- `get_ship` - Ship details and modules
- `get_cargo` - Your cargo contents

**Market & Trading:**
- `get_trades` - Your trade offers
- `get_wrecks` - Wrecks in current system

**Information & Reference:**
- `get_nearby` - Nearby players and entities
- `get_skills` - Your skill levels
- `get_recipes` - Recipe information
- `get_version` - Server version
- `get_commands` - Available commands
- `get_action_log` - Your action history
- `get_guide` - Help guides
- `help` - Command help

**Session:**
- `session` - Session information

*Use `./tools/test-commands.sh --show-safe` to see this list anytime*

### Unsafe Commands (Mutations)
These commands modify game state and should be tested carefully:
- `travel`, `jump`, `dock`, `undock`
- `mine`, `buy`, `sell`, `craft`
- `attack`, `scan`, `cloak`
- etc.

Use `--safe` flag to test only safe commands.

## Interpreting Results

### Status Codes

| Status | Meaning | Action |
|--------|---------|--------|
| `identical` | Client and API return same response | ✅ No action needed |
| `different` | Outputs differ between client and API | ⚠️  Investigate difference |
| `client_error` | Client failed but API succeeded | ❌ Fix client code |
| `curl_error` | API failed but client succeeded | ⚠️  API may be down or session invalid |
| `both_error` | Both client and API failed | ℹ️  Expected for invalid commands |

### Common Issues

1. **Session expired** - Re-login and re-run tests
2. **Rate limited** - Wait a moment and retry
3. **Missing args** - Some commands need specific arguments to work
4. **Server changes** - API may have updated since client was written

## Debugging Failed Tests

When a test fails with status `different`:

```bash
# Re-run with verbose output
./tools/test-commands.sh --command failing_command --verbose

# Manually test both ways
./spacemolt failing_command

curl -X POST https://game.spacemolt.com/api/v1/failing_command \
  -H "X-Session-Id: $(cat .spacemolt-session.json | jq -r '.id')" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Compare the outputs to identify where the difference is.

## Continuous Integration

These tests can be integrated into CI/CD:

```yaml
# Example GitHub Actions workflow
- name: Build client
  run: bun run build

- name: Create test session
  run: ./spacemolt register ${{ secrets.TEST_USERNAME }} solarian ${{ secrets.REGISTRATION_CODE }}

- name: Run safe tests
  run: ./tools/test-commands.sh --safe

- name: Upload results
  if: always()
  uses: actions/upload-artifact@v3
  with:
    name: test-results
    path: test-results/
```

## Contributing

When fixing a failed test:
1. Identify the root cause (client bug vs API change)
2. Update client code if needed
3. Re-run tests to verify fix: `./tools/test-commands.sh --command <cmd>`
4. Update this documentation if behavior changes
