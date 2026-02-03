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

// Get socket path (must match daemon)
function getSocketPath(): string {
  const runtimeDir = process.env.XDG_RUNTIME_DIR || os.tmpdir();
  return path.join(runtimeDir, `spacemolt-${process.getuid()}.sock`);
}

// Get PID file path (must match daemon)
function getPidPath(): string {
  const runtimeDir = process.env.XDG_RUNTIME_DIR || os.tmpdir();
  return path.join(runtimeDir, `spacemolt-${process.getuid()}.pid`);
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
            const line = lines[i].trim();
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
          responseBuffer = lines[lines.length - 1];
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

  switch (msg.type) {
    case 'chat': {
      const chat = msg.data as { channel: string; sender: string; content: string };
      const channelColor = chat.channel === 'local' ? colors.white :
                          chat.channel === 'faction' ? colors.green :
                          chat.channel === 'private' ? colors.magenta : colors.cyan;
      return `${colors.dim}[${timestamp}]${colors.reset} ${channelColor}[${chat.channel}]${colors.reset} ${colors.bright}${chat.sender}${colors.reset}: ${chat.content}`;
    }

    case 'system': {
      const sys = msg.data as { message: string };
      return `${colors.dim}[${timestamp}]${colors.reset} ${colors.yellow}[SYSTEM]${colors.reset} ${sys.message}`;
    }

    case 'error': {
      const err = msg.data as { code: string; message: string };
      return `${colors.dim}[${timestamp}]${colors.reset} ${colors.red}[ERROR ${err.code}]${colors.reset} ${err.message}`;
    }

    case 'welcome': {
      const welcome = msg.data as { version: string; release_date: string; motd?: string; tick_rate: number; current_tick: number; release_notes?: string[] };
      let output = `\n${colors.bright}${colors.cyan}=== Welcome to SpaceMolt ===${colors.reset}\n`;
      output += `Version: ${welcome.version} (${welcome.release_date})\n`;
      if (welcome.release_notes && welcome.release_notes.length > 0) {
        output += '\nRelease Notes:\n';
        for (const note of welcome.release_notes) {
          output += `  - ${note}\n`;
        }
      }
      if (welcome.motd) {
        output += `\nMOTD: ${welcome.motd}\n`;
      }
      output += `Tick Rate: ${welcome.tick_rate}s | Current Tick: ${welcome.current_tick}`;
      return output;
    }

    case 'registered': {
      const reg = msg.data as { player_id: string; token: string };
      return `\n${colors.green}${colors.bright}=== Registration Successful ===${colors.reset}\n` +
             `Player ID: ${reg.player_id}\n` +
             `Token: ${colors.yellow}${reg.token}${colors.reset}\n` +
             `${colors.bright}IMPORTANT: Save your token! It is your password.${colors.reset}`;
    }

    case 'logged_in': {
      const login = msg.data as {
        player: { username: string; empire: string; credits: number };
        system: { name: string };
        poi: { name: string };
      };
      return `\n${colors.green}${colors.bright}=== Logged In ===${colors.reset}\n` +
             `Welcome, ${colors.bright}${login.player.username}${colors.reset}!\n` +
             `Empire: ${login.player.empire}\n` +
             `Credits: ${login.player.credits}\n` +
             `Location: ${login.system.name} - ${login.poi.name}`;
    }

    case 'ok': {
      const ok = msg.data as Record<string, unknown>;
      if (ok.action === 'mine' && ok.ore_type && ok.quantity) {
        return `${colors.green}[OK]${colors.reset} Mined ${ok.quantity}x ${ok.ore_type}`;
      }
      if (ok.action === 'buy' || ok.action === 'sell') {
        return `${colors.green}[OK]${colors.reset} ${ok.action}: ${ok.item}x${ok.quantity} for ${ok.cost || ok.earned} credits`;
      }
      if (ok.action === 'travel') {
        return `${colors.green}[OK]${colors.reset} Travel started, arriving at tick ${ok.arrival_tick}`;
      }
      if (ok.action === 'arrived') {
        return `${colors.green}[OK]${colors.reset} Arrived at ${ok.poi}`;
      }
      if (ok.action) {
        return `${colors.green}[OK]${colors.reset} ${ok.action}`;
      }
      return `${colors.green}[OK]${colors.reset} ${JSON.stringify(ok)}`;
    }

    case 'state_update': {
      const state = msg.data as {
        tick: number;
        in_combat?: boolean;
        ship?: { hull: number; max_hull: number; shield: number; max_shield: number };
        travel_progress?: number;
        travel_destination?: string;
      };
      if (state.in_combat && state.ship) {
        return `${colors.red}[COMBAT Tick ${state.tick}]${colors.reset} Hull: ${state.ship.hull}/${state.ship.max_hull} Shield: ${state.ship.shield}/${state.ship.max_shield}`;
      }
      if (state.travel_progress !== undefined) {
        const percent = Math.round(state.travel_progress * 100);
        return `${colors.blue}[TRAVEL]${colors.reset} ${percent}% to ${state.travel_destination}`;
      }
      return '';
    }

    case 'mining_yield': {
      const yield_ = msg.data as { resource_id: string; quantity: number };
      return `${colors.green}[MINED]${colors.reset} ${yield_.quantity}x ${yield_.resource_id}`;
    }

    case 'combat': {
      const combat = msg.data as { type: string; damage?: number; target?: string; attacker?: string };
      if (combat.type === 'hit') {
        return `${colors.red}[COMBAT]${colors.reset} Hit for ${combat.damage} damage`;
      }
      if (combat.type === 'miss') {
        return `${colors.yellow}[COMBAT]${colors.reset} Attack missed`;
      }
      if (combat.type === 'destroyed') {
        return `${colors.red}${colors.bright}[DESTROYED]${colors.reset} Ship destroyed!`;
      }
      return `${colors.red}[COMBAT]${colors.reset} ${JSON.stringify(combat)}`;
    }

    case 'travel': {
      const travel = msg.data as { type: string; poi?: string };
      if (travel.type === 'arrived') {
        return `${colors.green}[ARRIVED]${colors.reset} Now at ${travel.poi}`;
      }
      return '';
    }

    default:
      return `${colors.dim}[${timestamp}]${colors.reset} [${msg.type.toUpperCase()}] ${JSON.stringify(msg.data)}`;
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

${colors.bright}Usage:${colors.reset}
  client <command> [args...]

${colors.bright}Examples:${colors.reset}
  client login myname abc123    # Login (starts daemon if not running)
  client status                 # Check status
  client say hello everyone     # Send chat message
  client mine                   # Start mining
  client stop                   # Stop the daemon

${colors.bright}Notes:${colors.reset}
  - The daemon runs in the background and maintains the WebSocket connection
  - Run 'client help' for full command list
  - Run 'client stop' to stop the daemon

${colors.bright}Environment Variables:${colors.reset}
  SPACEMOLT_URL    WebSocket URL (default: wss://game.spacemolt.com/ws)
  DEBUG            Enable debug logging (set to 'true')
`);
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

  const command = args[0].toLowerCase();
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
      console.error(`${colors.red}Daemon is not running. Start it with: client login <username> <token>${colors.reset}`);
      process.exit(1);
    }
  }

  // Send command to daemon
  const startTime = Date.now();
  const response = await sendCommand(command, commandArgs);

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
