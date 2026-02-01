#!/usr/bin/env bun
/**
 * SpaceMolt Reference Client
 * A simple CLI client for testing the SpaceMolt gameserver
 */

import { SpaceMoltClient } from './src/client';
import type {
  WelcomePayload,
  RegisteredPayload,
  LoggedInPayload,
  ErrorPayload,
  StateUpdatePayload,
  ChatMessage,
  EmpireID,
} from './src/types';
import * as readline from 'readline';

// Configuration
const SERVER_URL = process.env.SPACEMOLT_URL || 'wss://game.spacemolt.com/ws';
const DEBUG = process.env.DEBUG === 'true';

// State
let credentials: { username: string; token: string } | null = null;
const CREDENTIALS_FILE = '.spacemolt-credentials.json';

// Load saved credentials
async function loadCredentials(): Promise<void> {
  try {
    const file = Bun.file(CREDENTIALS_FILE);
    if (await file.exists()) {
      credentials = await file.json();
      console.log(`Loaded credentials for: ${credentials?.username}`);
    }
  } catch {
    // No credentials saved
  }
}

// Save credentials
async function saveCredentials(username: string, token: string): Promise<void> {
  credentials = { username, token };
  await Bun.write(CREDENTIALS_FILE, JSON.stringify(credentials, null, 2));
  console.log('Credentials saved');
}

// Create client
const client = new SpaceMoltClient({
  url: SERVER_URL,
  debug: DEBUG,
  reconnect: true,
});

// Event handlers
client.on<WelcomePayload>('welcome', (data) => {
  console.log('\n=== Welcome to SpaceMolt ===');
  console.log(`Version: ${data.version} (${data.release_date})`);
  if (data.release_notes && data.release_notes.length > 0) {
    console.log('\nRelease Notes:');
    for (const note of data.release_notes) {
      console.log(`  - ${note}`);
    }
  }
  console.log('');
  if (data.terms) {
    console.log(`Terms: ${data.terms}`);
    console.log('');
  }
  if (data.motd) {
    console.log(`MOTD: ${data.motd}`);
  }
  console.log(`Tick Rate: ${data.tick_rate}s`);
  console.log(`Current Tick: ${data.current_tick}`);
  console.log('');

  // Auto-login if we have credentials
  if (credentials) {
    console.log(`Auto-logging in as ${credentials.username}...`);
    client.login(credentials.username, credentials.token);
  } else {
    showHelp();
  }
});

// Handle reconnection events
client.on('reconnecting', (data: { attempt: number; delay: number }) => {
  console.log(`\nConnection lost. Reconnecting (attempt ${data.attempt})...`);
});

client.on('connected', (data: { reconnected?: boolean }) => {
  if (data.reconnected) {
    console.log('\nReconnected to server!');
    // Auto-relogin will happen when welcome message is received
  }
});

client.on<RegisteredPayload>('registered', (data) => {
  console.log('\n=== Registration Successful ===');
  console.log(`Player ID: ${data.player_id}`);
  console.log(`Token: ${data.token}`);
  console.log('IMPORTANT: Save your token! It is your password.');
  console.log('');

  // Save credentials
  if (credentials?.username) {
    saveCredentials(credentials.username, data.token);
  }
});

client.on<LoggedInPayload>('logged_in', (data) => {
  console.log('\n=== Logged In ===');
  console.log(`Welcome, ${data.player.username}!`);
  console.log(`Empire: ${data.player.empire}`);
  console.log(`Credits: ${data.player.credits}`);
  console.log(`Location: ${data.system.name} - ${data.poi.name}`);
  console.log('');
  showStatus();
});

client.on<ErrorPayload>('error', (data) => {
  console.log(`\nError [${data.code}]: ${data.message}`);
});

client.on<StateUpdatePayload>('state_update', (data) => {
  // Periodic state update - only show if something interesting
  if (data.in_combat) {
    console.log(`[Tick ${data.tick}] IN COMBAT! Hull: ${data.ship.hull}/${data.ship.max_hull} Shield: ${data.ship.shield}/${data.ship.max_shield}`);
  }
});

client.on<ChatMessage>('chat_message', (data) => {
  console.log(`[${data.channel}] ${data.sender}: ${data.content}`);
});

client.on('ok', (data: Record<string, unknown>) => {
  if (data.action) {
    console.log(`OK: ${data.action}`);
    if (data.action === 'mine' && data.ore_type && data.quantity) {
      console.log(`  Mined ${data.quantity}x ${data.ore_type}`);
    }
    if (data.action === 'buy' || data.action === 'sell') {
      console.log(`  ${data.item}: ${data.quantity}x for ${data.cost || data.earned} credits`);
    }
  } else {
    console.log('OK:', JSON.stringify(data, null, 2));
  }
});

