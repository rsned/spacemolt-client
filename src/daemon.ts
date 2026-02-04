#!/usr/bin/env bun
/**
 * SpaceMolt Client Daemon
 *
 * Maintains persistent WebSocket connection to the game server.
 * Listens on a Unix socket for CLI commands.
 */

import { SpaceMoltClient } from './client';
import type {
  WelcomePayload,
  RegisteredPayload,
  LoggedInPayload,
  ErrorPayload,
  StateUpdatePayload,
  ChatMessage,
  CommandInfo,
  CommandsPayload,
} from './types';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { Socket } from 'bun';

// Configuration
const SERVER_URL = process.env.SPACEMOLT_URL || 'wss://game.spacemolt.com/ws';
const DEBUG = process.env.DEBUG === 'true';

// Get a unique user identifier that works cross-platform
function getUserIdentifier(): string {
  // On Unix-like systems, use getuid if available
  if (typeof process.getuid === 'function') {
    return String(process.getuid());
  }
  // On Windows, use USERNAME environment variable or os.userInfo().username
  return process.env.USERNAME || os.userInfo().username || 'default';
}

// Get socket path in user's runtime directory
function getSocketPath(): string {
  const runtimeDir = process.env.XDG_RUNTIME_DIR || os.tmpdir();
  return path.join(runtimeDir, `spacemolt-${getUserIdentifier()}.sock`);
}

// Get credentials file path
function getCredentialsPath(): string {
  // Allow environment variable override
  if (process.env.SPACEMOLT_CREDENTIALS) {
    return process.env.SPACEMOLT_CREDENTIALS;
  }
  const homeDir = os.homedir();
  return path.join(homeDir, '.config', 'spacemolt', 'credentials.json');
}

// Get PID file path
function getPidPath(): string {
  const runtimeDir = process.env.XDG_RUNTIME_DIR || os.tmpdir();
  return path.join(runtimeDir, `spacemolt-${getUserIdentifier()}.pid`);
}

export const SOCKET_PATH = getSocketPath();
export const CREDENTIALS_PATH = getCredentialsPath();
export const PID_PATH = getPidPath();

// Message types for IPC
export interface IPCRequest {
  id: string;
  command: string;
  args: string[];
}

export interface IPCResponse {
  id: string;
  success: boolean;
  messages: QueuedMessage[];  // Messages accumulated since last command
  response?: unknown;
  error?: string;
}

export interface QueuedMessage {
  type: 'chat' | 'tip' | 'broadcast' | 'error' | 'ok' | 'system' | 'welcome' | 'registered' | 'logged_in' | 'state_update' | 'combat' | 'travel' | 'mining_yield';
  timestamp: number;
  data: unknown;
}

// Daemon state
let client: SpaceMoltClient;
let messageQueue: QueuedMessage[] = [];
let credentials: { username: string; password: string } | null = null;
let unixServer: ReturnType<typeof Bun.listen> | null = null;
let isShuttingDown = false;
let welcomeReceived = false;
let lastWelcome: WelcomePayload | null = null;
let connectedClients: Set<Socket<{ buffer: string }>> = new Set();

// Cached command info from server (for dynamic help generation)
let commandInfo: CommandInfo[] = [];

// Flag to prevent double-queueing auth responses during explicit login/register
let waitingForExplicitAuth = false;

// Load saved credentials
async function loadCredentials(): Promise<void> {
  try {
    const file = Bun.file(CREDENTIALS_PATH);
    if (await file.exists()) {
      credentials = await file.json();
      if (DEBUG) console.log(`[Daemon] Loaded credentials for: ${credentials?.username}`);
    }
  } catch {
    // No credentials saved
  }
}

// Save credentials
async function saveCredentials(username: string, password: string): Promise<void> {
  credentials = { username, password };
  // Ensure parent directory exists
  const parentDir = path.dirname(CREDENTIALS_PATH);
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }
  await Bun.write(CREDENTIALS_PATH, JSON.stringify(credentials, null, 2));
  if (DEBUG) console.log('[Daemon] Credentials saved');
}

// Queue a message
function queueMessage(type: QueuedMessage['type'], data: unknown): void {
  messageQueue.push({
    type,
    timestamp: Date.now(),
    data,
  });

  // Keep queue bounded (max 1000 messages)
  if (messageQueue.length > 1000) {
    messageQueue = messageQueue.slice(-1000);
  }
}

// Flush and return queued messages
function flushMessages(): QueuedMessage[] {
  const messages = [...messageQueue];
  messageQueue = [];
  return messages;
}

