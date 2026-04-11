/**
 * MySQL Database Initialization and Migration System
 * Supports schema versioning with up/down migrations
 */

import { getMySQLAdapter } from './mysql-adapter.js';
import { log } from '../utils/logger.js';

interface Migration {
  version: number;
  name: string;
  up: string;
  down: string;
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'init',
    up: `
      -- Schema version tracking table
      CREATE TABLE IF NOT EXISTS schema_version (
        version INT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

      -- Users table
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(64) PRIMARY KEY,
        username VARCHAR(100) NOT NULL UNIQUE,
        display_name VARCHAR(200) NOT NULL DEFAULT '',
        password_hash VARCHAR(255) NOT NULL,
        avatar VARCHAR(500) DEFAULT '',
        department_id VARCHAR(64),
        phone VARCHAR(20) DEFAULT '',
        email VARCHAR(200) DEFAULT '',
        status ENUM('active', 'disabled', 'deleted') NOT NULL DEFAULT 'active',
        created_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000),
        updated_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000),
        last_login_at BIGINT,
        INDEX idx_users_username (username),
        INDEX idx_users_status (status),
        INDEX idx_users_department (department_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

      -- Departments table (tree structure with materialized path)
      CREATE TABLE IF NOT EXISTS departments (
        id VARCHAR(64) PRIMARY KEY,
        name VARCHAR(200) NOT NULL,
        parent_id VARCHAR(64),
        path VARCHAR(500) NOT NULL,
        level INT NOT NULL DEFAULT 0,
        description TEXT DEFAULT '',
        created_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000),
        updated_at BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000),
        INDEX idx_departments_parent (parent_id),
        INDEX idx_departments_path (path),
        FOREIGN KEY (parent_id) REFERENCES departments(id) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

      -- Add foreign key to users table after departments is created
      ALTER TABLE users
        ADD CONSTRAINT fk_users_department
        FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL;

      -- KB Documents table
      CREATE TABLE IF NOT EXISTS kb_documents (
        doc_id VARCHAR(100) PRIMARY KEY,
        name VARCHAR(500) NOT NULL,
        source VARCHAR(500) DEFAULT '',
        owner_id VARCHAR(64) NOT NULL,
        chunk_count INT DEFAULT 0,
        total_tokens INT DEFAULT 0,
        ingested_at BIGINT NOT NULL,
        updated_at BIGINT,
        version INT DEFAULT 1,
        tags JSON DEFAULT '[]',
        shared TINYINT DEFAULT 0,
        content_hash VARCHAR(64) DEFAULT '',
        parsed_content LONGTEXT DEFAULT '',
        layouts_json JSON DEFAULT '[]',
        segments_json JSON DEFAULT '[]',
        doc_mind_task_id VARCHAR(100),
        parsing_status VARCHAR(50) DEFAULT 'success',
        parsing_progress DECIMAL(5,2) DEFAULT 100.00,
        media_type VARCHAR(50) DEFAULT 'document',
        duration_ms INT,
        UNIQUE KEY uk_kb_documents_name_owner (name, owner_id),
        INDEX idx_kb_documents_owner (owner_id),
        INDEX idx_kb_documents_shared (shared),
        INDEX idx_kb_documents_ingested (ingested_at),
        FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

      -- KB Chunks table
      CREATE TABLE IF NOT EXISTS kb_chunks (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        doc_id VARCHAR(100) NOT NULL,
        chunk_index INT NOT NULL,
        content LONGTEXT NOT NULL,
        tokens INT DEFAULT 0,
        vector BLOB,
        page_number INT,
        bbox_data JSON DEFAULT '[]',
        segment_index INT,
        time_range VARCHAR(100),
        frame_url VARCHAR(500),
        asr_text TEXT,
        content_type VARCHAR(50) DEFAULT 'text',
        INDEX idx_kb_chunks_doc_id (doc_id),
        INDEX idx_kb_chunks_content_type (content_type),
        FOREIGN KEY (doc_id) REFERENCES kb_documents(doc_id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

      -- WAL (Write-Ahead Log) Entries table
      CREATE TABLE IF NOT EXISTS wal_entries (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        sequence_number BIGINT NOT NULL UNIQUE,
        operation_type ENUM('INSERT', 'UPDATE', 'DELETE') NOT NULL,
        table_name VARCHAR(100) NOT NULL,
        record_id VARCHAR(100) NOT NULL,
        old_data JSON,
        new_data JSON,
        timestamp BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP() * 1000),
        transaction_id VARCHAR(64),
        INDEX idx_wal_sequence (sequence_number),
        INDEX idx_wal_table_record (table_name, record_id),
        INDEX idx_wal_timestamp (timestamp),
        INDEX idx_wal_transaction (transaction_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

      -- KB Versions table (document version history)
      CREATE TABLE IF NOT EXISTS kb_versions (
        doc_id VARCHAR(100) NOT NULL,
        version INT NOT NULL,
        content_hash VARCHAR(64) NOT NULL,
        chunk_count INT DEFAULT 0,
        total_tokens INT DEFAULT 0,
        created_at BIGINT NOT NULL,
        PRIMARY KEY (doc_id, version),
        FOREIGN KEY (doc_id) REFERENCES kb_documents(doc_id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `,
    down: `
      DROP TABLE IF EXISTS kb_versions;
      DROP TABLE IF EXISTS wal_entries;
      DROP TABLE IF EXISTS kb_chunks;
      DROP TABLE IF EXISTS kb_documents;
      ALTER TABLE users DROP FOREIGN KEY IF EXISTS fk_users_department;
      DROP TABLE IF EXISTS users;
      DROP TABLE IF EXISTS departments;
      DROP TABLE IF EXISTS schema_version;
    `
  },
  {
    version: 2,
    name: 'add_kb_keywords_and_fulltext',
    up: `
      -- KB Keywords table for keyword search
      CREATE TABLE IF NOT EXISTS kb_keywords (
        keyword VARCHAR(100) NOT NULL,
        chunk_id BIGINT NOT NULL,
        tf DECIMAL(10, 8) DEFAULT 0,
        PRIMARY KEY (keyword, chunk_id),
        INDEX idx_kb_keywords_chunk (chunk_id),
        FOREIGN KEY (chunk_id) REFERENCES kb_chunks(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

      -- Full-text index on kb_documents.name
      CREATE FULLTEXT INDEX IF NOT EXISTS ft_idx_kb_documents_name ON kb_documents(name);

      -- Full-text index on kb_chunks.content
      CREATE FULLTEXT INDEX IF NOT EXISTS ft_idx_kb_chunks_content ON kb_chunks(content);

      -- Index on keyword for faster keyword search
      CREATE INDEX idx_kb_keywords_keyword ON kb_keywords(keyword);
    `,
    down: `
      DROP INDEX IF EXISTS ft_idx_kb_documents_name ON kb_documents;
      DROP INDEX IF EXISTS ft_idx_kb_chunks_content ON kb_chunks;
      DROP INDEX IF EXISTS idx_kb_keywords_keyword ON kb_keywords;
      DROP TABLE IF EXISTS kb_keywords;
    `
  }
];

