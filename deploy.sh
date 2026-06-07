#!/bin/bash

# =============================================================================
# RAOS 统一部署脚本
# 支持: standalone(单机) / cluster(集群) / local(本地)
# 使用方法: sudo ./deploy.sh [mode] [version]
#   mode: standalone|cluster|local
#   version: 镜像版本号 (默认: latest)
# =============================================================================

set -euo pipefail

# 配置 — 全部可通过环境变量覆盖, 避免硬编码
SWR_REGISTRY="${SWR_REGISTRY:-swr.cn-north-4.myhuaweicloud.com}"
SWR_ORG="${SWR_ORG:-kavin}"
SWR_USERNAME="${SWR_USERNAME:?必须设置 SWR_USERNAME (华为云 SWR 用户名)}"
SWR_PASSWORD="${SWR_PASSWORD:?必须设置 SWR_PASSWORD (华为云 SWR 密码, 用 read -s 交互输入或从 .env 读)}"
MODE=${1:-standalone}
VERSION=${2:-latest}
QDRANT_VERSION="${QDRANT_VERSION:-v1.9.0}"
PROJECT_NAME="${PROJECT_NAME:-raos}"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 显示帮助
show_help() {
    cat << EOF
RAOS 部署脚本

使用方法:
  sudo ./deploy.sh [模式] [版本号]

模式:
  standalone  - 单机 Docker Compose 部署 (默认)
  cluster     - Docker Swarm 集群部署
  local       - 本地开发环境部署

版本号:
  镜像标签, 默认: latest

示例:
  sudo ./deploy.sh standalone v1.0.0
  sudo ./deploy.sh cluster v1.0.0
  sudo ./deploy.sh local

EOF
}

# 登录华为云 SWR — 凭据必须来自环境变量, 不再硬编码
login_swr() {
    log_info "登录华为云 SWR (${SWR_REGISTRY})..."
    # --password-stdin 避免密码出现在 ps 输出
    printf '%s' "${SWR_PASSWORD}" | docker login -u "${SWR_USERNAME}" --password-stdin "${SWR_REGISTRY}" 2>/dev/null || {
        log_error "登录失败"
        exit 1
    }
    log_info "登录成功"
}

# 单机部署
deploy_standalone() {
    log_info "=========================="
    log_info "开始单机部署 (Docker Compose)"
    log_info "=========================="
    
    # 登录 SWR
    login_swr
    
    # 创建网络
    docker network create ${PROJECT_NAME}-network 2>/dev/null || true
    
    # 生成部署配置
    generate_compose_config
    
    # 拉取镜像
    log_info "拉取镜像..."
    docker-compose -f docker-compose.deploy.yml pull
    
    # 启动服务
    log_info "启动服务..."
    docker-compose -f docker-compose.deploy.yml up -d
    
    # 等待服务就绪
    log_info "等待服务就绪..."
    sleep 10
    
    # 健康检查
    check_health
    
    log_info "=========================="
    log_info "单机部署完成"
    log_info "=========================="
    show_endpoints
}

# 集群部署
deploy_cluster() {
    log_info "=========================="
    log_info "开始集群部署 (Docker Swarm)"
    log_info "=========================="
    
    # 检查 Swarm 模式
    if ! docker info --format '{{.Swarm.LocalNodeState}}' | grep -q "active"; then
        log_warn "Docker 未在 Swarm 模式，正在初始化..."
        docker swarm init 2>/dev/null || {
            log_error "Swarm 初始化失败，请手动执行: docker swarm init"
            exit 1
        }
    fi
    
    # 登录 SWR
    login_swr
    
    # 创建密钥
    create_secrets
    
    # 生成部署配置
    generate_swarm_config
    
    # 部署栈
    log_info "部署服务栈..."
    docker stack deploy -c docker-compose.swarm.yml ${PROJECT_NAME}
    
    # 等待服务就绪
    log_info "等待服务就绪..."
    sleep 15
    
    # 检查服务状态
    docker stack ps ${PROJECT_NAME}
    docker service ls | grep ${PROJECT_NAME}
    
    log_info "=========================="
    log_info "集群部署完成"
    log_info "=========================="
    show_endpoints
}