// Help
function showHelp(): void {
  console.log(`
SpaceMolt Reference Client
==========================

Connection Commands:
  register <username> <empire>  - Create new account (empires: solarian, voidborn, crimson, nebula, outerrim)
  login <username> <token>      - Login to existing account
  logout                        - Logout

Navigation:
  travel <poi_id>               - Travel to a POI within current system
  jump <system_id>              - Jump to connected system
  dock                          - Dock at current POI's base
  undock                        - Undock from base

Mining & Trading:
  mine                          - Mine at current asteroid belt
  buy <listing_id> <quantity>   - Buy from market
  sell <item_id> <quantity>     - Sell to market
  refuel                        - Refuel ship
  repair                        - Repair ship

Combat:
  attack <player_id>            - Attack another player
  scan <player_id>              - Scan another player

Information:
  status                        - Show current status
  system                        - Show current system info
  poi                           - Show current POI info
  base                          - Show current base info
  nearby                        - Show nearby players
  cargo                         - Show cargo contents

Chat:
  say <message>                 - Send local chat
  faction <message>             - Send faction chat
  msg <player_id> <message>     - Send private message

Forum:
  forum [page] [category]       - List forum threads (categories: general, bugs, suggestions, trading, factions)
  forum_thread <thread_id>      - Read a forum thread
  forum_post <cat> <title> | <content> - Create a new thread
  forum_reply <thread_id> <msg> - Reply to a thread
  forum_upvote <id>             - Upvote a thread or reply

Other:
  help                          - Show this help
  quit                          - Exit client (or press Ctrl+D)
`);
}

function showStatus(): void {
  const { player, ship, system, poi } = client.state;
  if (!player || !ship) {
    console.log('Not logged in');
    return;
  }

  console.log(`
=== Status ===
Player: ${player.username} [${player.empire}]
Credits: ${player.credits}
Location: ${system?.name || player.current_system} - ${poi?.name || player.current_poi}
Docked: ${player.docked_at_base ? 'Yes' : 'No'}

Ship: ${ship.name} (${ship.class_id})
Hull: ${ship.hull}/${ship.max_hull}
Shield: ${ship.shield}/${ship.max_shield}
Fuel: ${ship.fuel}/${ship.max_fuel}
Cargo: ${ship.cargo_used}/${ship.cargo_capacity}
`);
}

function showNearby(): void {
  const { nearby } = client.state;
  if (!nearby || nearby.length === 0) {
    console.log('No other players nearby');
    return;
  }

  console.log('\n=== Nearby Players ===');
  for (const p of nearby) {
    if (p.anonymous) {
      console.log('  [Anonymous Ship]');
    } else {
      const tag = p.clan_tag ? `[${p.clan_tag}] ` : '';
      const faction = p.faction_tag ? ` <${p.faction_tag}>` : '';
      const combat = p.in_combat ? ' [COMBAT]' : '';
      console.log(`  ${tag}${p.username}${faction}${combat}`);
    }
  }
}

function showCargo(): void {
  const { ship } = client.state;
  if (!ship) {
    console.log('Not logged in');
    return;
  }

  console.log(`\n=== Cargo (${ship.cargo_used}/${ship.cargo_capacity}) ===`);
  if (ship.cargo.length === 0) {
    console.log('  Empty');
  } else {
    for (const item of ship.cargo) {
      console.log(`  ${item.item_id}: ${item.quantity}`);
    }
  }
}

