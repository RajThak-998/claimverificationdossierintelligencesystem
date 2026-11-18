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
        NGINX -->|HTTP:8080| BACKEND["Go API Container<br/>(Direct Upload & In-Memory Goroutines)"]
        
        BACKEND --> PG[("PostgreSQL 16 (Port 5432)")]
        BACKEND --> MINIO[("MinIO S3 / Local Storage (Port 9000)")]
        
        subgraph OptionalScale ["Optional Multi-Node Scale-Out"]
            BACKEND -.-> REDIS[("Redis 7.2 (Port 6379)")]
            REDIS -.-> WORKER["Go Background Worker Daemon<br/>(Asynq Worker)"]
            WORKER -.-> PG
            WORKER -.-> MINIO
        end
    end
```

> [!CAUTION]
> **Hosting Trap**: If you deploy your staging demo to a raw cloud IP address (e.g., `http://143.110.22.84:3000`) without an SSL certificate, **the browser will block the microphone and screen sharing outright**, making it impossible to demo the live WhatsApp tele-verification feature.

---

## 2. Production Docker Compose Setup (`docker-compose.yml`)

The platform—including PostgreSQL, MinIO S3 object storage, the stateless Go API (with in-memory async execution), the React frontend, and Nginx reverse proxy—launches cleanly with: `docker compose up -d`.

> [!NOTE]
> **Lean Deployment for ~100 Agents**: Because 5-second chunk streaming and active Redis chunk recovery were dropped in favor of direct uploads and in-process Go goroutines for PDF compilation, running a standalone Redis container and separate worker container is completely optional.

```yaml
version: '3.8'

networks:
  motor_net:
    driver: bridge

volumes:
  pg_data:
  minio_data:

services:
  # ============================================================================
  # 1. Database (PostgreSQL 16)
  # ============================================================================
  postgres:
    image: postgres:16-alpine
    container_name: motor_postgres
    restart: always
    ports:
      - "5433:5432"
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
  # 2. Object Storage (MinIO S3 Compatible)
  # ============================================================================
  minio:
    image: quay.io/minio/minio:latest
    profiles:
      - minio
    container_name: motor_minio
    restart: always
    ports:
      - "9000:9000"
      - "9001:9001"
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: ${STORAGE_ACCESS_KEY:-minioadmin}
      MINIO_ROOT_PASSWORD: ${STORAGE_SECRET_KEY:-minioadminpassword123}
    volumes:
      - minio_data:/data
    networks:
      - motor_net

  # ============================================================================
  # 3. Stateless Go Backend REST API (Direct Upload & In-Memory Goroutine Workers)
  # ============================================================================
  api:
    build:
      context: ./backend
      dockerfile: Dockerfile.api
    container_name: motor_api
    restart: always
    ports:
      - "8080:8080"
    environment:
      - PORT=8080
      - DB_DRIVER=postgres
      - DB_DSN=postgres://${DB_USER:-postgres}:${DB_PASSWORD:-SecretPostgresPass123!}@postgres:5432/${DB_NAME:-motor_claims}?sslmode=disable
      - STORAGE_DRIVER=local
      - STORAGE_BASE_DIR=data/storage
      - STORAGE_BASE_URL=http://localhost:8080
      - JWT_SECRET=${JWT_SECRET:-super-secret-jwt-signing-key-32chars}
      - APP_ENV=production
    depends_on:
      postgres:
        condition: service_healthy
    volumes:
      - ./data/storage:/app/data/storage
    networks:
      - motor_net

  # ============================================================================
  # 4. Frontend Dashboard (React / Vite)
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
  # 5. Reverse Proxy & SSL (Nginx)
  # ============================================================================
  nginx:
    image: nginx:alpine
    container_name: motor_nginx
    restart: always
    ports:
      - "80:80"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
    depends_on:
      - frontend
      - api
    networks:
      - motor_net
```

---

## 3. Production Nginx Configuration (`nginx.conf`)

This configuration enforces SSL/TLS 1.3, handles multipart video uploads up to 50MB, provides WebSocket proxying for live recall alarms, and isolates API from frontend assets:

```nginx
events {
    worker_connections 1024;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;
    
    sendfile on;
    keepalive_timeout 65;
    client_max_body_size 50M; # Necessary for direct video uploads and large PDF dossiers

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
