#!/bin/bash
# 修复 .env 缺失变量
# 用法:
#   交互模式（默认）: ./scripts/fix-env.sh
#   非交互模式: ./scripts/fix-env.sh --auto
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${PROJECT_DIR}/.env"
AUTO_MODE=false

if [[ "${1:-}" == "--auto" ]]; then
  AUTO_MODE=true
fi

# 颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# 生成密码
gen_pass() {
  openssl rand -base64 24 2>/dev/null | tr -dc 'a-zA-Z0-9' | head -c 24
}
gen_jwt() {
  openssl rand -base64 48 2>/dev/null
}

# 获取服务器 IP
get_server_ips() {
  local ips=""
  if command -v hostname &>/dev/null && hostname -I &>/dev/null; then
    ips=$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -v '^127\.' | grep -v '^::1' | head -5)
  fi
  if [[ -z "$ips" ]] && command -v ip &>/dev/null; then
    ips=$(ip -4 addr show 2>/dev/null | grep -oP '(?<=inet\s)\d+(\.\d+){3}' | grep -v '^127\.' | head -5)
  fi
  if [[ -z "$ips" ]] && command -v ifconfig &>/dev/null; then
    ips=$(ifconfig 2>/dev/null | grep -oE 'inet [0-9]+\.[0-9]+\.[0-9]+\.[0-9]+' | grep -v '127.0.0.1' | sed 's/inet //' | head -5)
  fi
  echo "$ips"
}

# 交互式配置 ALLOWED_ORIGINS
interactive_allowed_origins() {
  echo ""
  echo -e "${CYAN}[CORS]${NC} 配置允许访问的域名/来源"
  echo ""
  echo -e "  ${YELLOW}说明:${NC} 浏览器通过 CORS 安全检查决定是否允许网页访问 API。"
  echo -e "  如果你的服务器通过 IP 或域名访问，必须将对应地址加入白名单。"
  echo -e "  多个来源用 ${BOLD}英文逗号${NC} 分隔。"
  echo ""

  local detected_ips
  detected_ips=$(get_server_ips)
  local first_ip=""
  if [[ -n "$detected_ips" ]]; then
    first_ip=$(echo "$detected_ips" | head -1)
    echo -e "  ${GREEN}检测到服务器 IP:${NC}"
    echo "$detected_ips" | sed 's/^/    - http:\/\//'
    echo ""
  fi

  local options=()
  local values=()
  local idx=1

  echo -e "  ${CYAN}${idx})${NC} http://localhost （仅本机访问）"
  options+=("localhost")
  values+=("http://localhost")
  ((idx++))

  if [[ -n "$first_ip" ]]; then
    echo -e "  ${CYAN}${idx})${NC} http://${first_ip} （内网/服务器 IP 访问）"
    options+=("server_ip")
    values+=("http://${first_ip}")
    ((idx++))
  fi

  echo -e "  ${CYAN}${idx})${NC} 自定义输入（支持多个，逗号分隔）"
  options+=("custom")
  values+=("__CUSTOM__")
  ((idx++))

  echo -e "  ${CYAN}${idx})${NC} * （允许所有来源，${RED}生产环境不推荐${NC}）"
  options+=("all")
  values+=("*")

  echo ""
  local choice
  local max_choice=$idx
  while true; do
    read -rp "$(echo -e "${YELLOW}?${NC} 请选择 [1-$max_choice]: ")" choice
    if [[ "$choice" =~ ^[0-9]+$ ]] && [[ "$choice" -ge 1 && "$choice" -le "$max_choice" ]]; then
      break
    fi
    echo -e "${YELLOW}  请输入 1-$max_choice 之间的数字${NC}"
  done

  local selected_value="${values[$((choice-1))]}"

  if [[ "$selected_value" == "__CUSTOM__" ]]; then
    echo ""
    local custom_input
    read -rp "$(echo -e "${YELLOW}?${NC} 请输入允许的来源（多个用逗号分隔）: ")" custom_input
    selected_value="${custom_input:-http://localhost}"
    if [[ "$selected_value" != "*" && ! "$selected_value" =~ ^https?:// ]]; then
      echo -e "${YELLOW}  提示: 建议以 http:// 或 https:// 开头，当前输入为: ${selected_value}${NC}"
    fi
  fi

  echo ""
  echo -e "  ${GREEN}已选择 CORS 白名单:${NC} ${BOLD}${selected_value}${NC}"
  echo ""
  echo "$selected_value"
}

JWT_SECRET=$(gen_jwt)
MYSQL_ROOT_PASS=$(gen_pass)
MYSQL_PASS=$(gen_pass)
RABBITMQ_PASS=$(gen_pass)
MINIO_PASS=$(gen_pass)
NEO4J_PASS=$(gen_pass)
GRAFANA_PASS=$(gen_pass)

# 确定 ALLOWED_ORIGINS
ALLOWED_ORIGINS="http://localhost"
if [[ "$AUTO_MODE" == false && -t 0 && -t 1 ]]; then
  ALLOWED_ORIGINS=$(interactive_allowed_origins)
else
  if [[ "$AUTO_MODE" == true ]]; then
    echo "⚙️  自动模式，使用默认 ALLOWED_ORIGINS=http://localhost"
  fi
  # 尝试自动添加检测到的第一个 IP（如果只有一个非 127 IP）
  local detected_ips
  detected_ips=$(get_server_ips)
  local first_ip=""
  if [[ -n "$detected_ips" ]]; then
    first_ip=$(echo "$detected_ips" | head -1)
    local ip_count
    ip_count=$(echo "$detected_ips" | wc -l | tr -d ' ')
    if [[ "$ip_count" -eq 1 ]]; then
      ALLOWED_ORIGINS="http://localhost,http://${first_ip}"
      echo "🌐 检测到单个服务器 IP，自动设置为: ${ALLOWED_ORIGINS}"
    fi
  fi
fi

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
ALLOWED_ORIGINS=${ALLOWED_ORIGINS}

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
echo "  ALLOWED_ORIGINS:     ${ALLOWED_ORIGINS}"
echo ""
echo "接下来执行：docker compose up -d --force-recreate raos-backend raos-workers raos-frontend"
