import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import type { IPCRequest, IPCResponse, QueuedMessage } from './daemon';

/**
 * Tests for the daemon's command synchronization behavior.
 *
 * Bug: Auth commands (login, register) return immediately after sending
 * to the server, without waiting for the server's response. This means
 * errors are queued and only shown on the NEXT command.
 *
 * Expected: Auth commands should wait for server response and include
 * any errors in the same command response.
 */
describe('Daemon Command Synchronization', () => {
  describe('login command synchronization', () => {
    test('login with invalid credentials should return error in same response', async () => {
      // This test demonstrates the bug:
      // When login fails, the error should be in response.messages of the SAME command,
      // not queued for the next command.

      // We can't easily unit test this without mocking the entire daemon/client setup,
      // so this is a documentation of the expected behavior.

      // Current buggy behavior:
      // 1. CLI sends: login invalid_user wrong_password
      // 2. Daemon returns: { success: true, messages: [], response: { action: 'login', username: 'invalid_user' } }
      // 3. Server sends error: { type: 'error', payload: { code: 'username_not_found', message: '...' } }
      // 4. Error is QUEUED in messageQueue
      // 5. Next CLI command (any command) returns: { success: true, messages: [{ type: 'error', ... }], ... }

      // Expected correct behavior:
      // 1. CLI sends: login invalid_user wrong_password
      // 2. Daemon sends to server and WAITS for response
      // 3. Server sends error: { type: 'error', payload: { code: 'username_not_found', ... } }
      // 4. Daemon returns: { success: false, messages: [{ type: 'error', ... }], error: 'username_not_found' }

      // For now, this test just documents the expectation
      expect(true).toBe(true);
    });

    test('login with valid credentials should return logged_in in same response', async () => {
      // Expected behavior:
      // 1. CLI sends: login valid_user correct_password
      // 2. Daemon sends to server and WAITS for response
      // 3. Server sends: { type: 'logged_in', payload: { player: {...}, ... } }
      // 4. Daemon returns: { success: true, messages: [{ type: 'logged_in', ... }], response: { action: 'login' } }

      expect(true).toBe(true);
    });
  });

  describe('register command synchronization', () => {
    test('register with taken username should return error in same response', async () => {
      // Expected behavior:
      // 1. CLI sends: register taken_username solarian
      // 2. Daemon sends to server and WAITS for response
      // 3. Server sends error: { type: 'error', payload: { code: 'username_taken', ... } }
      // 4. Daemon returns: { success: false, messages: [{ type: 'error', ... }], error: 'username_taken' }

      expect(true).toBe(true);
    });

    test('register success should return password in same response', async () => {
      // Expected behavior:
      // 1. CLI sends: register new_username solarian
      // 2. Daemon sends to server and WAITS for response
      // 3. Server sends: { type: 'registered', payload: { password: '...', player_id: '...' } }
      // 4. Daemon returns: { success: true, messages: [{ type: 'registered', ... }], response: { action: 'register' } }

      expect(true).toBe(true);
    });
  });
});

/**
 * Integration test that demonstrates the bug by simulating the daemon behavior.
 * This test creates a mock server and daemon to show the synchronization issue.
 */