/**
 * Get current schema version from database
 */
async function getCurrentVersion(): Promise<number> {
  const adapter = getMySQLAdapter();
  try {
    const rows = await adapter.query<{ version: number }>(
      'SELECT MAX(version) as version FROM schema_version'
    );
    return rows[0]?.version ?? 0;
  } catch (error) {
    // Table doesn't exist yet
    return 0;
  }
}

/**
 * Record migration version in schema_version table
 */
async function recordVersion(version: number, name: string): Promise<void> {
  const adapter = getMySQLAdapter();
  await adapter.execute(
    'INSERT INTO schema_version (version, name) VALUES (?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name), applied_at = CURRENT_TIMESTAMP',
    [version, name]
  );
}

/**
 * Delete migration version from schema_version table (for down migrations)
 */
async function removeVersion(version: number): Promise<void> {
  const adapter = getMySQLAdapter();
  await adapter.execute(
    'DELETE FROM schema_version WHERE version = ?',
    [version]
  );
}

/**
 * Initialize MySQL database by running all pending migrations
 * Each migration is wrapped in a transaction for atomicity
 */
export async function initMySQLDatabase(): Promise<void> {
  const adapter = getMySQLAdapter();
  const currentVersion = await getCurrentVersion();
  
  log('info', 'mysql_database_init_start', { currentVersion, targetVersion: MIGRATIONS.length });

  // Run pending migrations
  for (const migration of MIGRATIONS) {
    if (migration.version > currentVersion) {
      try {
        log('info', 'mysql_database_migration_start', { 
          version: migration.version, 
          name: migration.name 
        });

        // Execute migration within a transaction for atomicity
        await adapter.transaction(async (conn) => {
          // Split and execute each statement
          const statements = migration.up
            .split(';')
            .map(s => s.trim())
            .filter(s => s.length > 0);

          for (const statement of statements) {
            await conn.execute(`${statement};`);
          }

          // Record version in the same transaction
          await conn.execute(
            'INSERT INTO schema_version (version, name) VALUES (?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name), applied_at = CURRENT_TIMESTAMP',
            [migration.version, migration.name]
          );
        });

        log('info', 'mysql_database_migration_complete', { 
          version: migration.version, 
          name: migration.name 
        });
      } catch (error) {
        log('error', 'mysql_database_migration_failed', { 
          version: migration.version, 
          name: migration.name,
          error: error instanceof Error ? error.message : String(error)
        });
        throw error;
      }
    }
  }

  log('info', 'mysql_database_init_complete', { version: MIGRATIONS.length });
}

/**
 * Reset MySQL database by running down migrations and re-initializing
 * WARNING: This will delete all data!
 */
