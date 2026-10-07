# Mini Deploy Platform

A lightweight Vercel/Render-style deployment platform — academic project.

## Architecture

```
GitHub Repository
  → GitHub Webhook
  → Node.js/Express Backend
  → Clone Repository
  → Docker Build
  → Docker Container
  → Nginx Reverse Proxy
  → Dynamic Deployment URL
```

## Project Structure

```
mini-deploy-platform/
├── frontend/       # React + Vite dashboard
├── backend/        # Node.js + Express API
├── database/       # SQL schema & migrations
├── docker/         # Docker-related configs
├── nginx/          # Nginx reverse proxy config
├── README.md
└── .gitignore
```

## Phase Roadmap

| Phase | Feature |
|-------|---------|
| 1 | Foundation — project structure, dashboard UI, REST API |
| 2 | GitHub OAuth + repository selection |
| 3 | GitHub Webhooks + Docker build pipeline |
| 4 | Nginx routing + dynamic deployment URLs |
| 5 | Socket.io live build logs |
| 6 | Rollback, redeploy, resource monitoring, cost simulation |

## Quick Start (Phase 1)

### Backend
```bash
cd backend
npm install
npm run dev
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

## Environment Variables

Copy `backend/.env.example` to `backend/.env` and fill in values.

## Health Check

```
GET http://localhost:3001/api/health
```
