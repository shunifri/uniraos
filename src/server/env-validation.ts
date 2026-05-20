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

  // JWT Secret
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    errors.push("JWT_SECRET must be set and at least 32 characters long");
  }

  // MySQL password
  if (isWeak(process.env.MYSQL_PASSWORD)) {
    errors.push("MYSQL_PASSWORD is missing, empty, or uses a weak/default value");
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
