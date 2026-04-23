import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { CustomSkillRepository } from "../../src/db/custom-skill-repository.js";
import { defineSkill, Autonomy } from "../../src/types/skill.js";

describe("CustomSkillRepository", () => {
  let db: Database.Database;
  let repo: CustomSkillRepository;

  beforeEach(() => {
    // 使用内存数据库，每个测试独立
    db = new Database(":memory:");
    db.exec(`
      CREATE TABLE IF NOT EXISTS custom_skills (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        description TEXT,
        version TEXT NOT NULL DEFAULT '1.0.0',
        definition TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        is_system INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      );
    `);
    repo = new CustomSkillRepository(db);
  });

  describe("create and find", () => {
    it("should persist a skill with owner", async () => {
      const skill = defineSkill({
        name: "test_skill",
        description: "A test skill",
        autonomy: Autonomy.MANUAL,
        handler: async () => ({ success: true, data: "hello" }),
      });

      const created = await repo.create(skill, "user_123");
      expect(created.name).toBe("test_skill");
      expect(created.ownerId).toBe("user_123");
      expect(created.isSystem).toBe(false);

      const found = await repo.findByName("test_skill");
      expect(found).not.toBeNull();
      expect(found!.ownerId).toBe("user_123");
    });

    it("should find skills by owner", async () => {
      const skillA = defineSkill({
        name: "skill_a",
        handler: async () => ({ success: true }),
      });
      const skillB = defineSkill({
        name: "skill_b",
        handler: async () => ({ success: true }),
      });

      await repo.create(skillA, "user_1");
      await repo.create(skillB, "user_2");

      const user1Skills = await repo.findByOwner("user_1");
      expect(user1Skills).toHaveLength(1);
      expect(user1Skills[0].name).toBe("skill_a");
    });
  });

  describe("reconstructSkill", () => {
    it("should reconstruct skill with default echo handler", async () => {
      const skill = defineSkill({
        name: "reconstruct_test",
        description: "Test reconstruction",
        autonomy: Autonomy.AUTO_PRE,
        visible: false,
        owner: "user_99",
        handler: async () => ({ success: true }),
      });

      await repo.create(skill, "user_99");
      const customSkill = await repo.findByName("reconstruct_test");
      expect(customSkill).not.toBeNull();

      const reconstructed = await repo.reconstructSkill(customSkill!);
      expect(reconstructed.name).toBe("reconstruct_test");
      expect(reconstructed.description).toBe("Test reconstruction");
      expect(reconstructed.autonomy).toBe(Autonomy.AUTO_PRE);
      expect(reconstructed.visible).toBe(false);
      expect(reconstructed.owner).toBe("user_99");

      // handler 应为默认 echo handler
      const result = await reconstructed.handler({ x: 1 }, {} as any);
      expect(result.success).toBe(true);
      expect((result as any).data).toEqual({ echo: { x: 1 } });
    });

    it("should reconstruct system skill correctly", async () => {
      const skill = defineSkill({
        name: "sys_skill",
        isSystem: true,
        handler: async () => ({ success: true }),
      });

      await repo.create(skill, "admin");
      const customSkill = await repo.findByName("sys_skill");
      const reconstructed = await repo.reconstructSkill(customSkill!);
      expect(reconstructed.isSystem).toBe(true);
    });
  });

  describe("delete", () => {
    it("should delete a skill", async () => {
      const skill = defineSkill({
        name: "to_delete",
        handler: async () => ({ success: true }),
      });

      const created = await repo.create(skill, "user_1");
      expect(await repo.findByName("to_delete")).not.toBeNull();

      const deleted = await repo.delete(created.id);
      expect(deleted).toBe(true);
      expect(await repo.findByName("to_delete")).toBeNull();
    });

    it("should delete all skills by owner", async () => {
      const skill = defineSkill({
        name: "owner_skill",
        handler: async () => ({ success: true }),
      });

      await repo.create(skill, "user_1");
      const count = await repo.deleteByOwner("user_1");
      expect(count).toBe(1);
      expect(await repo.findByName("owner_skill")).toBeNull();
    });
  });
});
