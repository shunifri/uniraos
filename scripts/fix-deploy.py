#!/usr/bin/env python3
"""
RAOS 部署一键修复脚本（在目标服务器上运行）

功能：
  1. 修复 deploy/deploy.sh 和 deploy/deploy-non-interactive.sh 中的基础设施等待逻辑
  2. 修复 docker-compose.yml 中 Redis / Qdrant 的健康检查
  3. 补齐 .env 缺失的关键变量（优先从运行中的容器读取真实密码）

用法：
  python3 fix-deploy.py
  docker compose -f docker-compose.yml --env-file .env down
  ./deploy/deploy-non-interactive.sh
"""
import base64
import json
import os
import re
import secrets
import subprocess
import sys
import time
from pathlib import Path


def gen_pass():
    return "".join(
        secrets.choice("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")
        for _ in range(24)
    )


def gen_jwt():
    return base64.b64encode(os.urandom(48)).decode().replace("\n", "")


def run(cmd):
    try:
        return subprocess.check_output(cmd, shell=True, text=True, stderr=subprocess.DEVNULL).strip()
    except subprocess.CalledProcessError:
        return ""


def read_text(path):
    return Path(path).read_text()


def write_text(path, content):
    Path(path).write_text(content)


def backup(path):
    p = Path(path)
    if p.exists():
        bak = p.parent / f"{p.name}.bak.{int(time.time())}"
        bak.write_bytes(p.read_bytes())
        return str(bak)
    return None


def get_container_env(container, var):
    raw = run(f'docker inspect {container} --format="{{{{json .Config.Env}}}}"')
    if not raw:
        return ""
    try:
        envs = json.loads(raw)
    except json.JSONDecodeError:
        return ""
    for item in envs:
        if item.startswith(f"{var}="):
            return item[len(var) + 1:]
    return ""


def fix_deploy_sh():
    path = Path("deploy/deploy.sh")
    if not path.exists():
        print("[WARN] deploy/deploy.sh 不存在，跳过")
        return

    text = path.read_text()

    old = """    if docker exec raos-mysql-primary mysqladmin ping -h localhost -u root -p"${MYSQL_ROOT_PASSWORD:-}" --silent 2>/dev/null; then
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
    fi"""

    new = """    if docker exec raos-mysql-primary mysqladmin ping -h localhost -u root -p"${MYSQL_ROOT_PASSWORD:-}" --silent >/dev/null 2>&1; then
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

    if curl -sf http://localhost:6333/healthz >/dev/null 2>&1; then
      qdrant_ready=true
    fi

    if docker exec raos-rabbitmq rabbitmq-diagnostics -q ping >/dev/null 2>&1; then
      rabbit_ready=true
    fi"""

    if old in text:
        text = text.replace(old, new)
        path.write_text(text)
        print("[OK] deploy/deploy.sh 已修复")
    else:
        print("[INFO] deploy/deploy.sh 不需要修复或已被修改")


def fix_deploy_non_interactive_sh():
    path = Path("deploy/deploy-non-interactive.sh")
    if not path.exists():
        print("[WARN] deploy/deploy-non-interactive.sh 不存在，跳过")
        return

    text = path.read_text()

    old = """  MYSQL_READY=false
  if docker exec raos-mysql-primary mysqladmin ping -h localhost -u root -p"${MYSQL_ROOT_PASSWORD:-}" --silent 2>/dev/null; then
    MYSQL_READY=true
  fi

  REDIS_READY=false
  if docker exec raos-redis redis-cli ping 2>/dev/null | grep -q PONG; then
    REDIS_READY=true
  fi

  QDRANT_READY=false
  if curl -sf http://localhost:6333/healthz > /dev/null 2>&1; then
    QDRANT_READY=true
  fi

  RABBIT_READY=false
  if docker exec raos-rabbitmq rabbitmq-diagnostics -q ping 2>/dev/null | grep -q ok; then
    RABBIT_READY=true
  fi"""

    new = """  MYSQL_READY=false
  if docker exec raos-mysql-primary mysqladmin ping -h localhost -u root -p"${MYSQL_ROOT_PASSWORD:-}" --silent >/dev/null 2>&1; then
    MYSQL_READY=true
  fi

  REDIS_READY=false
  if [[ -n "${REDIS_PASSWORD:-}" ]]; then
    if docker exec raos-redis redis-cli -a "$REDIS_PASSWORD" ping 2>/dev/null | grep -q PONG; then
      REDIS_READY=true
    fi
  else
    if docker exec raos-redis redis-cli ping 2>/dev/null | grep -q PONG; then
      REDIS_READY=true
    fi
  fi

  QDRANT_READY=false
  if curl -sf http://localhost:6333/healthz >/dev/null 2>&1; then
    QDRANT_READY=true
  fi

  RABBIT_READY=false
  if docker exec raos-rabbitmq rabbitmq-diagnostics -q ping >/dev/null 2>&1; then
    RABBIT_READY=true
  fi"""

    if old in text:
        text = text.replace(old, new)
        path.write_text(text)
        print("[OK] deploy/deploy-non-interactive.sh 已修复")
    else:
        print("[INFO] deploy/deploy-non-interactive.sh 不需要修复或已被修改")


