# Mini Deploy Platform 🚀

A lightweight, automated deployment platform (similar to Vercel or Render) built from scratch. It handles GitHub OAuth repository connections, automated Git cloning, containerized Docker builds, live WebSocket log streaming, zero-downtime Nginx reverse-proxy routing, real-time Docker resource monitoring & cost estimation, one-click redeployment, and safe rollback with zero downtime.

---

## 📌 Problem Statement & Objectives

Modern cloud platforms like Vercel, Render, and Fly.io abstract away the complexities of build pipelines, isolated container runtimes, dynamic DNS routing, and resource management. 
**Mini Deploy Platform** was engineered to understand and implement these cloud primitives in an educational and production-grade architecture:
- **Automated CI/CD**: Automatic build on GitHub push events or manual triggers.
- **Isolated Containers**: Dynamic Dockerfile detection, image building, and isolated container execution.
- **Zero-Downtime Traffic Routing**: Instant dynamic Nginx configuration reloads only after health check verification.
- **Live Observability**: Real-time terminal log streaming via WebSockets and container-level CPU/memory monitoring.
- **Safety First**: Zero-downtime rollbacks, build concurrency locking, and protected container cleanup.

---

## 🏗️ Architecture Overview

```mermaid
graph TD
    Client["User Browser / React Dashboard"] -->|REST API & JWT| Express["Node.js / Express Backend (Port 3001)"]
    Client -->|Socket.IO| Logs["Live WebSocket Logs"]
    Express -->|SQL Queries & Pooling| PG[("PostgreSQL (mini_deploy)")]
    Express -->|Stats API & Engine| Docker["Docker Desktop Engine (Daemon)"]
    Express -->|Reload Conf| Nginx["Nginx Reverse Proxy (Port 80)"]
    GitHub["GitHub (OAuth & Webhooks)"] -->|HMAC Webhook PUSH| Express

    subgraph "Zero-Downtime Deployment Lifecycle"
        Cloning["1. Clone Git Branch / Commit SHA"] --> Building["2. Docker Build (Auto-Detect / Dockerfile)"]
        Building --> Starting["3. Run Container on Free Port"]
        Starting --> Health["4. HTTP Health Check Verification"]
        Health -->|Pass| Route["5. Update Nginx Upstream & Switch Active"]
        Health -->|Fail| Keep["5b. Retain Previous Live Container & Route"]
    end

    Express --> Cloning
    Route --> Nginx
    Nginx -->|Live Traffic| Container["Active Production Container"]
```

---

## 🚀 Features Implemented (Phases 1–8)

### Phase 1: Core Foundation & UI
- React 18 + Vite frontend with clean, responsive white theme.
- Express REST API with modular controllers, services, and error handling.
- Project and deployment status modeling.

### Phase 2: Authentication & Role-Based Access Control
- JWT-based authentication with bcrypt password hashing.
- Role-based authorization (`USER` vs `ADMIN`).
- User profile management and secure token storage.

### Phase 3: PostgreSQL & GitHub OAuth
- PostgreSQL schema with foreign keys, indexes, and automated initialization.
- GitHub OAuth 2.0 integration for seamless user onboarding.
- GitHub repository picker and branch selector.

### Phase 4: Docker Deployment Engine
- Automatic Dockerfile detection (Node.js, static HTML, standard Dockerfiles).
- Dynamic port allocation and container lifecycle management.
- Deployment statuses: `QUEUED`, `CLONING`, `BUILDING`, `STARTING`, `HEALTH_CHECK`, `LIVE`, `FAILED`, `CANCELLED`.

### Phase 5: GitHub Webhooks & Real-Time Logs
- GitHub push webhook integration with HMAC-SHA256 signature verification.
- Real-time build log streaming via Socket.IO directly to the frontend console.
- Historical log capture stored in database for auditability.

### Phase 6: Dynamic Nginx Routing
- Dynamic Nginx configuration generator mapping project slugs to active container ports.
- Configuration testing (`nginx -t`) before graceful reloads (`nginx -s reload`).
- Fallback reverse proxy mode when Nginx is run locally or externally.

### Phase 7: Container Resource Monitoring & Cost Estimation
- Real-time CPU, Memory (MB), Network I/O, and Uptime polling from Docker daemon.
- 5-second interval time-series persistence in PostgreSQL (`resource_metrics`).
- Cost estimation model ($/hour and $/month) based on active resource footprints.
- Admin multi-container overview and project-level resource graphs.

### Phase 8: One-Click Redeployment, Safe Rollbacks & Production Polish
- **One-Click Redeployment**: Redeploy from project root or any historic deployment with commit SHA preservation.
- **Safe Rollback**: Roll back to any previous `LIVE` version with zero-downtime safety guarantee: candidate container is built and health-checked before any routing switch. If rollback fails, the current production route and container remain online untouched.
- **Concurrency Locks**: In-memory and database locks preventing duplicate builds or race conditions from rapid clicks or concurrent webhooks.
- **Safe Container Cleanup**: Configurable container retention policy strictly protecting active production containers.
- **Deployment History**: Source filtering (`⚡ Push`, `👤 Manual`, `🔄 Redeploy`, `⏪ Rollback`), duration calculation, commit messages, and active production indicators.

---

## 🛠️ Technology Stack