# 本地开发部署
deploy_local() {
    log_info "=========================="
    log_info "开始本地开发部署"
    log_info "=========================="

    # 检查本地依赖
    check_local_deps

    # 启动基础设施 (用 docker-compose.dev.yml — 替代原本不存在的 docker-compose.infra.yml)
    log_info "启动基础设施 (Docker)..."
    if [[ -f "docker-compose.dev.yml" ]]; then
        docker-compose -f docker-compose.dev.yml up -d
    else
        log_warn "docker-compose.dev.yml 不存在, 跳过基础设施, 使用本地服务"
    fi

    # 安装依赖
    log_info "安装依赖..."
    npm install

    # 启动后端
    log_info "启动后端服务..."
    npm run dev &

    # 启动前端
    log_info "启动前端服务..."
    (cd web && npm install && npm run dev) &

    log_info "=========================="
    log_info "本地开发环境已启动"
    log_info "=========================="
    echo ""
    echo "服务地址:"
    echo "  后端 API: http://localhost:3000"
    echo "  前端 Web: http://localhost:5173"
    echo ""
}

# 生成分部署配置
generate_compose_config() {
    # 所有密码/secret 必须从环境变量读, 没有默认值 (避免生产误用默认值)
    local mysql_root_pw="${MYSQL_ROOT_PASSWORD:?必须设置 MYSQL_ROOT_PASSWORD}"
    local mysql_user_pw="${MYSQL_PASSWORD:?必须设置 MYSQL_PASSWORD}"
    local rabbitmq_pw="${RABBITMQ_PASSWORD:?必须设置 RABBITMQ_PASSWORD}"
    local jwt_secret="${JWT_SECRET:?必须设置 JWT_SECRET (建议 32+ 随机字符)}"

    # 拒绝不安全的默认 secret
    if [[ "${jwt_secret}" == "change-this-secret" || "${jwt_secret}" == "__REPLACE_IN_PRODUCTION__" || ${#jwt_secret} -lt 16 ]]; then
        log_error "JWT_SECRET 不安全: 不能用占位符 / 必须 >= 16 字符"
        exit 1
    fi

    cat > docker-compose.deploy.yml << EOF
version: '3.8'

services:
  mysql:
    image: ${SWR_REGISTRY}/${SWR_ORG}/mysql:8.0
    environment:
      MYSQL_ROOT_PASSWORD: ${mysql_root_pw}
      MYSQL_DATABASE: raos
      MYSQL_USER: raos
      MYSQL_PASSWORD: ${mysql_user_pw}
    volumes:
      - mysql_data:/var/lib/mysql
    ports:
      - "3306:3306"
    networks:
      - raos-network

  redis:
    image: ${SWR_REGISTRY}/${SWR_ORG}/redis:7-alpine
    ports:
      - "6379:6379"
    networks:
      - raos-network

  rabbitmq:
    image: ${SWR_REGISTRY}/${SWR_ORG}/rabbitmq:3.12-management-alpine
    environment:
      RABBITMQ_DEFAULT_USER: raos
      RABBITMQ_DEFAULT_PASS: ${rabbitmq_pw}
    ports:
      - "5672:5672"
      - "15672:15672"
    networks:
      - raos-network

  qdrant:
    image: ${SWR_REGISTRY}/${SWR_ORG}/qdrant:${QDRANT_VERSION}
    ports:
      - "6333:6333"
    volumes:
      - qdrant_data:/qdrant/storage
    networks:
      - raos-network

  backend:
    image: ${SWR_REGISTRY}/${SWR_ORG}/raos-backend:${VERSION}
    environment:
      - NODE_ENV=production
      - MYSQL_PRIMARY_HOST=mysql
      - REDIS_HOSTS=redis:6379
      - QDRANT_HOST=qdrant
      - RABBITMQ_URL=amqp://raos:${rabbitmq_pw}@rabbitmq:5672
      - JWT_SECRET=${jwt_secret}
    ports:
      - "3000:3000"
    depends_on:
      - mysql
      - redis
      - qdrant
    networks:
      - raos-network

  frontend:
    image: ${SWR_REGISTRY}/${SWR_ORG}/raos-frontend:${VERSION}
    ports:
      - "80:80"
    depends_on:
      - backend
    networks:
      - raos-network

volumes:
  mysql_data:
  qdrant_data:

networks:
  raos-network:
    driver: bridge
EOF
    log_info "生成部署配置: docker-compose.deploy.yml"
}

# 生成 Swarm 配置
generate_swarm_config() {
    # 使用现有的 swarm 配置，替换镜像地址
    sed -e "s|mysql:8.0|${SWR_REGISTRY}/ddm/mysql:8.0|g" \
        -e "s|redis:7-alpine|${SWR_REGISTRY}/cce/redis:7-alpine|g" \
        -e "s|rabbitmq:.*-management-alpine|${SWR_REGISTRY}/cce/rabbitmq:3.12-management-alpine|g" \
        -e "s|qdrant/qdrant:.*|${SWR_REGISTRY}/${SWR_ORG}/qdrant:${QDRANT_VERSION}|g" \
        -e "s|raos-backend:.*|raos-backend:${VERSION}|g" \
        -e "s|raos-frontend:.*|raos-frontend:${VERSION}|g" \
        docker-compose.swarm.yml > docker-compose.swarm.deploy.yml
    log_info "生成集群配置: docker-compose.swarm.deploy.yml"
}

# 创建 Docker Secrets — swarm 模式专用, 凭据必须从 env 读
create_secrets() {
    log_info "创建 Docker Secrets..."
    local mysql_pw="${MYSQL_PASSWORD:?swarm 模式必须设置 MYSQL_PASSWORD}"
    local jwt_sec="${JWT_SECRET:?swarm 模式必须设置 JWT_SECRET}"
    printf '%s' "${mysql_pw}" | docker secret create mysql_password - 2>/dev/null || true
    printf '%s' "${jwt_sec}" | docker secret create jwt_secret - 2>/dev/null || true
}

# 检查本地依赖
check_local_deps() {
    log_info "检查本地依赖..."
    command -v node >/dev/null 2>&1 || { log_error "需要 Node.js"; exit 1; }
    command -v npm >/dev/null 2>&1 || { log_error "需要 npm"; exit 1; }
    log_info "依赖检查通过"
}

# 健康检查 — 超时算失败 (非 0 exit), 避免误报"成功"
check_health() {
    local max_attempts="${HEALTH_CHECK_MAX_ATTEMPTS:-30}"
    local sleep_seconds="${HEALTH_CHECK_INTERVAL:-2}"
    log_info "健康检查 (最多 ${max_attempts} 次, 间隔 ${sleep_seconds}s)..."
    local i
    for ((i = 1; i <= max_attempts; i++)); do
        if curl -fsS http://localhost:3000/health >/dev/null 2>&1; then
            log_info "后端服务就绪"
            return 0
        fi
        sleep "${sleep_seconds}"
    done
    log_error "健康检查超时 (${max_attempts} 次 × ${sleep_seconds}s) — 服务未就绪, 请查 docker logs"
    return 1
}

# 显示访问地址
show_endpoints() {
    echo ""
    echo "访问地址:"
    echo "  Web 应用: http://localhost"
    echo "  API 文档: http://localhost/api"
    echo "  RabbitMQ 管理: http://localhost:15672 (raos/raospassword)"
    echo ""
}

# 主函数
GENERATED_COMPOSE=""
main() {
    case "$MODE" in
        standalone)
            GENERATED_COMPOSE="docker-compose.deploy.yml"
            deploy_standalone
            ;;
        cluster)
            GENERATED_COMPOSE="docker-compose.swarm.deploy.yml"
            deploy_cluster
            ;;
        local)
            deploy_local
            ;;
        help|--help|-h)
            show_help
            ;;
        *)
            log_error "未知模式: $MODE"
            show_help
            exit 1
            ;;
    esac
}

# 清理临时生成的 compose 配置文件 (避免泄漏 secrets 到 git)
cleanup() {
    local exit_code=$?
    if [[ -n "${GENERATED_COMPOSE}" && -f "${GENERATED_COMPOSE}" ]]; then
        log_info "清理临时文件: ${GENERATED_COMPOSE}"
        rm -f "${GENERATED_COMPOSE}" 2>/dev/null || true
    fi
    exit "${exit_code}"
}
trap cleanup EXIT

main