def fix_docker_compose():
    path = Path("docker-compose.yml")
    if not path.exists():
        print("[WARN] docker-compose.yml 不存在，跳过")
        return

    text = path.read_text()

    # 修复 Redis：增加 environment 传递 REDIS_PASSWORD
    old_redis = """  redis:
    image: redis:7-alpine
    container_name: raos-redis
    ports:
      - "6379:6379"
    command: >
      redis-server
      --appendonly yes
      --maxmemory 512mb
      --maxmemory-policy allkeys-lru
      --requirepass ${REDIS_PASSWORD:-}"""

    new_redis = """  redis:
    image: redis:7-alpine
    container_name: raos-redis
    ports:
      - "6379:6379"
    environment:
      REDIS_PASSWORD: ${REDIS_PASSWORD:-}
    command: >
      redis-server
      --appendonly yes
      --maxmemory 512mb
      --maxmemory-policy allkeys-lru
      --requirepass ${REDIS_PASSWORD:-}"""

    if old_redis in text:
        text = text.replace(old_redis, new_redis)
        print("[OK] docker-compose.yml Redis environment 已添加")

    # 修复 Redis healthcheck 支持密码
    old_redis_hc = """    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
      retries: 5"""

    new_redis_hc = """    healthcheck:
      test: ["CMD-SHELL", "redis-cli -a \"$$REDIS_PASSWORD\" ping | grep -q PONG"]
      interval: 10s
      timeout: 3s
      retries: 5"""

    if old_redis_hc in text:
        text = text.replace(old_redis_hc, new_redis_hc)
        print("[OK] docker-compose.yml Redis healthcheck 已修复")

    # 修复 Qdrant healthcheck
    old_qdrant_hc = """    healthcheck:
      test: ['CMD-SHELL', 'perl -e "use IO::Socket::INET; my $$s = IO::Socket::INET->new(PeerAddr=>q{localhost}, PeerPort=>6333, Proto=>q{tcp}, Timeout=>5); exit($$s ? 0 : 1);" || exit 1']
      interval: 10s
      timeout: 5s
      retries: 5"""

    new_qdrant_hc = """    healthcheck:
      test:
        - CMD-SHELL
        - >-
          perl -e 'use IO::Socket::INET; my $$s = IO::Socket::INET->new(PeerAddr=>q{localhost}, PeerPort=>6333, Proto=>q{tcp}, Timeout=>5); exit($$s ? 0 : 1);' || exit 1
      interval: 10s
      timeout: 5s
      retries: 5"""

    if old_qdrant_hc in text:
        text = text.replace(old_qdrant_hc, new_qdrant_hc)
        print("[OK] docker-compose.yml Qdrant healthcheck 已修复")

    path.write_text(text)


