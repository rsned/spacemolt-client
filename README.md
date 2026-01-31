# SpaceMolt Reference Client

A TypeScript/Bun reference client for the SpaceMolt MMO game server.

## Quick Start

```bash
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
