#!/usr/bin/env python3
"""
RAOS .env 修复脚本

用途：
  在已有运行容器但 .env 文件缺失关键变量时，自动补齐 .env。
  会从当前运行的 RAOS 容器中读取实际密码（保留数据卷可用），
  缺失的其他变量则生成强随机值。

用法：
  python3 scripts/recover-env.py

注意：
  - 运行前会自动备份当前 .env
  - 若希望重新生成强密码并丢弃旧数据卷，请先 docker compose down -v
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


def get_container_env(container, var):
    """从容器的 Config.Env 读取环境变量值。"""
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


def get_mysql_root_password():
    return get_container_env("raos-mysql-primary", "MYSQL_ROOT_PASSWORD")


def get_mysql_password():
    return get_container_env("raos-mysql-primary", "MYSQL_PASSWORD")


def get_neo4j_password():
    auth = get_container_env("raos-neo4j", "NEO4J_AUTH")
    if auth.startswith("neo4j/"):
        return auth[6:]
    return ""


def main():
    project_dir = Path(__file__).resolve().parent.parent
    env_file = project_dir / ".env"
    example_file = project_dir / ".env.example"

    if not env_file.exists() and example_file.exists():
        env_file.write_text(example_file.read_text())

    if not env_file.exists():
        print("ERROR: 找不到 .env 或 .env.example", file=sys.stderr)
        sys.exit(1)

    # 备份
    backup = project_dir / f".env.bak.{int(time.time())}"
    backup.write_bytes(env_file.read_bytes())
    print(f"[OK] 已备份原 .env 到 {backup.name}")

    existing = {}
    for line in env_file.read_text().splitlines():
        line = line.rstrip("\n")
        if not line or line.strip().startswith("#"):
            continue
        m = re.match(r"^([A-Za-z_][A-Za-z0-9_]*)=(.*)$", line)
        if m:
            existing[m.group(1)] = m.group(2)

    # 如果容器正在运行，读取实际密码以保留数据卷
    mysql_root = existing.get("MYSQL_ROOT_PASSWORD") or get_mysql_root_password() or "rootpassword"
    mysql_pass = existing.get("MYSQL_PASSWORD") or get_mysql_password() or "raospassword"
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

    # 保留 .env 中已设置、但不在 defaults 里的变量（如 LLM_API_KEY）
    final = dict(defaults)
    for k, v in existing.items():
        if k not in final:
            final[k] = v

    lines = [
        "# =============================================================================",
        "# RAOS .env — auto-completed by recover-env.py",
        f"# Backup: {backup.name}",
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
    print("[TIP] 若不想保留旧数据卷密码，请先执行 docker compose down -v 再重新部署")


if __name__ == "__main__":
    main()