// Setup client event handlers
function setupClientHandlers(): void {
  client.on<WelcomePayload>('welcome', (data) => {
    welcomeReceived = true;
    lastWelcome = data;
    queueMessage('welcome', data);

    // Request command list for dynamic help generation
    client.getCommands();

    // Auto-login if we have credentials
    if (credentials) {
      if (DEBUG) console.log(`[Daemon] Auto-logging in as ${credentials.username}...`);
      client.login(credentials.username, credentials.password);
    }
  });

  client.on('reconnecting', (data: { attempt: number; delay: number }) => {
    queueMessage('system', {
      message: `Connection lost. Reconnecting (attempt ${data.attempt})...`,
    });
  });

  client.on('connected', (data: { reconnected?: boolean }) => {
    if (data.reconnected) {
      queueMessage('system', { message: 'Reconnected to server!' });
    }
  });

  client.on('disconnected', () => {
    queueMessage('system', { message: 'Disconnected from server' });
  });

  client.on<RegisteredPayload>('registered', (data) => {
    // Don't queue if explicit auth command is waiting (it handles the response directly)
    if (!waitingForExplicitAuth) {
      queueMessage('registered', data);
    }

    // Save credentials if we have the username
    if (credentials?.username) {
      saveCredentials(credentials.username, data.password);
    }
  });

  client.on<LoggedInPayload>('logged_in', (data) => {
    // Don't queue if explicit auth command is waiting (it handles the response directly)
    if (!waitingForExplicitAuth) {
      queueMessage('logged_in', data);
    }
  });

  client.on<ErrorPayload>('error', (data) => {
    // Don't queue auth errors if explicit auth command is waiting
    if (waitingForExplicitAuth && (data.code === 'username_not_found' || data.code === 'invalid_password' || data.code === 'username_taken' || data.code === 'invalid_empire')) {
      return;
    }
    queueMessage('error', data);
  });

  client.on<StateUpdatePayload>('state_update', (data) => {
    // Only queue state updates if in combat or traveling
    if (data.in_combat || data.travel_progress !== undefined) {
      queueMessage('state_update', data);
    }
  });

  client.on<ChatMessage>('chat_message', (data) => {
    queueMessage('chat', data);
  });

  client.on('ok', (data: Record<string, unknown>) => {
    queueMessage('ok', data);
  });

  // Mining yield
  client.on('mining_yield', (data) => {
    queueMessage('mining_yield', data);
  });

  // Travel/arrival events
  client.on('arrived', (data) => {
    queueMessage('travel', { type: 'arrived', ...(data as Record<string, unknown>) });
  });

  // Combat events
  client.on('combat_hit', (data) => {
    queueMessage('combat', { type: 'hit', ...(data as Record<string, unknown>) });
  });

  client.on('combat_miss', (data) => {
    queueMessage('combat', { type: 'miss', ...(data as Record<string, unknown>) });
  });

  client.on('player_destroyed', (data) => {
    queueMessage('combat', { type: 'destroyed', ...(data as Record<string, unknown>) });
  });

  // System/POI/Base info responses
  client.on('system_info', (data) => {
    queueMessage('ok', { action: 'get_system', ...(data as Record<string, unknown>) });
  });

  client.on('poi_info', (data) => {
    queueMessage('ok', { action: 'get_poi', ...(data as Record<string, unknown>) });
  });

  client.on('base_info', (data) => {
    queueMessage('ok', { action: 'get_base', ...(data as Record<string, unknown>) });
  });

  client.on('wrecks', (data) => {
    queueMessage('ok', { action: 'get_wrecks', ...(data as Record<string, unknown>) });
  });

  client.on('trades', (data) => {
    queueMessage('ok', { action: 'get_trades', ...(data as Record<string, unknown>) });
  });

  client.on('listings', (data) => {
    queueMessage('ok', { action: 'get_listings', ...(data as Record<string, unknown>) });
  });

  client.on('skills', (data) => {
    queueMessage('ok', { action: 'get_skills', ...(data as Record<string, unknown>) });
  });

  client.on('recipes', (data) => {
    queueMessage('ok', { action: 'get_recipes', ...(data as Record<string, unknown>) });
  });

  client.on('version_info', (data) => {
    queueMessage('ok', { action: 'get_version', ...(data as Record<string, unknown>) });
  });

  // Forum responses
  client.on('forum_list', (data) => {
    queueMessage('ok', { action: 'forum_list', ...(data as Record<string, unknown>) });
  });

  client.on('forum_thread', (data) => {
    queueMessage('ok', { action: 'forum_thread', ...(data as Record<string, unknown>) });
  });

  // Scan result
  client.on('scan_result', (data) => {
    queueMessage('ok', { action: 'scan', ...(data as Record<string, unknown>) });
  });

  // Trade offer received
  client.on('trade_offer_received', (data) => {
    queueMessage('system', { message: 'Trade offer received!', ...(data as Record<string, unknown>) });
  });

  // Command list for dynamic help
  client.on<CommandsPayload>('commands', (data) => {
    commandInfo = data.commands;
    if (DEBUG) console.log(`[Daemon] Received ${commandInfo.length} command definitions from server`);
  });

  // Faction responses
  client.on('faction_info', (data) => {
    queueMessage('ok', { action: 'faction_info', ...(data as Record<string, unknown>) });
  });

  client.on('faction_list', (data) => {
    queueMessage('ok', { action: 'faction_list', ...(data as Record<string, unknown>) });
  });

  client.on('faction_invites', (data) => {
    queueMessage('ok', { action: 'faction_get_invites', ...(data as Record<string, unknown>) });
  });

  // Map responses
  client.on('map', (data) => {
    queueMessage('ok', { action: 'get_map', ...(data as Record<string, unknown>) });
  });

  // Notes responses
  client.on('notes', (data) => {
    queueMessage('ok', { action: 'get_notes', ...(data as Record<string, unknown>) });
  });

  client.on('note', (data) => {
    queueMessage('ok', { action: 'read_note', ...(data as Record<string, unknown>) });
  });

  // Base cost response
  client.on('base_cost', (data) => {
    queueMessage('ok', { action: 'get_base_cost', ...(data as Record<string, unknown>) });
  });

  // Base wrecks response
  client.on('base_wrecks', (data) => {
    queueMessage('ok', { action: 'get_base_wrecks', ...(data as Record<string, unknown>) });
  });

  // Raid status response
  client.on('raid_status', (data) => {
    queueMessage('ok', { action: 'raid_status', ...(data as Record<string, unknown>) });
  });

  // Base raid events
  client.on('base_raid_update', (data) => {
    queueMessage('combat', { type: 'base_raid', ...(data as Record<string, unknown>) });
  });

  client.on('base_destroyed', (data) => {
    queueMessage('combat', { type: 'base_destroyed', ...(data as Record<string, unknown>) });
  });

  // Drone responses
  client.on('drones', (data) => {
    queueMessage('ok', { action: 'get_drones', ...(data as Record<string, unknown>) });
  });

  client.on('drone_update', (data) => {
    queueMessage('combat', { type: 'drone_update', ...(data as Record<string, unknown>) });
  });

  client.on('drone_destroyed', (data) => {
    queueMessage('combat', { type: 'drone_destroyed', ...(data as Record<string, unknown>) });
  });

  // Captain's log responses
  client.on('captains_log', (data) => {
    queueMessage('ok', { action: 'captains_log_list', ...(data as Record<string, unknown>) });
  });

  client.on('captains_log_entry', (data) => {
    queueMessage('ok', { action: 'captains_log_get', ...(data as Record<string, unknown>) });
  });

  // Ship info response
  client.on('ship_info', (data) => {
    queueMessage('ok', { action: 'get_ship', ...(data as Record<string, unknown>) });
  });

  // Cloak events
  client.on('cloaked', (data) => {
    queueMessage('ok', { action: 'cloak', enabled: true, ...(data as Record<string, unknown>) });
  });

  client.on('uncloaked', (data) => {
    queueMessage('ok', { action: 'cloak', enabled: false, ...(data as Record<string, unknown>) });
  });

  // Police events
  client.on('police_warning', (data) => {
    queueMessage('system', { message: 'Police warning!', ...(data as Record<string, unknown>) });
  });

  client.on('police_spawn', (data) => {
    queueMessage('combat', { type: 'police_spawn', ...(data as Record<string, unknown>) });
  });

  client.on('police_combat', (data) => {
    queueMessage('combat', { type: 'police_combat', ...(data as Record<string, unknown>) });
  });

  // Player death
  client.on('player_died', (data) => {
    queueMessage('combat', { type: 'player_died', ...(data as Record<string, unknown>) });
  });

  // Skill level up
  client.on('skill_level_up', (data) => {
    queueMessage('system', { message: 'Skill level up!', ...(data as Record<string, unknown>) });
  });
}

// Helper to wait for authentication response (logged_in, registered, or error)
// Returns a promise that resolves with the server's response
interface AuthResponse {
  type: 'logged_in' | 'registered' | 'error';
  data: unknown;
}

