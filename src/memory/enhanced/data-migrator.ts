/**
 * Data Migrator - 旧格式数据迁移到增强格式
 * 一次性迁移，添加版本链和智能遗忘字段
 */
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  copyFileSync,
} from "fs";
import { join } from "path";
import type { LTMEntry } from "../ltm.js";

export interface EnhancedLTMEntry extends LTMEntry {
  version: number;
  parentId: string | null;
  rootId: string | null;
  relation: "creates" | "updates" | "extends" | "derives";
  isLatest: boolean;
  forgotten: boolean;
  forgottenAt?: number;
  forgottenReason?: string;
  expiresAt?: number;
}

export interface MigrateResult {
  migrated: number;
  backupPath: string;
}

export class DataMigrator {
  /**
   * 检查是否需要迁移
   */
  needsMigration(storePath: string): boolean {
    const markerFile = join(storePath, "_migrated_v2");
    return !existsSync(markerFile);
  }

  /**
   * 执行迁移
   */
  migrate(storePath: string): MigrateResult {
    const markerFile = join(storePath, "_migrated_v2");

    // 如果已迁移，直接返回
    if (existsSync(markerFile)) {
      return { migrated: 0, backupPath: "" };
    }

    const indexPath = join(storePath, "index.json");
    if (!existsSync(indexPath)) {
      // 新数据，直接创建标记
      writeFileSync(markerFile, "migrated");
      return { migrated: 0, backupPath: "" };
    }

    // 备份旧数据
    const backupPath = this.backup(storePath);

    // 读取旧数据
    let entries: LTMEntry[] = [];
    try {
      const raw = readFileSync(indexPath, "utf-8");
      entries = JSON.parse(raw);
    } catch {
      // 文件损坏，从空开始
      entries = [];
    }

    // 迁移每条条目
    const migratedEntries: EnhancedLTMEntry[] = entries.map((entry) => ({
      ...entry,
      version: 1,
      parentId: null,
      rootId: entry.id,
      relation: "creates",
      isLatest: true,
      forgotten: false,
    }));

    // 写入迁移后的数据
    try {
      writeFileSync(
        indexPath,
        JSON.stringify(migratedEntries, null, 2),
        "utf-8"
      );
    } catch (err) {
      console.error("Failed to write migrated LTM data:", err);
    }

    // 创建迁移标记
    writeFileSync(markerFile, "migrated");

    return { migrated: migratedEntries.length, backupPath };
  }

  /**
   * 备份旧数据
   */
  backup(storePath: string): string {
    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .substring(0, 19);
    const backupDir = join(storePath, `_backup_${timestamp}`);
    mkdirSync(backupDir, { recursive: true });

    const indexPath = join(storePath, "index.json");
    if (existsSync(indexPath)) {
      copyFileSync(indexPath, join(backupDir, "index.json"));
    }

    const archiveManifestPath = join(storePath, "archive-manifest.json");
    if (existsSync(archiveManifestPath)) {
      copyFileSync(archiveManifestPath, join(backupDir, "archive-manifest.json"));
    }

    return backupDir;
  }
}
