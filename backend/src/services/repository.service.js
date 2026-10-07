/**
 * repository.service.js — Git repository cloning, project type detection, and workspace management.
 *
 * Phase 4:
 *   - Clones GitHub repositories into per-deployment workspaces using spawn()
 *   - Deep recursive project type detection (Dockerfile, Node.js, Python, Static HTML, Go, PHP, generic fallback)
 *   - Auto-generates fallback Dockerfiles for any project structure
 *   - Manages safe workspace cleanup
 */

const fs     = require('fs');
const path   = require('path');
const { spawn } = require('child_process');
const logger = require('../utils/logger.util');

const WORKSPACE_BASE = process.env.DEPLOY_WORKSPACE || path.join(__dirname, '../../../deployments');

if (!fs.existsSync(WORKSPACE_BASE)) {
  fs.mkdirSync(WORKSPACE_BASE, { recursive: true });
}

const getWorkspacePath = (deploymentId) => path.join(WORKSPACE_BASE, deploymentId);

const isValidGithubUrl = (url) => {
  if (!url || typeof url !== 'string') return false;
  return /^https:\/\/github\.com\/[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+/.test(url);
};

const isValidBranch = (branch) => {
  if (!branch || typeof branch !== 'string') return false;
  return /^[a-zA-Z0-9._\-/]+$/.test(branch) && branch.length <= 100;
};

// ─── Git clone ────────────────────────────────────────────────────────────────

const cloneRepository = async ({ deploymentId, repositoryUrl, branch, accessToken, onLog }) => {
  if (!isValidGithubUrl(repositoryUrl)) {
    throw new Error(`Invalid GitHub repository URL: ${repositoryUrl}`);
  }

  if (!isValidBranch(branch)) {
    throw new Error(`Invalid branch name: ${branch}`);
  }

  const workspacePath = getWorkspacePath(deploymentId);

  onLog(`[INFO] Preparing workspace: ${workspacePath}`);
  fs.mkdirSync(workspacePath, { recursive: true });

  let cloneUrl = repositoryUrl;
  if (accessToken) {
    cloneUrl = repositoryUrl.replace('https://', `https://${accessToken}@`);
  }

  onLog(`[INFO] Cloning repository: ${repositoryUrl} (branch: ${branch})`);

  const args = [
    'clone',
    '--depth', '1',
    '--branch', branch,
    cloneUrl,
    '.',
  ];

  await new Promise((resolve, reject) => {
    const proc = spawn('git', args, {
      cwd:   workspacePath,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });

    proc.stdout.on('data', (data) => {
      const lines = data.toString().split('\n').filter((l) => l.trim());
      for (const line of lines) {
        const masked = accessToken ? line.replace(accessToken, '***') : line;
        onLog(`[GIT] ${masked}`);
      }
    });

    proc.stderr.on('data', (data) => {
      const lines = data.toString().split('\n').filter((l) => l.trim());
      for (const line of lines) {
        const masked = accessToken ? line.replace(accessToken, '***') : line;
        onLog(`[GIT] ${masked}`);
      }
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Git clone failed with exit code ${code}`));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn git: ${err.message}. Is git installed?`));
    });
  });

  onLog(`[INFO] Repository cloned successfully.`);
  return workspacePath;
};

// ─── Recursive File Search ───────────────────────────────────────────────────

/**
 * Recursively find any file matching a filename or extension up to 4 subdirectories deep.
 */
const findFileInWorkspace = (workspacePath, targetFilename) => {
  const search = (dir, depth = 0) => {
    if (depth > 4) return null;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === '.git' || entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        const fullPath = path.join(dir, entry.name);

        if (entry.isFile() && entry.name.toLowerCase() === targetFilename.toLowerCase()) {
          return fullPath;
        } else if (entry.isDirectory()) {
          const res = search(fullPath, depth + 1);
          if (res) return res;
        }
      }
    } catch {}
    return null;
  };
  return search(workspacePath);
};

/**
 * Find files ending with a specific extension (e.g. .js, .py, .html)
 */