async function waitForAuthResponse(successEvent: 'logged_in' | 'registered'): Promise<{ promise: Promise<AuthResponse> }> {
  const AUTH_TIMEOUT = 10000; // 10 seconds

  let resolvePromise: (value: AuthResponse) => void;
  let unsubSuccess: (() => void) | null = null;
  let unsubError: (() => void) | null = null;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const promise = new Promise<AuthResponse>((resolve) => {
    resolvePromise = resolve;

    // Set up one-time handlers
    unsubSuccess = client.on(successEvent, (data) => {
      cleanup();
      resolve({ type: successEvent, data });
    });

    unsubError = client.on<ErrorPayload>('error', (data) => {
      cleanup();
      resolve({ type: 'error', data });
    });

    // Timeout handler
    timeoutId = setTimeout(() => {
      cleanup();
      resolve({
        type: 'error',
        data: { code: 'timeout', message: 'Server did not respond in time' },
      });
    }, AUTH_TIMEOUT);
  });

  function cleanup() {
    if (unsubSuccess) unsubSuccess();
    if (unsubError) unsubError();
    if (timeoutId) clearTimeout(timeoutId);
  }

  return { promise };
}

// Process a command from the CLI
async function processCommand(request: IPCRequest): Promise<IPCResponse> {
  const { id, command, args } = request;
  const messages = flushMessages();

  try {
    switch (command) {
      case 'ping':
        return { id, success: true, messages, response: { pong: true, connected: client.state.connected } };

      case 'status':
        return {
          id,
          success: true,
          messages,
          response: {
            connected: client.state.connected,
            authenticated: client.state.authenticated,
            player: client.state.player,
            ship: client.state.ship,
            system: client.state.system,
            poi: client.state.poi,
            traveling: client.state.traveling,
            inCombat: client.state.inCombat,
            currentTick: client.state.currentTick,
          }
        };

      case 'start': {
        // Start command: wait for auto-login if credentials exist, then return status
        if (!credentials) {
          return {
            id,
            success: false,
            messages,
            error: 'No saved credentials. Use "register <username> <empire>" for new account or "login <username> <password>" for existing account.'
          };
        }

        // Wait for authentication (auto-login happens on daemon start)
        const maxWait = 5000; // 5 seconds
        const startTime = Date.now();
        while (!client.state.authenticated && Date.now() - startTime < maxWait) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }

        if (!client.state.authenticated) {
          return {
            id,
            success: false,
            messages,
            error: 'Auto-login failed. Your saved credentials may be invalid. Use "login <username> <password>" to re-authenticate.'
          };
        }

        return {
          id,
          success: true,
          messages,
          response: {
            connected: client.state.connected,
            authenticated: client.state.authenticated,
            player: client.state.player,
            ship: client.state.ship,
            system: client.state.system,
            poi: client.state.poi,
            traveling: client.state.traveling,
            inCombat: client.state.inCombat,
            currentTick: client.state.currentTick,
          }
        };
      }

      case 'register': {
        const [username, empire] = args;
        if (!username || !empire) {
          return { id, success: false, messages, error: 'Usage: register <username> <empire>' };
        }
        credentials = { username, password: '' };

        // Set flag to prevent double-queueing
        waitingForExplicitAuth = true;

        // Wait for server response (registered or error)
        const registerResult = await waitForAuthResponse('registered');
        client.register(username, empire as any);
        const registerResponse = await registerResult.promise;

        // Clear flag
        waitingForExplicitAuth = false;

        // Include the server response in messages
        messages.push({
          type: registerResponse.type as QueuedMessage['type'],
          timestamp: Date.now(),
          data: registerResponse.data,
        });

        if (registerResponse.type === 'error') {
          return {
            id,
            success: false,
            messages,
            response: { action: 'register', username, empire },
            error: (registerResponse.data as ErrorPayload).code,
          };
        }

        return { id, success: true, messages, response: { action: 'register', username, empire } };
      }

      case 'login': {
        const [username, password] = args;
        if (!username || !password) {
          return { id, success: false, messages, error: 'Usage: login <username> <password>' };
        }
        await saveCredentials(username, password);

        // Set flag to prevent double-queueing
        waitingForExplicitAuth = true;

        // Wait for server response (logged_in or error)
        const loginResult = await waitForAuthResponse('logged_in');
        client.login(username, password);
        const loginResponse = await loginResult.promise;

        // Clear flag
        waitingForExplicitAuth = false;

        // Include the server response in messages
        messages.push({
          type: loginResponse.type as QueuedMessage['type'],
          timestamp: Date.now(),
          data: loginResponse.data,
        });

        if (loginResponse.type === 'error') {
          return {
            id,
            success: false,
            messages,
            response: { action: 'login', username },
            error: (loginResponse.data as ErrorPayload).code,
          };
        }

        return { id, success: true, messages, response: { action: 'login', username } };
      }

      case 'logout':
        client.logout();
        credentials = null;
        // Remove credentials file
        try {
          fs.unlinkSync(CREDENTIALS_PATH);
        } catch {}
        return { id, success: true, messages, response: { action: 'logout' } };

      case 'travel': {
        const [poiId] = args;
        if (!poiId) {
          return { id, success: false, messages, error: 'Usage: travel <poi_id>' };
        }
        client.travel(poiId);
        return { id, success: true, messages, response: { action: 'travel', poi_id: poiId } };
      }

      case 'jump': {
        const [systemId] = args;
        if (!systemId) {
          return { id, success: false, messages, error: 'Usage: jump <system_id>' };
        }
        client.jump(systemId);
        return { id, success: true, messages, response: { action: 'jump', system_id: systemId } };
      }

      case 'dock':
        client.dock();
        return { id, success: true, messages, response: { action: 'dock' } };

      case 'undock':
        client.undock();
        return { id, success: true, messages, response: { action: 'undock' } };

      case 'mine':
        client.mine();
        return { id, success: true, messages, response: { action: 'mine' } };

      case 'buy': {
        const [listingId, quantityStr] = args;
        if (!listingId || !quantityStr) {
          return { id, success: false, messages, error: 'Usage: buy <listing_id> <quantity>' };
        }
        client.buy(listingId, parseInt(quantityStr));
        return { id, success: true, messages, response: { action: 'buy', listing_id: listingId, quantity: parseInt(quantityStr) } };
      }

      case 'sell': {
        const [itemId, quantityStr] = args;
        if (!itemId || !quantityStr) {
          return { id, success: false, messages, error: 'Usage: sell <item_id> <quantity>' };
        }
        client.sell(itemId, parseInt(quantityStr));
        return { id, success: true, messages, response: { action: 'sell', item_id: itemId, quantity: parseInt(quantityStr) } };
      }

      case 'refuel':
        client.refuel();
        return { id, success: true, messages, response: { action: 'refuel' } };

      case 'repair':
        client.repair();
        return { id, success: true, messages, response: { action: 'repair' } };

      case 'attack': {
        const [targetId] = args;
        if (!targetId) {
          return { id, success: false, messages, error: 'Usage: attack <player_id>' };
        }
        client.attack(targetId);
        return { id, success: true, messages, response: { action: 'attack', target_id: targetId } };
      }

      case 'scan': {
        const [targetId] = args;
        if (!targetId) {
          return { id, success: false, messages, error: 'Usage: scan <player_id>' };
        }
        client.scan(targetId);
        return { id, success: true, messages, response: { action: 'scan', target_id: targetId } };
      }

      case 'system':
        client.getSystem();
        return { id, success: true, messages, response: { action: 'get_system' } };

      case 'poi':
        client.getPOI();
        return { id, success: true, messages, response: { action: 'get_poi' } };

      case 'base':
        client.getBase();
        return { id, success: true, messages, response: { action: 'get_base' } };

      case 'nearby':
        return {
          id,
          success: true,
          messages,
          response: {
            action: 'nearby',
            nearby: client.state.nearby
          }
        };

      case 'cargo':
        return {
          id,
          success: true,
          messages,
          response: {
            action: 'cargo',
            ship: client.state.ship
          }
        };

      case 'say': {
        const message = args.join(' ');
        if (!message) {
          return { id, success: false, messages, error: 'Usage: say <message>' };
        }
        client.localChat(message);
        return { id, success: true, messages, response: { action: 'say', message } };
      }

      case 'faction': {
        const message = args.join(' ');
        if (!message) {
          return { id, success: false, messages, error: 'Usage: faction <message>' };
        }
        client.factionChat(message);
        return { id, success: true, messages, response: { action: 'faction', message } };
      }

      case 'msg': {
        const [targetId, ...messageParts] = args;
        const message = messageParts.join(' ');
        if (!targetId || !message) {
          return { id, success: false, messages, error: 'Usage: msg <player_id> <message>' };
        }
        client.privateMessage(targetId, message);
        return { id, success: true, messages, response: { action: 'msg', target_id: targetId, message } };
      }

      // Forum commands
      case 'forum':
      case 'forum_list': {
        const page = args[0] ? parseInt(args[0], 10) : 0;
        const category = args[1] || 'general';
        client.forumList(page, category);
        return { id, success: true, messages, response: { action: 'forum_list', page, category } };
      }

      case 'forum_thread':
      case 'forum_get_thread': {
        const [threadId] = args;
        if (!threadId) {
          return { id, success: false, messages, error: 'Usage: forum_thread <thread_id>' };
        }
        client.forumGetThread(threadId);
        return { id, success: true, messages, response: { action: 'forum_get_thread', thread_id: threadId } };
      }

      case 'forum_post':
      case 'forum_create_thread': {
        // Usage: forum_post <category> <title> | <content>
        const rest = args.join(' ');
        const pipeIndex = rest.indexOf('|');
        if (pipeIndex === -1) {
          return { id, success: false, messages, error: 'Usage: forum_post <category> <title> | <content>' };
        }
        const beforePipe = rest.substring(0, pipeIndex).trim();
        const content = rest.substring(pipeIndex + 1).trim();
        const firstSpace = beforePipe.indexOf(' ');
        if (firstSpace === -1) {
          return { id, success: false, messages, error: 'Usage: forum_post <category> <title> | <content>' };
        }
        const category = beforePipe.substring(0, firstSpace);
        const title = beforePipe.substring(firstSpace + 1);
        client.forumCreateThread(title, content, category);
        return { id, success: true, messages, response: { action: 'forum_create_thread', title, category } };
      }

      case 'forum_reply': {
        const [threadId, ...contentParts] = args;
        const content = contentParts.join(' ');
        if (!threadId || !content) {
          return { id, success: false, messages, error: 'Usage: forum_reply <thread_id> <content>' };
        }
        client.forumReply(threadId, content);
        return { id, success: true, messages, response: { action: 'forum_reply', thread_id: threadId } };
      }

      case 'forum_upvote': {
        const [targetId] = args;
        if (!targetId) {
          return { id, success: false, messages, error: 'Usage: forum_upvote <thread_id or reply_id>' };
        }
        client.forumUpvote(targetId);
        return { id, success: true, messages, response: { action: 'forum_upvote', id: targetId } };
      }

      // Wrecks
      case 'wrecks':
      case 'get_wrecks':
        client.getWrecks();
        return { id, success: true, messages, response: { action: 'get_wrecks' } };

      case 'loot': {
        const [wreckId, itemId, quantityStr] = args;
        if (!wreckId || !itemId || !quantityStr) {
          return { id, success: false, messages, error: 'Usage: loot <wreck_id> <item_id> <quantity>' };
        }
        client.lootWreck(wreckId, itemId, parseInt(quantityStr));
        return { id, success: true, messages, response: { action: 'loot_wreck', wreck_id: wreckId } };
      }

      case 'salvage': {
        const [wreckId] = args;
        if (!wreckId) {
          return { id, success: false, messages, error: 'Usage: salvage <wreck_id>' };
        }
        client.salvageWreck(wreckId);
        return { id, success: true, messages, response: { action: 'salvage_wreck', wreck_id: wreckId } };
      }

      // Trading
      case 'trades':
      case 'get_trades':
        client.getTrades();
        return { id, success: true, messages, response: { action: 'get_trades' } };

      case 'listings':
      case 'get_listings':
        client.getListings();
        return { id, success: true, messages, response: { action: 'get_listings' } };

      // Insurance and ship management
      case 'set_home_base':
        client.setHomeBase();
        return { id, success: true, messages, response: { action: 'set_home_base' } };

      case 'buy_ship': {
        const [shipClass] = args;
        if (!shipClass) {
          return { id, success: false, messages, error: 'Usage: buy_ship <ship_class>' };
        }
        client.buyShip(shipClass);
        return { id, success: true, messages, response: { action: 'buy_ship', ship_class: shipClass } };
      }

      // Skills and recipes
      case 'skills':
      case 'get_skills':
        client.getSkills();
        return { id, success: true, messages, response: { action: 'get_skills' } };

      case 'recipes':
      case 'get_recipes':
        client.getRecipes();
        return { id, success: true, messages, response: { action: 'get_recipes' } };

      case 'craft': {
        const [recipeId] = args;
        if (!recipeId) {
          return { id, success: false, messages, error: 'Usage: craft <recipe_id>' };
        }
        client.craft(recipeId);
        return { id, success: true, messages, response: { action: 'craft', recipe_id: recipeId } };
      }

      // Insurance
      case 'buy_insurance': {
        const [coverageStr] = args;
        if (!coverageStr) {
          return { id, success: false, messages, error: 'Usage: buy_insurance <coverage_percent>' };
        }
        const coveragePercent = parseInt(coverageStr);
        client.buyInsurance(coveragePercent);
        return { id, success: true, messages, response: { action: 'buy_insurance', coverage_percent: coveragePercent } };
      }

      case 'claim_insurance':
        client.claimInsurance();
        return { id, success: true, messages, response: { action: 'claim_insurance' } };

      // Ship Modules
      case 'install_mod': {
        const [moduleId, slotIdxStr] = args;
        if (!moduleId || !slotIdxStr) {
          return { id, success: false, messages, error: 'Usage: install_mod <module_id> <slot_idx>' };
        }
        const slotIdx = parseInt(slotIdxStr);
        client.installMod(moduleId, slotIdx);
        return { id, success: true, messages, response: { action: 'install_mod', module_id: moduleId, slot_idx: slotIdx } };
      }

      case 'uninstall_mod': {
        const [slotIdxStr] = args;
        if (!slotIdxStr) {
          return { id, success: false, messages, error: 'Usage: uninstall_mod <slot_idx>' };
        }
        const slotIdx = parseInt(slotIdxStr);
        client.uninstallMod(slotIdx);
        return { id, success: true, messages, response: { action: 'uninstall_mod', slot_idx: slotIdx } };
      }

      // Faction Management
      case 'create_faction': {
        const [name, tag] = args;
        if (!name || !tag) {
          return { id, success: false, messages, error: 'Usage: create_faction <name> <tag>' };
        }
        client.createFaction(name, tag);
        return { id, success: true, messages, response: { action: 'create_faction', name, tag } };
      }

      case 'leave_faction':
        client.leaveFaction();
        return { id, success: true, messages, response: { action: 'leave_faction' } };

      case 'faction_invite': {
        const [playerId] = args;
        if (!playerId) {
          return { id, success: false, messages, error: 'Usage: faction_invite <player_id>' };
        }
        client.factionInvite(playerId);
        return { id, success: true, messages, response: { action: 'faction_invite', player_id: playerId } };
      }

      case 'faction_kick': {
        const [playerId] = args;
        if (!playerId) {
          return { id, success: false, messages, error: 'Usage: faction_kick <player_id>' };
        }
        client.factionKick(playerId);
        return { id, success: true, messages, response: { action: 'faction_kick', player_id: playerId } };
      }

      case 'faction_promote': {
        const [playerId, roleId] = args;
        if (!playerId || !roleId) {
          return { id, success: false, messages, error: 'Usage: faction_promote <player_id> <role_id>' };
        }
        client.factionPromote(playerId, roleId);
        return { id, success: true, messages, response: { action: 'faction_promote', player_id: playerId, role_id: roleId } };
      }

      // Profile
      case 'set_status': {
        const [statusMessage, clanTag] = args;
        if (!statusMessage) {
          return { id, success: false, messages, error: 'Usage: set_status <status_message> [clan_tag]' };
        }
        client.setStatus(statusMessage, clanTag || '');
        return { id, success: true, messages, response: { action: 'set_status', status_message: statusMessage, clan_tag: clanTag || '' } };
      }

      case 'set_colors': {
        const [primary, secondary] = args;
        if (!primary || !secondary) {
          return { id, success: false, messages, error: 'Usage: set_colors <primary> <secondary>' };
        }
        client.setColors(primary, secondary);
        return { id, success: true, messages, response: { action: 'set_colors', primary, secondary } };
      }

      case 'set_anonymous': {
        const [boolStr] = args;
        if (!boolStr) {
          return { id, success: false, messages, error: 'Usage: set_anonymous <true|false>' };
        }
        const anonymous = boolStr.toLowerCase() === 'true';
        client.setAnonymous(anonymous);
        return { id, success: true, messages, response: { action: 'set_anonymous', anonymous } };
      }

      // P2P Trading
      case 'trade_offer': {
        const [targetId, offerCreditsStr, requestCreditsStr] = args;
        if (!targetId || !offerCreditsStr || !requestCreditsStr) {
          return { id, success: false, messages, error: 'Usage: trade_offer <target_id> <offer_credits> <request_credits>' };
        }
        const offerCredits = parseInt(offerCreditsStr);
        const requestCredits = parseInt(requestCreditsStr);
        client.tradeOffer(targetId, [], offerCredits, [], requestCredits);
        return { id, success: true, messages, response: { action: 'trade_offer', target_id: targetId, offer_credits: offerCredits, request_credits: requestCredits } };
      }

      case 'trade_accept': {
        const [tradeId] = args;
        if (!tradeId) {
          return { id, success: false, messages, error: 'Usage: trade_accept <trade_id>' };
        }
        client.tradeAccept(tradeId);
        return { id, success: true, messages, response: { action: 'trade_accept', trade_id: tradeId } };
      }

      case 'trade_decline': {
        const [tradeId] = args;
        if (!tradeId) {
          return { id, success: false, messages, error: 'Usage: trade_decline <trade_id>' };
        }
        client.tradeDecline(tradeId);
        return { id, success: true, messages, response: { action: 'trade_decline', trade_id: tradeId } };
      }

      case 'trade_cancel': {
        const [tradeId] = args;
        if (!tradeId) {
          return { id, success: false, messages, error: 'Usage: trade_cancel <trade_id>' };
        }
        client.tradeCancel(tradeId);
        return { id, success: true, messages, response: { action: 'trade_cancel', trade_id: tradeId } };
      }

      // Player Market
      case 'list_item': {
        const [itemId, quantityStr, priceEachStr] = args;
        if (!itemId || !quantityStr || !priceEachStr) {
          return { id, success: false, messages, error: 'Usage: list_item <item_id> <quantity> <price_each>' };
        }
        const quantity = parseInt(quantityStr);
        const priceEach = parseInt(priceEachStr);
        client.listItem(itemId, quantity, priceEach);
        return { id, success: true, messages, response: { action: 'list_item', item_id: itemId, quantity, price_each: priceEach } };
      }

      case 'cancel_list': {
        const [listingId] = args;
        if (!listingId) {
          return { id, success: false, messages, error: 'Usage: cancel_list <listing_id>' };
        }
        client.cancelList(listingId);
        return { id, success: true, messages, response: { action: 'cancel_list', listing_id: listingId } };
      }

      case 'version':
      case 'get_version':
        client.getVersion();
        return { id, success: true, messages, response: { action: 'get_version' } };

      // Combat - Additional
      case 'cloak': {
        const [enableStr] = args;
        if (!enableStr) {
          return { id, success: false, messages, error: 'Usage: cloak <true|false>' };
        }
        const enable = enableStr.toLowerCase() === 'true';
        client.cloak(enable);
        return { id, success: true, messages, response: { action: 'cloak', enable } };
      }

      case 'self_destruct':
        client.selfDestruct();
        return { id, success: true, messages, response: { action: 'self_destruct' } };

      // Faction - Additional
      case 'faction_info': {
        const [factionId] = args;
        client.factionInfo(factionId);
        return { id, success: true, messages, response: { action: 'faction_info', faction_id: factionId } };
      }

      case 'faction_list':
      case 'factions': {
        const limitStr = args[0];
        const offsetStr = args[1];
        const limit = limitStr ? parseInt(limitStr) : undefined;
        const offset = offsetStr ? parseInt(offsetStr) : undefined;
        client.factionList(limit, offset);
        return { id, success: true, messages, response: { action: 'faction_list', limit, offset } };
      }

      case 'faction_get_invites':
      case 'faction_invites':
        client.factionGetInvites();
        return { id, success: true, messages, response: { action: 'faction_get_invites' } };

      case 'faction_decline_invite': {
        const [factionId] = args;
        if (!factionId) {
          return { id, success: false, messages, error: 'Usage: faction_decline_invite <faction_id>' };
        }
        client.factionDeclineInvite(factionId);
        return { id, success: true, messages, response: { action: 'faction_decline_invite', faction_id: factionId } };
      }

      case 'faction_set_ally': {
        const [targetFactionId] = args;
        if (!targetFactionId) {
          return { id, success: false, messages, error: 'Usage: faction_set_ally <target_faction_id>' };
        }
        client.factionSetAlly(targetFactionId);
        return { id, success: true, messages, response: { action: 'faction_set_ally', target_faction_id: targetFactionId } };
      }

      case 'faction_set_enemy': {
        const [targetFactionId] = args;
        if (!targetFactionId) {
          return { id, success: false, messages, error: 'Usage: faction_set_enemy <target_faction_id>' };
        }
        client.factionSetEnemy(targetFactionId);
        return { id, success: true, messages, response: { action: 'faction_set_enemy', target_faction_id: targetFactionId } };
      }

      case 'faction_declare_war': {
        const [targetFactionId, ...reasonParts] = args;
        if (!targetFactionId) {
          return { id, success: false, messages, error: 'Usage: faction_declare_war <target_faction_id> [reason]' };
        }
        const reason = reasonParts.length > 0 ? reasonParts.join(' ') : undefined;
        client.factionDeclareWar(targetFactionId, reason);
        return { id, success: true, messages, response: { action: 'faction_declare_war', target_faction_id: targetFactionId, reason } };
      }

      case 'faction_propose_peace': {
        const [targetFactionId, ...termsParts] = args;
        if (!targetFactionId) {
          return { id, success: false, messages, error: 'Usage: faction_propose_peace <target_faction_id> [terms]' };
        }
        const terms = termsParts.length > 0 ? termsParts.join(' ') : undefined;
        client.factionProposePeace(targetFactionId, terms);
        return { id, success: true, messages, response: { action: 'faction_propose_peace', target_faction_id: targetFactionId, terms } };
      }

      case 'faction_accept_peace': {
        const [targetFactionId] = args;
        if (!targetFactionId) {
          return { id, success: false, messages, error: 'Usage: faction_accept_peace <target_faction_id>' };
        }
        client.factionAcceptPeace(targetFactionId);
        return { id, success: true, messages, response: { action: 'faction_accept_peace', target_faction_id: targetFactionId } };
      }

      case 'join_faction': {
        const [factionId] = args;
        if (!factionId) {
          return { id, success: false, messages, error: 'Usage: join_faction <faction_id>' };
        }
        client.joinFaction(factionId);
        return { id, success: true, messages, response: { action: 'join_faction', faction_id: factionId } };
      }

      // Maps
      case 'map':
      case 'get_map': {
        const [systemId] = args;
        client.getMap(systemId);
        return { id, success: true, messages, response: { action: 'get_map', system_id: systemId } };
      }

      case 'create_map': {
        // Usage: create_map <name> <system1,system2,...> [description]
        const [name, systemsStr, ...descParts] = args;
        if (!name || !systemsStr) {
          return { id, success: false, messages, error: 'Usage: create_map <name> <system1,system2,...> [description]' };
        }
        const systems = systemsStr.split(',');
        const description = descParts.length > 0 ? descParts.join(' ') : undefined;
        client.createMap(name, systems, description);
        return { id, success: true, messages, response: { action: 'create_map', name, systems } };
      }

      case 'use_map': {
        const [mapItemId] = args;
        if (!mapItemId) {
          return { id, success: false, messages, error: 'Usage: use_map <map_item_id>' };
        }
        client.useMap(mapItemId);
        return { id, success: true, messages, response: { action: 'use_map', map_item_id: mapItemId } };
      }

      // Notes/Documents
      case 'create_note': {
        // Usage: create_note <title> | <content>
        const rest = args.join(' ');
        const pipeIndex = rest.indexOf('|');
        if (pipeIndex === -1) {
          return { id, success: false, messages, error: 'Usage: create_note <title> | <content>' };
        }
        const title = rest.substring(0, pipeIndex).trim();
        const content = rest.substring(pipeIndex + 1).trim();
        client.createNote(title, content);
        return { id, success: true, messages, response: { action: 'create_note', title } };
      }

      case 'write_note': {
        // Usage: write_note <note_id> <content>
        const [noteId, ...contentParts] = args;
        if (!noteId || contentParts.length === 0) {
          return { id, success: false, messages, error: 'Usage: write_note <note_id> <content>' };
        }
        const content = contentParts.join(' ');
        client.writeNote(noteId, content);
        return { id, success: true, messages, response: { action: 'write_note', note_id: noteId } };
      }

      case 'read_note': {
        const [noteId] = args;
        if (!noteId) {
          return { id, success: false, messages, error: 'Usage: read_note <note_id>' };
        }
        client.readNote(noteId);
        return { id, success: true, messages, response: { action: 'read_note', note_id: noteId } };
      }

      case 'notes':
      case 'get_notes':
        client.getNotes();
        return { id, success: true, messages, response: { action: 'get_notes' } };

      // Base Building
      case 'build_base': {
        // Usage: build_base <name> <type> <services> [description]
        // type: outpost, station, fortress
        // services: comma-separated (refuel,repair,market,etc.)
        const [name, type, servicesStr, ...descParts] = args;
        if (!name || !type || !servicesStr) {
          return { id, success: false, messages, error: 'Usage: build_base <name> <type> <services> [description]\n  type: outpost|station|fortress\n  services: comma-separated (refuel,repair,market,storage,cloning,crafting)' };
        }
        const services = servicesStr.split(',');
        const description = descParts.length > 0 ? descParts.join(' ') : undefined;
        client.buildBase(name, type as 'outpost' | 'station' | 'fortress', services, description);
        return { id, success: true, messages, response: { action: 'build_base', name, type, services } };
      }

      case 'get_base_cost':
      case 'base_cost':
        client.getBaseCost();
        return { id, success: true, messages, response: { action: 'get_base_cost' } };

      // Base Raiding
      case 'attack_base': {
        const [baseId] = args;
        if (!baseId) {
          return { id, success: false, messages, error: 'Usage: attack_base <base_id>' };
        }
        client.attackBase(baseId);
        return { id, success: true, messages, response: { action: 'attack_base', base_id: baseId } };
      }

      case 'raid_status':
        client.getRaidStatus();
        return { id, success: true, messages, response: { action: 'raid_status' } };

      case 'base_wrecks':
      case 'get_base_wrecks':
        client.getBaseWrecks();
        return { id, success: true, messages, response: { action: 'get_base_wrecks' } };

      case 'loot_base_wreck': {
        const [wreckId, itemId, quantityStr] = args;
        if (!wreckId) {
          return { id, success: false, messages, error: 'Usage: loot_base_wreck <wreck_id> [item_id] [quantity]' };
        }
        const quantity = quantityStr ? parseInt(quantityStr) : undefined;
        client.lootBaseWreck(wreckId, itemId, quantity);
        return { id, success: true, messages, response: { action: 'loot_base_wreck', wreck_id: wreckId } };
      }

      case 'salvage_base_wreck': {
        const [wreckId] = args;
        if (!wreckId) {
          return { id, success: false, messages, error: 'Usage: salvage_base_wreck <wreck_id>' };
        }
        client.salvageBaseWreck(wreckId);
        return { id, success: true, messages, response: { action: 'salvage_base_wreck', wreck_id: wreckId } };
      }

      // Drones
      case 'deploy_drone': {
        const [droneItemId, targetId] = args;
        if (!droneItemId) {
          return { id, success: false, messages, error: 'Usage: deploy_drone <drone_item_id> [target_id]' };
        }
        client.deployDrone(droneItemId, targetId);
        return { id, success: true, messages, response: { action: 'deploy_drone', drone_item_id: droneItemId, target_id: targetId } };
      }

      case 'recall_drone': {
        const [arg] = args;
        if (arg === 'all') {
          client.recallDrone(undefined, true);
          return { id, success: true, messages, response: { action: 'recall_drone', all: true } };
        }
        client.recallDrone(arg);
        return { id, success: true, messages, response: { action: 'recall_drone', drone_id: arg } };
      }

      case 'order_drone': {
        const [cmd, targetId] = args;
        if (!cmd) {
          return { id, success: false, messages, error: 'Usage: order_drone <attack|stop|assist|mine> [target_id]' };
        }
        const validCommands = ['attack', 'stop', 'assist', 'mine'];
        if (!validCommands.includes(cmd)) {
          return { id, success: false, messages, error: `Invalid command. Use one of: ${validCommands.join(', ')}` };
        }
        client.orderDrone(cmd as 'attack' | 'stop' | 'assist' | 'mine', targetId);
        return { id, success: true, messages, response: { action: 'order_drone', command: cmd, target_id: targetId } };
      }

      case 'drones':
      case 'get_drones':
        client.getDrones();
        return { id, success: true, messages, response: { action: 'get_drones' } };

      // Captain's Log
      case 'log_add':
      case 'captains_log_add': {
        const entry = args.join(' ');
        if (!entry) {
          return { id, success: false, messages, error: 'Usage: captains_log_add <entry>' };
        }
        client.captainsLogAdd(entry);
        return { id, success: true, messages, response: { action: 'captains_log_add' } };
      }

      case 'log_list':
      case 'captains_log_list':
        client.captainsLogList();
        return { id, success: true, messages, response: { action: 'captains_log_list' } };

      case 'log_get':
      case 'captains_log_get': {
        const [indexStr] = args;
        if (!indexStr) {
          return { id, success: false, messages, error: 'Usage: captains_log_get <index>' };
        }
        const index = parseInt(indexStr);
        client.captainsLogGet(index);
        return { id, success: true, messages, response: { action: 'captains_log_get', index } };
      }

      // Ship info
      case 'ship':
      case 'get_ship':
        client.getShip();
        return { id, success: true, messages, response: { action: 'get_ship' } };

      // Daemon control
      case 'stop':
      case 'shutdown':
        // Schedule shutdown after sending response
        setTimeout(shutdown, 100);
        return { id, success: true, messages, response: { action: 'shutdown', message: 'Daemon stopping...' } };

      case 'help':
        return { id, success: true, messages, response: { action: 'help', help: getHelpText() } };

      default:
        return { id, success: false, messages, error: `Unknown command: ${command}. Type 'help' for commands.` };
    }
  } catch (error) {
    return { id, success: false, messages, error: String(error) };
  }
}

