import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';

let testDb: Database.Database;

vi.mock('../../src/db/database.js', () => ({
  getDb: () => testDb,
}));

async function importConnector() {
  return import('../../src/services/database-connector.js');
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS connections (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      config TEXT,
      db_config TEXT,
      test_query TEXT,
      status TEXT
    );
  `);
}

describe('Database Connector', () => {
  beforeEach(() => {
    testDb = new Database(':memory:');
    initSchema(testDb);
  });

  afterEach(async () => {
    const { clearConnectionPool } = await importConnector();
    clearConnectionPool();
    testDb.close();
  });

  it('should throw for non-existent connection', async () => {
    const { getConnection } = await importConnector();
    await expect(getConnection('non-existent')).rejects.toThrow('not found');
  });

  it('should throw for connection without db_config', async () => {
    testDb
      .prepare(
        `INSERT INTO connections (id, name, type, config, db_config, status)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run('conn-1', 'Test', 'mysql', '{}', null, 'active');

    const { getConnection } = await importConnector();
    await expect(getConnection('conn-1')).rejects.toThrow('no database config');
  });

  it('should test inline SQLite config', async () => {
    const { testConnectionConfig } = await importConnector();
    const result = await testConnectionConfig({
      name: 'test',
      type: 'sqlite',
      host: '',
      port: 0,
      database: ':memory:',
      username: '',
      password: '',
    });
    expect(result.success).toBe(true);
    expect(result.message).toBe('Connection successful');
  });

  it('should test inline MySQL config with invalid credentials', async () => {
    const { testConnectionConfig } = await importConnector();
    const result = await testConnectionConfig({
      name: 'test',
      type: 'mysql',
      host: 'localhost',
      port: 3306,
      database: 'test',
      username: 'invalid',
      password: 'invalid',
    });
    expect(result.success).toBe(false);
  });

  it('should get SQLite connection and execute query', async () => {
    const dbConfig = JSON.stringify({
      name: 'test-sqlite',
      type: 'sqlite',
      host: '',
      port: 0,
      database: ':memory:',
      username: '',
      password: '',
    });

    testDb
      .prepare(
        `INSERT INTO connections (id, name, type, config, db_config, status)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run('conn-sqlite', 'Test SQLite', 'sqlite', '{}', dbConfig, 'active');

    const { getConnection, executeQuery, closeConnection } = await importConnector();
    const conn = await getConnection('conn-sqlite');
    expect(conn).toBeDefined();

    const result = await executeQuery('conn-sqlite', 'SELECT 1 as val');
    expect(result).toEqual([{ val: 1 }]);

    await closeConnection('conn-sqlite');
  });

  it('should test existing connection', async () => {
    const dbConfig = JSON.stringify({
      name: 'test-sqlite',
      type: 'sqlite',
      host: '',
      port: 0,
      database: ':memory:',
      username: '',
      password: '',
    });

    testDb
      .prepare(
        `INSERT INTO connections (id, name, type, config, db_config, test_query, status)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run('conn-test', 'Test', 'sqlite', '{}', dbConfig, 'SELECT 1', 'active');

    const { testConnection, closeConnection } = await importConnector();
    const result = await testConnection('conn-test');
    expect(result.success).toBe(true);

    await closeConnection('conn-test');
  });
});