| Layer | Technologies |
|---|---|
| **Frontend** | React 18, Vite, React Router v6, Tailwind CSS, Lucide Icons, Socket.IO Client |
| **Backend** | Node.js, Express, Socket.IO, `pg` (node-postgres), JSONWebToken, Bcrypt.js |
| **Database** | PostgreSQL 15+ |
| **Container Engine** | Docker Desktop Engine (Docker CLI / Dockerode) |
| **Reverse Proxy** | Nginx |
| **VCS Integration** | GitHub REST API, GitHub OAuth 2.0, GitHub Webhooks (HMAC SHA-256) |

---

## 📋 Prerequisites

1. **Node.js**: v18.x or v20.x installed.
2. **PostgreSQL**: Running locally on port `5432` with a database named `mini_deploy`.
3. **Docker Desktop**: Running with Linux containers mode enabled.
4. **Git**: Installed and available in system `PATH`.
5. **Nginx** *(Optional for local dev, fallback proxy included)*: Installed if testing physical port 80 routing.

---

## ⚙️ Environment Variables

### Backend Configuration (`backend/.env`)
Copy `backend/.env.example` to `backend/.env`:

```env
# Server
PORT=3001
NODE_ENV=development

# JWT Secret
JWT_SECRET=super_secret_jwt_key_change_in_production

# PostgreSQL Database
DATABASE_URL=postgres://postgres:password@localhost:5432/mini_deploy
DB_USER=postgres
DB_PASSWORD=password
DB_HOST=localhost
DB_PORT=5432
DB_NAME=mini_deploy

# Docker Engine & Deployment
DOCKER_PORT_RANGE_START=5000
DOCKER_PORT_RANGE_END=5100
DEPLOYMENT_BASE_DOMAIN=localhost
WORKSPACE_DIR=D:/mini-deploy-platform/deployments

# GitHub OAuth & Webhooks
GITHUB_CLIENT_ID=your_github_client_id
GITHUB_CLIENT_SECRET=your_github_client_secret
GITHUB_REDIRECT_URI=http://localhost:3001/api/auth/github/callback
GITHUB_WEBHOOK_SECRET=your_webhook_hmac_secret

# Nginx Configuration
NGINX_ENABLED=false
NGINX_CONF_DIR=D:/mini-deploy-platform/nginx/conf.d

# Phase 7 Cost Model Configuration
COST_CPU_PER_CORE_HOUR=0.0300
COST_MEM_PER_GB_HOUR=0.0040
COST_BASE_CONTAINER_HOUR=0.0050
COST_ESTIMATOR_ENABLED=true
```

### Frontend Configuration (`frontend/.env`)
```env
VITE_API_URL=http://localhost:3001/api
VITE_SOCKET_URL=http://localhost:3001
```

---

## 💻 Local Setup & Installation

### 1. Database Setup
Ensure PostgreSQL is running, then create the database:
```sql
CREATE DATABASE mini_deploy;
```
Tables and Phase 8 columns are automatically created when the backend starts via `backend/src/db/init.js`.

### 2. Backend Installation & Startup
```bash
cd backend
npm install
npm run dev
```
Backend will start on `http://localhost:3001`.

### 3. Frontend Installation & Startup
```bash
cd frontend
npm install
npm run dev
```
Frontend will be accessible at `http://localhost:5173`.

---

## 🧪 Testing Commands

The platform includes comprehensive automated test suites covering resource monitoring, cost estimation, redeployment, rollback, concurrency locking, and security:

```bash
# Run Phase 8 Verification Test Suite (Redeploy, Rollback, Locks, Security)
cd backend
node test_phase8.js

# Run Phase 7 Verification Test Suite (Resource Metrics, Costs, Docker Persistence)
node test_phase7.js

# Verify Frontend Production Build
cd ../frontend
npm run build
```

---

## 🔒 Security & Reliability Hardening

1. **Zero Secret Leakage**: Passwords, GitHub OAuth access tokens, and internal container environments are never returned in public deployment API responses or logged in console logs.
2. **Access Control**: Users can only trigger deployments, view metrics, and initiate rollbacks on projects they own. Administrative endpoints (`/api/admin/*`) require explicit `ADMIN` role.
3. **Webhook Verification**: Every webhook payload from GitHub is verified using HMAC-SHA256 signature checking.
4. **Command Injection Prevention**: Git operations use parameterized inputs and sanitize branch names and commit hashes.
5. **Port Conflict Elimination**: Dynamic port scanner tests TCP port availability before assigning container bindings.
6. **Zero-Downtime Guarantee**: Candidate containers are started on isolated ports and verified via HTTP health checks before active production traffic is updated.

---

## ⚠️ Common Errors & Troubleshooting

- **Docker daemon not responding**:
  *Ensure Docker Desktop is open and running. Test via `docker ps` in terminal.*
- **Port already in use**:
  *If ports 5000–5100 are occupied, adjust `DOCKER_PORT_RANGE_START` and `DOCKER_PORT_RANGE_END` in `backend/.env`.*
- **Database connection refused**:
  *Verify PostgreSQL is running on `localhost:5432` and credentials in `.env` match your local postgres installation.*

---

## 🔮 Limitations & Future Scope

- **Multi-Node Clustering**: Currently operates single-node Docker Engine; can be extended to Kubernetes (K8s) or Docker Swarm for multi-host scaling.
- **Custom Domains & SSL**: Automatic Let's Encrypt SSL certificate provisioning via Certbot for custom user domains.
- **Build Cache Volumes**: Docker build layer caching to accelerate build times across repeated commits.