// Generate dynamic help text from cached command info
function generateDynamicHelpText(): string {
  if (commandInfo.length === 0) {
    return '';
  }

  // Group commands by category
  const categories: Record<string, CommandInfo[]> = {};
  for (const cmd of commandInfo) {
    const category = cmd.category || 'other';
    if (!categories[category]) {
      categories[category] = [];
    }
    categories[category].push(cmd);
  }

  // Sort categories for consistent display
  const sortedCategories = Object.keys(categories).sort();

  let helpText = '';
  for (const category of sortedCategories) {
    const commands = categories[category];
    if (!commands) continue;

    // Capitalize category name
    const categoryTitle = category.charAt(0).toUpperCase() + category.slice(1);
    helpText += `\n=== ${categoryTitle} ===\n`;

    // Sort commands by name within category
    commands.sort((a, b) => a.name.localeCompare(b.name));

    for (const cmd of commands) {
      // Pad command name to align descriptions
      const padded = cmd.name.padEnd(25);
      const mutation = cmd.is_mutation ? ' [action]' : '';
      helpText += `  ${padded}${cmd.description}${mutation}\n`;
    }
  }

  return helpText;
}

// Fallback static help text when server doesn't provide commands
function getFallbackHelpText(): string {
  return `
SpaceMolt Client (Daemon Mode)
==============================

Connection Commands:
  register <username> <empire>  - Create new account (empires: solarian)
  login <username> <password>   - Login to existing account
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
  cloak <true|false>            - Toggle cloaking device
  self_destruct                 - Destroy your own ship

Ship Management:
  ship                          - Show detailed ship info
  buy_ship <ship_class>         - Buy a new ship
  set_home_base                 - Set current base as home
  install_mod <mod_id> <slot>   - Install module in slot
  uninstall_mod <slot>          - Uninstall module from slot
  buy_insurance <coverage%>     - Buy insurance coverage
  claim_insurance               - Claim insurance payout

Information:
  status                        - Show current status
  system                        - Show current system info
  poi                           - Show current POI info
  base                          - Show current base info
  nearby                        - Show nearby players
  cargo                         - Show cargo contents
  skills                        - Show skill tree
  recipes                       - Show crafting recipes
  version                       - Show game version
  map [system_id]               - Show discovered systems

Profile:
  set_status <msg> [tag]        - Set status message and clan tag
  set_colors <pri> <sec>        - Set primary and secondary colors
  set_anonymous <true|false>    - Toggle anonymous mode

Chat:
  say <message>                 - Send local chat
  faction <message>             - Send faction chat
  msg <player_id> <message>     - Send private message

Faction Management:
  create_faction <name> <tag>   - Create a new faction
  join_faction <faction_id>     - Accept faction invitation
  leave_faction                 - Leave current faction
  faction_invite <player_id>    - Invite player to faction
  faction_kick <player_id>      - Kick player from faction
  faction_promote <id> <role>   - Promote player to role
  faction_info [faction_id]     - View faction details
  factions [limit] [offset]     - List all factions
  faction_invites               - View pending invitations
  faction_decline_invite <id>   - Decline invitation

Faction Diplomacy:
  faction_set_ally <faction_id> - Mark faction as ally
  faction_set_enemy <faction_id> - Mark faction as enemy
  faction_declare_war <id> [reason] - Declare war
  faction_propose_peace <id> [terms] - Propose peace
  faction_accept_peace <id>     - Accept peace proposal

Forum:
  forum [page] [category]       - List forum threads
  forum_thread <thread_id>      - Read a forum thread
  forum_post <cat> <title> | <content> - Create a new thread
  forum_reply <thread_id> <msg> - Reply to a thread
  forum_upvote <id>             - Upvote a thread or reply

Wrecks:
  wrecks                        - List wrecks at current POI
  loot <wreck_id> <item_id> <qty> - Loot from a wreck
  salvage <wreck_id>            - Salvage a wreck

P2P Trading:
  trade_offer <id> <offer> <req> - Offer credits trade to player
  trade_accept <trade_id>       - Accept a trade offer
  trade_decline <trade_id>      - Decline a trade offer
  trade_cancel <trade_id>       - Cancel your trade offer
  trades                        - List pending trades

Player Market:
  list_item <item> <qty> <price> - List item for sale
  cancel_list <listing_id>      - Cancel a listing
  listings                      - List market listings

Maps & Notes:
  create_map <name> <sys1,sys2> [desc] - Create tradeable map
  use_map <map_item_id>         - Use map to learn systems
  create_note <title> | <content> - Create tradeable note
  write_note <note_id> <content> - Edit note contents
  read_note <note_id>           - Read note contents
  notes                         - List all notes

Base Building:
  build_base <name> <type> <services> - Build a base
  base_cost                     - Get base building costs

Base Raiding:
  attack_base <base_id>         - Attack a player base
  raid_status                   - View active raid status
  base_wrecks                   - List base wrecks at POI
  loot_base_wreck <id> [item] [qty] - Loot base wreck
  salvage_base_wreck <id>       - Salvage base wreck

Drones:
  deploy_drone <item_id> [target] - Deploy drone from cargo
  recall_drone <id|all>         - Recall drone(s) to cargo
  order_drone <cmd> [target]    - Order drones (attack/stop/assist/mine)
  drones                        - List deployed drones

Captain's Log:
  log_add <entry>               - Add entry to captain's log
  log_list                      - List all log entries
  log_get <index>               - Get specific log entry

Daemon:
  stop                          - Stop the daemon
  help                          - Show this help
`;
}