const findFileByExtension = (workspacePath, ext) => {
  const search = (dir, depth = 0) => {
    if (depth > 4) return null;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === '.git' || entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        const fullPath = path.join(dir, entry.name);

        if (entry.isFile() && entry.name.toLowerCase().endsWith(ext.toLowerCase())) {
          return fullPath;
        } else if (entry.isDirectory()) {
          const res = search(fullPath, depth + 1);
          if (res) return res;
        }
      }
    } catch {}
    return null;
  };
  return search(workspacePath);
};

// ─── Project type detection ───────────────────────────────────────────────────

const detectAndPrepareProject = async (workspacePath, onLog) => {
  try {
    const rootFiles = fs.readdirSync(workspacePath);
    onLog(`[INFO] Cloned files in workspace root: ${rootFiles.join(', ')}`);
  } catch {}

  // 1. Existing Dockerfile anywhere in workspace
  const dockerfilePath = findFileInWorkspace(workspacePath, 'Dockerfile');
  if (dockerfilePath) {
    const relPath = path.relative(workspacePath, dockerfilePath);
    onLog(`[INFO] Dockerfile detected at ${relPath}.`);
    if (relPath !== 'Dockerfile') {
      fs.copyFileSync(dockerfilePath, path.join(workspacePath, 'Dockerfile'));
      onLog(`[INFO] Copied Dockerfile to workspace root.`);
    }
    const containerPort = await detectExposedPort(path.join(workspacePath, 'Dockerfile')) || 3000;
    onLog(`[INFO] Container will listen on port ${containerPort}.`);
    return { type: 'dockerfile', containerPort };
  }

  // 2. Node.js project (package.json)
  const packageJsonPath = findFileInWorkspace(workspacePath, 'package.json');
  if (packageJsonPath) {
    const pkgDir = path.dirname(packageJsonPath);
    const relPkgDir = path.relative(workspacePath, pkgDir);
    onLog(`[INFO] package.json detected at ${path.relative(workspacePath, packageJsonPath)}.`);

    let packageJson = {};
    try {
      const raw = fs.readFileSync(packageJsonPath, 'utf-8');
      packageJson = JSON.parse(raw);
    } catch {
      onLog(`[WARN] Could not parse package.json, proceeding with default Node.js setup.`);
    }

    let startCmd = 'npm start';
    const scripts = packageJson.scripts || {};

    if (scripts.start) {
      startCmd = 'npm start';
    } else if (scripts.dev) {
      startCmd = 'npm run dev';
    } else if (packageJson.main) {
      startCmd = `node ${packageJson.main}`;
    } else if (fs.existsSync(path.join(pkgDir, 'server.js'))) {
      startCmd = 'node server.js';
    } else if (fs.existsSync(path.join(pkgDir, 'index.js'))) {
      startCmd = 'node index.js';
    } else if (fs.existsSync(path.join(pkgDir, 'app.js'))) {
      startCmd = 'node app.js';
    } else {
      startCmd = 'node index.js';
    }

    const workingSubDir = relPkgDir && relPkgDir !== '.' ? relPkgDir : '.';
    await generateNodeDockerfile(workspacePath, workingSubDir, startCmd, onLog);
    const isVite = packageJson.devDependencies?.vite || packageJson.dependencies?.vite || startCmd.includes('dev');
    const containerPort = isVite ? 5173 : 3000;
    return { type: 'nodejs', containerPort };
  }

  // 3. Python project (requirements.txt or .py file)
  const reqPath = findFileInWorkspace(workspacePath, 'requirements.txt');
  const pyFile  = findFileByExtension(workspacePath, '.py');
  if (reqPath || pyFile) {
    onLog(`[INFO] Python project detected.`);
    const entryFile = pyFile ? path.relative(workspacePath, pyFile) : 'app.py';
    await generatePythonDockerfile(workspacePath, entryFile, onLog);
    return { type: 'python', containerPort: 5000 };
  }

  // 4. Any JavaScript / TypeScript file (.js or .ts)
  const jsFile = findFileByExtension(workspacePath, '.js') || findFileByExtension(workspacePath, '.ts');
  if (jsFile) {
    const relJs = path.relative(workspacePath, jsFile);
    onLog(`[INFO] JavaScript file detected (${relJs}).`);
    await generateNodeDockerfile(workspacePath, '.', `node ${relJs}`, onLog);
    return { type: 'nodejs', containerPort: 3000 };
  }

  // 5. Static HTML site (index.html or .html file)
  const htmlFile = findFileByExtension(workspacePath, '.html');
  if (htmlFile) {
    onLog(`[INFO] Static HTML site detected.`);
    await generateStaticDockerfile(workspacePath, onLog);
    return { type: 'static', containerPort: 80 };
  }

  // 6. Generic Fallback: Serve workspace via Nginx static web server
  onLog(`[INFO] Creating static web server fallback for workspace.`);
  await generateStaticDockerfile(workspacePath, onLog);
  return { type: 'static', containerPort: 80 };
};

