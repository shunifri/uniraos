import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { 
  initMySQLDatabase, 
  resetMySQLDatabase, 
  migrateToVersion,
  getMigrationStatus,
  isDatabaseInitialized,
  MIGRATIONS 
} from "../../src/db/mysql-database.js";
import { getMySQLAdapter, resetMySQLAdapter } from "../../src/db/mysql-adapter.js";

// Skip tests if MySQL is not available
const describeIfMySQL = process.env.SKIP_MYSQL_TESTS ? describe.skip : describe;

describeIfMySQL("MySQL Database Migrations", () => {
  beforeAll(async () => {
    // Reset adapter to ensure fresh connection
    resetMySQLAdapter();
  });

  afterAll(async () => {
    const adapter = getMySQLAdapter();
    await adapter.close();
    resetMySQLAdapter();
  });

  beforeEach(async () => {
    // Reset database before each test
    try {
      await resetMySQLDatabase();
    } catch (error) {
      console.log("Reset failed, database may not exist yet:", error);
    }
  });

  it("should have migrations defined", () => {
    expect(MIGRATIONS).toHaveLength(2);
    expect(MIGRATIONS[0].version).toBe(1);
    expect(MIGRATIONS[0].name).toBe("init");
    expect(MIGRATIONS[1].version).toBe(2);
    expect(MIGRATIONS[1].name).toBe("add_kb_keywords_and_fulltext");
  });

  it("should initialize database with all migrations", async () => {
    await initMySQLDatabase();
    
    const adapter = getMySQLAdapter();
    
    // Check schema_version table exists and has records
    const versions = await adapter.query<{ version: number; name: string }>(
      "SELECT * FROM schema_version ORDER BY version"
    );
    expect(versions.length).toBe(2);
    expect(versions[0].version).toBe(1);
    expect(versions[0].name).toBe("init");
    expect(versions[1].version).toBe(2);
    expect(versions[1].name).toBe("add_kb_keywords_and_fulltext");
  });

  it("should create all required tables", async () => {
    await initMySQLDatabase();
    
    const adapter = getMySQLAdapter();
    
    // Check tables exist
    const tables = await adapter.query<{ TABLE_NAME: string }>(
      `SELECT TABLE_NAME FROM information_schema.tables 
       WHERE table_schema = DATABASE() 
       AND table_name IN ('users', 'departments', 'kb_documents', 'kb_chunks', 'wal_entries', 'kb_versions', 'kb_keywords')`
    );
    
    const tableNames = tables.map(t => t.TABLE_NAME);
    expect(tableNames).toContain("users");
    expect(tableNames).toContain("departments");
    expect(tableNames).toContain("kb_documents");
    expect(tableNames).toContain("kb_chunks");
    expect(tableNames).toContain("wal_entries");
    expect(tableNames).toContain("kb_versions");
    expect(tableNames).toContain("kb_keywords");
  });

  it("should have correct table structure for users", async () => {
    await initMySQLDatabase();
    
    const adapter = getMySQLAdapter();
    
    // Check users table columns
    const columns = await adapter.query<{ COLUMN_NAME: string; DATA_TYPE: string }>(
      `SELECT COLUMN_NAME, DATA_TYPE 
       FROM information_schema.columns 
       WHERE table_schema = DATABASE() AND table_name = 'users'`
    );
    
    const columnMap = new Map(columns.map(c => [c.COLUMN_NAME, c.DATA_TYPE]));
    
    expect(columnMap.has("id")).toBe(true);
    expect(columnMap.has("username")).toBe(true);
    expect(columnMap.has("password_hash")).toBe(true);
    expect(columnMap.has("department_id")).toBe(true);
    expect(columnMap.has("phone")).toBe(true);
    expect(columnMap.has("email")).toBe(true);
    expect(columnMap.has("status")).toBe(true);
  });

  it("should have correct table structure for kb_documents", async () => {
    await initMySQLDatabase();
    
    const adapter = getMySQLAdapter();
    
    const columns = await adapter.query<{ COLUMN_NAME: string; DATA_TYPE: string }>(
      `SELECT COLUMN_NAME, DATA_TYPE 
       FROM information_schema.columns 
       WHERE table_schema = DATABASE() AND table_name = 'kb_documents'`
    );
    
    const columnMap = new Map(columns.map(c => [c.COLUMN_NAME, c.DATA_TYPE]));
    
    expect(columnMap.has("doc_id")).toBe(true);
    expect(columnMap.has("name")).toBe(true);
    expect(columnMap.has("owner_id")).toBe(true);
    expect(columnMap.has("tags")).toBe(true);
    expect(columnMap.has("shared")).toBe(true);
    expect(columnMap.has("parsed_content")).toBe(true);
    expect(columnMap.has("parsing_status")).toBe(true);
    expect(columnMap.has("media_type")).toBe(true);
  });

  it("should have correct table structure for kb_chunks", async () => {
    await initMySQLDatabase();
    
    const adapter = getMySQLAdapter();
    
    const columns = await adapter.query<{ COLUMN_NAME: string; DATA_TYPE: string }>(
      `SELECT COLUMN_NAME, DATA_TYPE 
       FROM information_schema.columns 
       WHERE table_schema = DATABASE() AND table_name = 'kb_chunks'`
    );
    
    const columnMap = new Map(columns.map(c => [c.COLUMN_NAME, c.DATA_TYPE]));
    
    expect(columnMap.has("id")).toBe(true);
    expect(columnMap.has("doc_id")).toBe(true);
    expect(columnMap.has("content")).toBe(true);
    expect(columnMap.has("vector")).toBe(true);
    expect(columnMap.has("page_number")).toBe(true);
    expect(columnMap.has("bbox_data")).toBe(true);
    expect(columnMap.has("segment_index")).toBe(true);
    expect(columnMap.has("time_range")).toBe(true);
    expect(columnMap.has("frame_url")).toBe(true);
    expect(columnMap.has("asr_text")).toBe(true);
    expect(columnMap.has("content_type")).toBe(true);
  });

  it("should have foreign key constraints", async () => {
    await initMySQLDatabase();
    
    const adapter = getMySQLAdapter();
    
    const foreignKeys = await adapter.query<{
      TABLE_NAME: string;
      COLUMN_NAME: string;
      REFERENCED_TABLE_NAME: string;
      REFERENCED_COLUMN_NAME: string;
    }>(
      `SELECT 
        TABLE_NAME,
        COLUMN_NAME,
        REFERENCED_TABLE_NAME,
        REFERENCED_COLUMN_NAME
       FROM information_schema.key_column_usage
       WHERE table_schema = DATABASE()
       AND referenced_table_name IS NOT NULL`
    );
    
    // Check kb_documents -> users FK
    const docOwnerFk = foreignKeys.find(
      fk => fk.TABLE_NAME === 'kb_documents' && fk.COLUMN_NAME === 'owner_id'
    );
    expect(docOwnerFk).toBeDefined();
    expect(docOwnerFk?.REFERENCED_TABLE_NAME).toBe("users");
    
    // Check kb_chunks -> kb_documents FK
    const chunkDocFk = foreignKeys.find(
      fk => fk.TABLE_NAME === 'kb_chunks' && fk.COLUMN_NAME === 'doc_id'
    );
    expect(chunkDocFk).toBeDefined();
    expect(chunkDocFk?.REFERENCED_TABLE_NAME).toBe("kb_documents");
    
    // Check kb_keywords -> kb_chunks FK
    const keywordChunkFk = foreignKeys.find(
      fk => fk.TABLE_NAME === 'kb_keywords' && fk.COLUMN_NAME === 'chunk_id'
    );
    expect(keywordChunkFk).toBeDefined();
    expect(keywordChunkFk?.REFERENCED_TABLE_NAME).toBe("kb_chunks");
  });

  it("should have indexes on frequently queried columns", async () => {
    await initMySQLDatabase();
    
    const adapter = getMySQLAdapter();
    
    const indexes = await adapter.query<{
      TABLE_NAME: string;
      INDEX_NAME: string;
      COLUMN_NAME: string;
    }>(
      `SELECT 
        TABLE_NAME,
        INDEX_NAME,
        COLUMN_NAME
       FROM information_schema.statistics
       WHERE table_schema = DATABASE()
       AND table_name IN ('users', 'kb_documents', 'kb_chunks', 'wal_entries')`
    );
    
    // Check users indexes
    const userIndexes = indexes.filter(i => i.TABLE_NAME === 'users');
    expect(userIndexes.some(i => i.INDEX_NAME === 'idx_users_username')).toBe(true);
    expect(userIndexes.some(i => i.INDEX_NAME === 'idx_users_status')).toBe(true);
    
    // Check kb_documents indexes
    const docIndexes = indexes.filter(i => i.TABLE_NAME === 'kb_documents');
    expect(docIndexes.some(i => i.INDEX_NAME === 'idx_kb_documents_owner')).toBe(true);
    expect(docIndexes.some(i => i.INDEX_NAME === 'idx_kb_documents_shared')).toBe(true);
    
    // Check kb_chunks indexes
    const chunkIndexes = indexes.filter(i => i.TABLE_NAME === 'kb_chunks');
    expect(chunkIndexes.some(i => i.INDEX_NAME === 'idx_kb_chunks_doc_id')).toBe(true);
    
    // Check wal_entries indexes
    const walIndexes = indexes.filter(i => i.TABLE_NAME === 'wal_entries');
    expect(walIndexes.some(i => i.INDEX_NAME === 'idx_wal_sequence')).toBe(true);
    expect(walIndexes.some(i => i.INDEX_NAME === 'idx_wal_timestamp')).toBe(true);
  });

  it("should have fulltext indexes after migration v2", async () => {
    await initMySQLDatabase();
    
    const adapter = getMySQLAdapter();
    
    const fulltextIndexes = await adapter.query<{
      TABLE_NAME: string;
      INDEX_NAME: string;
    }>(
      `SELECT 
        TABLE_NAME,
        INDEX_NAME
       FROM information_schema.statistics
       WHERE table_schema = DATABASE()
       AND index_type = 'FULLTEXT'`
    );
    
    const ftDocName = fulltextIndexes.find(
      i => i.TABLE_NAME === 'kb_documents' && i.INDEX_NAME === 'ft_idx_kb_documents_name'
    );
    expect(ftDocName).toBeDefined();
    
    const ftChunkContent = fulltextIndexes.find(
      i => i.TABLE_NAME === 'kb_chunks' && i.INDEX_NAME === 'ft_idx_kb_chunks_content'
    );
    expect(ftChunkContent).toBeDefined();
  });

  it("should support inserting and querying data", async () => {
    await initMySQLDatabase();
    
    const adapter = getMySQLAdapter();
    
    // Insert test department
    await adapter.execute(
      `INSERT INTO departments (id, name, parent_id, path, level) 
       VALUES (?, ?, ?, ?, ?)`,
      ['dept_test', 'Test Department', null, '/Test Department', 0]
    );
    
    // Insert test user
    await adapter.execute(
      `INSERT INTO users (id, username, password_hash, department_id) 
       VALUES (?, ?, ?, ?)`,
      ['user_test', 'testuser', 'hashed_password', 'dept_test']
    );
    
    // Insert test document
    await adapter.execute(
      `INSERT INTO kb_documents (doc_id, name, owner_id, ingested_at) 
       VALUES (?, ?, ?, ?)`,
      ['doc_test', 'Test Document', 'user_test', Date.now()]
    );
    
    // Query the data back
    const user = await adapter.query<{ id: string; username: string }>(
      'SELECT * FROM users WHERE id = ?',
      ['user_test']
    );
    expect(user).toHaveLength(1);
    expect(user[0].username).toBe('testuser');
    
    const doc = await adapter.query<{ doc_id: string; name: string }>(
      'SELECT * FROM kb_documents WHERE doc_id = ?',
      ['doc_test']
    );
    expect(doc).toHaveLength(1);
    expect(doc[0].name).toBe('Test Document');
  });

  it("should enforce foreign key constraints", async () => {
    await initMySQLDatabase();
    
    const adapter = getMySQLAdapter();
    
    // Try to insert a document with non-existent owner (should fail)
    await expect(
      adapter.execute(
        `INSERT INTO kb_documents (doc_id, name, owner_id, ingested_at) 
         VALUES (?, ?, ?, ?)`,
        ['doc_invalid', 'Invalid Doc', 'non_existent_user', Date.now()]
      )
    ).rejects.toThrow();
  });

  it("should support JSON columns", async () => {
    await initMySQLDatabase();
    
    const adapter = getMySQLAdapter();
    
    // Insert department
    await adapter.execute(
      `INSERT INTO departments (id, name, parent_id, path, level) 
       VALUES (?, ?, ?, ?, ?)`,
      ['dept_json', 'JSON Test', null, '/JSON Test', 0]
    );
    
    // Insert user
    await adapter.execute(
      `INSERT INTO users (id, username, password_hash) 
       VALUES (?, ?, ?)`,
      ['user_json', 'jsonuser', 'hash']
    );
    
    // Insert document with JSON tags
    const tags = JSON.stringify(['tag1', 'tag2', 'tag3']);
    await adapter.execute(
      `INSERT INTO kb_documents (doc_id, name, owner_id, tags, ingested_at) 
       VALUES (?, ?, ?, ?, ?)`,
      ['doc_json', 'JSON Doc', 'user_json', tags, Date.now()]
    );
    
    // Query back and verify JSON
    const doc = await adapter.query<{ doc_id: string; tags: string | string[] }>(
      'SELECT * FROM kb_documents WHERE doc_id = ?',
      ['doc_json']
    );
    expect(doc).toHaveLength(1);
    
    // MySQL may return JSON as parsed array or string
    const tagsValue = doc[0].tags;
    const parsedTags = Array.isArray(tagsValue) ? tagsValue : JSON.parse(tagsValue);
    expect(parsedTags).toEqual(['tag1', 'tag2', 'tag3']);
  });

  it("should get migration status", async () => {
    await initMySQLDatabase();
    
    const status = await getMigrationStatus();
    
    expect(status.currentVersion).toBe(2);
    expect(status.latestVersion).toBe(2);
    expect(status.pendingMigrations).toHaveLength(0);
  });

  it("should detect database initialization status", async () => {
    // Database should be initialized after init
    let initialized = await isDatabaseInitialized();
    expect(initialized).toBe(true);
    
    // Reset to version 0
    await migrateToVersion(0);
    
    initialized = await isDatabaseInitialized();
    expect(initialized).toBe(false);
  });

  it("should support migration to specific version", async () => {
    await initMySQLDatabase();
    
    // Migrate down to version 1
    await migrateToVersion(1);
    
    const status1 = await getMigrationStatus();
    expect(status1.currentVersion).toBe(1);
    
    // Check that kb_keywords table is dropped
    const adapter = getMySQLAdapter();
    const tables = await adapter.query<{ TABLE_NAME: string }>(
      `SELECT TABLE_NAME FROM information_schema.tables 
       WHERE table_schema = DATABASE() AND table_name = 'kb_keywords'`
    );
    expect(tables).toHaveLength(0);
    
    // Migrate back up to version 2
    await migrateToVersion(2);
    
    const status2 = await getMigrationStatus();
    expect(status2.currentVersion).toBe(2);
    
    // Check that kb_keywords table is recreated
    const tables2 = await adapter.query<{ TABLE_NAME: string }>(
      `SELECT TABLE_NAME FROM information_schema.tables 
       WHERE table_schema = DATABASE() AND table_name = 'kb_keywords'`
    );
    expect(tables2).toHaveLength(1);
  });

  it("should handle WAL entries", async () => {
    await initMySQLDatabase();
    
    const adapter = getMySQLAdapter();
    
    // Insert WAL entries
    const oldData = JSON.stringify({ name: 'Old Name' });
    const newData = JSON.stringify({ name: 'New Name' });
    
    await adapter.execute(
      `INSERT INTO wal_entries (sequence_number, operation_type, table_name, record_id, old_data, new_data, transaction_id) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [1, 'UPDATE', 'users', 'user_1', oldData, newData, 'txn_123']
    );
    
    // Query WAL entries
    const entries = await adapter.query<{
      sequence_number: number;
      operation_type: string;
      table_name: string;
    }>('SELECT * FROM wal_entries WHERE sequence_number = ?', [1]);
    
    expect(entries).toHaveLength(1);
    expect(entries[0].operation_type).toBe('UPDATE');
    expect(entries[0].table_name).toBe('users');
  });

  it("should support unique constraints", async () => {
    await initMySQLDatabase();
    
    const adapter = getMySQLAdapter();
    
    // Insert department
    await adapter.execute(
      `INSERT INTO departments (id, name, parent_id, path, level) 
       VALUES (?, ?, ?, ?, ?)`,
      ['dept_unique', 'Unique Test', null, '/Unique Test', 0]
    );
    
    // Insert first user
    await adapter.execute(
      `INSERT INTO users (id, username, password_hash) 
       VALUES (?, ?, ?)`,
      ['user_unique_1', 'uniqueuser', 'hash1']
    );
    
    // Try to insert user with same username (should fail)
    await expect(
      adapter.execute(
        `INSERT INTO users (id, username, password_hash) 
         VALUES (?, ?, ?)`,
        ['user_unique_2', 'uniqueuser', 'hash2']
      )
    ).rejects.toThrow();
  });

  it("should support enum constraints", async () => {
    await initMySQLDatabase();
    
    const adapter = getMySQLAdapter();
    
    // Insert department
    await adapter.execute(
      `INSERT INTO departments (id, name, parent_id, path, level) 
       VALUES (?, ?, ?, ?, ?)`,
      ['dept_enum', 'Enum Test', null, '/Enum Test', 0]
    );
    
    // Insert user with valid status
    await adapter.execute(
      `INSERT INTO users (id, username, password_hash, status) 
       VALUES (?, ?, ?, ?)`,
      ['user_enum', 'enumuser', 'hash', 'active']
    );
    
    // Try to insert user with invalid status
    await expect(
      adapter.execute(
        `INSERT INTO users (id, username, password_hash, status) 
         VALUES (?, ?, ?, ?)`,
        ['user_enum_invalid', 'enumuser2', 'hash', 'invalid_status']
      )
    ).rejects.toThrow();
  });

  it("should use utf8mb4 charset", async () => {
    await initMySQLDatabase();
    
    const adapter = getMySQLAdapter();
    
    const tableInfo = await adapter.query<{
      TABLE_NAME: string;
      TABLE_COLLATION: string;
    }>(
      `SELECT TABLE_NAME, TABLE_COLLATION 
       FROM information_schema.tables 
       WHERE table_schema = DATABASE() 
       AND table_name = 'users'`
    );
    
    expect(tableInfo[0].TABLE_COLLATION).toContain('utf8mb4');
  });

  it("should use InnoDB engine", async () => {
    await initMySQLDatabase();
    
    const adapter = getMySQLAdapter();
    
    const tableInfo = await adapter.query<{
      TABLE_NAME: string;
      ENGINE: string;
    }>(
      `SELECT TABLE_NAME, ENGINE 
       FROM information_schema.tables 
       WHERE table_schema = DATABASE() 
       AND table_name = 'users'`
    );
    
    expect(tableInfo[0].ENGINE).toBe('InnoDB');
  });
});

describeIfMySQL("MySQL Database Reset", () => {
  it("should reset database completely", async () => {
    await initMySQLDatabase();
    
    const adapter = getMySQLAdapter();
    
    // Insert some data
    await adapter.execute(
      `INSERT INTO departments (id, name, parent_id, path, level) 
       VALUES (?, ?, ?, ?, ?)`,
      ['dept_reset', 'Reset Test', null, '/Reset Test', 0]
    );
    
    await adapter.execute(
      `INSERT INTO users (id, username, password_hash) 
       VALUES (?, ?, ?)`,
      ['user_reset', 'resetuser', 'hash']
    );
    
    // Reset database
    await resetMySQLDatabase();
    
    // Verify data is gone but tables exist
    const users = await adapter.query('SELECT * FROM users WHERE id = ?', ['user_reset']);
    expect(users).toHaveLength(0);
    
    // Verify schema_version is reset
    const status = await getMigrationStatus();
    expect(status.currentVersion).toBe(2);
    expect(status.pendingMigrations).toHaveLength(0);
  });
});