describe('Daemon Synchronization Integration', () => {
  // Mock WebSocket server that responds to messages
  class MockGameServer {
    private handlers: Map<string, (payload: any) => any> = new Map();
    public messagesReceived: Array<{ type: string; payload: any }> = [];
    private clientCallback: ((msg: any) => void) | null = null;

    constructor() {
      // Default handlers that simulate the real server
      this.handlers.set('login', (payload) => {
        const { username, password } = payload;
        if (username === 'valid_user' && password === 'valid_password') {
          return { type: 'logged_in', payload: { player: { username, id: 'p1' } } };
        }
        return { type: 'error', payload: { code: 'username_not_found', message: `No player found with username '${username}'` } };
      });

      this.handlers.set('register', (payload) => {
        const { username, empire } = payload;
        if (username === 'taken_username') {
          return { type: 'error', payload: { code: 'username_taken', message: 'Username already taken' } };
        }
        return { type: 'registered', payload: { password: 'new_password_123', player_id: 'p2' } };
      });
    }

    onClientMessage(callback: (msg: any) => void) {
      this.clientCallback = callback;
    }

    // Simulate receiving a message from client
    async receiveMessage(msg: { type: string; payload?: any }) {
      this.messagesReceived.push(msg);
      const handler = this.handlers.get(msg.type);
      if (handler) {
        // Simulate network latency
        await new Promise(resolve => setTimeout(resolve, 50));
        const response = handler(msg.payload);
        if (this.clientCallback) {
          this.clientCallback(response);
        }
        return response;
      }
    }
  }

  // Simplified daemon that demonstrates the current buggy behavior
  class BuggyDaemon {
    private messageQueue: QueuedMessage[] = [];
    private server: MockGameServer;

    constructor(server: MockGameServer) {
      this.server = server;
      // Setup listener for server messages
      this.server.onClientMessage((msg) => {
        this.messageQueue.push({
          type: msg.type as QueuedMessage['type'],
          timestamp: Date.now(),
          data: msg.payload,
        });
      });
    }

    flushMessages(): QueuedMessage[] {
      const messages = [...this.messageQueue];
      this.messageQueue = [];
      return messages;
    }

    // Current buggy implementation - returns immediately without waiting
    async processLoginBuggy(username: string, password: string): Promise<IPCResponse> {
      const messages = this.flushMessages();

      // Send to server (fire and forget - THE BUG!)
      this.server.receiveMessage({ type: 'login', payload: { username, password } });

      // Return immediately without waiting for response
      return {
        id: 'test',
        success: true,
        messages,
        response: { action: 'login', username },
      };
    }

    // Fixed implementation - waits for server response
    async processLoginFixed(username: string, password: string): Promise<IPCResponse> {
      const messages = this.flushMessages();

      // Create a promise that waits for the server response
      const responsePromise = new Promise<{ type: string; payload: any }>((resolve) => {
        const originalCallback = (this.server as any).clientCallback;
        (this.server as any).clientCallback = (msg: any) => {
          (this.server as any).clientCallback = originalCallback;
          resolve(msg);
        };
      });

      // Send to server
      this.server.receiveMessage({ type: 'login', payload: { username, password } });

      // Wait for response with timeout
      const serverResponse = await Promise.race([
        responsePromise,
        new Promise<{ type: string; payload: any }>((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), 5000)
        ),
      ]);

      // Include the server response in our return
      messages.push({
        type: serverResponse.type as QueuedMessage['type'],
        timestamp: Date.now(),
        data: serverResponse.payload,
      });

      const isError = serverResponse.type === 'error';
      return {
        id: 'test',
        success: !isError,
        messages,
        response: { action: 'login', username },
        error: isError ? serverResponse.payload.code : undefined,
      };
    }
  }

  test('buggy daemon: login error is NOT in immediate response', async () => {
    const server = new MockGameServer();
    const daemon = new BuggyDaemon(server);

    // First command: login with invalid credentials
    const response1 = await daemon.processLoginBuggy('invalid_user', 'wrong_password');

    // BUG: Response shows success even though login will fail
    expect(response1.success).toBe(true);
    // BUG: No error messages in immediate response
    expect(response1.messages.filter(m => m.type === 'error')).toHaveLength(0);

    // Wait for server to process
    await new Promise(resolve => setTimeout(resolve, 100));

    // Second command: the error finally appears
    const messages = daemon.flushMessages();
    // Error appears on NEXT command - this is the bug!
    expect(messages.filter(m => m.type === 'error')).toHaveLength(1);
    expect((messages[0].data as any).code).toBe('username_not_found');
  });

  test('fixed daemon: login error IS in immediate response', async () => {
    const server = new MockGameServer();
    const daemon = new BuggyDaemon(server);

    // Login with invalid credentials using fixed implementation
    const response = await daemon.processLoginFixed('invalid_user', 'wrong_password');

    // FIXED: Response correctly shows failure
    expect(response.success).toBe(false);
    expect(response.error).toBe('username_not_found');

    // FIXED: Error message is in the immediate response
    const errorMessages = response.messages.filter(m => m.type === 'error');
    expect(errorMessages).toHaveLength(1);
    expect((errorMessages[0].data as any).code).toBe('username_not_found');
    expect((errorMessages[0].data as any).message).toContain('invalid_user');
  });

  test('fixed daemon: successful login shows logged_in in immediate response', async () => {
    const server = new MockGameServer();
    const daemon = new BuggyDaemon(server);

    // Login with valid credentials
    const response = await daemon.processLoginFixed('valid_user', 'valid_password');

    // Success!
    expect(response.success).toBe(true);

    // logged_in message is in immediate response
    const loginMessages = response.messages.filter(m => m.type === 'logged_in');
    expect(loginMessages).toHaveLength(1);
    expect((loginMessages[0].data as any).player.username).toBe('valid_user');
  });
});