def recover_env():
    env_file = Path(".env")
    example_file = Path(".env.example")

    if not env_file.exists() and example_file.exists():
        env_file.write_text(example_file.read_text())

    if not env_file.exists():
        print("ERROR: 找不到 .env 或 .env.example", file=sys.stderr)
        sys.exit(1)

    backup_path = env_file.parent / f".env.bak.{int(time.time())}"
    backup_path.write_bytes(env_file.read_bytes())
    print(f"[OK] 已备份原 .env 到 {backup_path.name}")

    existing = {}
    for line in env_file.read_text().splitlines():
        line = line.rstrip("\n")
        if not line or line.strip().startswith("#"):
            continue
        m = re.match(r"^([A-Za-z_][A-Za-z0-9_]*)=(.*)$", line)
        if m:
            existing[m.group(1)] = m.group(2)

    mysql_root = existing.get("MYSQL_ROOT_PASSWORD") or get_container_env("raos-mysql-primary", "MYSQL_ROOT_PASSWORD") or "rootpassword"
    mysql_pass = existing.get("MYSQL_PASSWORD") or get_container_env("raos-mysql-primary", "MYSQL_PASSWORD") or "raospassword"
    neo4j_pass = existing.get("NEO4J_PASSWORD") or get_neo4j_password() or "raospassword"

    defaults = {
        "MYSQL_ROOT_PASSWORD": mysql_root,
        "MYSQL_USER": existing.get("MYSQL_USER") or "raos",
        "MYSQL_PASSWORD": mysql_pass,
        "MYSQL_CONN_LIMIT": existing.get("MYSQL_CONN_LIMIT") or "20",
        "REDIS_PASSWORD": existing.get("REDIS_PASSWORD") or gen_pass(),
        "RABBITMQ_USER": existing.get("RABBITMQ_USER") or "raos",
        "RABBITMQ_PASS": existing.get("RABBITMQ_PASS") or gen_pass(),
        "MINIO_USER": existing.get("MINIO_USER") or "raos",
        "MINIO_PASSWORD": existing.get("MINIO_PASSWORD") or gen_pass(),
        "NEO4J_AUTH": f"neo4j/{neo4j_pass}",
        "NEO4J_USER": existing.get("NEO4J_USER") or "neo4j",
        "NEO4J_PASSWORD": neo4j_pass,
        "NEO4J_PAGE_CACHE": existing.get("NEO4J_PAGE_CACHE") or "512M",
        "NEO4J_HEAP_INIT": existing.get("NEO4J_HEAP_INIT") or "512M",
        "NEO4J_HEAP_MAX": existing.get("NEO4J_HEAP_MAX") or "1G",
        "JWT_SECRET": existing.get("JWT_SECRET") or gen_jwt(),
        "ALLOWED_ORIGINS": existing.get("ALLOWED_ORIGINS") or "http://localhost",
        "NODE_ENV": existing.get("NODE_ENV") or "production",
        "INITIAL_ADMIN_PASSWORD": existing.get("INITIAL_ADMIN_PASSWORD") or gen_pass(),
        "GRAFANA_USER": existing.get("GRAFANA_USER") or "admin",
        "GRAFANA_PASSWORD": existing.get("GRAFANA_PASSWORD") or gen_pass(),
        "IMAGE_TAG": existing.get("IMAGE_TAG") or "latest",
        "GRAPH_STORE_BACKEND": existing.get("GRAPH_STORE_BACKEND") or "mysql",
        "LOG_LEVEL": existing.get("LOG_LEVEL") or "info",
        "UPLOAD_MAX_FILE_SIZE_MB": existing.get("UPLOAD_MAX_FILE_SIZE_MB") or "200",
    }

    final = dict(defaults)
    for k, v in existing.items():
        if k not in final:
            final[k] = v

    lines = [
        "# =============================================================================",
        "# RAOS .env — auto-completed by fix-deploy.py",
        f"# Backup: {backup_path.name}",
        "# =============================================================================",
        "",
        "# ----- MySQL -----",
        f"MYSQL_ROOT_PASSWORD={final['MYSQL_ROOT_PASSWORD']}",
        f"MYSQL_USER={final['MYSQL_USER']}",
        f"MYSQL_PASSWORD={final['MYSQL_PASSWORD']}",
        f"MYSQL_CONN_LIMIT={final['MYSQL_CONN_LIMIT']}",
        "",
        "# ----- Redis -----",
        f"REDIS_PASSWORD={final['REDIS_PASSWORD']}",
        "",
        "# ----- RabbitMQ -----",
        f"RABBITMQ_USER={final['RABBITMQ_USER']}",
        f"RABBITMQ_PASS={final['RABBITMQ_PASS']}",
        "",
        "# ----- MinIO -----",
        f"MINIO_USER={final['MINIO_USER']}",
        f"MINIO_PASSWORD={final['MINIO_PASSWORD']}",
        "",
        "# ----- Neo4j -----",
        f"NEO4J_AUTH={final['NEO4J_AUTH']}",
        f"NEO4J_USER={final['NEO4J_USER']}",
        f"NEO4J_PASSWORD={final['NEO4J_PASSWORD']}",
        f"NEO4J_PAGE_CACHE={final['NEO4J_PAGE_CACHE']}",
        f"NEO4J_HEAP_INIT={final['NEO4J_HEAP_INIT']}",
        f"NEO4J_HEAP_MAX={final['NEO4J_HEAP_MAX']}",
        "",
        "# ----- 应用 -----",
        f"JWT_SECRET={final['JWT_SECRET']}",
        f"ALLOWED_ORIGINS={final['ALLOWED_ORIGINS']}",
        "",
        "# ----- LLM (可选) -----",
        f"LLM_API_KEY={final.get('LLM_API_KEY', '')}",
        f"LLM_BASE_URL={final.get('LLM_BASE_URL', 'https://api.openai.com/v1')}",
        "",
        "# ----- Grafana -----",
        f"GRAFANA_USER={final['GRAFANA_USER']}",
        f"GRAFANA_PASSWORD={final['GRAFANA_PASSWORD']}",
        "",
        "# ----- 部署 -----",
        f"IMAGE_TAG={final['IMAGE_TAG']}",
        f"GRAPH_STORE_BACKEND={final['GRAPH_STORE_BACKEND']}",
        "",
        "# ----- 首次部署 admin 密码 -----",
        f"INITIAL_ADMIN_PASSWORD={final['INITIAL_ADMIN_PASSWORD']}",
        "",
        "# ----- 运行环境 -----",
        f"NODE_ENV={final['NODE_ENV']}",
        "",
        "# ----- 日志级别 -----",
        f"LOG_LEVEL={final['LOG_LEVEL']}",
        "",
        "# ----- 文件上传 -----",
        f"UPLOAD_MAX_FILE_SIZE_MB={final['UPLOAD_MAX_FILE_SIZE_MB']}",
    ]

    env_file.write_text("\n".join(lines) + "\n")
    print(f"[OK] .env 已补齐，共 {len(lines)} 行")


def main():
    fix_deploy_sh()
    fix_deploy_non_interactive_sh()
    fix_docker_compose()
    recover_env()
    print("\n[TIP] 接下来执行：")
    print("  docker compose -f docker-compose.yml --env-file .env down")
    print("  ./deploy/deploy-non-interactive.sh")


if __name__ == "__main__":
    main()