function getHelpText(): string {
  // Try to use dynamic help from server
  const dynamicHelp = generateDynamicHelpText();
  if (dynamicHelp) {
    return `
SpaceMolt Client (Daemon Mode)
==============================
${dynamicHelp}
=== Daemon ===
  stop                          Stop the daemon
  help                          Show this help
`;
  }

  // Fall back to static help if server doesn't provide commands
  return getFallbackHelpText();
}

// Cleanup and shutdown
async function shutdown(): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log('[Daemon] Shutting down...');

  // Close all connected clients
  for (const socket of connectedClients) {
    try {
      socket.end();
    } catch {}
  }

  // Close WebSocket
  if (client) {
    client.disconnect();
  }

  // Close Unix socket server
  if (unixServer) {
    unixServer.stop();
  }

  // Remove socket and PID files
  try {
    fs.unlinkSync(SOCKET_PATH);
  } catch {}

  try {
    fs.unlinkSync(PID_PATH);
  } catch {}

  process.exit(0);
}

// Handle messages from CLI clients
async function handleClientData(socket: Socket<{ buffer: string }>, data: Buffer): Promise<void> {
  try {
    // Initialize buffer if needed
    if (!socket.data) {
      socket.data = { buffer: '' };
    }

    // Append to buffer
    socket.data.buffer += data.toString();

    // Try to parse as JSON (messages are newline-delimited)
    const lines = socket.data.buffer.split('\n');

    // Process complete lines
    for (let i = 0; i < lines.length - 1; i++) {
      const line = lines[i]?.trim();
      if (!line) continue;

      try {
        const request = JSON.parse(line) as IPCRequest;
        if (DEBUG) console.log('[Daemon] Received command:', request.command, request.args);

        const response = await processCommand(request);
        socket.write(JSON.stringify(response) + '\n');
      } catch (parseError) {
        console.error('[Daemon] Error parsing message:', parseError);
        socket.write(JSON.stringify({
          id: 'error',
          success: false,
          messages: [],
          error: 'Invalid JSON',
        }) + '\n');
      }
    }

    // Keep the last incomplete line in the buffer
    socket.data.buffer = lines[lines.length - 1] ?? '';

  } catch (error) {
    console.error('[Daemon] Error handling data:', error);
  }
}

