#!/bin/bash

# =============================================================================
# RAOS 统一部署脚本
# 支持: standalone(单机) / cluster(集群) / local(本地)
# 使用方法: sudo ./deploy.sh [mode] [version]
#   mode: standalone|cluster|local
#   version: 镜像版本号 (默认: latest)
# =============================================================================

set -e

# 配置
SWR_REGISTRY="swr.cn-north-4.myhuaweicloud.com"
SWR_ORG="kavin"
MODE=${1:-standalone}
VERSION=${2:-latest}
QDRANT_VERSION="v1.9.0"
PROJECT_NAME="raos"

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

# 登录华为云 SWR
login_swr() {
    log_info "登录华为云 SWR..."
    docker login -u cn-north-4@HPUATFLDVQ30DWEOVMBZ -p c047c1f5ca9490b8fa37d139a10a81f94edd2c148067fd11b912118dbcf9afa3 ${SWR_REGISTRY} 2>/dev/null || {
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
    
    # 启动基础设施
    log_info "启动基础设施 (Docker)..."
    docker-compose -f docker-compose.infra.yml up -d 2>/dev/null || {
        log_warn "基础设施 compose 不存在，使用本地服务"
    }
    
    # 安装依赖
    log_info "安装依赖..."
    npm install
    
    # 启动后端
    log_info "启动后端服务..."
    npm run dev &
    
    # 启动前端
    log_info "启动前端服务..."
    cd web && npm install && npm run dev &
    cd ..
    
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
    cat > docker-compose.deploy.yml << EOF
version: '3.8'

services:
  mysql:
    image: ${SWR_REGISTRY}/${SWR_ORG}/mysql:8.0
    environment:
      MYSQL_ROOT_PASSWORD: rootpassword
      MYSQL_DATABASE: raos
      MYSQL_USER: raos
      MYSQL_PASSWORD: raospassword
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
      RABBITMQ_DEFAULT_PASS: raospassword
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
      - RABBITMQ_URL=amqp://raos:raospassword@rabbitmq:5672
      - JWT_SECRET=change-this-secret
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

# 创建密钥
create_secrets() {
    log_info "创建 Docker Secrets..."
    echo "raospassword" | docker secret create mysql_password - 2>/dev/null || true
    echo "jwtsecret" | docker secret create jwt_secret - 2>/dev/null || true
}

# 检查本地依赖
check_local_deps() {
    log_info "检查本地依赖..."
    command -v node >/dev/null 2>&1 || { log_error "需要 Node.js"; exit 1; }
    command -v npm >/dev/null 2>&1 || { log_error "需要 npm"; exit 1; }
    log_info "依赖检查通过"
}

# 健康检查
check_health() {
    log_info "健康检查..."
    for i in {1..30}; do
        if curl -s http://localhost:3000/health >/dev/null 2>&1; then
            log_info "后端服务就绪"
            return 0
        fi
        sleep 2
    done
    log_warn "健康检查超时，服务可能仍在启动中"
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
main() {
    case "$MODE" in
        standalone)
            deploy_standalone
            ;;
        cluster)
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

main
