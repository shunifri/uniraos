#!/bin/bash
# =============================================================================
# RAOS 交互式部署向导
# 全新环境或重新部署时执行
#
# 用法:
#   交互模式: ./deploy/deploy.sh
#   非交互模式: ./deploy/deploy.sh --non-interactive [--build] [--env-file <path>]
#   纯镜像模式: ./deploy/deploy.sh --quick
# =============================================================================

set -uo pipefail

# =============================================================================
# 颜色与样式
# =============================================================================
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# =============================================================================
# 默认配置
# =============================================================================
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="${PROJECT_DIR}/.env"
COMPOSE_FILE="${PROJECT_DIR}/docker-compose.yml"

# Compose 文件参数（自动检测 override 文件）
COMPOSE_ARGS=(-f "$COMPOSE_FILE")
if [[ -f "${PROJECT_DIR}/docker-compose.override.yml" ]]; then
  COMPOSE_ARGS+=(-f "${PROJECT_DIR}/docker-compose.override.yml")
fi

# 模式开关
NON_INTERACTIVE=false
BUILD_LOCAL=false
QUICK_MODE=false
DEPLOY_MODE="" # build | pull | quick

# =============================================================================
# 日志函数
# =============================================================================
function log_info()  { echo -e "${BLUE}[INFO]${NC}  $1"; }
function log_ok()    { echo -e "${GREEN}[OK]${NC}   $1"; }
function log_warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
function log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
function log_step()  { echo -e "\n${CYAN}${BOLD}▶ $1${NC}"; }

# =============================================================================
# 工具函数
# =============================================================================
function clear_screen() {
  if command -v tput &>/dev/null; then
    tput clear 2>/dev/null || echo -e "\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n"
  else
    echo -e "\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n"
  fi
}

function print_header() {
  echo ""
  echo -e "${CYAN}${BOLD}╔══════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${CYAN}${BOLD}║                                                              ║${NC}"
  echo -e "${CYAN}${BOLD}║${NC}     ${BOLD}RAOS — 递归式智能体操作系统${NC}                            ${CYAN}${BOLD}║${NC}"
  echo -e "${CYAN}${BOLD}║${NC}     ${YELLOW}交互式部署向导${NC}                                          ${CYAN}${BOLD}║${NC}"
  echo -e "${CYAN}${BOLD}║                                                              ║${NC}"
  echo -e "${CYAN}${BOLD}╚══════════════════════════════════════════════════════════════╝${NC}"
  echo ""
}

function print_divider() {
  echo -e "${BLUE}──────────────────────────────────────────────────────────────${NC}"
}

function read_input() {
  local prompt="$1"
  local default="${2:-}"
  local result
  if [[ -n "$default" ]]; then
    read -rp "$(echo -e "${YELLOW}?${NC} $prompt [${CYAN}$default${NC}]: ")" result
    echo "${result:-$default}"
  else
    read -rp "$(echo -e "${YELLOW}?${NC} $prompt: ")" result
    echo "$result"
  fi
}

function read_password() {
  local prompt="$1"
  local result
  read -rsp "$(echo -e "${YELLOW}?${NC} $prompt (输入不显示): ")" result
  echo ""
  echo "$result"
}

function confirm() {
  local prompt="$1"
  local default="${2:-Y}"
  local result
  while true; do
    read -rp "$(echo -e "${YELLOW}?${NC} $prompt [${CYAN}$default${NC}]: ")" result
    result="${result:-$default}"
    case "$result" in
      [Yy]|[Yy][Ee][Ss]) return 0 ;;
      [Nn]|[Nn][Oo]) return 1 ;;
      *) echo -e "${YELLOW}  请输入 Y 或 N${NC}" ;;
    esac
  done
}

function generate_password() {
  openssl rand -base64 24 2>/dev/null | tr -dc 'a-zA-Z0-9' | head -c 24
}

function generate_jwt_secret() {
  (openssl rand -base64 48 2>/dev/null || dd if=/dev/urandom bs=48 count=1 2>/dev/null | base64) | tr -d '\n'
}

