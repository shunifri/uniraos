/**
 * Redis-based Session Store
 * Provides distributed session management for RAOS
 */

import { RedisClient, getRedisClient } from './redis-client.js';
import { log } from '../utils/logger.js';

// Session TTL in seconds (24 hours)
const SESSION_TTL = 24 * 60 * 60;

export interface SessionData {
  userId: string;
  username: string;
  displayName: string;
  departmentId?: string;
  roles: string[];
  createdAt: number;
  lastActivity: number;
}

export interface SessionCreateData {
  userId: string;
  username: string;
  displayName: string;
  departmentId?: string;
  roles: string[];
}

export class RedisSessionStore {
  private client: RedisClient;
  private sessionPrefix: string = 'session:';

  constructor(client?: RedisClient) {
    this.client = client || getRedisClient();
  }

  /**
   * Get the full session key
   */
  private getSessionKey(sessionId: string): string {
    return `${this.sessionPrefix}${sessionId}`;
  }

  /**
   * Get the user sessions index key
   */
  private getUserSessionsKey(userId: string): string {
    return `user_sessions:${userId}`;
  }

  /**
   * Create a new session
   */
  async create(sessionId: string, data: SessionCreateData): Promise<void> {
    try {
      const now = Date.now();
      const sessionData: SessionData = {
        ...data,
        createdAt: now,
        lastActivity: now,
      };

      const sessionKey = this.getSessionKey(sessionId);
      await this.client.set(sessionKey, sessionData, SESSION_TTL);

      // Add to user's session index for session tracking
      const userSessionsKey = this.getUserSessionsKey(data.userId);
      const existingSessions = await this.client.get<string[]>(userSessionsKey) || [];
      if (!existingSessions.includes(sessionId)) {
        existingSessions.push(sessionId);
        await this.client.set(userSessionsKey, existingSessions, SESSION_TTL);
      }

      log('info', 'session_created', { 
        sessionId: sessionId.slice(0, 8) + '...', 
        userId: data.userId,
        username: data.username 
      });
    } catch (error) {
      log('error', 'session_create_error', { 
        sessionId: sessionId.slice(0, 8) + '...', 
        error: (error as Error).message 
      });
      throw error;
    }
  }

  /**
   * Get session data
   */
  async get(sessionId: string): Promise<SessionData | null> {
    try {
      const sessionKey = this.getSessionKey(sessionId);
      const data = await this.client.get<SessionData>(sessionKey);
      
      if (data) {
        // Update last activity on get
        data.lastActivity = Date.now();
        await this.client.set(sessionKey, data, SESSION_TTL);
      }
      
      return data;
    } catch (error) {
      log('error', 'session_get_error', { 
        sessionId: sessionId.slice(0, 8) + '...', 
        error: (error as Error).message 
      });
      return null;
    }
  }

  /**
   * Update session data
   */
  async update(sessionId: string, data: Partial<Omit<SessionData, 'createdAt'>>): Promise<void> {
    try {
      const sessionKey = this.getSessionKey(sessionId);
      const existingData = await this.client.get<SessionData>(sessionKey);
      
      if (!existingData) {
        throw new Error('Session not found');
      }

      const updatedData: SessionData = {
        ...existingData,
        ...data,
        lastActivity: Date.now(),
      };

      await this.client.set(sessionKey, updatedData, SESSION_TTL);

      // Update user sessions index if userId changed
      if (data.userId && data.userId !== existingData.userId) {
        // Remove from old user's sessions
        const oldUserSessionsKey = this.getUserSessionsKey(existingData.userId);
        const oldSessions = await this.client.get<string[]>(oldUserSessionsKey) || [];
        const filteredSessions = oldSessions.filter(id => id !== sessionId);
        if (filteredSessions.length > 0) {
          await this.client.set(oldUserSessionsKey, filteredSessions, SESSION_TTL);
        } else {
          await this.client.delete(oldUserSessionsKey);
        }

        // Add to new user's sessions
        const newUserSessionsKey = this.getUserSessionsKey(data.userId);
        const newSessions = await this.client.get<string[]>(newUserSessionsKey) || [];
        if (!newSessions.includes(sessionId)) {
          newSessions.push(sessionId);
          await this.client.set(newUserSessionsKey, newSessions, SESSION_TTL);
        }
      }

      log('info', 'session_updated', { sessionId: sessionId.slice(0, 8) + '...' });
    } catch (error) {
      log('error', 'session_update_error', { 
        sessionId: sessionId.slice(0, 8) + '...', 
        error: (error as Error).message 
      });
      throw error;
    }
  }

