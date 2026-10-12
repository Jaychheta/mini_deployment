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

const cloneRepository = async ({ deploymentId, repositoryUrl, branch, accessToken, onLog, targetCommitSha = null }) => {
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

  // If targeting an exact commit, clone without single-depth so commit is reachable
  const args = targetCommitSha
    ? ['clone', cloneUrl, '.']
    : ['clone', '--depth', '1', '--branch', branch, cloneUrl, '.'];

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

  if (targetCommitSha) {
    onLog(`[INFO] Checking out target commit ${targetCommitSha.slice(0, 7)}...`);
    await new Promise((resolve, reject) => {
      const checkoutProc = spawn('git', ['checkout', targetCommitSha], {
        cwd:   workspacePath,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
      });

      checkoutProc.stderr.on('data', (d) => {
        const line = d.toString().trim();
        if (line) onLog(`[GIT] ${line}`);
      });

      checkoutProc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Failed to checkout target commit ${targetCommitSha}`));
      });
      checkoutProc.on('error', reject);
    });
  }

  onLog(`[INFO] Repository cloned successfully.`);
  return workspacePath;
};

const getWorkspaceCommitInfo = async (workspacePath) => {
  return new Promise((resolve) => {
    const proc = spawn('git', ['log', '-1', '--pretty=%H%x00%s'], {
      cwd: workspacePath,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });
    let out = '';
    proc.stdout.on('data', (d) => { out += d.toString(); });
    proc.on('close', (code) => {
      if (code === 0 && out.trim()) {
        const [sha, message] = out.trim().split('\0');
        resolve({ sha: sha || null, message: message || null });
      } else {
        resolve({ sha: null, message: null });
      }
    });
    proc.on('error', () => resolve({ sha: null, message: null }));
  });
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

/**
 * Detect port for a Node.js project by inspecting config files, package scripts, and .env files.
 *
 * @param {string} workspacePath - Root of the workspace
 * @param {string} pkgDir - Directory containing package.json
 * @param {Object} packageJson - Parsed package.json
 * @param {string} startCmd - Start command selected for running the app
 * @returns {{ port: number, isVite: boolean, source: string }}
 */
const detectNodeProjectPort = (workspacePath, pkgDir, packageJson, startCmd) => {
  const scripts = packageJson.scripts || {};
  const isVite = !!(
    packageJson.devDependencies?.vite ||
    packageJson.dependencies?.vite ||
    Object.values(scripts).some((s) => typeof s === 'string' && s.includes('vite'))
  );
  const isNext = !!(
    packageJson.dependencies?.next ||
    packageJson.devDependencies?.next
  );
  const isAstro = !!(
    packageJson.dependencies?.astro ||
    packageJson.devDependencies?.astro
  );
  const isNuxt = !!(
    packageJson.dependencies?.nuxt ||
    packageJson.devDependencies?.nuxt
  );

  // 1. Inspect Vite configuration files
  const viteConfigFiles = [
    'vite.config.js', 'vite.config.ts', 'vite.config.mjs', 'vite.config.cjs',
    'vitest.config.js', 'vitest.config.ts'
  ];
  for (const cfg of viteConfigFiles) {
    const candidates = [path.join(pkgDir, cfg), path.join(workspacePath, cfg)];
    for (const targetPath of candidates) {
      if (fs.existsSync(targetPath)) {
        try {
          const content = fs.readFileSync(targetPath, 'utf-8');
          // Match server: { ... port: 3000 ... } or port: 3000
          const serverPortMatch = content.match(/server\s*:\s*\{[^}]*?port\s*:\s*(\d+)/s);
          if (serverPortMatch) {
            return { port: parseInt(serverPortMatch[1], 10), isVite, source: `${cfg} (server.port)` };
          }
          const portMatch = content.match(/port\s*:\s*(\d+)/);
          if (portMatch) {
            return { port: parseInt(portMatch[1], 10), isVite, source: `${cfg} (port)` };
          }
        } catch {}
      }
    }
  }

  // 2. Check scripts for explicit port flags (--port 3000, -p 3000, PORT=3000)
  const scriptCommands = [startCmd, scripts.start, scripts.dev].filter(Boolean);
  for (const cmd of scriptCommands) {
    const portFlagMatch = cmd.match(/(?:--port|-p)\s+([0-9]+)/) || cmd.match(/PORT=([0-9]+)/);
    if (portFlagMatch) {
      return { port: parseInt(portFlagMatch[1], 10), isVite, source: 'package.json script flag' };
    }
  }

  // 3. Check .env files in pkgDir and workspace root
  const envFiles = ['.env', '.env.local', '.env.production', '.env.development'];
  for (const envFile of envFiles) {
    for (const dir of [pkgDir, workspacePath]) {
      const p = path.join(dir, envFile);
      if (fs.existsSync(p)) {
        try {
          const content = fs.readFileSync(p, 'utf-8');
          const m = content.match(/^\s*PORT\s*=\s*(\d+)/m);
          if (m) {
            return { port: parseInt(m[1], 10), isVite, source: `${envFile} (PORT)` };
          }
        } catch {}
      }
    }
  }

  // 4. Framework defaults
  if (isVite) {
    return { port: 5173, isVite: true, source: 'Vite default' };
  }
  if (isNext) {
    return { port: 3000, isVite: false, source: 'Next.js default' };
  }
  if (isAstro) {
    return { port: 4321, isVite: false, source: 'Astro default' };
  }
  if (isNuxt) {
    return { port: 3000, isVite: false, source: 'Nuxt default' };
  }

  // 5. Generic Node.js / Express default
  return { port: 3000, isVite: false, source: 'Node.js standard default' };
};

/**
 * Automatically configure Vite projects to allow external domains (Vite 6 host blocking protection)
 */
const patchViteConfigForAllowedHosts = (workspacePath, onLog = () => {}) => {
  const viteConfigFiles = [
    'vite.config.js', 'vite.config.ts', 'vite.config.mjs', 'vite.config.cjs',
  ];
  for (const cfg of viteConfigFiles) {
    const fullPath = findFileInWorkspace(workspacePath, cfg);
    if (fullPath && fs.existsSync(fullPath)) {
      try {
        let content = fs.readFileSync(fullPath, 'utf-8');
        if (!content.includes('allowedHosts')) {
          if (/server\s*:\s*\{/i.test(content)) {
            content = content.replace(/(server\s*:\s*\{)/i, `$1\n    allowedHosts: true,`);
          } else if (/defineConfig\s*\(\s*\{/i.test(content)) {
            content = content.replace(/(defineConfig\s*\(\s*\{)/i, `$1\n  server: { allowedHosts: true, host: '0.0.0.0' },`);
          }
          fs.writeFileSync(fullPath, content, 'utf-8');
          onLog(`[INFO] Configured ${cfg} with allowedHosts: true for external proxy domain access.`);
          return true;
        }
      } catch (err) {
        onLog(`[WARN] Could not patch ${cfg}: ${err.message}`);
      }
    }
  }
  return false;
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
    const portInfo = detectNodeProjectPort(workspacePath, pkgDir, packageJson, startCmd);
    const containerPort = portInfo.port;
    onLog(`[INFO] Detected container port: ${containerPort} (source: ${portInfo.source}).`);

    if (portInfo.isVite) {
      patchViteConfigForAllowedHosts(workspacePath, onLog);
    }

    await generateNodeDockerfile(workspacePath, workingSubDir, startCmd, containerPort, portInfo.isVite, onLog);
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
    await generateNodeDockerfile(workspacePath, '.', `node ${relJs}`, 3000, false, onLog);
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

const generateNodeDockerfile = async (workspacePath, workingSubDir, startCmd, containerPort = 3000, isVite = false, onLog = () => {}) => {
  // Create a .dockerignore to avoid copying stale node_modules or permission locks
  const dockerIgnorePath = path.join(workspacePath, '.dockerignore');
  fs.writeFileSync(dockerIgnorePath, "node_modules\n.git\n.npm\n", 'utf-8');

  const cdInstruction = workingSubDir !== '.' ? `WORKDIR /app/${workingSubDir.replace(/\\/g, '/')}` : 'WORKDIR /app';
  
  // For npm run dev or vite, ensure host 0.0.0.0 is used so it binds externally in Docker
  let finalCmd = startCmd;
  if (isVite) {
    if (!finalCmd.includes('--host') && !finalCmd.includes('-h')) {
      finalCmd = `${finalCmd} -- --host 0.0.0.0`;
    }
    // If start command doesn't explicitly specify a port flag, pass the detected containerPort
    if (!finalCmd.includes('--port') && !finalCmd.includes('-p')) {
      finalCmd = `${finalCmd} --port ${containerPort}`;
    }
  } else if (finalCmd.includes('dev')) {
    if (!finalCmd.includes('--host') && !finalCmd.includes('-h')) {
      finalCmd = `${finalCmd} -- --host 0.0.0.0`;
    }
  }
  const cmdParts = finalCmd.split(' ').map(c => `"${c}"`).join(', ');

  const dockerfileContent = `# Auto-generated Dockerfile by Mini Deploy Platform
FROM node:20-alpine

WORKDIR /app
COPY . .
${cdInstruction}

ENV HOST=0.0.0.0
ENV PORT=${containerPort}
ENV __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=.linkpc.net,.nip.io,.sslip.io,dbj.linkpc.net,localhost

RUN if [ -f package.json ]; then npm install; fi

EXPOSE ${containerPort}
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
  getWorkspaceCommitInfo,
  WORKSPACE_BASE,
};