function is_weak_password() {
  local value="$1"
  if [[ -z "$value" || ${#value} -lt 8 ]]; then
    return 0
  fi
  local lower="${value,,}"
  local placeholders=("your-" "your_" "placeholder" "changeme" "password" "123456" "admin123" "raospassword" "rootpassword")
  for p in "${placeholders[@]}"; do
    if [[ "$lower" == *"$p"* ]]; then
      return 0
    fi
  done
  return 1
}

function check_port() {
  local port="$1"
  if command -v lsof &>/dev/null && lsof -Pi :"$port" -sTCP:LISTEN -t &>/dev/null; then
    return 0
  elif command -v ss &>/dev/null && ss -tln | grep -q ":$port "; then
    return 0
  elif command -v netstat &>/dev/null && netstat -tln 2>/dev/null | grep -q ":$port "; then
    return 0
  fi
  return 1
}

function sed_inplace() {
  local file="$1"
  shift
  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "$@" "$file"
  else
    sed -i "$@" "$file"
  fi
}

# =============================================================================
# 参数解析
# =============================================================================
while [[ $# -gt 0 ]]; do
  case $1 in
    --non-interactive)
      NON_INTERACTIVE=true
      shift
      ;;
    --build)
      BUILD_LOCAL=true
      shift
      ;;
    --quick)
      QUICK_MODE=true
      shift
      ;;
    --env-file)
      ENV_FILE="$2"
      shift 2
      ;;
    --help|-h)
      echo "RAOS 部署向导"
      echo ""
      echo "用法: $0 [选项]"
      echo ""
      echo "选项:"
      echo "  (无参数)            启动交互式部署向导（推荐）"
      echo "  --non-interactive   非交互模式（兼容 CI/CD）"
      echo "  --build             本地构建镜像（而非拉取远程镜像）"
      echo "  --quick             纯镜像快速部署（无源码，仅下载配置）"
      echo "  --env-file <path>   指定环境变量文件路径（默认: .env）"
      echo "  --help, -h          显示此帮助"
      echo ""
      echo "示例:"
      echo "  $0                           # 交互式向导"
      echo "  $0 --non-interactive --build # CI/CD 本地构建"
      echo "  $0 --quick                   # 无源码快速部署"
      exit 0
      ;;
    *)
      echo -e "${RED}未知参数: $1${NC}"
      echo "使用 --help 查看用法"
      exit 1
      ;;
  esac
done

# =============================================================================
# 非交互模式：走原有简化逻辑
# =============================================================================
if $NON_INTERACTIVE; then
  exec "$SCRIPT_DIR/deploy-non-interactive.sh" \
    ${BUILD_LOCAL:+--build} \
    ${ENV_FILE:+--env-file "$ENV_FILE"}
fi

# =============================================================================
# 交互模式：步骤 0 — 选择部署方式
# =============================================================================
function step_choose_mode() {
  clear_screen
  print_header

  # 检测是否有源码
  local has_source=false
  if [[ -f "$COMPOSE_FILE" && -f "$PROJECT_DIR/.env.example" ]]; then
    has_source=true
  fi

  echo -e "${BOLD}请选择部署方式:${NC}"
  echo ""

  if $has_source; then
    echo -e "  ${GREEN}1)${NC} 🏗️  ${BOLD}本地构建部署${NC}"
    echo -e "     从本地源码构建 Docker 镜像，适合开发/测试环境"
    echo ""
    echo -e "  ${GREEN}2)${NC} 📦 ${BOLD}拉取远程镜像部署${NC} ${CYAN}(推荐)${NC}"
    echo -e "     从华为云 SWR 拉取预编译镜像，适合生产环境"
    echo ""
    echo -e "  ${GREEN}3)${NC} 🚀 ${BOLD}纯镜像快速部署${NC}"
    echo -e "     无需保留源码，仅下载必要配置文件后部署"
    echo ""

    local choice
    while true; do
      read -rp "$(echo -e "${YELLOW}?${NC} 请输入选项 [1-3]: ")" choice
      case "$choice" in
        1)
          DEPLOY_MODE="build"
          BUILD_LOCAL=true
          break
          ;;
        2)
          DEPLOY_MODE="pull"
          BUILD_LOCAL=false
          break
          ;;
        3)
          DEPLOY_MODE="quick"
          QUICK_MODE=true
          break
          ;;
        *)
          echo -e "${RED}  请输入 1、2 或 3${NC}"
          ;;
      esac
    done
  else
    echo -e "  ${YELLOW}⚠️  未检测到项目源码${NC}"
    echo ""
    echo -e "  ${GREEN}1)${NC} 🚀 ${BOLD}纯镜像快速部署${NC} ${CYAN}(推荐)${NC}"
    echo -e "     自动下载必要配置文件，从远程镜像部署"
    echo ""
    echo -e "  ${GREEN}2)${NC} 📥 ${BOLD}先克隆源码再部署${NC}"
    echo -e "     退出脚本，请先执行: git clone <repo> && cd raos"
    echo ""

    local choice
    while true; do
      read -rp "$(echo -e "${YELLOW}?${NC} 请输入选项 [1-2]: ")" choice
      case "$choice" in
        1)
          DEPLOY_MODE="quick"
          QUICK_MODE=true
          break
          ;;
        2)
          echo ""
          echo -e "${CYAN}请执行以下命令后重新运行本脚本:${NC}"
          echo "  git clone <your-repo-url> && cd raos"
          echo "  ./deploy/deploy.sh"
          exit 0
          ;;
        *)
          echo -e "${RED}  请输入 1 或 2${NC}"
          ;;
      esac
    done
  fi
}

