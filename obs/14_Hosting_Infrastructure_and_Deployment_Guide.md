---
title: 14. Hosting Infrastructure and Deployment Guide
tags:
  - hosting
  - deployment
  - docker
  - nginx
  - ssl
  - devops
  - minio
  - postgresql
date: 2026-10-19
status: active
---

# 🚀 14. Hosting Infrastructure and Deployment Guide

## 1. Hosting Architecture & SSL Mandate

Modern browsers (Chrome, Edge, Firefox, Safari) strictly enforce that **screen recording (`getDisplayMedia`) and microphone capture (`getUserMedia`) work only over HTTPS** (with an exception granted only to `http://localhost`).

```mermaid
flowchart TD
    INTERNET(("🌐 Internet (Agent / Client)")) -->|HTTPS:443 (SSL/TLS 1.3)| NGINX["Nginx Reverse Proxy & SSL Termination<br/>(Let's Encrypt / Certbot)"]
    
    subgraph InternalNetwork ["Docker Internal Network (bridge: motor_net)"]
        NGINX -->|HTTP:3000| FRONTEND["Frontend Container (React / Vite / Nginx)"]
        NGINX -->|HTTP:8080| BACKEND["Go API Container (Stateless REST)"]
        
        BACKEND --> PG[("PostgreSQL 16 (Port 5432)")]
        BACKEND --> REDIS[("Redis 7.2 (Port 6379)")]
        BACKEND --> MINIO[("MinIO S3 Object Storage (Port 9000)")]
        
        REDIS --> WORKER["Go Background Worker Daemon<br/>(FFmpeg + Headless PDF Engine)"]
        WORKER --> PG
        WORKER --> MINIO
    end
```

> [!CAUTION]
> **Hosting Trap**: If you deploy your staging demo to a raw cloud IP address (e.g., `http://143.110.22.84:3000`) without an SSL certificate, **the browser will block the microphone and screen sharing outright**, making it impossible to demo the live WhatsApp tele-verification feature.

---

## 2. Production Docker Compose Setup (`docker-compose.yml`)

The entire platform—including the database, Redis queue, MinIO S3 object storage, Go API, worker, frontend, and Nginx proxy—can be launched with a single command: `docker compose up -d`.

