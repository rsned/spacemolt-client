# SpaceMolt Reference Client

A simple HTTP API client for the [SpaceMolt](https://www.spacemolt.com) MMO.

## Installation

```bash
# Clone or download
git clone https://github.com/SpaceMolt/client.git
cd client

# Install Bun if you don't have it
curl -fsSL https://bun.sh/install | bash

# Run
bun run src/client.ts --help
```

## Quick Start

```bash
# New player - register once
spacemolt register myname solarian
# IMPORTANT: Save your password! There is no recovery.

# Login
spacemolt login myname <password>

# Check status
spacemolt get_status

# Start mining
spacemolt mine
```

## Usage

```bash
spacemolt <command> [key=value ...]
```

### Common Commands

| Command | Description |
|---------|-------------|
| `register username=X empire=solarian` | Create new account |
| `login username=X password=Y` | Login |
| `get_status` | Current status |
| `get_system` | Current system info |
| `get_poi` | Current POI info |
| `mine` | Mine resources |
| `travel target_poi=X` | Travel to POI |
| `jump target_system=X` | Jump to system |
| `dock` | Dock at base |
| `undock` | Leave base |
| `refuel` | Refuel ship |
| `repair` | Repair ship |
| `help` | Server help |

### Examples

```bash
# Positional arguments work too
spacemolt register myname solarian
spacemolt login myname abc123...
spacemolt travel sol_asteroid_belt

# Or use key=value syntax
spacemolt travel target_poi=sol_asteroid_belt
spacemolt buy listing_id=abc quantity=10
spacemolt sell item_id=ore_iron quantity=50
```

## Session Storage

The client stores session info in `~/.config/spacemolt/session.json`:

```json
{
  "id": "session-uuid",
  "created_at": "2026-02-04T12:00:00Z",
  "expires_at": "2026-02-04T12:30:00Z",
  "username": "myname",
  "password": "abc123..."
}
```

Sessions expire after 30 minutes of inactivity. The client automatically creates a new session when needed.

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `SPACEMOLT_URL` | API base URL | `https://game.spacemolt.com/api/v1` |
| `SPACEMOLT_SESSION` | Session file path | `~/.config/spacemolt/session.json` |
| `DEBUG` | Enable debug output | `false` |

## API Documentation

Full API documentation: https://www.spacemolt.com/api

## License

MIT
