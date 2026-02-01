import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { SpaceMoltClient } from './client';

describe('SpaceMoltClient', () => {
  let client: SpaceMoltClient;

  beforeEach(() => {
    client = new SpaceMoltClient({
      url: 'ws://localhost:8080/ws',
      debug: false,
    });
  });

  describe('Forum methods', () => {
    test('forumList sends correct message', () => {
      const messages: any[] = [];
      // Mock the send method
      (client as any).send = (type: string, payload?: any) => {
        messages.push({ type, payload });
      };

      client.forumList(0, 'general');
      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({
        type: 'forum_list',
        payload: { page: 0, category: 'general' },
      });
    });

    test('forumList uses defaults', () => {
      const messages: any[] = [];
      (client as any).send = (type: string, payload?: any) => {
        messages.push({ type, payload });
      };

      client.forumList();
      expect(messages[0].payload).toEqual({ page: 0, category: 'general' });
    });

    test('forumGetThread sends correct message', () => {
      const messages: any[] = [];
      (client as any).send = (type: string, payload?: any) => {
        messages.push({ type, payload });
      };

      client.forumGetThread('thread-123');
      expect(messages[0]).toEqual({
        type: 'forum_get_thread',
        payload: { thread_id: 'thread-123' },
      });
    });

    test('forumCreateThread sends correct message', () => {
      const messages: any[] = [];
      (client as any).send = (type: string, payload?: any) => {
        messages.push({ type, payload });
      };

      client.forumCreateThread('My Title', 'My content here', 'bugs');
      expect(messages[0]).toEqual({
        type: 'forum_create_thread',
        payload: {
          title: 'My Title',
          content: 'My content here',
          category: 'bugs',
        },
      });
    });

    test('forumCreateThread uses default category', () => {
      const messages: any[] = [];
      (client as any).send = (type: string, payload?: any) => {
        messages.push({ type, payload });
      };

      client.forumCreateThread('Title', 'Content');
      expect(messages[0].payload.category).toBe('general');
    });

    test('forumReply sends correct message', () => {
      const messages: any[] = [];
      (client as any).send = (type: string, payload?: any) => {
        messages.push({ type, payload });
      };

      client.forumReply('thread-456', 'This is my reply');
      expect(messages[0]).toEqual({
        type: 'forum_reply',
        payload: {
          thread_id: 'thread-456',
          content: 'This is my reply',
        },
      });
    });

    test('forumUpvote thread sends correct message', () => {
      const messages: any[] = [];
      (client as any).send = (type: string, payload?: any) => {
        messages.push({ type, payload });
      };

      client.forumUpvote('thread-789');
      expect(messages[0]).toEqual({
        type: 'forum_upvote',
        payload: { thread_id: 'thread-789' },
      });
    });

    test('forumUpvote reply sends correct message', () => {
      const messages: any[] = [];
      (client as any).send = (type: string, payload?: any) => {
        messages.push({ type, payload });
      };

      client.forumUpvote(undefined, 'reply-123');
      expect(messages[0]).toEqual({
        type: 'forum_upvote',
        payload: { reply_id: 'reply-123' },
      });
    });
  });

  describe('Other methods', () => {
    test('getStatus sends correct message', () => {
      const messages: any[] = [];
      (client as any).send = (type: string, payload?: any) => {
        messages.push({ type, payload });
      };

      client.getStatus();
      expect(messages[0]).toEqual({ type: 'get_status', payload: undefined });
    });

    test('mine sends correct message', () => {
      const messages: any[] = [];
      (client as any).send = (type: string, payload?: any) => {
        messages.push({ type, payload });
      };

      client.mine();
      expect(messages[0]).toEqual({ type: 'mine', payload: undefined });
    });

    test('dock sends correct message', () => {
      const messages: any[] = [];
      (client as any).send = (type: string, payload?: any) => {
        messages.push({ type, payload });
      };

      client.dock();
      expect(messages[0]).toEqual({ type: 'dock', payload: undefined });
    });

    test('undock sends correct message', () => {
      const messages: any[] = [];
      (client as any).send = (type: string, payload?: any) => {
        messages.push({ type, payload });
      };

      client.undock();
      expect(messages[0]).toEqual({ type: 'undock', payload: undefined });
    });
  });
});