```yaml
version: '3.8'

networks:
  motor_net:
    driver: bridge

volumes:
  pg_data:
  redis_data:
  minio_data:
  certbot_etc:
  certbot_var:

services:
  # ============================================================================
  # 1. Database (PostgreSQL 16)
  # ============================================================================
  postgres:
    image: postgres:16-alpine
    container_name: motor_postgres
    restart: always
    environment:
      POSTGRES_DB: ${DB_NAME:-motor_claims}
      POSTGRES_USER: ${DB_USER:-postgres}
      POSTGRES_PASSWORD: ${DB_PASSWORD:-SecretPostgresPass123!}
    volumes:
      - pg_data:/var/lib/postgresql/data
    networks:
      - motor_net
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 5s
      retries: 5

  # ============================================================================
  # 2. Redis Message Broker & Queue
  # ============================================================================
  redis:
    image: redis:7-alpine
    container_name: motor_redis
    restart: always
    command: redis-server --appendonly yes --requirepass ${REDIS_PASSWORD:-SecretRedisPass123!}
    volumes:
      - redis_data:/data
    networks:
      - motor_net
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "${REDIS_PASSWORD:-SecretRedisPass123!}", "ping"]
      interval: 5s
      timeout: 5s
      retries: 5

  # ============================================================================
  # 3. Object Storage (MinIO S3 Compatible)
  # ============================================================================
  minio:
    image: minio/minio:RELEASE.2024-05-10T01-41-38Z
    container_name: motor_minio
    restart: always
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: ${STORAGE_ACCESS_KEY:-minioadmin}
      MINIO_ROOT_PASSWORD: ${STORAGE_SECRET_KEY:-minioadminpassword123}
    volumes:
      - minio_data:/data
    networks:
      - motor_net

  # ============================================================================
  # 4. Stateless Go Backend REST API
  # ============================================================================
  api:
    build:
      context: ./backend
      dockerfile: Dockerfile.api
    container_name: motor_api
    restart: always
    environment:
      - PORT=8080
      - DB_DSN=postgres://${DB_USER:-postgres}:${DB_PASSWORD:-SecretPostgresPass123!}@postgres:5432/${DB_NAME:-motor_claims}?sslmode=disable
      - REDIS_ADDR=redis:6379
      - REDIS_PASSWORD=${REDIS_PASSWORD:-SecretRedisPass123!}
      - STORAGE_DRIVER=${STORAGE_DRIVER:-minio}
      - STORAGE_ENDPOINT=minio:9000
      - STORAGE_BUCKET=${STORAGE_BUCKET:-motor-claims-vault}
      - STORAGE_ACCESS_KEY=${STORAGE_ACCESS_KEY:-minioadmin}
      - STORAGE_SECRET_KEY=${STORAGE_SECRET_KEY:-minioadminpassword123}
      - STORAGE_USE_SSL=false
      - JWT_SECRET=${JWT_SECRET:-super-secret-jwt-signing-key-32chars}
      - APP_ENV=production
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    networks:
      - motor_net

  # ============================================================================
  # 5. Go Background Worker (FFmpeg & PDF Compiler)
  # ============================================================================
  worker:
    build:
      context: ./backend
      dockerfile: Dockerfile.worker
    container_name: motor_worker
    restart: always
    environment:
      - DB_DSN=postgres://${DB_USER:-postgres}:${DB_PASSWORD:-SecretPostgresPass123!}@postgres:5432/${DB_NAME:-motor_claims}?sslmode=disable
      - REDIS_ADDR=redis:6379
      - REDIS_PASSWORD=${REDIS_PASSWORD:-SecretRedisPass123!}
      - STORAGE_DRIVER=${STORAGE_DRIVER:-minio}
      - STORAGE_ENDPOINT=minio:9000
      - STORAGE_BUCKET=${STORAGE_BUCKET:-motor-claims-vault}
      - STORAGE_ACCESS_KEY=${STORAGE_ACCESS_KEY:-minioadmin}
      - STORAGE_SECRET_KEY=${STORAGE_SECRET_KEY:-minioadminpassword123}
      - STORAGE_USE_SSL=false
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    networks:
      - motor_net

  # ============================================================================
  # 6. Frontend Dashboard (React / Vite)
  # ============================================================================
  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
    container_name: motor_frontend
    restart: always
    networks:
      - motor_net

  # ============================================================================
  # 7. Reverse Proxy & SSL (Nginx + Certbot)
  # ============================================================================
  nginx:
    image: nginx:alpine
    container_name: motor_nginx
    restart: always
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - certbot_etc:/etc/letsencrypt:ro
      - certbot_var:/var/www/certbot:ro
    depends_on:
      - frontend
      - api
    networks:
      - motor_net
```

---

## 3. Production Nginx Configuration (`nginx.conf`)

This configuration enforces SSL/TLS 1.3, handles chunked multipart streaming uploads up to 50MB, provides WebSocket proxying for live recall alarms, and isolates API from frontend assets:

```nginx
events {
    worker_connections 1024;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;
    
    sendfile on;
    keepalive_timeout 65;
    client_max_body_size 50M; # Necessary for 5s video chunks and large PDF uploads

    # Redirect all HTTP traffic to HTTPS
    server {
        listen 80;
        server_name demo.yourdomain.com;

        location /.well-known/acme-challenge/ {
            root /var/www/certbot;
        }

        location / {
            return 301 https://$host$request_uri;
        }
    }

    # HTTPS Production Server
    server {
        listen 443 ssl http2;
        server_name demo.yourdomain.com;

        ssl_certificate /etc/letsencrypt/live/demo.yourdomain.com/fullchain.pem;
        ssl_certificate_key /etc/letsencrypt/live/demo.yourdomain.com/privkey.pem;

        ssl_protocols TLSv1.2 TLSv1.3;
        ssl_ciphers HIGH:!aNULL:!MD5;

        # Frontend SPA Static Assets
        location / {
            proxy_pass http://frontend:3000;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto https;
        }

        # Stateless Go API
        location /api/ {
            proxy_pass http://api:8080;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto https;
            
            # WebSocket Support for Live Recalls and Alerts
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
            proxy_read_timeout 86400s;
        }
    }
}
```