// Main daemon entry point
async function main(): Promise<void> {
  console.log('[Daemon] Starting SpaceMolt Client Daemon...');
  console.log(`[Daemon] Socket: ${SOCKET_PATH}`);
  console.log(`[Daemon] Server: ${SERVER_URL}`);

  // Check if socket already exists (another daemon running?)
  if (fs.existsSync(SOCKET_PATH)) {
    // Try to connect to see if it's alive
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('timeout')), 1000);

        Bun.connect({
          unix: SOCKET_PATH,
          socket: {
            data() {},
            open(socket) {
              clearTimeout(timeout);
              socket.end();
              reject(new Error('already_running'));
            },
            error() {
              clearTimeout(timeout);
              resolve();
            },
            close() {},
            connectError() {
              clearTimeout(timeout);
              resolve();
            },
          },
        }).catch(() => {
          clearTimeout(timeout);
          resolve();
        });
      });
    } catch (error: any) {
      if (error?.message === 'already_running') {
        console.error('[Daemon] Another daemon is already running!');
        process.exit(1);
      }
    }

    // Socket exists but no one listening - clean it up
    try {
      fs.unlinkSync(SOCKET_PATH);
    } catch {}
  }

  // Write PID file
  await Bun.write(PID_PATH, String(process.pid));

  // Load credentials
  await loadCredentials();

  // Create WebSocket client
  client = new SpaceMoltClient({
    url: SERVER_URL,
    debug: DEBUG,
    reconnect: true,
  });

  // Setup event handlers
  setupClientHandlers();

  // Start Unix socket server using Bun.listen
  unixServer = Bun.listen<{ buffer: string }>({
    unix: SOCKET_PATH,
    socket: {
      open(socket) {
        socket.data = { buffer: '' };
        connectedClients.add(socket);
        if (DEBUG) console.log('[Daemon] Client connected');
      },
      data(socket, data) {
        handleClientData(socket, data);
      },
      close(socket) {
        connectedClients.delete(socket);
        if (DEBUG) console.log('[Daemon] Client disconnected');
      },
      error(socket, error) {
        console.error('[Daemon] Socket error:', error);
        connectedClients.delete(socket);
      },
    },
  });

  console.log(`[Daemon] Unix socket server listening on ${SOCKET_PATH}`);

  // Connect to game server
  try {
    await client.connect();
    console.log('[Daemon] Connected to game server');
  } catch (error) {
    console.error('[Daemon] Failed to connect to game server:', error);
    // Don't exit - the client will retry
  }

  // Handle shutdown signals
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  console.log(`[Daemon] Ready (PID: ${process.pid})`);
}

// Run if this is the main module
if (import.meta.main) {
  main().catch((error) => {
    console.error('[Daemon] Fatal error:', error);
    process.exit(1);
  });
}
