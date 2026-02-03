import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import { SpaceMoltClient, type ClientState } from './client';
import type {
  EmpireID,
  CargoItem,
  WelcomePayload,
  RegisteredPayload,
  LoggedInPayload,
  StateUpdatePayload,
  ErrorPayload,
  ScanResultPayload,
  ChatMessage,
} from './types';

// Helper to capture sent messages
function createMockClient(): { client: SpaceMoltClient; messages: any[] } {
  const client = new SpaceMoltClient({
    url: 'ws://localhost:8080/ws',
    debug: false,
  });
  const messages: any[] = [];

  // Mock the send method to capture messages
  (client as any).send = (type: string, payload?: any) => {
    messages.push({ type, payload });
  };

  return { client, messages };
}

describe('SpaceMoltClient', () => {
  describe('Constructor and Options', () => {
    test('creates client with default options', () => {
      const client = new SpaceMoltClient({ url: 'ws://localhost:8080/ws' });
      expect((client as any).options.url).toBe('ws://localhost:8080/ws');
      expect((client as any).options.reconnect).toBe(true);
      expect((client as any).options.reconnectDelay).toBe(5000);
      expect((client as any).options.debug).toBe(false);
    });

    test('creates client with custom options', () => {
      const client = new SpaceMoltClient({
        url: 'ws://custom:9000/ws',
        reconnect: false,
        reconnectDelay: 10000,
        debug: true,
      });
      expect((client as any).options.url).toBe('ws://custom:9000/ws');
      expect((client as any).options.reconnect).toBe(false);
      expect((client as any).options.reconnectDelay).toBe(10000);
      expect((client as any).options.debug).toBe(true);
    });

    test('initializes with default state', () => {
      const client = new SpaceMoltClient({ url: 'ws://localhost:8080/ws' });
      expect(client.state).toEqual({
        connected: false,
        authenticated: false,
        player: null,
        ship: null,
        system: null,
        poi: null,
        base: null,
        nearby: [],
        inCombat: false,
        currentTick: 0,
        traveling: null,
      });
    });
  });

  describe('Authentication', () => {
    test('register sends correct message', () => {
      const { client, messages } = createMockClient();

      client.register('testuser', 'solarian');

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({
        type: 'register',
        payload: { username: 'testuser', empire: 'solarian' },
      });
    });

    test('register works with all empires', () => {
      const empires: EmpireID[] = ['solarian', 'voidborn', 'crimson', 'nebula', 'outerrim'];

      for (const empire of empires) {
        const { client, messages } = createMockClient();
        client.register(`player_${empire}`, empire);
        expect(messages[0].payload.empire).toBe(empire);
      }
    });

    test('login sends correct message and saves credentials', () => {
      const { client, messages } = createMockClient();

      client.login('testuser', 'secret-token-123');

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({
        type: 'login',
        payload: { username: 'testuser', token: 'secret-token-123' },
      });

      // Verify credentials are saved
      expect(client.getSavedCredentials()).toEqual({
        username: 'testuser',
        token: 'secret-token-123',
      });
    });

    test('logout sends message and clears state', () => {
      const { client, messages } = createMockClient();

      // Set up initial state
      client.state.authenticated = true;
      client.state.player = { id: 'p1', username: 'test' } as any;
      client.state.ship = { id: 's1' } as any;
      client.login('testuser', 'token');

      messages.length = 0; // Clear login message

      client.logout();

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({ type: 'logout', payload: undefined });
      expect(client.state.authenticated).toBe(false);
      expect(client.state.player).toBeNull();
      expect(client.state.ship).toBeNull();
      expect(client.getSavedCredentials()).toBeNull();
    });

    test('clearCredentials removes saved credentials', () => {
      const { client } = createMockClient();

      client.login('testuser', 'token');
      expect(client.getSavedCredentials()).not.toBeNull();

      client.clearCredentials();
      expect(client.getSavedCredentials()).toBeNull();
    });
  });

  describe('Navigation', () => {
    test('travel sends correct message', () => {
      const { client, messages } = createMockClient();

      client.travel('asteroid-belt-1');

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({
        type: 'travel',
        payload: { target_poi: 'asteroid-belt-1' },
      });
    });

    test('jump sends correct message', () => {
      const { client, messages } = createMockClient();

      client.jump('alpha-centauri');

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({
        type: 'jump',
        payload: { target_system: 'alpha-centauri' },
      });
    });

    test('dock sends correct message', () => {
      const { client, messages } = createMockClient();

      client.dock();

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({ type: 'dock', payload: undefined });
    });

    test('undock sends correct message', () => {
      const { client, messages } = createMockClient();

      client.undock();

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({ type: 'undock', payload: undefined });
    });
  });

  describe('Combat', () => {
    test('attack sends correct message', () => {
      const { client, messages } = createMockClient();

      client.attack('player-123');

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({
        type: 'attack',
        payload: { target_id: 'player-123' },
      });
    });

    test('scan sends correct message', () => {
      const { client, messages } = createMockClient();

      client.scan('unknown-ship-456');

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({
        type: 'scan',
        payload: { target_id: 'unknown-ship-456' },
      });
    });
  });

  describe('Mining', () => {
    test('mine sends correct message', () => {
      const { client, messages } = createMockClient();

      client.mine();

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({ type: 'mine', payload: undefined });
    });
  });

  describe('Trading - NPC Market', () => {
    test('buy sends correct message', () => {
      const { client, messages } = createMockClient();

      client.buy('listing-789', 100);

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({
        type: 'buy',
        payload: { listing_id: 'listing-789', quantity: 100 },
      });
    });

    test('sell sends correct message', () => {
      const { client, messages } = createMockClient();

      client.sell('iron-ore', 50);

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({
        type: 'sell',
        payload: { item_id: 'iron-ore', quantity: 50 },
      });
    });

    test('refuel sends correct message', () => {
      const { client, messages } = createMockClient();

      client.refuel();

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({ type: 'refuel', payload: undefined });
    });

    test('repair sends correct message', () => {
      const { client, messages } = createMockClient();

      client.repair();

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({ type: 'repair', payload: undefined });
    });
  });

  describe('Trading - Player Market (Auction House)', () => {
    test('listItem sends correct message', () => {
      const { client, messages } = createMockClient();

      client.listItem('rare-crystal', 10, 5000);

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({
        type: 'list_item',
        payload: { item_id: 'rare-crystal', quantity: 10, price_each: 5000 },
      });
    });

    test('buyListing sends correct message', () => {
      const { client, messages } = createMockClient();

      client.buyListing('listing-abc', 5);

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({
        type: 'buy_listing',
        payload: { listing_id: 'listing-abc', quantity: 5 },
      });
    });

    test('cancelList sends correct message', () => {
      const { client, messages } = createMockClient();

      client.cancelList('listing-xyz');

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({
        type: 'cancel_list',
        payload: { listing_id: 'listing-xyz' },
      });
    });

    test('getListings sends correct message', () => {
      const { client, messages } = createMockClient();

      client.getListings();

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({ type: 'get_listings', payload: undefined });
    });
  });

  describe('Trading - Player to Player', () => {
    test('tradeOffer sends correct message with full payload', () => {
      const { client, messages } = createMockClient();

      const offerItems: CargoItem[] = [
        { item_id: 'iron-ore', quantity: 100 },
        { item_id: 'copper-ore', quantity: 50 },
      ];
      const requestItems: CargoItem[] = [
        { item_id: 'refined-iron', quantity: 20 },
      ];

      client.tradeOffer('player-456', offerItems, 1000, requestItems, 500);

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({
        type: 'trade_offer',
        payload: {
          target_id: 'player-456',
          offer_items: offerItems,
          offer_credits: 1000,
          request_items: requestItems,
          request_credits: 500,
        },
      });
    });

    test('tradeOffer with empty items', () => {
      const { client, messages } = createMockClient();

      client.tradeOffer('player-789', [], 5000, [], 0);

      expect(messages[0].payload).toEqual({
        target_id: 'player-789',
        offer_items: [],
        offer_credits: 5000,
        request_items: [],
        request_credits: 0,
      });
    });

    test('tradeAccept sends correct message', () => {
      const { client, messages } = createMockClient();

      client.tradeAccept('trade-123');

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({
        type: 'trade_accept',
        payload: { trade_id: 'trade-123' },
      });
    });

    test('tradeDecline sends correct message', () => {
      const { client, messages } = createMockClient();

      client.tradeDecline('trade-456');

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({
        type: 'trade_decline',
        payload: { trade_id: 'trade-456' },
      });
    });

    test('tradeCancel sends correct message', () => {
      const { client, messages } = createMockClient();

      client.tradeCancel('trade-789');

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({
        type: 'trade_cancel',
        payload: { trade_id: 'trade-789' },
      });
    });

    test('getTrades sends correct message', () => {
      const { client, messages } = createMockClient();

      client.getTrades();

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({ type: 'get_trades', payload: undefined });
    });
  });

  describe('Crafting', () => {
    test('craft sends correct message', () => {
      const { client, messages } = createMockClient();

      client.craft('recipe-refined-iron');

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({
        type: 'craft',
        payload: { recipe_id: 'recipe-refined-iron' },
      });
    });
  });

  describe('Chat', () => {
    test('chat sends correct message with all parameters', () => {
      const { client, messages } = createMockClient();

      client.chat('private', 'Hello there!', 'player-123');

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({
        type: 'chat',
        payload: {
          channel: 'private',
          content: 'Hello there!',
          target_id: 'player-123',
        },
      });
    });

    test('localChat sends to local channel', () => {
      const { client, messages } = createMockClient();

      client.localChat('Anyone want to trade?');

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({
        type: 'chat',
        payload: {
          channel: 'local',
          content: 'Anyone want to trade?',
          target_id: undefined,
        },
      });
    });

    test('factionChat sends to faction channel', () => {
      const { client, messages } = createMockClient();

      client.factionChat('Fleet assembling at base alpha');

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({
        type: 'chat',
        payload: {
          channel: 'faction',
          content: 'Fleet assembling at base alpha',
          target_id: undefined,
        },
      });
    });

    test('privateMessage sends to specific player', () => {
      const { client, messages } = createMockClient();

      client.privateMessage('player-secret', 'Confidential info');

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({
        type: 'chat',
        payload: {
          channel: 'private',
          content: 'Confidential info',
          target_id: 'player-secret',
        },
      });
    });
  });

  describe('Faction Management', () => {
    test('createFaction sends correct message', () => {
      const { client, messages } = createMockClient();

      client.createFaction('Space Pirates', 'SPRT');

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({
        type: 'create_faction',
        payload: { name: 'Space Pirates', tag: 'SPRT' },
      });
    });

    test('joinFaction sends correct message', () => {
      const { client, messages } = createMockClient();

      client.joinFaction('faction-123');

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({
        type: 'join_faction',
        payload: { faction_id: 'faction-123' },
      });
    });

    test('leaveFaction sends correct message', () => {
      const { client, messages } = createMockClient();

      client.leaveFaction();

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({ type: 'leave_faction', payload: undefined });
    });

    test('factionInvite sends correct message', () => {
      const { client, messages } = createMockClient();

      client.factionInvite('player-recruit');

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({
        type: 'faction_invite',
        payload: { player_id: 'player-recruit' },
      });
    });

    test('factionKick sends correct message', () => {
      const { client, messages } = createMockClient();

      client.factionKick('player-traitor');

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({
        type: 'faction_kick',
        payload: { player_id: 'player-traitor' },
      });
    });

    test('factionPromote sends correct message', () => {
      const { client, messages } = createMockClient();

      client.factionPromote('player-deserving', 'officer');

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({
        type: 'faction_promote',
        payload: { player_id: 'player-deserving', role_id: 'officer' },
      });
    });
  });

  describe('Profile Settings', () => {
    test('setStatus sends correct message', () => {
      const { client, messages } = createMockClient();

      client.setStatus('Looking for group!', 'LFG');

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({
        type: 'set_status',
        payload: { status_message: 'Looking for group!', clan_tag: 'LFG' },
      });
    });

    test('setColors sends correct message', () => {
      const { client, messages } = createMockClient();

      client.setColors('#FF0000', '#00FF00');

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({
        type: 'set_colors',
        payload: { primary_color: '#FF0000', secondary_color: '#00FF00' },
      });
    });

    test('setAnonymous sends correct message for true', () => {
      const { client, messages } = createMockClient();

      client.setAnonymous(true);

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({
        type: 'set_anonymous',
        payload: { anonymous: true },
      });
    });

    test('setAnonymous sends correct message for false', () => {
      const { client, messages } = createMockClient();

      client.setAnonymous(false);

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({
        type: 'set_anonymous',
        payload: { anonymous: false },
      });
    });
  });

  describe('Wrecks', () => {
    test('getWrecks sends correct message', () => {
      const { client, messages } = createMockClient();

      client.getWrecks();

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({ type: 'get_wrecks', payload: undefined });
    });

    test('lootWreck sends correct message', () => {
      const { client, messages } = createMockClient();

      client.lootWreck('wreck-123', 'salvage-metal', 25);

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({
        type: 'loot_wreck',
        payload: { wreck_id: 'wreck-123', item_id: 'salvage-metal', quantity: 25 },
      });
    });

    test('salvageWreck sends correct message', () => {
      const { client, messages } = createMockClient();

      client.salvageWreck('wreck-456');

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({
        type: 'salvage_wreck',
        payload: { wreck_id: 'wreck-456' },
      });
    });
  });

  describe('Insurance', () => {
    test('buyInsurance sends correct message', () => {
      const { client, messages } = createMockClient();

      client.buyInsurance(75);

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({
        type: 'buy_insurance',
        payload: { coverage_percent: 75 },
      });
    });

    test('claimInsurance sends correct message', () => {
      const { client, messages } = createMockClient();

      client.claimInsurance();

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({ type: 'claim_insurance', payload: undefined });
    });

    test('setHomeBase sends correct message', () => {
      const { client, messages } = createMockClient();

      client.setHomeBase();

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({ type: 'set_home_base', payload: undefined });
    });
  });

  describe('Ship Management', () => {
    test('buyShip sends correct message', () => {
      const { client, messages } = createMockClient();

      client.buyShip('cruiser-mk2');

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({
        type: 'buy_ship',
        payload: { ship_class: 'cruiser-mk2' },
      });
    });

    test('installMod sends correct message', () => {
      const { client, messages } = createMockClient();

      client.installMod('laser-cannon-3', 0);

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({
        type: 'install_mod',
        payload: { module_id: 'laser-cannon-3', slot_idx: 0 },
      });
    });

    test('installMod with different slot indices', () => {
      const { client, messages } = createMockClient();

      client.installMod('shield-booster', 5);

      expect(messages[0].payload).toEqual({
        module_id: 'shield-booster',
        slot_idx: 5,
      });
    });

    test('uninstallMod sends correct message', () => {
      const { client, messages } = createMockClient();

      client.uninstallMod(2);

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({
        type: 'uninstall_mod',
        payload: { slot_idx: 2 },
      });
    });
  });

  describe('Queries', () => {
    test('getStatus sends correct message', () => {
      const { client, messages } = createMockClient();

      client.getStatus();

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({ type: 'get_status', payload: undefined });
    });

    test('getSystem sends correct message', () => {
      const { client, messages } = createMockClient();

      client.getSystem();

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({ type: 'get_system', payload: undefined });
    });

    test('getPOI sends correct message', () => {
      const { client, messages } = createMockClient();

      client.getPOI();

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({ type: 'get_poi', payload: undefined });
    });

    test('getBase sends correct message', () => {
      const { client, messages } = createMockClient();

      client.getBase();

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({ type: 'get_base', payload: undefined });
    });

    test('getShip sends correct message', () => {
      const { client, messages } = createMockClient();

      client.getShip();

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({ type: 'get_ship', payload: undefined });
    });

    test('getSkills sends correct message', () => {
      const { client, messages } = createMockClient();

      client.getSkills();

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({ type: 'get_skills', payload: undefined });
    });

    test('getRecipes sends correct message', () => {
      const { client, messages } = createMockClient();

      client.getRecipes();

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({ type: 'get_recipes', payload: undefined });
    });

    test('getVersion sends correct message', () => {
      const { client, messages } = createMockClient();

      client.getVersion();

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({ type: 'get_version', payload: undefined });
    });
  });

  describe('Forum', () => {
    test('forumList sends correct message with defaults', () => {
      const { client, messages } = createMockClient();

      client.forumList();

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({
        type: 'forum_list',
        payload: { page: 0, category: 'general' },
      });
    });

    test('forumList sends correct message with custom params', () => {
      const { client, messages } = createMockClient();

      client.forumList(2, 'bugs');

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({
        type: 'forum_list',
        payload: { page: 2, category: 'bugs' },
      });
    });

    test('forumGetThread sends correct message', () => {
      const { client, messages } = createMockClient();

      client.forumGetThread('thread-123');

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({
        type: 'forum_get_thread',
        payload: { thread_id: 'thread-123' },
      });
    });

    test('forumCreateThread sends correct message with default category', () => {
      const { client, messages } = createMockClient();

      client.forumCreateThread('My Title', 'My content here');

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({
        type: 'forum_create_thread',
        payload: {
          title: 'My Title',
          content: 'My content here',
          category: 'general',
        },
      });
    });

    test('forumCreateThread sends correct message with custom category', () => {
      const { client, messages } = createMockClient();

      client.forumCreateThread('Bug Report', 'Found a bug!', 'bugs');

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({
        type: 'forum_create_thread',
        payload: {
          title: 'Bug Report',
          content: 'Found a bug!',
          category: 'bugs',
        },
      });
    });

    test('forumReply sends correct message', () => {
      const { client, messages } = createMockClient();

      client.forumReply('thread-456', 'This is my reply');

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({
        type: 'forum_reply',
        payload: {
          thread_id: 'thread-456',
          content: 'This is my reply',
        },
      });
    });

    test('forumUpvote thread sends correct message', () => {
      const { client, messages } = createMockClient();

      client.forumUpvote('thread-789');

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({
        type: 'forum_upvote',
        payload: { thread_id: 'thread-789' },
      });
    });

    test('forumUpvote reply sends correct message', () => {
      const { client, messages } = createMockClient();

      client.forumUpvote(undefined, 'reply-123');

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({
        type: 'forum_upvote',
        payload: { reply_id: 'reply-123' },
      });
    });

    test('forumUpvote with neither thread nor reply sends nothing', () => {
      const { client, messages } = createMockClient();

      client.forumUpvote();

      expect(messages).toHaveLength(0);
    });

    test('forumDeleteThread sends correct message', () => {
      const { client, messages } = createMockClient();

      client.forumDeleteThread('thread-to-delete');

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({
        type: 'forum_delete_thread',
        payload: { thread_id: 'thread-to-delete' },
      });
    });

    test('forumDeleteReply sends correct message', () => {
      const { client, messages } = createMockClient();

      client.forumDeleteReply('reply-to-delete');

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({
        type: 'forum_delete_reply',
        payload: { reply_id: 'reply-to-delete' },
      });
    });
  });

  describe('Event Handling', () => {
    test('on registers event handler and returns unsubscribe function', () => {
      const client = new SpaceMoltClient({ url: 'ws://localhost:8080/ws' });
      const handler = mock(() => {});

      const unsubscribe = client.on('test_event', handler);

      expect(typeof unsubscribe).toBe('function');
      expect((client as any).eventHandlers.get('test_event')?.size).toBe(1);
    });

    test('unsubscribe function removes handler', () => {
      const client = new SpaceMoltClient({ url: 'ws://localhost:8080/ws' });
      const handler = mock(() => {});

      const unsubscribe = client.on('test_event', handler);
      unsubscribe();

      expect((client as any).eventHandlers.get('test_event')?.size).toBe(0);
    });

    test('off removes event handler', () => {
      const client = new SpaceMoltClient({ url: 'ws://localhost:8080/ws' });
      const handler = mock(() => {});

      client.on('test_event', handler);
      client.off('test_event', handler);

      expect((client as any).eventHandlers.get('test_event')?.size).toBe(0);
    });

    test('multiple handlers can be registered for same event', () => {
      const client = new SpaceMoltClient({ url: 'ws://localhost:8080/ws' });
      const handler1 = mock(() => {});
      const handler2 = mock(() => {});

      client.on('test_event', handler1);
      client.on('test_event', handler2);

      expect((client as any).eventHandlers.get('test_event')?.size).toBe(2);
    });

    test('emit calls all registered handlers', () => {
      const client = new SpaceMoltClient({ url: 'ws://localhost:8080/ws' });
      const handler1 = mock(() => {});
      const handler2 = mock(() => {});

      client.on('test_event', handler1);
      client.on('test_event', handler2);

      (client as any).emit('test_event', { data: 'test' });

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler1).toHaveBeenCalledWith({ data: 'test' });
      expect(handler2).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledWith({ data: 'test' });
    });

    test('emit does nothing for events with no handlers', () => {
      const client = new SpaceMoltClient({ url: 'ws://localhost:8080/ws' });

      // Should not throw
      expect(() => {
        (client as any).emit('nonexistent_event', { data: 'test' });
      }).not.toThrow();
    });

    test('handler errors do not affect other handlers', () => {
      const client = new SpaceMoltClient({ url: 'ws://localhost:8080/ws', debug: false });
      const errorHandler = mock(() => { throw new Error('Test error'); });
      const successHandler = mock(() => {});

      client.on('test_event', errorHandler);
      client.on('test_event', successHandler);

      // Should not throw and should call both handlers
      (client as any).emit('test_event', { data: 'test' });

      expect(errorHandler).toHaveBeenCalledTimes(1);
      expect(successHandler).toHaveBeenCalledTimes(1);
    });
  });

  describe('Message Handling', () => {
    test('handleWelcome updates currentTick and emits event', () => {
      const client = new SpaceMoltClient({ url: 'ws://localhost:8080/ws' });
      const handler = mock(() => {});
      client.on('welcome', handler);

      const payload: WelcomePayload = {
        version: '1.0.0',
        release_date: '2026-01-01',
        release_notes: ['Initial release'],
        tick_rate: 10,
        current_tick: 12345,
        server_time: Date.now(),
        motd: 'Welcome to SpaceMolt!',
      };

      (client as any).handleWelcome(payload);

      expect(client.state.currentTick).toBe(12345);
      expect(handler).toHaveBeenCalledWith(payload);
    });

    test('handleRegistered emits event', () => {
      const client = new SpaceMoltClient({ url: 'ws://localhost:8080/ws' });
      const handler = mock(() => {});
      client.on('registered', handler);

      const payload: RegisteredPayload = {
        token: 'secret-token',
        player_id: 'player-123',
      };

      (client as any).handleRegistered(payload);

      expect(handler).toHaveBeenCalledWith(payload);
    });

    test('handleLoggedIn updates state and emits event', () => {
      const client = new SpaceMoltClient({ url: 'ws://localhost:8080/ws' });
      const handler = mock(() => {});
      client.on('logged_in', handler);

      const payload: LoggedInPayload = {
        player: {
          id: 'p1',
          username: 'testuser',
          empire: 'solarian',
          credits: 1000,
        } as any,
        ship: { id: 's1', name: 'Test Ship' } as any,
        system: { id: 'sys1', name: 'Sol' } as any,
        poi: { id: 'poi1', name: 'Earth' } as any,
      };

      (client as any).handleLoggedIn(payload);

      expect(client.state.authenticated).toBe(true);
      expect(client.state.player).toEqual(payload.player);
      expect(client.state.ship).toEqual(payload.ship);
      expect(client.state.system).toEqual(payload.system);
      expect(client.state.poi).toEqual(payload.poi);
      expect(handler).toHaveBeenCalledWith(payload);
    });

    test('handleError emits error event', () => {
      const client = new SpaceMoltClient({ url: 'ws://localhost:8080/ws' });
      const handler = mock(() => {});
      client.on('error', handler);

      const payload: ErrorPayload = {
        code: 'AUTH_FAILED',
        message: 'Invalid credentials',
      };

      (client as any).handleError(payload);

      expect(handler).toHaveBeenCalledWith(payload);
    });

    test('handleStateUpdate updates all state fields', () => {
      const client = new SpaceMoltClient({ url: 'ws://localhost:8080/ws' });
      const handler = mock(() => {});
      client.on('state_update', handler);

      const payload: StateUpdatePayload = {
        tick: 5000,
        player: { id: 'p1', credits: 2000 } as any,
        ship: { id: 's1', hull: 100 } as any,
        nearby: [{ player_id: 'p2', anonymous: false, in_combat: false }],
        in_combat: true,
      };

      (client as any).handleStateUpdate(payload);

      expect(client.state.currentTick).toBe(5000);
      expect(client.state.player).toEqual(payload.player);
      expect(client.state.ship).toEqual(payload.ship);
      expect(client.state.nearby).toEqual(payload.nearby);
      expect(client.state.inCombat).toBe(true);
      expect(client.state.traveling).toBeNull();
      expect(handler).toHaveBeenCalledWith(payload);
    });

    test('handleStateUpdate sets travel state when traveling', () => {
      const client = new SpaceMoltClient({ url: 'ws://localhost:8080/ws' });

      const payload: StateUpdatePayload = {
        tick: 5000,
        player: {} as any,
        ship: {} as any,
        nearby: [],
        in_combat: false,
        travel_progress: 0.5,
        travel_destination: 'Asteroid Belt',
        travel_type: 'travel',
        travel_arrival_tick: 5010,
      };

      (client as any).handleStateUpdate(payload);

      expect(client.state.traveling).toEqual({
        progress: 0.5,
        destination: 'Asteroid Belt',
        type: 'travel',
        arrivalTick: 5010,
      });
    });

    test('handleStateUpdate sets travel state for jump', () => {
      const client = new SpaceMoltClient({ url: 'ws://localhost:8080/ws' });

      const payload: StateUpdatePayload = {
        tick: 5000,
        player: {} as any,
        ship: {} as any,
        nearby: [],
        in_combat: false,
        travel_progress: 0.2,
        travel_destination: 'Alpha Centauri',
        travel_type: 'jump',
        travel_arrival_tick: 5050,
      };

      (client as any).handleStateUpdate(payload);

      expect(client.state.traveling).toEqual({
        progress: 0.2,
        destination: 'Alpha Centauri',
        type: 'jump',
        arrivalTick: 5050,
      });
    });

    test('handleMessage parses and routes welcome message', () => {
      const client = new SpaceMoltClient({ url: 'ws://localhost:8080/ws' });
      const handler = mock(() => {});
      client.on('welcome', handler);

      const message = JSON.stringify({
        type: 'welcome',
        payload: {
          version: '1.0.0',
          release_date: '2026-01-01',
          release_notes: [],
          tick_rate: 10,
          current_tick: 100,
          server_time: Date.now(),
          motd: 'Welcome!',
        },
      });

      (client as any).handleMessage(message);

      expect(handler).toHaveBeenCalled();
    });

    test('handleMessage routes scan_result to event', () => {
      const client = new SpaceMoltClient({ url: 'ws://localhost:8080/ws' });
      const handler = mock(() => {});
      client.on('scan_result', handler);

      const payload: ScanResultPayload = {
        target_id: 'target-123',
        success: true,
        revealed_info: ['username', 'ship_class'],
        username: 'mystery_player',
        ship_class: 'cruiser',
      };

      const message = JSON.stringify({ type: 'scan_result', payload });
      (client as any).handleMessage(message);

      expect(handler).toHaveBeenCalledWith(payload);
    });

    test('handleMessage routes chat_message to event', () => {
      const client = new SpaceMoltClient({ url: 'ws://localhost:8080/ws' });
      const handler = mock(() => {});
      client.on('chat_message', handler);

      const payload: ChatMessage = {
        id: 'msg-1',
        channel: 'local',
        sender_id: 'player-1',
        sender: 'TestPlayer',
        content: 'Hello world!',
        timestamp: '2026-01-01T00:00:00Z',
      };

      const message = JSON.stringify({ type: 'chat_message', payload });
      (client as any).handleMessage(message);

      expect(handler).toHaveBeenCalledWith(payload);
    });

    test('handleMessage routes ok to event', () => {
      const client = new SpaceMoltClient({ url: 'ws://localhost:8080/ws' });
      const handler = mock(() => {});
      client.on('ok', handler);

      const payload = { action: 'dock' };
      const message = JSON.stringify({ type: 'ok', payload });
      (client as any).handleMessage(message);

      expect(handler).toHaveBeenCalledWith(payload);
    });

    test('handleMessage routes version_info to event', () => {
      const client = new SpaceMoltClient({ url: 'ws://localhost:8080/ws' });
      const handler = mock(() => {});
      client.on('version_info', handler);

      const payload = { version: '1.2.3', release_date: '2026-02-01', release_notes: ['New feature'] };
      const message = JSON.stringify({ type: 'version_info', payload });
      (client as any).handleMessage(message);

      expect(handler).toHaveBeenCalledWith(payload);
    });

    test('handleMessage routes unknown types to generic event', () => {
      const client = new SpaceMoltClient({ url: 'ws://localhost:8080/ws' });
      const handler = mock(() => {});
      client.on('custom_event', handler);

      const payload = { custom: 'data' };
      const message = JSON.stringify({ type: 'custom_event', payload });
      (client as any).handleMessage(message);

      expect(handler).toHaveBeenCalledWith(payload);
    });

    test('handleMessage handles invalid JSON gracefully', () => {
      const client = new SpaceMoltClient({ url: 'ws://localhost:8080/ws', debug: false });

      // Should not throw
      expect(() => {
        (client as any).handleMessage('not valid json');
      }).not.toThrow();
    });
  });

  describe('Message Queue', () => {
    test('messages are queued when disconnected', () => {
      const client = new SpaceMoltClient({ url: 'ws://localhost:8080/ws' });
      client.state.connected = false;

      // Call the actual send method (not mocked)
      (client as any).send('get_status');

      expect((client as any).messageQueue).toHaveLength(1);
      expect((client as any).messageQueue[0].type).toBe('get_status');
    });

    test('queued messages include timestamp', () => {
      const client = new SpaceMoltClient({ url: 'ws://localhost:8080/ws' });
      client.state.connected = false;

      const before = Date.now();
      (client as any).send('get_status');
      const after = Date.now();

      const queuedMsg = (client as any).messageQueue[0];
      expect(queuedMsg.timestamp).toBeGreaterThanOrEqual(before);
      expect(queuedMsg.timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe('Debug Logging', () => {
    test('log outputs when debug is true', () => {
      const client = new SpaceMoltClient({ url: 'ws://localhost:8080/ws', debug: true });
      const consoleSpy = spyOn(console, 'log').mockImplementation(() => {});

      (client as any).log('Test message', { data: 'value' });

      expect(consoleSpy).toHaveBeenCalledWith('[SpaceMolt]', 'Test message', { data: 'value' });

      consoleSpy.mockRestore();
    });

    test('log does not output when debug is false', () => {
      const client = new SpaceMoltClient({ url: 'ws://localhost:8080/ws', debug: false });
      const consoleSpy = spyOn(console, 'log').mockImplementation(() => {});

      (client as any).log('Test message');

      expect(consoleSpy).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('Disconnect', () => {
    test('disconnect clears reconnect timeout and closes WebSocket', () => {
      const client = new SpaceMoltClient({ url: 'ws://localhost:8080/ws' });

      // Simulate having a reconnect timeout
      (client as any).reconnectTimeout = setTimeout(() => {}, 10000);

      // Create a mock WebSocket
      const mockWs = { close: mock(() => {}) };
      (client as any).ws = mockWs;

      client.disconnect();

      expect((client as any).reconnectTimeout).toBeNull();
      expect((client as any).options.reconnect).toBe(false);
      expect(mockWs.close).toHaveBeenCalled();
      expect((client as any).ws).toBeNull();
    });

    test('disconnect works even without WebSocket', () => {
      const client = new SpaceMoltClient({ url: 'ws://localhost:8080/ws' });
      (client as any).ws = null;

      // Should not throw
      expect(() => {
        client.disconnect();
      }).not.toThrow();
    });
  });

  describe('API Introspection', () => {
    test('getCommands sends correct message', () => {
      const { client, messages } = createMockClient();

      client.getCommands();

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({ type: 'get_commands', payload: undefined });
    });

    test('handleMessage routes commands to event', () => {
      const client = new SpaceMoltClient({ url: 'ws://localhost:8080/ws' });
      const handler = mock(() => {});
      client.on('commands', handler);

      const payload = {
        commands: [
          {
            name: 'travel',
            description: 'Travel to a POI',
            category: 'navigation',
            parameters: [{ name: 'poi_id', type: 'string', required: true }],
            requires_auth: true,
          },
        ],
      };

      const message = JSON.stringify({ type: 'commands', payload });
      (client as any).handleMessage(message);

      expect(handler).toHaveBeenCalledWith(payload);
    });
  });
});