---

## 4. Environment Variables Specification (`.env.example`)

Developers and DevOps engineers can copy this file directly to `.env`:

```env
# ==============================================================================
# Motor Claim Verification Platform - Environment Configuration
# ==============================================================================

# Server & Network Configuration
APP_ENV=production
PORT=8080
DOMAIN_NAME=demo.yourdomain.com
CORS_ALLOWED_ORIGINS=https://demo.yourdomain.com

# PostgreSQL Database Configuration
DB_HOST=postgres
DB_PORT=5432
DB_NAME=motor_claims
DB_USER=postgres
DB_PASSWORD=SuperStrongDBPassword2026!
DB_DSN=postgres://postgres:SuperStrongDBPassword2026!@postgres:5432/motor_claims?sslmode=disable

# Redis & Asynq Worker Configuration
REDIS_ADDR=redis:6379
REDIS_PASSWORD=SuperStrongRedisPassword2026!

# Storage Abstraction Configuration (minio | s3 | r2)
STORAGE_DRIVER=minio
STORAGE_ENDPOINT=minio:9000
STORAGE_BUCKET=motor-claims-vault
STORAGE_ACCESS_KEY=minioadmin
STORAGE_SECRET_KEY=minioadminpassword123
STORAGE_USE_SSL=false
# For AWS S3:
# STORAGE_DRIVER=s3
# STORAGE_REGION=ap-south-1
# STORAGE_BUCKET=prod-motor-claims-vault
# STORAGE_ACCESS_KEY=AKIAIOSFODNN7EXAMPLE
# STORAGE_SECRET_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY

# Security & Authentication
JWT_SECRET=e4d909c290d0fb1ca068ffaddf22cbd0aef9d8d64f0b2fbe0b396e987c2f8216
JWT_EXPIRATION_HOURS=24

# Commercial & Invoice Defaults
BASE_CASE_FEE_INR=750.00
DEFAULT_PER_MINUTE_RATE_INR=45.00
```

---

## 5. SSL Certificate Setup for Staging Demo (Let's Encrypt / Free DNS)

To quickly provide client stakeholders with a live, HTTPS-enabled staging demo without paying for a commercial certificate:

1. **Option A: Custom Domain**:
   * Point an A-record (e.g., `demo.youragency.com`) to your VPS public IP.
   * Run Certbot via Docker:
     ```bash
     docker run -it --rm --name certbot \
       -v "/etc/letsencrypt:/etc/letsencrypt" \
       -v "/var/www/certbot:/var/www/certbot" \
       certbot/certbot certonly --webroot \
       -w /var/www/certbot -d demo.youragency.com
     ```
2. **Option B: Cloudflare Tunnel (Zero Port Forwarding)**:
   * Install `cloudflared` on the VPS.
   * Run: `cloudflared tunnel --url http://localhost:80`
   * Cloudflare automatically provides an authenticated, SSL-certified public URL (`https://xyz.trycloudflare.com`). **The browser media APIs will function smoothly without certificate errors!**

---

## 6. Next Steps & Connected Knowledge

* To see how hosting aligns with each sprint of development, continue to [[15_Complete_Development_Lifecycle_and_Roadmap]].
* For the architectural principles governing this deployment, see [[11_The_6_Architectural_Pillars_and_Trap_Mitigations]].
* For failure recovery on host reboot, see [[13_Edge_Cases_and_Failure_Recovery]].
