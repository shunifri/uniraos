# RAOS 本地开发环境部署指南

## 概述

由于 Docker Hub 网络限制，本指南提供本地安装各服务的替代方案。

## 1. 安装依赖服务

### 1.1 MySQL 8.0

**macOS:**
```bash
brew install mysql@8.0
brew services start mysql

# 配置 root 密码
mysql_secure_installation

# 创建数据库和用户
mysql -u root -p
```

```sql
CREATE DATABASE raos CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'raos'@'localhost' IDENTIFIED BY 'raospassword';
GRANT ALL PRIVILEGES ON raos.* TO 'raos'@'localhost';
FLUSH PRIVILEGES;
```

### 1.2 Redis

**macOS:**
```bash
brew install redis
brew services start redis

# 验证
redis-cli ping
```

### 1.3 Qdrant

**macOS:**
```bash
# 使用 Homebrew
brew tap qdrant/tap
brew install qdrant

# 启动
qdrant
```

### 1.4 RabbitMQ

**macOS:**
```bash
brew install rabbitmq
brew services start rabbitmq

# 启用管理插件
rabbitmq-plugins enable rabbitmq_management

# 创建用户
rabbitmqctl add_user raos raospassword
rabbitmqctl set_user_tags raos administrator
rabbitmqctl set_permissions -p / raos ".*" ".*" ".*"
```

## 2. 配置环境变量

```bash
cp .env.example .env
```

## 3. 启动应用

```bash
npm run dev
```

## 4. 验证

```bash
curl http://localhost:3000/health
```
