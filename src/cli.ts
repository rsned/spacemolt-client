#!/usr/bin/env bun
/**
 * SpaceMolt Client CLI
 *
 * Command-line interface that communicates with the daemon.
 * If no daemon is running, starts one in the background.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';
import type { IPCRequest, IPCResponse, QueuedMessage } from './daemon';

// Get a unique user identifier that works cross-platform
function getUserIdentifier(): string {
  // On Unix-like systems, use getuid if available
  if (typeof process.getuid === 'function') {
    return String(process.getuid());
  }
  // On Windows, use USERNAME environment variable or os.userInfo().username
  return process.env.USERNAME || os.userInfo().username || 'default';
}

// Get socket path (must match daemon)
function getSocketPath(): string {
  const runtimeDir = process.env.XDG_RUNTIME_DIR || os.tmpdir();
  return path.join(runtimeDir, `spacemolt-${getUserIdentifier()}.sock`);
}

// Get PID file path (must match daemon)
function getPidPath(): string {
  const runtimeDir = process.env.XDG_RUNTIME_DIR || os.tmpdir();
  return path.join(runtimeDir, `spacemolt-${getUserIdentifier()}.pid`);
}

const SOCKET_PATH = getSocketPath();
const PID_PATH = getPidPath();
const DEBUG = process.env.DEBUG === 'true';

// ANSI colors for output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
};

// Check if daemon is running
async function isDaemonRunning(): Promise<boolean> {
  if (!fs.existsSync(SOCKET_PATH)) {
    return false;
  }

  // Try to connect
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(false), 1000);

    Bun.connect({
      unix: SOCKET_PATH,
      socket: {
        data() {},
        open(socket) {
          clearTimeout(timeout);
          socket.end();
          resolve(true);
        },
        error() {
          clearTimeout(timeout);
          resolve(false);
        },
        close() {},
        connectError() {
          clearTimeout(timeout);
          resolve(false);
        },
      },
    }).catch(() => {
      clearTimeout(timeout);
      resolve(false);
    });
  });
}

// Start daemon in background
async function startDaemon(): Promise<boolean> {
  const daemonPath = path.join(import.meta.dir, 'daemon.ts');

  if (DEBUG) console.log(`[CLI] Starting daemon: ${daemonPath}`);

  // Spawn daemon in background
  const child = spawn('bun', ['run', daemonPath], {
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      DEBUG: DEBUG ? 'true' : 'false',
    },
  });

  child.unref();

  // Wait for daemon to be ready
  const maxWait = 5000; // 5 seconds
  const startTime = Date.now();

  while (Date.now() - startTime < maxWait) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    if (await isDaemonRunning()) {
      // Read PID file
      try {
        const pid = await Bun.file(PID_PATH).text();
        console.log(`${colors.green}SpaceMolt Client daemon started (PID ${pid.trim()})${colors.reset}`);
      } catch {
        console.log(`${colors.green}SpaceMolt Client daemon started${colors.reset}`);
      }
      return true;
    }
  }

  console.error(`${colors.red}Failed to start daemon${colors.reset}`);
  return false;
}

// Send command to daemon and get response
async function sendCommand(command: string, args: string[]): Promise<IPCResponse | null> {
  return new Promise((resolve) => {
    const requestId = crypto.randomUUID();
    const request: IPCRequest = { id: requestId, command, args };
    const timeout = setTimeout(() => {
      console.error(`${colors.red}Command timed out${colors.reset}`);
      resolve(null);
    }, 30000);

    let responseBuffer = '';

    Bun.connect({
      unix: SOCKET_PATH,
      socket: {
        data(socket, data) {
          responseBuffer += data.toString();

          // Try to parse newline-delimited JSON
          const lines = responseBuffer.split('\n');
          for (let i = 0; i < lines.length - 1; i++) {
            const line = lines[i]?.trim();
            if (!line) continue;

            try {
              const response = JSON.parse(line) as IPCResponse;
              clearTimeout(timeout);
              socket.end();
              resolve(response);
              return;
            } catch {
              // Not valid JSON, continue
            }
          }

          // Keep incomplete data in buffer
          responseBuffer = lines[lines.length - 1] ?? '';
        },
        open(socket) {
          // Send request with newline delimiter
          socket.write(JSON.stringify(request) + '\n');
        },
        error(socket, error) {
          clearTimeout(timeout);
          console.error(`${colors.red}Connection error: ${error}${colors.reset}`);
          resolve(null);
        },
        close() {
          clearTimeout(timeout);
          // If we have data in buffer, try to parse it
          if (responseBuffer.trim()) {
            try {
              const response = JSON.parse(responseBuffer.trim()) as IPCResponse;
              resolve(response);
              return;
            } catch {}
          }
        },
        connectError(socket, error) {
          clearTimeout(timeout);
          console.error(`${colors.red}Failed to connect to daemon: ${error}${colors.reset}`);
          resolve(null);
        },
      },
    }).catch((error) => {
      clearTimeout(timeout);
      console.error(`${colors.red}Failed to connect: ${error}${colors.reset}`);
      resolve(null);
    });
  });
}

// Format a queued message for display
function formatMessage(msg: QueuedMessage): string {
  const timestamp = new Date(msg.timestamp).toLocaleTimeString();
  const data = msg.data as Record<string, unknown> | null | undefined;

  // Helper to extract a displayable message from common payload fields
  function extractMessage(payload: Record<string, unknown> | null | undefined): string | null {
    if (!payload) return null;
    // Try common message field names in order of preference
    for (const field of ['message', 'content', 'text', 'description', 'info']) {
      if (typeof payload[field] === 'string') {
        return payload[field] as string;
      }
    }
    // Try to find a 'data' field that might contain a message
    if (payload.data && typeof payload.data === 'object') {
      const nestedData = payload.data as Record<string, unknown>;
      for (const field of ['message', 'content', 'text', 'description', 'info']) {
        if (typeof nestedData[field] === 'string') {
          return nestedData[field] as string;
        }
      }
    }
    return null;
  }

  // Helper to format type name for display (snake_case -> SNAKE_CASE)
  function formatTypeName(type: string): string {
    return type.toUpperCase().replace(/-/g, '_');
  }

  switch (msg.type) {
    case 'chat': {
      const chat = data as { channel?: string; sender?: string; content?: string } | null;
      const channel = chat?.channel || 'unknown';
      const sender = chat?.sender || 'Unknown';
      const content = chat?.content || '';
      const channelColor = channel === 'local' ? colors.white :
                          channel === 'faction' ? colors.green :
                          channel === 'private' ? colors.magenta : colors.cyan;
      return `${colors.dim}[${timestamp}]${colors.reset} ${channelColor}[${channel}]${colors.reset} ${colors.bright}${sender}${colors.reset}: ${content}`;
    }

    case 'system': {
      const message = extractMessage(data) || '';
      return `${colors.dim}[${timestamp}]${colors.reset} ${colors.yellow}[SYSTEM]${colors.reset} ${message}`;
    }

    case 'error': {
      const err = data as { code?: string; message?: string } | null;
      const code = err?.code || 'UNKNOWN';
      const message = err?.message || extractMessage(data) || 'An error occurred';
      return `${colors.dim}[${timestamp}]${colors.reset} ${colors.red}[ERROR ${code}]${colors.reset} ${message}`;
    }

    case 'tip': {
      const message = extractMessage(data) || '';
      return `${colors.dim}[${timestamp}]${colors.reset} ${colors.cyan}[TIP]${colors.reset} ${message}`;
    }

    case 'broadcast': {
      const message = extractMessage(data) || '';
      return `${colors.dim}[${timestamp}]${colors.reset} ${colors.bright}${colors.yellow}[BROADCAST]${colors.reset} ${message}`;
    }

    case 'welcome': {
      const welcome = data as { version?: string; release_date?: string; motd?: string; tick_rate?: number; current_tick?: number; release_notes?: string[] } | null;
      let output = `\n${colors.bright}${colors.cyan}=== Welcome to SpaceMolt ===${colors.reset}\n`;
      if (welcome?.version) {
        output += `Version: ${welcome.version}${welcome.release_date ? ` (${welcome.release_date})` : ''}\n`;
      }
      if (welcome?.release_notes && welcome.release_notes.length > 0) {
        output += '\nRelease Notes:\n';
        for (const note of welcome.release_notes) {
          output += `  - ${note}\n`;
        }
      }
      if (welcome?.motd) {
        output += `\nMOTD: ${welcome.motd}\n`;
      }
      if (welcome?.tick_rate !== undefined) {
        output += `Tick Rate: ${welcome.tick_rate}s`;
        if (welcome.current_tick !== undefined) {
          output += ` | Current Tick: ${welcome.current_tick}`;
        }
      }
      return output;
    }

    case 'registered': {
      const reg = data as { player_id?: string; password?: string } | null;
      let output = `\n${colors.green}${colors.bright}=== Registration Successful ===${colors.reset}\n`;
      if (reg?.player_id) {
        output += `Player ID: ${reg.player_id}\n`;
      }
      if (reg?.password) {
        output += `Password: ${colors.yellow}${reg.password}${colors.reset}\n`;
        output += `${colors.bright}IMPORTANT: Save your password! There is no recovery.${colors.reset}`;
      }
      return output;
    }

    case 'logged_in': {
      const login = data as {
        player?: { username?: string; empire?: string; credits?: number };
        system?: { name?: string };
        poi?: { name?: string };
      } | null;
      let output = `\n${colors.green}${colors.bright}=== Logged In ===${colors.reset}\n`;
      if (login?.player?.username) {
        output += `Welcome, ${colors.bright}${login.player.username}${colors.reset}!\n`;
      }
      if (login?.player?.empire) {
        output += `Empire: ${login.player.empire}\n`;
      }
      if (login?.player?.credits !== undefined) {
        output += `Credits: ${login.player.credits}\n`;
      }
      if (login?.system?.name || login?.poi?.name) {
        output += `Location: ${login?.system?.name || 'Unknown'} - ${login?.poi?.name || 'Unknown'}`;
      }
      return output;
    }

    case 'ok': {
      const ok = data as Record<string, unknown> | null;
      if (!ok) {
        return `${colors.green}[OK]${colors.reset}`;
      }
      if (ok.action === 'mine' && ok.ore_type && ok.quantity) {
        return `${colors.green}[OK]${colors.reset} Mined ${ok.quantity}x ${ok.ore_type}`;
      }
      if (ok.action === 'buy' || ok.action === 'sell') {
        return `${colors.green}[OK]${colors.reset} ${ok.action}: ${ok.item || 'item'}x${ok.quantity || '?'} for ${ok.cost || ok.earned || '?'} credits`;
      }
      if (ok.action === 'travel') {
        return `${colors.green}[OK]${colors.reset} Travel started${ok.arrival_tick ? `, arriving at tick ${ok.arrival_tick}` : ''}`;
      }
      if (ok.action === 'arrived') {
        return `${colors.green}[OK]${colors.reset} Arrived${ok.poi ? ` at ${ok.poi}` : ''}`;
      }
      if (ok.action) {
        return `${colors.green}[OK]${colors.reset} ${ok.action}`;
      }
      // Try to extract a message for generic ok responses
      const message = extractMessage(ok);
      if (message) {
        return `${colors.green}[OK]${colors.reset} ${message}`;
      }
      return `${colors.green}[OK]${colors.reset} ${JSON.stringify(ok)}`;
    }

    case 'state_update': {
      const state = data as {
        tick?: number;
        in_combat?: boolean;
        ship?: { hull?: number; max_hull?: number; shield?: number; max_shield?: number };
        travel_progress?: number;
        travel_destination?: string;
      } | null;
      if (state?.in_combat && state.ship) {
        const hull = state.ship.hull ?? '?';
        const maxHull = state.ship.max_hull ?? '?';
        const shield = state.ship.shield ?? '?';
        const maxShield = state.ship.max_shield ?? '?';
        return `${colors.red}[COMBAT${state.tick !== undefined ? ` Tick ${state.tick}` : ''}]${colors.reset} Hull: ${hull}/${maxHull} Shield: ${shield}/${maxShield}`;
      }
      if (state?.travel_progress !== undefined) {
        const percent = Math.round(state.travel_progress * 100);
        return `${colors.blue}[TRAVEL]${colors.reset} ${percent}%${state.travel_destination ? ` to ${state.travel_destination}` : ''}`;
      }
      return '';
    }

    case 'mining_yield': {
      const yield_ = data as { resource_id?: string; quantity?: number } | null;
      const resourceId = yield_?.resource_id || 'unknown';
      const quantity = yield_?.quantity ?? '?';
      return `${colors.green}[MINED]${colors.reset} ${quantity}x ${resourceId}`;
    }

    case 'combat': {
      const combat = data as { type?: string; damage?: number; target?: string; attacker?: string } | null;
      if (combat?.type === 'hit') {
        return `${colors.red}[COMBAT]${colors.reset} Hit${combat.damage !== undefined ? ` for ${combat.damage} damage` : ''}`;
      }
      if (combat?.type === 'miss') {
        return `${colors.yellow}[COMBAT]${colors.reset} Attack missed`;
      }
      if (combat?.type === 'destroyed') {
        return `${colors.red}${colors.bright}[DESTROYED]${colors.reset} Ship destroyed!`;
      }
      // Unknown combat type - show what we have
      const message = extractMessage(combat as Record<string, unknown>);
      if (message) {
        return `${colors.red}[COMBAT]${colors.reset} ${message}`;
      }
      return `${colors.red}[COMBAT]${colors.reset} ${JSON.stringify(combat)}`;
    }

    case 'travel': {
      const travel = data as { type?: string; poi?: string } | null;
      if (travel?.type === 'arrived') {
        return `${colors.green}[ARRIVED]${colors.reset}${travel.poi ? ` Now at ${travel.poi}` : ''}`;
      }
      return '';
    }

    default: {
      // Forward-compatible default handler for unknown message types
      const typeName = formatTypeName(msg.type);

      // Try to extract a meaningful message from the payload
      const message = extractMessage(data);
      if (message) {
        return `${colors.dim}[${timestamp}]${colors.reset} ${colors.magenta}[${typeName}]${colors.reset} ${message}`;
      }

      // If there's a 'data' field with content, try to display it nicely
      if (data && data.data && typeof data.data !== 'object') {
        return `${colors.dim}[${timestamp}]${colors.reset} ${colors.magenta}[${typeName}]${colors.reset} ${data.data}`;
      }

      // If the payload is very simple (few keys), format it nicely
      if (data && Object.keys(data).length > 0 && Object.keys(data).length <= 3) {
        const parts = Object.entries(data).map(([key, value]) => {
          if (typeof value === 'object') {
            return `${key}: ${JSON.stringify(value)}`;
          }
          return `${key}: ${value}`;
        });
        return `${colors.dim}[${timestamp}]${colors.reset} ${colors.magenta}[${typeName}]${colors.reset} ${parts.join(' | ')}`;
      }

      // Fall back to JSON for complex payloads
      return `${colors.dim}[${timestamp}]${colors.reset} ${colors.magenta}[${typeName}]${colors.reset} ${JSON.stringify(data)}`;
    }
  }
}

// Format response for display
function formatResponse(response: IPCResponse, startTime: number): void {
  // Print timestamp header for LLMs to track execution timing
  const now = new Date();
  const elapsed = Date.now() - startTime;
  console.log(`${colors.dim}[${now.toISOString()}] (${elapsed}ms)${colors.reset}`);

  // First, display any queued messages
  for (const msg of response.messages) {
    const formatted = formatMessage(msg);
    if (formatted) {
      console.log(formatted);
    }
  }

  // Then display the response
  if (!response.success) {
    console.error(`${colors.red}Error: ${response.error}${colors.reset}`);
    return;
  }

  const data = response.response as Record<string, unknown>;
  if (!data) return;

  // Handle specific response types
  if (data.help) {
    console.log(data.help);
    return;
  }

  if (data.action === 'nearby') {
    const nearby = data.nearby as Array<{
      player_id?: string;
      username?: string;
      clan_tag?: string;
      faction_tag?: string;
      anonymous?: boolean;
      in_combat?: boolean;
    }>;
    if (!nearby || nearby.length === 0) {
      console.log('No other players nearby');
    } else {
      console.log(`\n${colors.bright}=== Nearby Players ===${colors.reset}`);
      for (const p of nearby) {
        if (p.anonymous) {
          console.log('  [Anonymous Ship]');
        } else {
          const tag = p.clan_tag ? `[${p.clan_tag}] ` : '';
          const faction = p.faction_tag ? ` <${p.faction_tag}>` : '';
          const combat = p.in_combat ? ` ${colors.red}[COMBAT]${colors.reset}` : '';
          console.log(`  ${tag}${p.username}${faction}${combat}`);
        }
      }
    }
    return;
  }

  if (data.action === 'cargo') {
    const ship = data.ship as {
      cargo_used: number;
      cargo_capacity: number;
      cargo: Array<{ item_id: string; quantity: number }>;
    };
    if (!ship) {
      console.log('Not logged in');
    } else {
      console.log(`\n${colors.bright}=== Cargo (${ship.cargo_used}/${ship.cargo_capacity}) ===${colors.reset}`);
      if (!ship.cargo || ship.cargo.length === 0) {
        console.log('  Empty');
      } else {
        for (const item of ship.cargo) {
          console.log(`  ${item.item_id}: ${item.quantity}`);
        }
      }
    }
    return;
  }

  // Status command
  if (data.player && data.ship) {
    const player = data.player as {
      username: string;
      empire: string;
      credits: number;
      current_system: string;
      current_poi: string;
      docked_at_base?: string;
    };
    const ship = data.ship as {
      name: string;
      class_id: string;
      hull: number;
      max_hull: number;
      shield: number;
      max_shield: number;
      fuel: number;
      max_fuel: number;
      cargo_used: number;
      cargo_capacity: number;
    };
    const system = data.system as { name: string } | null;
    const poi = data.poi as { name: string } | null;
    const traveling = data.traveling as { progress: number; destination: string; type: string } | null;

    console.log(`\n${colors.bright}=== Status ===${colors.reset}`);
    console.log(`Player: ${colors.bright}${player.username}${colors.reset} [${player.empire}]`);
    console.log(`Credits: ${player.credits}`);
    console.log(`Location: ${system?.name || player.current_system} - ${poi?.name || player.current_poi}`);
    console.log(`Docked: ${player.docked_at_base ? 'Yes' : 'No'}`);

    if (traveling) {
      const percent = Math.round(traveling.progress * 100);
      console.log(`${colors.blue}Traveling: ${percent}% to ${traveling.destination} (${traveling.type})${colors.reset}`);
    }

    console.log(`\nShip: ${ship.name} (${ship.class_id})`);
    console.log(`Hull: ${ship.hull}/${ship.max_hull}`);
    console.log(`Shield: ${ship.shield}/${ship.max_shield}`);
    console.log(`Fuel: ${ship.fuel}/${ship.max_fuel}`);
    console.log(`Cargo: ${ship.cargo_used}/${ship.cargo_capacity}`);

    if (data.inCombat) {
      console.log(`\n${colors.red}${colors.bright}*** IN COMBAT ***${colors.reset}`);
    }
    return;
  }

  // For other responses, just confirm the action was sent
  if (data.action) {
    // Action confirmation is already handled by queued messages
    return;
  }

  // Fallback: print JSON
  console.log(JSON.stringify(data, null, 2));
}

// Show help text
function showHelp(): void {
  console.log(`
${colors.bright}SpaceMolt Client${colors.reset}
A daemon-based CLI for the SpaceMolt MMO

${colors.bright}Quick Start:${colors.reset}
  ${colors.cyan}# New players - register once, then play:${colors.reset}
  spacemolt register myname solarian    # Create account (save your password!)
  spacemolt status                      # See your ship and location
  spacemolt mine                        # Start mining

  ${colors.cyan}# Returning players - just start playing:${colors.reset}
  spacemolt start                       # Reconnect with saved credentials
  spacemolt status                      # See where you left off

${colors.bright}Usage:${colors.reset}
  spacemolt <command> [args...]

${colors.bright}Common Commands:${colors.reset}
  start                         # Start daemon and auto-login with saved credentials
  status                        # Check your current status
  mine                          # Mine resources at current POI
  travel <poi_id>               # Travel to a POI in current system
  dock                          # Dock at current base
  help                          # Full command list from server
  stop                          # Stop the daemon

${colors.bright}Notes:${colors.reset}
  - Credentials are saved after first login/register (~/.config/spacemolt/credentials.json)
  - The daemon runs in background and maintains WebSocket connection
  - Use 'help' for the full list of 90+ game commands

${colors.bright}Environment Variables:${colors.reset}
  SPACEMOLT_URL          WebSocket URL (default: wss://game.spacemolt.com/ws)
  SPACEMOLT_CREDENTIALS  Path to credentials file (default: ~/.config/spacemolt/credentials.json)
  DEBUG                  Enable debug logging (set to 'true')
`);
}

// Check if response contains a rate_limited error and return wait time
function getRateLimitWaitTime(response: IPCResponse): number | null {
  for (const msg of response.messages) {
    if (msg.type === 'error') {
      const err = msg.data as { code?: string; wait_seconds?: number } | null;
      if (err?.code === 'rate_limited' && typeof err.wait_seconds === 'number') {
        return err.wait_seconds;
      }
    }
  }
  return null;
}

// Display queued messages except rate_limited errors (for retry scenarios)
function displayNonRateLimitMessages(response: IPCResponse): void {
  for (const msg of response.messages) {
    // Skip rate_limited errors when we're going to retry
    if (msg.type === 'error') {
      const err = msg.data as { code?: string } | null;
      if (err?.code === 'rate_limited') {
        continue;
      }
    }
    const formatted = formatMessage(msg);
    if (formatted) {
      console.log(formatted);
    }
  }
}

// Main CLI entry point
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // No arguments - show help
  if (args.length === 0) {
    console.log(`${colors.dim}[${new Date().toISOString()}]${colors.reset}`);
    showHelp();
    process.exit(0);
  }

  const command = args[0]!.toLowerCase();
  const commandArgs = args.slice(1);

  // Special handling for local help
  if (command === '--help' || command === '-h') {
    console.log(`${colors.dim}[${new Date().toISOString()}]${colors.reset}`);
    showHelp();
    process.exit(0);
  }

  // Check if daemon is running
  const daemonRunning = await isDaemonRunning();

  if (!daemonRunning) {
    // Commands that require the daemon to be started
    const startCommands = ['login', 'register', 'connect', 'start'];

    if (startCommands.includes(command)) {
      console.log(`${colors.dim}[${new Date().toISOString()}]${colors.reset} Starting SpaceMolt Client daemon...`);
      const started = await startDaemon();
      if (!started) {
        process.exit(1);
      }
      // Give it a moment to connect
      await new Promise((resolve) => setTimeout(resolve, 500));
    } else if (command === 'stop' || command === 'shutdown') {
      console.log(`${colors.dim}[${new Date().toISOString()}]${colors.reset} Daemon is not running`);
      process.exit(0);
    } else {
      console.log(`${colors.dim}[${new Date().toISOString()}]${colors.reset}`);
      console.error(`${colors.red}Daemon is not running. Start with: spacemolt start (saved credentials) or spacemolt login <username> <password>${colors.reset}`);
      process.exit(1);
    }
  }

  // Send command with auto-retry on rate limit
  const startTime = Date.now();
  const maxRetries = 3;
  let retryCount = 0;
  let response: IPCResponse | null = null;

  while (retryCount <= maxRetries) {
    response = await sendCommand(command, commandArgs);

    if (!response) {
      console.log(`${colors.dim}[${new Date().toISOString()}]${colors.reset}`);
      process.exit(1);
    }

    // Check for rate_limited error with wait_seconds
    const waitTime = getRateLimitWaitTime(response);
    if (waitTime !== null && retryCount < maxRetries) {
      // Display any non-rate-limit messages (like chat)
      displayNonRateLimitMessages(response);

      // Wait and retry
      const waitMs = Math.ceil(waitTime * 1000) + 100; // Add 100ms buffer
      console.log(`${colors.yellow}Waiting ${waitTime.toFixed(1)}s for next tick...${colors.reset}`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      retryCount++;
      continue;
    }

    // No rate limit or max retries reached - exit loop
    break;
  }

  if (!response) {
    console.log(`${colors.dim}[${new Date().toISOString()}]${colors.reset}`);
    process.exit(1);
  }

  formatResponse(response, startTime);

  // Exit with appropriate code
  process.exit(response.success ? 0 : 1);
}

// Run
main().catch((error) => {
  console.error(`${colors.red}Error: ${error}${colors.reset}`);
  process.exit(1);
});
