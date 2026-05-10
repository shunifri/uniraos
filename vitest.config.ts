import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  resolve: {
    alias: {
      react: resolve(__dirname, "web/node_modules/react"),
      "react-dom": resolve(__dirname, "web/node_modules/react-dom"),
      "react/jsx-runtime": resolve(__dirname, "web/node_modules/react/jsx-runtime.js"),
      "react/jsx-dev-runtime": resolve(__dirname, "web/node_modules/react/jsx-dev-runtime.js"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"],
    mainFields: ["module", "main"],
    conditions: ["import", "module", "default"],
  },
  optimizeDeps: {
    include: ["react", "react-dom", "react-dom/client", "react-dom/test-utils"],
  },
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    exclude: [
      "tests/db/mysql-database.test.ts",
      "tests/vector/qdrant-client.test.ts",
    ],
    environment: "jsdom",
    setupFiles: ["tests/setup.ts"],
    server: {
      deps: {
        inline: [/^(react|react-dom)/],
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      thresholds: {
        lines: 50,
        functions: 50,
        branches: 40,
        statements: 50
      }
    },
    env: {
      // Qdrant 端口配置 - 与 docker-compose.local.yml 保持一致
      QDRANT_URL: "http://localhost:6334",
      QDRANT_HOST: "localhost",
      QDRANT_PORT: "6334",
      QDRANT_GRPC_PORT: "6335",
      // MySQL 端口配置 - 与 docker-compose.local.yml 保持一致  
      MYSQL_PRIMARY_HOST: "localhost",
      MYSQL_PRIMARY_PORT: "3307",
      MYSQL_USER: "raos",
      MYSQL_PASSWORD: "raospassword",
      MYSQL_DATABASE: "raos",
      // Redis 端口配置
      REDIS_HOSTS: "localhost:6380",
    },
  },
});
