/**
 * Environment variable validation
 * Ensures all required secrets are set before server startup.
 * Prevents production from running with weak/default passwords.
 */

export interface EnvValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

const PLACEHOLDERS = [
  "__REPLACE_IN_PRODUCTION__",
  "your-",
  "your_",
  "placeholder",
  "changeme",
  "password",
  "123456",
  "admin123",
  "raospassword",
  "rootpassword",
];

function isWeak(value: string | undefined): boolean {
  if (!value || value.trim().length === 0) return true;
  const lower = value.toLowerCase().trim();
  if (lower.length < 8) return true;
  return PLACEHOLDERS.some((p) => lower.includes(p.toLowerCase()));
}

export function validateEnv(): EnvValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // MySQL password
  if (isWeak(process.env.MYSQL_PASSWORD)) {
    errors.push("MYSQL_PASSWORD is missing, empty, or uses a weak/default value");
  }

  // P2-3 修复: USE_MYSQL=true 时检查 MYSQL_PRIMARY_HOST 不是默认 fallback 'localhost'
  // 同事 2026-06-12 部署反馈 ECONNREFUSED 172.29.0.2:3306, 根因是容器在错误的网络里
  // 跑 (单容器起没接 raos-backend network), MySQL 配置 fallback 到某 IP 连不上。
  // 如果 host 是 'localhost' / '127.0.0.1' / 看起来像 dev IP 但又连不通, 提示用户。
  if (process.env.USE_MYSQL === "true" && process.env.NODE_ENV === "production") {
    const host = process.env.MYSQL_PRIMARY_HOST;
    if (!host) {
      warnings.push(
        "MYSQL_PRIMARY_HOST is not set, falling back to 'localhost'. " +
        "In Docker, this means the container cannot reach mysql-primary. " +
        "Set MYSQL_PRIMARY_HOST=mysql-primary in your env (or use docker compose which auto-sets it)."
      );
    } else if (host === "localhost" || host === "127.0.0.1") {
      errors.push(
        `MYSQL_PRIMARY_HOST=${host} but container cannot reach its own loopback to MySQL. ` +
        `In Docker, set MYSQL_PRIMARY_HOST=mysql-primary (the compose service name).`
      );
    } else if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
      // IP 形如 172.x / 10.x / 192.168.x 但用户应该用服务名, 不是 raw IP
      warnings.push(
        `MYSQL_PRIMARY_HOST=${host} is a raw IP, not a Docker service name. ` +
        `If MySQL is in docker compose, use MYSQL_PRIMARY_HOST=mysql-primary (auto-DNS). ` +
        `Raw IP only works if MySQL is on the host network or a fixed external IP.`
      );
    }
  }

  // Redis password (warn if empty in production, but don't block)
  if (process.env.NODE_ENV === "production" && !process.env.REDIS_PASSWORD) {
    warnings.push("REDIS_PASSWORD is strongly recommended in production");
  }

  // MinIO password
  if (isWeak(process.env.MINIO_PASSWORD)) {
    errors.push("MINIO_PASSWORD is missing, empty, or uses a weak/default value");
  }

  // RabbitMQ password
  if (isWeak(process.env.RABBITMQ_PASS)) {
    errors.push("RABBITMQ_PASS is missing, empty, or uses a weak/default value");
  }

  // Neo4j password (if used)
  if (process.env.NEO4J_PASSWORD && isWeak(process.env.NEO4J_PASSWORD)) {
    errors.push("NEO4J_PASSWORD uses a weak/default value");
  }

  // DocMind credentials (if enabled via env)
  if (process.env.DOCMIND_ACCESS_KEY_ID && process.env.DOCMIND_ACCESS_KEY_ID.length < 5) {
    errors.push("DOCMIND_ACCESS_KEY_ID appears invalid (too short)");
  }

  // LLM API Key (optional at startup — can be configured via system settings UI/API later)
  const hasLlmKey = !!(process.env.LLM_API_KEY || process.env.OPENAI_API_KEY);
  if (!hasLlmKey) {
    warnings.push("No LLM API key found in environment (LLM_API_KEY or OPENAI_API_KEY). You can configure it later via System Settings → LLM Config.");
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validates environment and exits if invalid (production only).
 * In development, prints warnings but continues.
 */
export function validateEnvOrExit(): void {
  const result = validateEnv();
  if (!result.valid) {
    console.error("\n❌ Environment validation failed:");
    for (const err of result.errors) {
      console.error(`   - ${err}`);
    }
    console.error("\nPlease check your .env file and ensure all required secrets are set.\n");

    if (process.env.NODE_ENV === "production") {
      process.exit(1);
    } else {
      console.warn("⚠️  Continuing in development mode despite validation failures...\n");
    }
  } else {
    if (result.warnings.length > 0) {
      console.warn("\n⚠️  Environment validation warnings:");
      for (const w of result.warnings) {
        console.warn(`   - ${w}`);
      }
    }
    console.log("✅ Environment validation passed\n");
  }
}
