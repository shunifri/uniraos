import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  resolve: {
    alias: {
      react: resolve(__dirname, "web/node_modules/react"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
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