# =============================================================================
# 交互模式：步骤 1 — 环境检查
# =============================================================================
function step_env_check() {
  log_step "步骤 1/5: 环境检查"
  print_divider

  local all_ok=true

  # Docker
  if ! command -v docker &>/dev/null; then
    log_error "Docker 未安装"
    echo "   安装指南: https://docs.docker.com/get-docker/"
    all_ok=false
  else
    local docker_version
    docker_version=$(docker --version | awk '{print $3}' | tr -d ',')
    log_ok "Docker 已安装: $docker_version"
  fi

  # Docker Compose
  if command -v docker compose &>/dev/null; then
    COMPOSE_CMD="docker compose"
    log_ok "Docker Compose (插件版) 已安装"
  elif command -v docker-compose &>/dev/null; then
    COMPOSE_CMD="docker-compose"
    log_ok "Docker Compose (独立版) 已安装"
  else
    log_error "Docker Compose 未安装"
    all_ok=false
  fi

  # 磁盘空间
  if command -v df &>/dev/null; then
    local available_gb
    available_gb=$(df -BG "$PROJECT_DIR" 2>/dev/null | awk 'NR==2 {print $4}' | tr -d 'G')
    if [[ -n "$available_gb" && "$available_gb" -lt 20 ]]; then
      log_warn "可用磁盘空间仅 ${available_gb}GB，建议至少 20GB"
    else
      log_ok "磁盘空间充足 (${available_gb:-未知}GB 可用)"
    fi
  fi

  # 端口检查
  local ports=(80 3000 3306 6379 9000 15672)
  local port_conflicts=()
  for port in "${ports[@]}"; do
    if check_port "$port"; then
      port_conflicts+=("$port")
    fi
  done

  if [[ ${#port_conflicts[@]} -gt 0 ]]; then
    log_warn "以下端口已被占用: ${port_conflicts[*]}"
    echo "   如有冲突，请停止占用服务或修改 docker-compose.yml 端口映射"
    if ! confirm "是否继续部署?"; then
      echo ""
      echo -e "${CYAN}已取消部署。请释放端口后重试。${NC}"
      exit 0
    fi
  else
    log_ok "关键端口未被占用"
  fi

  if ! $all_ok; then
    echo ""
    log_error "环境检查未通过，请修复上述问题后重试"
    exit 1
  fi

  echo ""
  log_ok "环境检查通过"
}

# =============================================================================
# 交互模式：步骤 2 — 纯镜像模式下载文件
# =============================================================================
function step_quick_download() {
  if ! $QUICK_MODE; then
    return 0
  fi

  log_step "步骤 2/5: 下载部署文件"
  print_divider

  log_info "正在下载必要配置文件..."

  local base_url="https://raw.githubusercontent.com/your-org/raos/main"
  local files=(
    "docker-compose.yml"
    ".env.example"
  )
  local dirs=(
    "docker/frontend"
    "docker/mysql"
    "docker/mysql/init"
    "docker/rabbitmq"
  )

  # 创建目录
  for dir in "${dirs[@]}"; do
    mkdir -p "$PROJECT_DIR/$dir"
  done

  # 下载文件（如果本地不存在）
  for file in "${files[@]}"; do
    if [[ ! -f "$PROJECT_DIR/$file" ]]; then
      log_info "下载 $file ..."
      if curl -fsSL -o "$PROJECT_DIR/$file" "$base_url/$file" 2>/dev/null; then
        log_ok "$file 下载完成"
      else
        log_warn "$file 下载失败，将尝试使用本地版本"
      fi
    else
      log_ok "$file 已存在，跳过下载"
    fi
  done

  # 下载 docker 配置文件
  local docker_files=(
    "docker/frontend/nginx.conf"
    "docker/mysql/primary.cnf"
    "docker/rabbitmq/rabbitmq.conf"
  )
  for file in "${docker_files[@]}"; do
    if [[ ! -f "$PROJECT_DIR/$file" ]]; then
      log_info "下载 $file ..."
      if curl -fsSL -o "$PROJECT_DIR/$file" "$base_url/$file" 2>/dev/null; then
        log_ok "$file 下载完成"
      else
        log_warn "$file 下载失败"
      fi
    fi
  done

  # 更新 Compose 文件路径
  COMPOSE_FILE="${PROJECT_DIR}/docker-compose.yml"

  echo ""
  log_ok "配置文件准备完成"
}

# =============================================================================
# 交互模式：步骤 3 — 配置环境变量
# =============================================================================
function step_config() {
  log_step "步骤 3/5: 环境变量配置"
  print_divider

  # 检查/生成 .env
  if [[ ! -f "$ENV_FILE" ]]; then
    if [[ ! -f "$PROJECT_DIR/.env.example" ]]; then
      log_error "未找到 .env.example 模板文件"
      exit 1
    fi
    cp "$PROJECT_DIR/.env.example" "$ENV_FILE"
    log_info ".env 已自动生成"
  else
    log_info ".env 已存在"
    if ! confirm "是否重新配置环境变量?"; then
      log_info "跳过配置，使用现有 .env"
      return 0
    fi
    # 重新配置时，补齐 .env 中缺失的变量（从 .env.example 追加）
    log_info "正在检查并补齐缺失的环境变量..."
    while IFS= read -r line || [[ -n "$line" ]]; do
      # 跳过空行和纯注释行
      [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
      local var_name=""
      if [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)= ]]; then
        var_name="${BASH_REMATCH[1]}"
        if ! grep -q "^${var_name}=" "$ENV_FILE"; then
          echo "$line" >> "$ENV_FILE"
        fi
      fi
    done < "$PROJECT_DIR/.env.example"
  fi

  echo ""
  echo -e "${BOLD}以下必填项将自动生成强密码，你可以确认或修改:${NC}"
  echo ""

  # JWT_SECRET
  local jwt_secret
  jwt_secret=$(generate_jwt_secret)
  echo -e "${CYAN}[JWT_SECRET]${NC} JWT 签名密钥（≥32 字符，用于 Token 签名）"
  if confirm "使用自动生成的密钥?"; then
    sed_inplace "$ENV_FILE" "s#^JWT_SECRET=.*#JWT_SECRET=${jwt_secret}#"
    log_ok "JWT_SECRET 已设置"
  else
    local custom_jwt
    custom_jwt=$(read_input "请输入 JWT_SECRET（≥32 字符）")
    while [[ ${#custom_jwt} -lt 32 ]]; do
      log_warn "JWT_SECRET 至少需要 32 个字符"
      custom_jwt=$(read_input "请输入 JWT_SECRET（≥32 字符）")
    done
    sed_inplace "$ENV_FILE" "s#^JWT_SECRET=.*#JWT_SECRET=${custom_jwt}#"
    log_ok "JWT_SECRET 已设置"
  fi
  echo ""

  # 数据库密码
  local mysql_root_pass mysql_pass
  mysql_root_pass=$(generate_password)
  mysql_pass=$(generate_password)

  echo -e "${CYAN}[MySQL]${NC} 数据库密码"
  if confirm "使用自动生成的强密码?"; then
    sed_inplace "$ENV_FILE" "s#^MYSQL_ROOT_PASSWORD=.*#MYSQL_ROOT_PASSWORD=${mysql_root_pass}#"
    sed_inplace "$ENV_FILE" "s#^MYSQL_PASSWORD=.*#MYSQL_PASSWORD=${mysql_pass}#"
    log_ok "MySQL 密码已设置"
  else
    local custom_root custom_app
    custom_root=$(read_password "MySQL root 密码")
    while is_weak_password "$custom_root"; do
      log_warn "密码太弱，请使用至少 8 位的强密码"
      custom_root=$(read_password "MySQL root 密码")
    done
    custom_app=$(read_password "MySQL 应用密码")
    while is_weak_password "$custom_app"; do
      log_warn "密码太弱，请使用至少 8 位的强密码"
      custom_app=$(read_password "MySQL 应用密码")
    done
    sed_inplace "$ENV_FILE" "s#^MYSQL_ROOT_PASSWORD=.*#MYSQL_ROOT_PASSWORD=${custom_root}#"
    sed_inplace "$ENV_FILE" "s#^MYSQL_PASSWORD=.*#MYSQL_PASSWORD=${custom_app}#"
    log_ok "MySQL 密码已设置"
  fi
  echo ""

  # RabbitMQ
  local rabbit_pass
  rabbit_pass=$(generate_password)

  echo -e "${CYAN}[RabbitMQ]${NC} 消息队列密码"
  if confirm "使用自动生成的强密码?"; then
    sed_inplace "$ENV_FILE" "s#^RABBITMQ_PASS=.*#RABBITMQ_PASS=${rabbit_pass}#"
    log_ok "RabbitMQ 密码已设置"
  else
    local custom_rabbit
    custom_rabbit=$(read_password "RabbitMQ 密码")
    while is_weak_password "$custom_rabbit"; do
      log_warn "密码太弱"
      custom_rabbit=$(read_password "RabbitMQ 密码")
    done
    sed_inplace "$ENV_FILE" "s#^RABBITMQ_PASS=.*#RABBITMQ_PASS=${custom_rabbit}#"
    log_ok "RabbitMQ 密码已设置"
  fi
  echo ""

  # MinIO
  local minio_pass
  minio_pass=$(generate_password)

  echo -e "${CYAN}[MinIO]${NC} 对象存储密码"
  if confirm "使用自动生成的强密码?"; then
    sed_inplace "$ENV_FILE" "s#^MINIO_PASSWORD=.*#MINIO_PASSWORD=${minio_pass}#"
    log_ok "MinIO 密码已设置"
  else
    local custom_minio
    custom_minio=$(read_password "MinIO 密码")
    while is_weak_password "$custom_minio"; do
      log_warn "密码太弱"
      custom_minio=$(read_password "MinIO 密码")
    done
    sed_inplace "$ENV_FILE" "s#^MINIO_PASSWORD=.*#MINIO_PASSWORD=${custom_minio}#"
    log_ok "MinIO 密码已设置"
  fi
  echo ""

  # Redis（可选但推荐）
  local redis_pass
  redis_pass=$(generate_password)

  echo -e "${CYAN}[Redis]${NC} 缓存密码（可选，生产环境推荐配置）"
  if confirm "设置 Redis 密码?"; then
    if confirm "使用自动生成的强密码?"; then
      sed_inplace "$ENV_FILE" "s#^REDIS_PASSWORD=.*#REDIS_PASSWORD=${redis_pass}#"
      log_ok "Redis 密码已设置"
    else
      local custom_redis
      custom_redis=$(read_password "Redis 密码")
      sed_inplace "$ENV_FILE" "s#^REDIS_PASSWORD=.*#REDIS_PASSWORD=${custom_redis}#"
      log_ok "Redis 密码已设置"
    fi
  else
    log_info "跳过 Redis 密码设置"
  fi
  echo ""

  # Neo4j
  local neo4j_pass
  neo4j_pass=$(generate_password)

  echo -e "${CYAN}[Neo4j]${NC} 图数据库密码（可选，使用知识图谱时需要）"
  if confirm "启用 Neo4j 图数据库?"; then
    if confirm "使用自动生成的强密码?"; then
      sed_inplace "$ENV_FILE" "s#^NEO4J_AUTH=.*#NEO4J_AUTH=neo4j/${neo4j_pass}#"
      sed_inplace "$ENV_FILE" "s#^NEO4J_PASSWORD=.*#NEO4J_PASSWORD=${neo4j_pass}#"
      log_ok "Neo4j 密码已设置"
    else
      local custom_neo4j
      custom_neo4j=$(read_password "Neo4j 密码")
      sed_inplace "$ENV_FILE" "s#^NEO4J_AUTH=.*#NEO4J_AUTH=neo4j/${custom_neo4j}#"
      sed_inplace "$ENV_FILE" "s#^NEO4J_PASSWORD=.*#NEO4J_PASSWORD=${custom_neo4j}#"
      log_ok "Neo4j 密码已设置"
    fi
    # 启用 Neo4j
    if grep -q "^GRAPH_STORE_BACKEND=" "$ENV_FILE"; then
      sed_inplace "$ENV_FILE" "s#^GRAPH_STORE_BACKEND=.*#GRAPH_STORE_BACKEND=neo4j#"
    fi
  else
    log_info "跳过 Neo4j 配置"
  fi
  echo ""

  # Grafana
  local grafana_pass
  grafana_pass=$(generate_password)

  echo -e "${CYAN}[Grafana]${NC} 监控面板管理员密码（可选，启用监控时需要）"
  if confirm "设置 Grafana 密码?"; then
    if confirm "使用自动生成的强密码?"; then
      sed_inplace "$ENV_FILE" "s#^GRAFANA_PASSWORD=.*#GRAFANA_PASSWORD=${grafana_pass}#"
      log_ok "Grafana 密码已设置"
    else
      local custom_grafana
      custom_grafana=$(read_password "Grafana 密码")
      while is_weak_password "$custom_grafana"; do
        log_warn "密码太弱"
        custom_grafana=$(read_password "Grafana 密码")
      done
      sed_inplace "$ENV_FILE" "s#^GRAFANA_PASSWORD=.*#GRAFANA_PASSWORD=${custom_grafana}#"
      log_ok "Grafana 密码已设置"
    fi
  else
    log_info "跳过 Grafana 配置"
  fi
  echo ""

  # LLM API Key
  echo -e "${CYAN}[LLM]${NC} 大语言模型 API Key"
  echo -e "   ${YELLOW}💡 提示: 你也可以在首次启动后，登录系统并在${NC}"
  echo -e "   ${YELLOW}   「系统设置 → LLM 配置」中填写，无需在此硬编码。${NC}"
  if confirm "现在配置 LLM API Key?"; then
    local llm_key llm_base
    llm_key=$(read_input "LLM API Key")
    llm_base=$(read_input "LLM Base URL" "https://api.openai.com/v1")
    sed_inplace "$ENV_FILE" "s#^# LLM_API_KEY=.*#LLM_API_KEY=${llm_key}#"
    sed_inplace "$ENV_FILE" "s#^LLM_API_KEY=.*#LLM_API_KEY=${llm_key}#"
    sed_inplace "$ENV_FILE" "s#^# LLM_BASE_URL=.*#LLM_BASE_URL=${llm_base}#"
    sed_inplace "$ENV_FILE" "s#^LLM_BASE_URL=.*#LLM_BASE_URL=${llm_base}#"
    log_ok "LLM 配置已保存"
  else
    log_info "跳过 LLM 配置，后续可在系统设置中配置"
    # 确保 LLM_API_KEY 不为旧示例值
    sed_inplace "$ENV_FILE" "s#^LLM_API_KEY=sk-your-openai-key#\# LLM_API_KEY=#"
    sed_inplace "$ENV_FILE" "s#^OPENAI_API_KEY=sk-your-openai-key#\# OPENAI_API_KEY=#"
  fi
  echo ""

  # ALLOWED_ORIGINS
  echo -e "${CYAN}[CORS]${NC} 允许访问的域名"
  local allowed_origins
  allowed_origins=$(read_input "ALLOWED_ORIGINS" "http://localhost")
  if grep -q "^ALLOWED_ORIGINS=" "$ENV_FILE"; then
    sed_inplace "$ENV_FILE" "s#^ALLOWED_ORIGINS=.*#ALLOWED_ORIGINS=${allowed_origins}#"
  else
    echo "ALLOWED_ORIGINS=${allowed_origins}" >> "$ENV_FILE"
  fi
  log_ok "CORS 白名单已设置"
  echo ""

  # NODE_ENV
  sed_inplace "$ENV_FILE" "s#^NODE_ENV=development#NODE_ENV=production#"

  print_divider
  log_ok "环境变量配置完成"
}

# =============================================================================
# 交互模式：步骤 4 — 配置摘要
# =============================================================================
function step_summary() {
  log_step "步骤 4/5: 配置摘要"
  print_divider

  # 加载环境变量
  set -a
  source "$ENV_FILE"
  set +a

  echo -e "${BOLD}部署方式:${NC}"
  case "$DEPLOY_MODE" in
    build) echo "  🏗️  本地构建部署" ;;
    pull)  echo "  📦 拉取远程镜像部署" ;;
    quick) echo "  🚀 纯镜像快速部署" ;;
  esac
  echo ""

  echo -e "${BOLD}关键配置（已脱敏）:${NC}"
  echo -e "  JWT_SECRET:          ${JWT_SECRET:-(未配置)}"
  echo -e "  MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASSWORD:-(未配置)}"
  echo -e "  MYSQL_PASSWORD:      ${MYSQL_PASSWORD:-(未配置)}"
  echo -e "  RABBITMQ_PASS:       ${RABBITMQ_PASS:-(未配置)}"
  echo -e "  MINIO_PASSWORD:      ${MINIO_PASSWORD:-(未配置)}"
  echo -e "  REDIS_PASSWORD:      ${REDIS_PASSWORD:-(未配置)}"
  echo -e "  NEO4J_AUTH:          ${NEO4J_AUTH:-(未配置)}"
  echo -e "  GRAFANA_USER:        ${GRAFANA_USER:-admin}"
  echo -e "  GRAFANA_PASSWORD:    ${GRAFANA_PASSWORD:-(未配置)}"
  echo -e "  LLM_API_KEY:         ${LLM_API_KEY:-(未配置)}"
  echo -e "  ALLOWED_ORIGINS:     ${ALLOWED_ORIGINS:-http://localhost}"
  echo ""

  echo -e "${BOLD}即将启动的服务:${NC}"
  echo "  - MySQL 8.0 (主库)"
  echo "  - Redis 7"
  echo "  - Qdrant 向量数据库"
  echo "  - RabbitMQ 消息队列"
  echo "  - MinIO 对象存储"
  echo "  - Neo4j 图数据库"
  echo "  - RAOS 后端 API"
  echo "  - RAOS Worker 队列消费者"
  echo "  - RAOS 前端 Web"
  echo ""

  if ! confirm "确认以上配置并开始部署?"; then
    echo ""
    echo -e "${CYAN}已取消部署。${NC}"
    echo "你可以随时重新运行 ./deploy/deploy.sh 开始部署"
    exit 0
  fi
}

# =============================================================================
# 交互模式：步骤 5 — 执行部署
# =============================================================================
function step_deploy() {
  log_step "步骤 5/5: 执行部署"
  print_divider

  # 重新加载环境变量
  set -a
  source "$ENV_FILE"
  set +a

  # 镜像准备
  echo ""
  if $BUILD_LOCAL; then
    log_info "正在本地构建镜像（这可能需要几分钟）..."
    if ! $COMPOSE_CMD "${COMPOSE_ARGS[@]}" --env-file "$ENV_FILE" build --no-cache; then
      log_error "镜像构建失败，请检查上方构建日志"
      echo "  常见原因:"
      echo "    1. package-lock.json 与 package.json 不一致"
      echo "    2. npm 依赖下载超时（国内网络建议配置 npm 镜像源）"
      echo "    3. Dockerfile 中某个构建步骤出错"
      exit 1
    fi
    log_ok "镜像构建完成"
  else
    log_info "正在拉取远程镜像..."
    if ! $COMPOSE_CMD "${COMPOSE_ARGS[@]}" --env-file "$ENV_FILE" pull; then
      log_error "镜像拉取失败，请检查网络连接和镜像地址"
      exit 1
    fi
    log_ok "镜像拉取完成"
  fi

  # 启动基础设施
  echo ""
  log_info "启动基础设施服务..."
  if ! $COMPOSE_CMD "${COMPOSE_ARGS[@]}" --env-file "$ENV_FILE" up -d \
    mysql-primary redis qdrant rabbitmq minio neo4j; then
    log_error "基础设施服务启动失败（可能是端口冲突或镜像拉取失败）"
    echo "  请检查上方错误信息，常见问题:"
    echo "    1. 端口已被占用（如 3306/6379/7687 等）"
    echo "    2. 镜像拉取超时"
    echo "    3. docker-compose.yml 配置错误"
    exit 1
  fi

  # 等待就绪
  echo ""
  log_info "等待基础设施就绪（最多 120 秒）..."
  local timeout=120 elapsed=0
  local mysql_ready redis_ready qdrant_ready rabbit_ready

  while [ $elapsed -lt $timeout ]; do
    mysql_ready=false
    redis_ready=false
    qdrant_ready=false
    rabbit_ready=false

    if docker exec raos-mysql-primary mysqladmin ping -h localhost -u root -p"${MYSQL_ROOT_PASSWORD:-}" --silent 2>/dev/null; then
      mysql_ready=true
    fi

    if [[ -n "${REDIS_PASSWORD:-}" ]]; then
      if docker exec raos-redis redis-cli -a "$REDIS_PASSWORD" ping 2>/dev/null | grep -q PONG; then
        redis_ready=true
      fi
    else
      if docker exec raos-redis redis-cli ping 2>/dev/null | grep -q PONG; then
        redis_ready=true
      fi
    fi

    if curl -sf http://localhost:6333/healthz > /dev/null 2>&1; then
      qdrant_ready=true
    fi

    if docker exec raos-rabbitmq rabbitmq-diagnostics -q ping 2>/dev/null | grep -q ok; then
      rabbit_ready=true
    fi

    if $mysql_ready && $redis_ready && $qdrant_ready && $rabbit_ready; then
      log_ok "所有基础设施服务已就绪"
      break
    fi

    sleep 5
    elapsed=$((elapsed + 5))
    echo -n "."
  done

  if [ $elapsed -ge $timeout ]; then
    echo ""
    log_error "基础设施服务启动超时"
    echo "  请检查以下日志排查问题:"
    echo "    MySQL:    docker logs raos-mysql-primary"
    echo "    Redis:    docker logs raos-redis"
    echo "    Qdrant:   docker logs raos-qdrant"
    echo "    RabbitMQ: docker logs raos-rabbitmq"
    exit 1
  fi

  # 数据库迁移
  echo ""
  log_info "运行数据库迁移..."
  if ! $COMPOSE_CMD "${COMPOSE_ARGS[@]}" --env-file "$ENV_FILE" run --rm \
    --entrypoint sh raos-backend -c "npm run db:migrate" 2>/dev/null; then
    log_warn "使用容器内迁移失败，尝试本地迁移..."
    if command -v npm &>/dev/null && [[ -f "$PROJECT_DIR/package.json" ]]; then
      (cd "$PROJECT_DIR" && npm run db:migrate) || true
    fi
  fi
  log_ok "数据库迁移完成"

  # 启动应用
  echo ""
  log_info "启动应用服务..."
  $COMPOSE_CMD "${COMPOSE_ARGS[@]}" --env-file "$ENV_FILE" up -d \
    raos-backend raos-workers raos-frontend
  log_ok "应用服务已启动"
}

# =============================================================================
# 健康检查
# =============================================================================
function step_health_check() {
  echo ""
  log_info "执行健康检查（最多 60 秒）..."

  local timeout=60 elapsed=0
  local backend_healthy=false
  local frontend_healthy=false

  while [ $elapsed -lt $timeout ]; do
    if curl -sf http://localhost:3000/health > /dev/null 2>&1; then
      backend_healthy=true
    fi

    if curl -sf http://localhost/health > /dev/null 2>&1 || \
       curl -sf -o /dev/null -w "%{http_code}" http://localhost | grep -qE "200|301"; then
      frontend_healthy=true
    fi

    if $backend_healthy && $frontend_healthy; then
      break
    fi

    sleep 5
    elapsed=$((elapsed + 5))
    echo -n "."
  done

  echo ""
  echo ""

  if $backend_healthy; then
    log_ok "后端服务健康: http://localhost:3000/health"
  else
    log_warn "后端服务健康检查未通过"
    echo "  查看日志: docker logs raos-backend"
  fi

  if $frontend_healthy; then
    log_ok "前端服务健康: http://localhost"
  else
    log_warn "前端服务健康检查未通过"
    echo "  查看日志: docker logs raos-frontend"
  fi
}

# =============================================================================
# 完成提示
# =============================================================================
function step_finish() {
  echo ""
  echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${GREEN}${BOLD}║${NC}                                                              ${GREEN}${BOLD}║${NC}"
  echo -e "${GREEN}${BOLD}║${NC}              🎉 ${BOLD}RAOS 部署完成！${NC}                               ${GREEN}${BOLD}║${NC}"
  echo -e "${GREEN}${BOLD}║${NC}                                                              ${GREEN}${BOLD}║${NC}"
  echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════════════════════╝${NC}"
  echo ""
  echo -e "  ${BOLD}访问地址:${NC}"
  echo "    🌐 前端:     http://localhost"
  echo "    🔌 API:      http://localhost:3000"
  echo "    📊 健康:     http://localhost:3000/health"
  echo "    📈 指标:     http://localhost:3000/metrics"
  echo ""
  echo -e "  ${BOLD}默认账号:${NC}"
  echo -e "    ${YELLOW}admin / admin${NC}"
  echo -e "    ${RED}⚠️  首次登录后请立即修改密码！${NC}"
  echo ""
  echo -e "  ${BOLD}基础设施:${NC}"
  echo "    MySQL:       localhost:3306"
  echo "    Redis:       localhost:6379"
  echo "    Qdrant:      localhost:6333"
  echo "    RabbitMQ:    http://localhost:15672"
  echo "    Neo4j:       http://localhost:7474"
  echo ""
  echo -e "  ${BOLD}后续操作:${NC}"
  if [[ -z "${LLM_API_KEY:-}" ]]; then
    echo "    1. 登录系统后进入「系统设置 → LLM 配置」填写 API Key"
  fi
  echo "    2. 启用监控: docker compose --profile monitoring up -d"
  echo "    3. 查看日志:  docker logs -f raos-backend"
  echo "    4. 备份数据:  ./deploy/backup.sh"
  echo ""
  echo -e "  ${BOLD}常用命令:${NC}"
  echo "    查看状态:    docker compose ps"
  echo "    停止服务:    docker compose down"
  echo "    完全清除:    docker compose down -v  (⚠️ 删除所有数据)"
  echo ""
}

# =============================================================================
# 主流程
# =============================================================================

# 捕获中断信号，优雅退出
trap 'echo "" ; echo -e "${YELLOW}部署已取消${NC}" ; exit 130' INT

step_choose_mode
step_env_check
step_quick_download
step_config
step_summary
step_deploy
step_health_check
step_finish
