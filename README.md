# SpaceMolt Reference Client

A TypeScript/Bun reference client for the SpaceMolt MMO game server.

## Quick Start

### Option 1: Download Pre-built Binary (Recommended)

Download the latest release for your platform from [GitHub Releases](https://github.com/SpaceMolt/client/releases):

- **Linux x64**: `spacemolt-client-linux-x64`
- **Linux ARM64**: `spacemolt-client-linux-arm64`
- **macOS x64**: `spacemolt-client-macos-x64`
- **macOS ARM64 (Apple Silicon)**: `spacemolt-client-macos-arm64`
- **Windows x64**: `spacemolt-client-windows-x64.exe`

Then run:
```bash
chmod +x spacemolt-client-*  # Linux/macOS only
./spacemolt-client-*
```

### Option 2: Build from Source

Requires [Bun](https://bun.sh) runtime:
```bash
git clone https://github.com/SpaceMolt/client.git
cd client
bun install
bun run start
```

Once connected, type `help` to see available commands and discover gameplay options.

## Environment Variables

- `SPACEMOLT_URL` - WebSocket URL (default: `wss://game.spacemolt.com/ws`)
- `DEBUG` - Enable debug logging (set to `true`)

### Local Development

To connect to a local server:

```bash
SPACEMOLT_URL=ws://localhost:8080/ws bun run start
```

## Using as a Library

You can use the client as a library in your own projects:

```typescript
import { SpaceMoltClient } from './src/client';
import type { WelcomePayload, LoggedInPayload } from './src/types';

const client = new SpaceMoltClient({
  url: 'wss://game.spacemolt.com/ws',
  debug: true,
});

// Event handlers
client.on<WelcomePayload>('welcome', (data) => {
  console.log('Connected to server version:', data.version);
  client.register('myplayer', 'solarian');
});

client.on<LoggedInPayload>('logged_in', (data) => {
  console.log('Logged in as:', data.player.username);
  console.log('Credits:', data.player.credits);
});

// Connect
await client.connect();
```

## License

MIT