  /**
   * Destroy a session
   */
  async destroy(sessionId: string): Promise<void> {
    try {
      const sessionKey = this.getSessionKey(sessionId);
      
      // Get session data to find userId
      const sessionData = await this.client.get<SessionData>(sessionKey);
      
      if (sessionData) {
        // Remove from user's session index
        const userSessionsKey = this.getUserSessionsKey(sessionData.userId);
        const userSessions = await this.client.get<string[]>(userSessionsKey) || [];
        const filteredSessions = userSessions.filter(id => id !== sessionId);
        
        if (filteredSessions.length > 0) {
          await this.client.set(userSessionsKey, filteredSessions, SESSION_TTL);
        } else {
          await this.client.delete(userSessionsKey);
        }
      }

      // Delete the session
      await this.client.delete(sessionKey);

      log('info', 'session_destroyed', { sessionId: sessionId.slice(0, 8) + '...' });
    } catch (error) {
      log('error', 'session_destroy_error', { 
        sessionId: sessionId.slice(0, 8) + '...', 
        error: (error as Error).message 
      });
      throw error;
    }
  }

  /**
   * Check if session exists
   */
  async exists(sessionId: string): Promise<boolean> {
    try {
      const sessionKey = this.getSessionKey(sessionId);
      return await this.client.exists(sessionKey);
    } catch (error) {
      log('error', 'session_exists_error', { 
        sessionId: sessionId.slice(0, 8) + '...', 
        error: (error as Error).message 
      });
      return false;
    }
  }

  /**
   * Get all sessions for a user
   */
  async getUserSessions(userId: string): Promise<string[]> {
    try {
      const userSessionsKey = this.getUserSessionsKey(userId);
      return await this.client.get<string[]>(userSessionsKey) || [];
    } catch (error) {
      log('error', 'session_get_user_sessions_error', { 
        userId, 
        error: (error as Error).message 
      });
      return [];
    }
  }

  /**
   * Destroy all sessions for a user
   */
  async destroyAllUserSessions(userId: string): Promise<void> {
    try {
      const sessionIds = await this.getUserSessions(userId);
      
      for (const sessionId of sessionIds) {
        await this.client.delete(this.getSessionKey(sessionId));
      }
      
      await this.client.delete(this.getUserSessionsKey(userId));

      log('info', 'session_destroyed_all_user', { 
        userId, 
        sessionsDestroyed: sessionIds.length 
      });
    } catch (error) {
      log('error', 'session_destroy_all_user_error', { 
        userId, 
        error: (error as Error).message 
      });
      throw error;
    }
  }

  /**
   * Extend session TTL
   */
  async extendSession(sessionId: string): Promise<void> {
    try {
      const sessionKey = this.getSessionKey(sessionId);
      await this.client.expire(sessionKey, SESSION_TTL);
    } catch (error) {
      log('error', 'session_extend_error', { 
        sessionId: sessionId.slice(0, 8) + '...', 
        error: (error as Error).message 
      });
      throw error;
    }
  }

  /**
   * Get session TTL remaining
   */
  async getSessionTTL(sessionId: string): Promise<number> {
    try {
      const sessionKey = this.getSessionKey(sessionId);
      return await this.client.ttl(sessionKey);
    } catch (error) {
      log('error', 'session_get_ttl_error', { 
        sessionId: sessionId.slice(0, 8) + '...', 
        error: (error as Error).message 
      });
      return -1;
    }
  }
}

// Singleton instance
let sessionStoreInstance: RedisSessionStore | null = null;

/**
 * Get the singleton session store instance
 */
export function getSessionStore(): RedisSessionStore {
  if (!sessionStoreInstance) {
    sessionStoreInstance = new RedisSessionStore();
  }
  return sessionStoreInstance;
}

/**
 * Reset the singleton instance (useful for testing)
 */
export function resetSessionStore(): void {
  sessionStoreInstance = null;
}