export async function resetMySQLDatabase(): Promise<void> {
  const adapter = getMySQLAdapter();
  const currentVersion = await getCurrentVersion();
  
  log('warn', 'mysql_database_reset_start', { currentVersion });

  // Run down migrations in reverse order
  for (const migration of [...MIGRATIONS].reverse()) {
    if (migration.version <= currentVersion) {
      try {
        log('info', 'mysql_database_rollback_start', { 
          version: migration.version, 
          name: migration.name 
        });

        // Split and execute each statement
        const statements = migration.down
          .split(';')
          .map(s => s.trim())
          .filter(s => s.length > 0);

        for (const statement of statements) {
          try {
            await adapter.execute(`${statement};`);
          } catch (error) {
            // Ignore errors during rollback (tables might not exist)
            log('debug', 'mysql_database_rollback_statement_skipped', { 
              statement: statement.substring(0, 100)
            });
          }
        }

        await removeVersion(migration.version);

        log('info', 'mysql_database_rollback_complete', { 
          version: migration.version, 
          name: migration.name 
        });
      } catch (error) {
        log('error', 'mysql_database_rollback_failed', { 
          version: migration.version, 
          name: migration.name,
          error: error instanceof Error ? error.message : String(error)
        });
        // Continue with other rollbacks
      }
    }
  }

  log('info', 'mysql_database_reset_complete');

  // Re-initialize
  await initMySQLDatabase();
}

/**
 * Migrate to a specific version
 * @param targetVersion The version to migrate to (up or down)
 */
export async function migrateToVersion(targetVersion: number): Promise<void> {
  const adapter = getMySQLAdapter();
  const currentVersion = await getCurrentVersion();
  
  if (targetVersion === currentVersion) {
    log('info', 'mysql_database_already_at_version', { version: targetVersion });
    return;
  }

  try {
    if (targetVersion > currentVersion) {
      // Migrate up
      for (const migration of MIGRATIONS) {
        if (migration.version > currentVersion && migration.version <= targetVersion) {
          try {
            log('info', 'mysql_database_migration_up_start', { 
              version: migration.version, 
              name: migration.name 
            });

            // Execute migration within a transaction for atomicity
            await adapter.transaction(async (conn) => {
              const statements = migration.up
                .split(';')
                .map(s => s.trim())
                .filter(s => s.length > 0);

              for (const statement of statements) {
                await conn.execute(`${statement};`);
              }

              // Record version in the same transaction
              await conn.execute(
                'INSERT INTO schema_version (version, name) VALUES (?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name), applied_at = CURRENT_TIMESTAMP',
                [migration.version, migration.name]
              );
            });

            log('info', 'mysql_database_migrated_up', { 
              version: migration.version,
              name: migration.name 
            });
          } catch (error) {
            log('error', 'mysql_database_migration_up_failed', { 
              version: migration.version, 
              name: migration.name,
              error: error instanceof Error ? error.message : String(error)
            });
            throw error;
          }
        }
      }
    } else {
      // Migrate down
      for (const migration of [...MIGRATIONS].reverse()) {
        if (migration.version <= currentVersion && migration.version > targetVersion) {
          try {
            log('info', 'mysql_database_migration_down_start', { 
              version: migration.version, 
              name: migration.name 
            });

            // Execute migration within a transaction for atomicity
            await adapter.transaction(async (conn) => {
              const statements = migration.down
                .split(';')
                .map(s => s.trim())
                .filter(s => s.length > 0);

              for (const statement of statements) {
                try {
                  await conn.execute(`${statement};`);
                } catch (error) {
                  // Ignore errors during rollback (tables might not exist)
                  log('debug', 'mysql_database_downgrade_statement_skipped', {
                    statement: statement.substring(0, 100)
                  });
                }
              }

              // Remove version record in the same transaction
              await conn.execute(
                'DELETE FROM schema_version WHERE version = ?',
                [migration.version]
              );
            });

            log('info', 'mysql_database_migrated_down', { 
              version: migration.version,
              name: migration.name 
            });
          } catch (error) {
            log('error', 'mysql_database_migration_down_failed', { 
              version: migration.version, 
              name: migration.name,
              error: error instanceof Error ? error.message : String(error)
            });
            throw error;
          }
        }
      }
    }

    log('info', 'mysql_database_migrate_to_version_complete', { 
      fromVersion: currentVersion, 
      toVersion: targetVersion 
    });
  } catch (error) {
    log('error', 'mysql_database_migrate_to_version_failed', { 
      fromVersion: currentVersion, 
      targetVersion,
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

/**
 * Get migration status
 */
export async function getMigrationStatus(): Promise<{
  currentVersion: number;
  latestVersion: number;
  pendingMigrations: number[];
}> {
  const currentVersion = await getCurrentVersion();
  const pendingMigrations = MIGRATIONS
    .filter(m => m.version > currentVersion)
    .map(m => m.version);

  return {
    currentVersion,
    latestVersion: MIGRATIONS.length,
    pendingMigrations
  };
}

/**
 * Check if database is initialized
 */
export async function isDatabaseInitialized(): Promise<boolean> {
  try {
    const version = await getCurrentVersion();
    return version > 0;
  } catch {
    return false;
  }
}

export { MIGRATIONS };