const detectExposedPort = async (dockerfilePath) => {
  try {
    const content = fs.readFileSync(dockerfilePath, 'utf-8');
    const match = content.match(/^EXPOSE\s+(\d+)/m);
    if (match) return parseInt(match[1], 10);
  } catch {}
  return null;
};

const generateNodeDockerfile = async (workspacePath, workingSubDir, startCmd, onLog) => {
  // Create a .dockerignore to avoid copying stale node_modules or permission locks
  const dockerIgnorePath = path.join(workspacePath, '.dockerignore');
  fs.writeFileSync(dockerIgnorePath, "node_modules\n.git\n.npm\n", 'utf-8');

  const cdInstruction = workingSubDir !== '.' ? `WORKDIR /app/${workingSubDir.replace(/\\/g, '/')}` : 'WORKDIR /app';
  
  // For npm run dev or vite, ensure host 0.0.0.0 is used so it binds externally in Docker
  let finalCmd = startCmd;
  if (finalCmd.includes('dev') || finalCmd.includes('vite')) {
    finalCmd = `${finalCmd} -- --host 0.0.0.0`;
  }
  const cmdParts = finalCmd.split(' ').map(c => `"${c}"`).join(', ');

  const dockerfileContent = `# Auto-generated Dockerfile by Mini Deploy Platform
FROM node:20-alpine

WORKDIR /app
COPY . .
${cdInstruction}

ENV HOST=0.0.0.0
ENV PORT=3000

RUN if [ -f package.json ]; then npm install; fi

EXPOSE 3000
EXPOSE 5173
EXPOSE 8080

CMD [${cmdParts}]
`;

  const dockerfilePath = path.join(workspacePath, 'Dockerfile');
  fs.writeFileSync(dockerfilePath, dockerfileContent, 'utf-8');
  onLog(`[INFO] Generated Dockerfile for Node.js project (Start command: ${finalCmd}).`);
};

const generatePythonDockerfile = async (workspacePath, entryFile, onLog) => {
  const relEntry = entryFile.replace(/\\/g, '/');
  const dockerfileContent = `# Auto-generated Dockerfile for Python by Mini Deploy Platform
FROM python:3.10-slim

WORKDIR /app
COPY . .

RUN if [ -f requirements.txt ]; then pip install --no-cache-dir -r requirements.txt; fi

EXPOSE 5000

CMD ["python", "${relEntry}"]
`;

  const dockerfilePath = path.join(workspacePath, 'Dockerfile');
  fs.writeFileSync(dockerfilePath, dockerfileContent, 'utf-8');
  onLog(`[INFO] Generated Dockerfile for Python project.`);
};

const generateStaticDockerfile = async (workspacePath, onLog) => {
  const dockerfileContent = `# Auto-generated Dockerfile for Static Site by Mini Deploy Platform
FROM nginx:alpine

COPY . /usr/share/nginx/html/

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
`;

  const dockerfilePath = path.join(workspacePath, 'Dockerfile');
  fs.writeFileSync(dockerfilePath, dockerfileContent, 'utf-8');
  onLog(`[INFO] Generated Dockerfile for Static Site.`);
};

const cleanupWorkspace = async (deploymentId) => {
  const workspacePath = getWorkspacePath(deploymentId);
  try {
    if (fs.existsSync(workspacePath)) {
      fs.rmSync(workspacePath, { recursive: true, force: true });
      logger.info(`[REPO] Workspace cleaned up: ${workspacePath}`);
    }
  } catch (err) {
    logger.warn(`[REPO] Could not clean workspace ${workspacePath}: ${err.message}`);
  }
};

module.exports = {
  getWorkspacePath,
  isValidGithubUrl,
  isValidBranch,
  cloneRepository,
  detectAndPrepareProject,
  cleanupWorkspace,
  WORKSPACE_BASE,
};