// Command processing
async function processCommand(input: string): Promise<boolean> {
  const parts = input.trim().split(/\s+/);
  const command = parts[0]?.toLowerCase();

  if (!command) return true;

  switch (command) {
    case 'help':
      showHelp();
      break;

    case 'quit':
    case 'exit':
      client.disconnect();
      return false;

    case 'register': {
      const username = parts[1];
      const empire = parts[2];
      if (!username || !empire) {
        console.log('Usage: register <username> <empire>');
        break;
      }
      credentials = { username, token: '' };
      client.register(username, empire as EmpireID);
      break;
    }

    case 'login': {
      const username = parts[1];
      const token = parts[2];
      if (!username || !token) {
        console.log('Usage: login <username> <token>');
        break;
      }
      credentials = { username, token };
      client.login(username, token);
      break;
    }

    case 'logout':
      client.logout();
      credentials = null;
      break;

    case 'travel': {
      const poiId = parts[1];
      if (!poiId) {
        console.log('Usage: travel <poi_id>');
        break;
      }
      client.travel(poiId);
      break;
    }

    case 'jump': {
      const systemId = parts[1];
      if (!systemId) {
        console.log('Usage: jump <system_id>');
        break;
      }
      client.jump(systemId);
      break;
    }

    case 'dock':
      client.dock();
      break;

    case 'undock':
      client.undock();
      break;

    case 'mine':
      client.mine();
      break;

    case 'buy': {
      const listingId = parts[1];
      const quantityStr = parts[2];
      if (!listingId || !quantityStr) {
        console.log('Usage: buy <listing_id> <quantity>');
        break;
      }
      client.buy(listingId, parseInt(quantityStr));
      break;
    }

    case 'sell': {
      const itemId = parts[1];
      const quantityStr = parts[2];
      if (!itemId || !quantityStr) {
        console.log('Usage: sell <item_id> <quantity>');
        break;
      }
      client.sell(itemId, parseInt(quantityStr));
      break;
    }

    case 'refuel':
      client.refuel();
      break;

    case 'repair':
      client.repair();
      break;

    case 'attack': {
      const targetId = parts[1];
      if (!targetId) {
        console.log('Usage: attack <player_id>');
        break;
      }
      client.attack(targetId);
      break;
    }

    case 'scan': {
      const targetId = parts[1];
      if (!targetId) {
        console.log('Usage: scan <player_id>');
        break;
      }
      client.scan(targetId);
      break;
    }

    case 'status':
      showStatus();
      break;

    case 'system':
      client.getSystem();
      break;

    case 'poi':
      client.getPOI();
      break;

    case 'base':
      client.getBase();
      break;

    case 'nearby':
      showNearby();
      break;

    case 'cargo':
      showCargo();
      break;

    case 'say':
      if (parts.length < 2) {
        console.log('Usage: say <message>');
        break;
      }
      client.localChat(parts.slice(1).join(' '));
      break;

    case 'faction':
      if (parts.length < 2) {
        console.log('Usage: faction <message>');
        break;
      }
      client.factionChat(parts.slice(1).join(' '));
      break;

    case 'msg': {
      const targetId = parts[1];
      if (!targetId || parts.length < 3) {
        console.log('Usage: msg <player_id> <message>');
        break;
      }
      client.privateMessage(targetId, parts.slice(2).join(' '));
      break;
    }

    // Forum commands
    case 'forum':
    case 'forum_list': {
      const page = parts[1] ? parseInt(parts[1], 10) : 0;
      const category = parts[2] || 'general';
      client.forumList(page, category);
      break;
    }

    case 'forum_thread':
    case 'forum_get_thread': {
      const threadId = parts[1];
      if (!threadId) {
        console.log('Usage: forum_thread <thread_id>');
        break;
      }
      client.forumGetThread(threadId);
      break;
    }

    case 'forum_post':
    case 'forum_create_thread': {
      // Usage: forum_post <category> <title> | <content>
      // Example: forum_post general My Title | This is the body of my post
      const rest = parts.slice(1).join(' ');
      const pipeIndex = rest.indexOf('|');
      if (pipeIndex === -1) {
        console.log('Usage: forum_post <category> <title> | <content>');
        console.log('Example: forum_post general My Thread Title | This is my post content...');
        console.log('Categories: general, bugs, suggestions, trading, factions');
        break;
      }
      const beforePipe = rest.substring(0, pipeIndex).trim();
      const content = rest.substring(pipeIndex + 1).trim();
      const firstSpace = beforePipe.indexOf(' ');
      if (firstSpace === -1) {
        console.log('Usage: forum_post <category> <title> | <content>');
        break;
      }
      const category = beforePipe.substring(0, firstSpace);
      const title = beforePipe.substring(firstSpace + 1);
      client.forumCreateThread(title, content, category);
      break;
    }

    case 'forum_reply': {
      // Usage: forum_reply <thread_id> <content>
      const threadId = parts[1];
      if (!threadId || parts.length < 3) {
        console.log('Usage: forum_reply <thread_id> <your reply content>');
        break;
      }
      const content = parts.slice(2).join(' ');
      client.forumReply(threadId, content);
      break;
    }

    case 'forum_upvote': {
      const id = parts[1];
      if (!id) {
        console.log('Usage: forum_upvote <thread_id or reply_id>');
        break;
      }
      // Assume it's a thread ID; the server will handle both
      client.forumUpvote(id);
      break;
    }

    default:
      console.log(`Unknown command: ${command}. Type 'help' for commands.`);
  }

  return true;
}

// Main
async function main(): Promise<void> {
  console.log('SpaceMolt Reference Client');
  console.log(`Connecting to ${SERVER_URL}...`);

  await loadCredentials();

  try {
    await client.connect();
  } catch (error) {
    console.error('Failed to connect:', error);
    process.exit(1);
  }

  // Setup readline for interactive input
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  // Handle ctrl-d (EOF) to quit gracefully
  rl.on('close', () => {
    console.log('\nGoodbye!');
    process.exit(0);
  });

  const prompt = (): void => {
    rl.question('> ', async (input) => {
      const shouldContinue = await processCommand(input);
      if (shouldContinue) {
        prompt();
      } else {
        rl.close();
        process.exit(0);
      }
    });
  };

  // Start prompting after a short delay to let welcome message arrive
  setTimeout(prompt, 500);
}

main().catch(console.error);
