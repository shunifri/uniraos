#!/bin/bash
# 修复 .env 缺失变量
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${PROJECT_DIR}/.env"

# 生成密码
gen_pass() {
  openssl rand -base64 24 2>/dev/null | tr -dc 'a-zA-Z0-9' | head -c 24
}
gen_jwt() {
  openssl rand -base64 48 2>/dev/null
}

JWT_SECRET=$(gen_jwt)
MYSQL_ROOT_PASS=$(gen_pass)
MYSQL_PASS=$(gen_pass)
RABBITMQ_PASS=$(gen_pass)
MINIO_PASS=$(gen_pass)
NEO4J_PASS=$(gen_pass)
GRAFANA_PASS=$(gen_pass)

cat > "$ENV_FILE" << EOF
# ============================================
# RAOS 环境变量配置
# ============================================

# Application
NODE_ENV=production
PORT=3000
LOG_LEVEL=info
JWT_SECRET=${JWT_SECRET}

# Docker Deployment
USE_MYSQL=true
IMAGE_TAG=latest

# MySQL Configuration
MYSQL_PRIMARY_HOST=mysql-primary
MYSQL_PRIMARY_PORT=3306
MYSQL_USER=raos
MYSQL_ROOT_PASSWORD=${MYSQL_ROOT_PASS}
MYSQL_PASSWORD=${MYSQL_PASS}
MYSQL_DATABASE=raos
MYSQL_CONN_LIMIT=20
MYSQL_REPLICA_CONN_LIMIT=30
MYSQL_ACQUIRE_TIMEOUT=60000
MYSQL_CONNECT_TIMEOUT=10000
MYSQL_QUEUE_LIMIT=0
MYSQL_KEEP_ALIVE_DELAY=10000

# Redis Configuration
REDIS_HOSTS=redis:6379
REDIS_PASSWORD=
REDIS_KEY_PREFIX=raos:

# Qdrant Vector Database
QDRANT_HOST=qdrant
QDRANT_PORT=6333
QDRANT_GRPC_PORT=6334

# RabbitMQ Configuration
RABBITMQ_URL=amqp://raos:${RABBITMQ_PASS}@rabbitmq:5672
RABBITMQ_USER=raos
RABBITMQ_PASS=${RABBITMQ_PASS}

# MinIO / S3 Configuration
MINIO_ENDPOINT=minio
MINIO_PORT=9000
MINIO_USE_SSL=false
MINIO_USER=raos
MINIO_PASSWORD=${MINIO_PASS}
MINIO_BUCKET=raos-files

# LLM Provider Configuration
LLM_API_KEY=
LLM_BASE_URL=https://api.openai.com/v1

# CORS
ALLOWED_ORIGINS=http://localhost

# Neo4j (Optional)
NEO4J_AUTH=neo4j/${NEO4J_PASS}
NEO4J_PASSWORD=${NEO4J_PASS}

# Grafana (Optional)
GRAFANA_USER=admin
GRAFANA_PASSWORD=${GRAFANA_PASS}
EOF

echo "✅ .env 已生成，关键密码："
echo "  JWT_SECRET:          ${JWT_SECRET:0:16}..."
echo "  MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASS:0:4}****"
echo "  MYSQL_PASSWORD:      ${MYSQL_PASS:0:4}****"
echo "  RABBITMQ_PASS:       ${RABBITMQ_PASS:0:4}****"
echo "  MINIO_PASSWORD:      ${MINIO_PASS:0:4}****"
echo "  NEO4J_PASSWORD:      ${NEO4J_PASS:0:4}****"
echo "  GRAFANA_PASSWORD:    ${GRAFANA_PASS:0:4}****"
echo ""
echo "接下来执行：docker compose up -d --force-recreate raos-backend raos-workers raos-frontend"
