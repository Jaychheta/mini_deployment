# Mini Deploy Platform — Demonstration Guide 🎬

Follow this step-by-step sequence to demonstrate the complete deployment lifecycle, live logs, resource monitoring, one-click redeployment, zero-downtime rollback, and failure handling.

---

## Prerequisites for the Demo

1. **Docker Desktop** is open and running on your system.
2. **PostgreSQL** is active and listening on port 5432 (`mini_deploy` database created).
3. **Backend** is running:
   ```bash
   cd D:\mini-deploy-platform\backend
   npm run dev
   ```
4. **Frontend** is running:
   ```bash
   cd D:\mini-deploy-platform\frontend
   npm run dev
   ```
5. Open browser at `http://localhost:5173`.

---

## 10-Step Demonstration Walkthrough

### Step 1: Log In to the Platform
1. Navigate to `http://localhost:5173/login`.
2. Enter your credentials (e.g., `admin@example.com` or create a new user via `/register`).
3. Click **Sign In**.
4. You will be redirected to the **Projects Dashboard**.

### Step 2: Connect GitHub & Select a Repository
1. Navigate to **New Project** (`/projects/new`).
2. If GitHub OAuth is configured, click **Connect GitHub** to sync your repositories.
3. Alternatively, enter the repository details manually:
   - **Project Name**: `demo-node-app`
   - **Repository URL**: `https://github.com/expressjs/express-starter` (or your sample repo)
   - **Branch**: `main`
   - **Slug**: `demo-node`
4. Click **Create Project**.

### Step 3: Trigger the First Deployment
1. On the Project Overview page, click **Deploy Now**.
2. Notice the button enters a disabled state while the operation is queued.
3. You will be immediately redirected to the **Deployment Details** page (`/deployments/:id`).
4. Observe the deployment status transition:
   `QUEUED` → `CLONING` → `BUILDING` → `STARTING` → `HEALTH_CHECK` → `LIVE`.

### Step 4: View Live Build Logs via WebSockets
1. On the Deployment page, watch the real-time terminal output stream line-by-line via Socket.IO:
   - Git cloning progress
   - Docker build step logs
   - Container port assignment (e.g., port `5001`)
   - HTTP health check execution and 200 OK verification.
2. Observe the completion time and calculated deployment duration badge.

### Step 5: Open the Live URL
1. Once the status shows `LIVE` with a green checkmark, look at the **Live URL** header.
2. Click the link (e.g., `http://demo-node.localhost` or `http://localhost:5001`).
3. Verify that your application responds with HTTP 200 and loads in the browser.

### Step 6: Trigger Automatic Webhook Deployment (or Push Commit)
1. If your repository has the webhook configured pointing to `/api/webhooks/github`, push a new commit to GitHub.
2. Alternatively, click **Trigger Deployment** from the project dashboard.
3. Notice that the deployment history updates automatically with:
   - Trigger badge: `⚡ Push` (for webhook) or `👤 Manual`
   - Commit message and commit hash.
   - Concurrency protection: If you click Deploy again while building, the UI alerts that a build is already in progress.

### Step 7: View Live Resource Metrics & Cost Estimates
1. Click the **Resources** tab or navigate to `/projects/:id/resources`.
2. Observe the Phase 7 live monitoring cards:
   - **CPU Usage**: Real-time percentage updated every 5 seconds.
   - **Memory Usage**: Current MB and container limit.
   - **Network I/O**: Cumulative received and transmitted bytes.
   - **Uptime**: Container duration.
   - **Estimated Cost**: Transparent hourly and monthly cost projections with the standard cloud estimate disclaimer.

### Step 8: Perform One-Click Redeployment
1. Go to the project details page (`/projects/:id`).
2. Click the **🔄 Redeploy Latest** button in the header.
3. Or go to **Deployments** history, find an earlier deployment, and click **Redeploy**.
4. Observe:
   - A new deployment is created with the trigger badge `🔄 Redeploy`.
   - The exact target commit SHA is preserved.
   - Live logs stream for the new build.
   - The previous container continues serving traffic until the new deployment is fully healthy.

### Step 9: Perform Safe Zero-Downtime Rollback
1. Go to the **Deployment History** table.
2. Identify a previously successful deployment that is marked as inactive.
3. Click the **⏪ Rollback** button next to that version.
4. A **Rollback Confirmation Modal** opens:
   - Displays the target deployment ID and commit hash.
   - Displays the zero-downtime safety guarantee notice:
     *"Your current production container will stay online. The target version will be built and health-checked on an isolated port before switching traffic."*
5. Click **Confirm Rollback**.
6. Observe:
   - Trigger source is marked as `⏪ Rollback`.
   - The candidate container starts on an isolated test port.
   - Live traffic is only cut over to the candidate once health checks pass.
   - Inactive historical container is gracefully stopped.

### Step 10: Demonstrate Failure Handling & Safety Guarantee
1. To demonstrate safety, trigger a deployment with an invalid branch or broken build.
2. Watch the pipeline fail:
   - Candidate build fails or health check fails.
   - Status updates to `FAILED` with a detailed error summary banner.
3. Open the **Live URL** of your active application:
   - Notice that your live production application **never went down**.
   - The active container remained running on its port.
   - Nginx routing was **never** switched to the failed candidate.
4. Concurrency lock is automatically released, allowing you to proceed with normal deployments.
