const express = require('express');
const multer = require('multer');
const Docker = require('dockerode');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const axios = require('axios');
const http = require('http');
const WebSocket = require('ws');
const mysql = require('mysql2/promise');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const docker = new Docker();
const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    // Only accept files named 'Dockerfile' or with .dockerfile extension
    if (file.originalname === 'Dockerfile' || file.originalname.endsWith('.dockerfile')) {
      cb(null, true);
    } else {
      cb(new Error('Only Dockerfile uploads are allowed'));
    }
  }
});
const deployments = new Map();
const tunnels = new Map();
const MAX_DEPLOYMENTS = parseInt(process.env.MAX_DEPLOYMENTS || '50');
const TUNNEL_TIMEOUT = parseInt(process.env.TUNNEL_TIMEOUT || '15000');
const CONTAINER_CHECK_TIMEOUT = parseInt(process.env.CONTAINER_CHECK_TIMEOUT || '2000');

// Database connection
let db;
async function initDB() {
  let retries = 10;
  let delay = 2000;

  while (retries > 0) {
    try {
      db = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'clouddeploy',
        password: process.env.DB_PASSWORD || 'password',
        database: process.env.DB_NAME || 'clouddeploy'
      });

      // Test connection
      await db.execute('SELECT 1');

      await db.execute(`
        CREATE TABLE IF NOT EXISTS deployments (
          id VARCHAR(255) PRIMARY KEY,
          url VARCHAR(255),
          localUrl VARCHAR(255),
          container_id VARCHAR(255),
          status VARCHAR(50),
          type VARCHAR(50),
          source VARCHAR(255),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      console.log('✅ Database connected successfully');
      return;
    } catch (error) {
      retries--;
      console.error(`❌ Database connection failed. Retries left: ${retries}`);
      console.error(`Error: ${error.message}`);

      if (retries === 0) {
        console.error('⚠️  Failed to connect to database after all retries. App will continue without database.');
        return;
      }

      await new Promise(resolve => setTimeout(resolve, delay));
      delay = Math.min(delay * 1.5, 15000); // Exponential backoff, max 15s
    }
  }
}

// Create required directories
const requiredDirs = ['uploads', 'deployments', path.join(__dirname, 'deployments')];
requiredDirs.forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`📁 Created directory: ${dir}`);
  }
});

// Generate random port with conflict checking
const usedPorts = new Set();

function getRandomPort() {
  let attempts = 0;
  while (attempts < 100) {
    const port = Math.floor(Math.random() * (9999 - 5000) + 5000);
    if (!usedPorts.has(port)) {
      usedPorts.add(port);
      return port;
    }
    attempts++;
  }
  throw new Error('Unable to find available port');
}

function releasePort(port) {
  if (port) {
    usedPorts.delete(port);
    console.log(`🔓 Released port: ${port}`);
  }
}

// Input validation helpers
function validateDockerImage(image) {
  if (!image || typeof image !== 'string') return false;
  // Basic validation: alphanumeric, dots, slashes, colons, hyphens, underscores
  const imageRegex = /^[a-zA-Z0-9._\/-]+:[a-zA-Z0-9._-]+$|^[a-zA-Z0-9._\/-]+$/;
  return imageRegex.test(image) && image.length < 256;
}

function validatePort(port) {
  const portNum = parseInt(port);
  return !isNaN(portNum) && portNum > 0 && portNum <= 65535;
}

function validateGitRepo(repo) {
  if (!repo || typeof repo !== 'string') return false;
  // Allow http(s) and git protocols
  const repoRegex = /^(https?:\/\/|git@)[\w\.-]+[\/:]([\w\.-]+\/)*[\w\.-]+(\.git)?$/;
  return repoRegex.test(repo) && repo.length < 512;
}

function checkDeploymentLimit() {
  if (deployments.size >= MAX_DEPLOYMENTS) {
    throw new Error(`Deployment limit reached (${MAX_DEPLOYMENTS}). Please delete some deployments first.`);
  }
}

// Create public tunnel for a port using Cloudflare
async function createPublicTunnel(port, deployId) {
  try {
    console.log(`Creating Cloudflare tunnel for port ${port}...`);

    const tunnelProcess = spawn('cloudflared', [
      'tunnel',
      '--url', `http://localhost:${port}`,
      '--no-autoupdate'
    ], {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    return new Promise((resolve, reject) => {
      let output = '';
      let resolved = false;
      const timeout = setTimeout(() => {
        if (!resolved) {
          console.log('Tunnel creation timeout, using localhost fallback');
          tunnelProcess.kill();
          resolve(null);
        }
      }, TUNNEL_TIMEOUT);

      const checkForUrl = (data) => {
        output += data.toString();
        const match = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
        if (match && !resolved) {
          resolved = true;
          clearTimeout(timeout);
          const tunnelUrl = match[0];
          console.log(`Tunnel created: ${tunnelUrl}`);
          tunnels.set(deployId, {
            url: tunnelUrl,
            process: tunnelProcess,
            close: () => tunnelProcess.kill()
          });
          resolve(tunnelUrl);
        }
      };

      tunnelProcess.stdout.on('data', checkForUrl);
      tunnelProcess.stderr.on('data', checkForUrl);

      tunnelProcess.on('error', (error) => {
        clearTimeout(timeout);
        console.error('Tunnel process error:', error);
        resolve(null);
      });

      tunnelProcess.on('exit', (code) => {
        if (code !== 0 && code !== null) {
          console.log(`Tunnel process exited with code ${code}`);
        }
      });
    });
  } catch (error) {
    console.error('Tunnel creation error:', error);
    return null;
  }
}

app.use(express.json());
app.use(express.static('public'));

// Serve CloudDeploy dashboard
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API routes prefix
app.use('/api', express.Router());

// Deploy from Docker image
app.post('/api/deploy/docker', async (req, res) => {
  let hostPort = null;
  try {
    const { image, port: appPort = '3000' } = req.body;

    // Input validation
    if (!validateDockerImage(image)) {
      return res.status(400).json({ error: 'Invalid Docker image name' });
    }
    if (!validatePort(appPort)) {
      return res.status(400).json({ error: 'Invalid port number' });
    }

    // Check deployment limit
    checkDeploymentLimit();

    const deployId = uuidv4().substring(0, 8);
    hostPort = getRandomPort();

    // Send progress updates
    const sendProgress = (step, progress) => {
      wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ type: 'progress', deployId, step, progress }));
        }
      });
    };

    sendProgress('Pulling image...', 20);

    // Pull image
    const pullStream = await docker.pull(image);
    await new Promise((resolve, reject) => {
      docker.modem.followProgress(pullStream, (err, res) => {
        if (err) reject(err);
        else resolve(res);
      }, (event) => {
        if (event.status) {
          let msg = event.status;
          if (event.progress) msg += ` ${event.progress}`;
          sendProgress(msg, 30); // Keep it around 30-50% range during pull
        }
      });
    });

    sendProgress('Creating container...', 60);

    const container = await docker.createContainer({
      Image: image,
      ExposedPorts: { [`${appPort}/tcp`]: {} },
      HostConfig: {
        PortBindings: { [`${appPort}/tcp`]: [{ HostPort: hostPort.toString() }] }
      }
    });

    console.log(`Container created: ${image} - App port: ${appPort}, Host port: ${hostPort}`);

    await container.start();

    sendProgress('Starting container...', 80);

    // Wait and verify container is actually running
    await new Promise(resolve => setTimeout(resolve, 3000));

    const containerInfo = await container.inspect();
    if (!containerInfo.State.Running) {
      // Container failed to start
      sendProgress('Container failed to start', 100);
      releasePort(hostPort);

      // Get logs for debugging
      let errorLogs = 'No logs available';
      try {
        const logs = await container.logs({ stdout: true, stderr: true, tail: 50 });
        errorLogs = logs.toString();
      } catch (e) {
        // Ignore log fetch errors
      }

      // Clean up failed container
      try {
        await container.remove({ force: true });
      } catch (e) {
        console.error('Failed to remove failed container:', e);
      }

      return res.status(500).json({
        error: 'Container failed to start',
        logs: errorLogs
      });
    }

    sendProgress('Container running successfully!', 90);

    // Wait for container to be ready before creating tunnel
    const waitForContainer = async (containerId, appPort, maxAttempts = 10) => {
      for (let i = 0; i < maxAttempts; i++) {
        try {
          const containerInfo = await docker.getContainer(containerId).inspect();
          const containerIP = containerInfo.NetworkSettings.IPAddress;

          if (containerIP) {
            await axios.get(`http://${containerIP}:${appPort}`, { timeout: 2000 });
            console.log(`Container ${containerId.substring(0, 12)} is ready`);
            return true;
          }
        } catch (err) {
          console.log(`Waiting for container... (${i + 1}/${maxAttempts})`);
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
      return false;
    };

    // Create Cloudflare tunnel after container is ready
    waitForContainer(container.id, appPort).then(async (ready) => {
      if (!ready) {
        console.log(`Container not ready after waiting, creating tunnel anyway`);
      }

      const tunnelUrl = await createPublicTunnel(hostPort, deployId);
      if (tunnelUrl) {
        const dep = deployments.get(deployId);
        if (dep) {
          dep.url = tunnelUrl;
          dep.hasPublicUrl = true;
          console.log(`Updated deployment ${deployId} with tunnel URL: ${tunnelUrl}`);

          // Update database
          if (db) {
            db.execute('UPDATE deployments SET url = ? WHERE id = ?', [tunnelUrl, deployId])
              .catch(err => console.error('DB update failed:', err));
          }
        }
      }
    }).catch(err => console.error('Tunnel creation failed:', err));

    const tunnelUrl = null; // Don't wait for tunnel

    const deployment = {
      id: deployId,
      url: tunnelUrl || `http://localhost:${hostPort}`,
      localUrl: `http://localhost:${hostPort}`,
      container: container.id,
      status: 'running',
      type: 'docker',
      source: image,
      hasPublicUrl: !!tunnelUrl,
      hostPort: hostPort, // Track port for cleanup
      createdAt: new Date().toISOString()
    };

    deployments.set(deployId, deployment);

    // Save to database
    if (db) {
      await db.execute(
        'INSERT INTO deployments (id, url, localUrl, container_id, status, type, source) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [deployId, deployment.url, deployment.localUrl, deployment.container, deployment.status, deployment.type, deployment.source]
      );
    }

    res.json({ success: true, deploymentId: deployId, url: deployment.url });
  } catch (error) {
    console.error('Deployment error:', error);
    // Release port on error
    if (hostPort) {
      releasePort(hostPort);
    }
    res.status(500).json({ error: error.message });
  }
});

// Deploy from Git repository
app.post('/api/deploy/git', async (req, res) => {
  let hostPort = null;
  let buildDir = null;
  try {
    const { repo, port: appPort = '3000' } = req.body;

    // Input validation
    if (!validateGitRepo(repo)) {
      return res.status(400).json({ error: 'Invalid Git repository URL' });
    }
    if (!validatePort(appPort)) {
      return res.status(400).json({ error: 'Invalid port number' });
    }

    // Check deployment limit
    checkDeploymentLimit();

    const deployId = uuidv4().substring(0, 8);
    hostPort = getRandomPort();
    buildDir = path.join(__dirname, 'deployments', `build-${deployId}`);

    // Ensure build directory exists
    if (!fs.existsSync(path.join(__dirname, 'deployments'))) {
      fs.mkdirSync(path.join(__dirname, 'deployments'), { recursive: true });
    }

    // Send progress updates
    const sendProgress = (step, progress) => {
      wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ type: 'progress', deployId, step, progress }));
        }
      });
    };

    sendProgress('Cloning repository...', 10);

    execSync(`git clone ${repo} ${buildDir}`);

    sendProgress('Building image...', 30);

    const buildStream = await docker.buildImage(buildDir, { t: `app-${deployId}` });

    await new Promise((resolve, reject) => {
      docker.modem.followProgress(buildStream, (err, res) => {
        if (err) reject(err);
        else resolve(res);
      }, (event) => {
        if (event.stream) {
          const msg = event.stream.trim();
          if (msg) {
            sendProgress(msg, 40);
          }
        }
      });
    });

    const container = await docker.createContainer({
      Image: `app-${deployId}`,
      ExposedPorts: { [`${appPort}/tcp`]: {} },
      HostConfig: {
        PortBindings: { [`${appPort}/tcp`]: [{ HostPort: hostPort.toString() }] }
      }
    });

    await container.start();

    const deployment = {
      id: deployId,
      url: `http://localhost:${hostPort}`,
      localUrl: `http://localhost:${hostPort}`,
      container: container.id,
      status: 'running',
      type: 'git',
      source: repo,
      hasPublicUrl: false,
      hostPort: hostPort, // Track port for cleanup
      buildDir: buildDir, // Track build dir for cleanup
      createdAt: new Date().toISOString()
    };

    deployments.set(deployId, deployment);

    // Create Cloudflare tunnel asynchronously (non-blocking)
    createPublicTunnel(hostPort, deployId).then(tunnelUrl => {
      if (tunnelUrl) {
        const dep = deployments.get(deployId);
        if (dep) {
          dep.url = tunnelUrl;
          dep.hasPublicUrl = true;
          console.log(`Updated deployment ${deployId} with tunnel URL: ${tunnelUrl}`);

          // Update database
          if (db) {
            db.execute('UPDATE deployments SET url = ? WHERE id = ?', [tunnelUrl, deployId])
              .catch(err => console.error('DB update failed:', err));
          }
        }
      }
    }).catch(err => console.error('Tunnel creation failed:', err));

    // Clean up build directory after successful deployment
    if (buildDir && fs.existsSync(buildDir)) {
      setTimeout(() => {
        try {
          fs.rmSync(buildDir, { recursive: true, force: true });
          console.log(`🗑️  Cleaned up build directory: ${buildDir}`);
        } catch (err) {
          console.error('Failed to clean up build directory:', err);
        }
      }, 5000); // Wait 5s to ensure image is built
    }

    res.json({ success: true, deploymentId: deployId, url: deployment.url });
  } catch (error) {
    console.error('Git deployment error:', error);
    // Release port on error
    if (hostPort) {
      releasePort(hostPort);
    }
    // Clean up build directory on error
    if (buildDir && fs.existsSync(buildDir)) {
      try {
        fs.rmSync(buildDir, { recursive: true, force: true });
      } catch (err) {
        console.error('Failed to clean up build directory:', err);
      }
    }
    res.status(500).json({ error: error.message });
  }
});

// Deploy from uploaded Dockerfile
app.post('/api/deploy/dockerfile', upload.single('dockerfile'), async (req, res) => {
  let port = null;
  let uploadedFile = null;
  try {
    // Check deployment limit
    checkDeploymentLimit();

    if (!req.file) {
      return res.status(400).json({ error: 'No Dockerfile uploaded' });
    }

    uploadedFile = req.file.path;
    const deployId = uuidv4().substring(0, 8);
    port = getRandomPort();

    // Send progress updates
    const sendProgress = (step, progress) => {
      wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ type: 'progress', deployId, step, progress }));
        }
      });
    };

    sendProgress('Building image from Dockerfile...', 20);

    const buildStream = await docker.buildImage({
      context: path.dirname(req.file.path),
      src: [path.basename(req.file.path)]
    }, { t: `app-${deployId}` });

    await new Promise((resolve, reject) => {
      docker.modem.followProgress(buildStream, (err, res) => {
        if (err) reject(err);
        else resolve(res);
      }, (event) => {
        if (event.stream) {
          const msg = event.stream.trim();
          if (msg) {
            sendProgress(msg, 40);
          }
        }
      });
    });

    const container = await docker.createContainer({
      Image: `app-${deployId}`,
      ExposedPorts: { '8080/tcp': {} },
      HostConfig: {
        PortBindings: { '8080/tcp': [{ HostPort: port.toString() }] }
      }
    });

    await container.start();

    // Create Cloudflare tunnel
    const tunnelUrl = await createPublicTunnel(port, deployId);

    const deployment = {
      id: deployId,
      url: tunnelUrl || `http://localhost:${port}`,
      localUrl: `http://localhost:${port}`,
      container: container.id,
      status: 'running',
      type: 'dockerfile',
      source: 'uploaded',
      hasPublicUrl: !!tunnelUrl,
      hostPort: port, // Track port for cleanup
      createdAt: new Date().toISOString()
    };

    deployments.set(deployId, deployment);

    // Clean up uploaded file
    if (uploadedFile && fs.existsSync(uploadedFile)) {
      setTimeout(() => {
        try {
          fs.unlinkSync(uploadedFile);
          console.log(`🗑️  Cleaned up uploaded file: ${uploadedFile}`);
        } catch (err) {
          console.error('Failed to clean up uploaded file:', err);
        }
      }, 5000);
    }

    res.json({ success: true, deploymentId: deployId, url: deployment.url });
  } catch (error) {
    console.error('Dockerfile deployment error:', error);
    // Release port on error
    if (port) {
      releasePort(port);
    }
    // Clean up uploaded file on error
    if (uploadedFile && fs.existsSync(uploadedFile)) {
      try {
        fs.unlinkSync(uploadedFile);
      } catch (err) {
        console.error('Failed to clean up uploaded file:', err);
      }
    }
    res.status(500).json({ error: error.message });
  }
});

// List deployments
app.get('/api/deployments', (req, res) => {
  res.json(Array.from(deployments.values()));
});

// Delete deployment
app.delete('/api/deploy/:id', async (req, res) => {
  try {
    const deployment = deployments.get(req.params.id);
    if (!deployment) {
      return res.status(404).json({ error: 'Deployment not found' });
    }

    const errors = [];

    // Stop and remove container (handle errors gracefully)
    try {
      const container = docker.getContainer(deployment.container);
      try {
        await container.stop({ t: 10 }); // 10 second timeout
      } catch (stopErr) {
        // Container might already be stopped
        console.log(`Container already stopped or error stopping: ${stopErr.message}`);
      }
      await container.remove({ force: true });
      console.log(`✅ Removed container: ${deployment.container.substring(0, 12)}`);
    } catch (containerErr) {
      console.error('Container cleanup error:', containerErr);
      errors.push(`Container cleanup failed: ${containerErr.message}`);
    }

    // Close tunnel if exists
    try {
      const tunnel = tunnels.get(req.params.id);
      if (tunnel) {
        tunnel.close();
        tunnels.delete(req.params.id);
        console.log(`✅ Closed tunnel for deployment: ${req.params.id}`);
      }
    } catch (tunnelErr) {
      console.error('Tunnel cleanup error:', tunnelErr);
      errors.push(`Tunnel cleanup failed: ${tunnelErr.message}`);
    }

    // Release port
    if (deployment.hostPort) {
      releasePort(deployment.hostPort);
    }

    // Clean up build directory if it exists
    if (deployment.buildDir && fs.existsSync(deployment.buildDir)) {
      try {
        fs.rmSync(deployment.buildDir, { recursive: true, force: true });
        console.log(`✅ Cleaned up build directory: ${deployment.buildDir}`);
      } catch (dirErr) {
        console.error('Build directory cleanup error:', dirErr);
        errors.push(`Build directory cleanup failed: ${dirErr.message}`);
      }
    }

    // Remove from memory
    deployments.delete(req.params.id);

    // Delete from database
    if (db) {
      try {
        await db.execute('DELETE FROM deployments WHERE id = ?', [req.params.id]);
      } catch (dbErr) {
        console.error('Database deletion error:', dbErr);
        errors.push(`Database deletion failed: ${dbErr.message}`);
      }
    }

    if (errors.length > 0) {
      res.json({ success: true, warnings: errors });
    } else {
      res.json({ success: true });
    }
  } catch (error) {
    console.error('Deployment deletion error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'healthy', deployments: deployments.size });
});

// Test deployment with simple web server
app.post('/api/deploy/test', async (req, res) => {
  let hostPort = null;
  try {
    // Check deployment limit
    checkDeploymentLimit();

    const deployId = uuidv4().substring(0, 8);
    hostPort = getRandomPort();

    // Pull nginx image first
    const pullStream = await docker.pull('nginx:alpine');
    await new Promise((resolve, reject) => {
      docker.modem.followProgress(pullStream, (err, res) => {
        if (err) reject(err);
        else resolve(res);
      }, (event) => {
        // No sendProgress here either, but this is a test endpoint, maybe less critical.
        // But good to have.
      });
    });

    // Deploy nginx as test
    const container = await docker.createContainer({
      Image: 'nginx:alpine',
      ExposedPorts: { '80/tcp': {} },
      HostConfig: {
        PortBindings: { '80/tcp': [{ HostPort: hostPort.toString() }] }
      }
    });

    await container.start();

    // Create Cloudflare tunnel
    const tunnelUrl = await createPublicTunnel(hostPort, deployId);

    const deployment = {
      id: deployId,
      url: tunnelUrl || `http://localhost:${hostPort}`,
      localUrl: `http://localhost:${hostPort}`,
      container: container.id,
      status: 'running',
      type: 'test',
      source: 'nginx:alpine',
      hasPublicUrl: !!tunnelUrl,
      hostPort: hostPort,
      createdAt: new Date().toISOString()
    };

    deployments.set(deployId, deployment);

    res.json({ success: true, deploymentId: deployId, url: deployment.url });
  } catch (error) {
    console.error('Test deployment error:', error);
    if (hostPort) {
      releasePort(hostPort);
    }
    res.status(500).json({ error: error.message });
  }
});

// Get container logs
app.get('/api/logs/:id', async (req, res) => {
  try {
    const deployment = deployments.get(req.params.id);
    if (!deployment) {
      return res.status(404).json({ error: 'Deployment not found' });
    }

    const container = docker.getContainer(deployment.container);
    const logs = await container.logs({ stdout: true, stderr: true, tail: 100 });
    res.json({ logs: logs.toString() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get deployment status with port detection
app.get('/api/deploy/:id/status', async (req, res) => {
  try {
    const deployment = deployments.get(req.params.id);
    if (!deployment) {
      return res.status(404).json({ error: 'Deployment not found' });
    }

    const container = docker.getContainer(deployment.container);
    const info = await container.inspect();

    // Get exposed ports from container
    const exposedPorts = Object.keys(info.Config.ExposedPorts || {});
    const portBindings = info.HostConfig.PortBindings || {};

    res.json({
      ...deployment,
      containerStatus: info.State.Status,
      running: info.State.Running,
      exposedPorts,
      portBindings
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Auto-detect and fix port issues
app.post('/api/deploy/:id/fix-port', async (req, res) => {
  try {
    const deployment = deployments.get(req.params.id);
    if (!deployment) {
      return res.status(404).json({ error: 'Deployment not found' });
    }

    const container = docker.getContainer(deployment.container);
    const info = await container.inspect();

    // Get container logs to check for port info
    const logs = await container.logs({ stdout: true, stderr: true, tail: 50 });
    const logText = logs.toString();

    // Look for common port patterns in logs
    const portMatches = logText.match(/(?:port|listening|server.*?)\s*(\d{4,5})/gi);
    let detectedPort = null;

    if (portMatches) {
      const portNumbers = portMatches.map(m => m.match(/\d{4,5}/)?.[0]).filter(Boolean);
      detectedPort = portNumbers[0];
    }

    // Check if container is actually running
    if (!info.State.Running) {
      return res.json({
        success: false,
        issue: 'container_stopped',
        message: 'Container is not running',
        logs: logText
      });
    }

    // Get exposed ports
    const exposedPorts = Object.keys(info.Config.ExposedPorts || {});

    res.json({
      success: true,
      containerRunning: info.State.Running,
      exposedPorts,
      detectedPort,
      logs: logText,
      portBindings: info.HostConfig.PortBindings
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Stats endpoint
app.get('/api/stats', (req, res) => {
  const stats = {
    totalDeployments: deployments.size,
    runningDeployments: Array.from(deployments.values()).filter(d => d.status === 'running').length,
    failedDeployments: Array.from(deployments.values()).filter(d => d.status === 'failed').length
  };
  res.json(stats);
});

// WebSocket connection
wss.on('connection', (ws) => {
  console.log('Client connected');
  ws.on('close', () => console.log('Client disconnected'));
});

// Load deployments from database on startup
async function loadDeploymentsFromDB() {
  if (!db) {
    console.log('⚠️  Database not available, skipping deployment restoration');
    return;
  }

  try {
    const [rows] = await db.execute('SELECT * FROM deployments');
    console.log(`📦 Found ${rows.length} deployments in database`);

    for (const row of rows) {
      // Verify container still exists
      try {
        const container = docker.getContainer(row.container_id);
        const info = await container.inspect();

        const deployment = {
          id: row.id,
          url: row.url,
          localUrl: row.localUrl,
          container: row.container_id,
          status: info.State.Running ? 'running' : 'stopped',
          type: row.type,
          source: row.source,
          hasPublicUrl: row.url && !row.url.includes('localhost'),
          createdAt: row.created_at
        };

        deployments.set(row.id, deployment);
        console.log(`✅ Restored deployment: ${row.id}`);
      } catch (err) {
        // Container doesn't exist anymore, clean up DB
        console.log(`⚠️  Container ${row.container_id.substring(0, 12)} not found, removing from DB`);
        await db.execute('DELETE FROM deployments WHERE id = ?', [row.id]);
      }
    }

    console.log(`✅ Loaded ${deployments.size} active deployments`);
  } catch (error) {
    console.error('Failed to load deployments from database:', error);
  }
}

// Cleanup orphaned tunnel processes on startup
async function cleanupOrphanedTunnels() {
  try {
    // Kill any existing cloudflared processes
    if (process.platform === 'win32') {
      execSync('taskkill /F /IM cloudflared.exe 2>nul', { stdio: 'ignore' });
    } else {
      execSync('pkill -9 cloudflared 2>/dev/null || true', { stdio: 'ignore' });
    }
    console.log('✅ Cleaned up orphaned tunnel processes');
  } catch (error) {
    // Ignore errors - processes might not exist
  }
}

initDB().then(async () => {
  // Clean up orphaned processes
  await cleanupOrphanedTunnels();

  // Load existing deployments
  await loadDeploymentsFromDB();

  server.listen(3000, () => {
    console.log('🚀 CloudDeploy running on port 3000');
    console.log('📊 Dashboard: http://localhost:3000');
    console.log(`📦 Active deployments: ${deployments.size}`);
    console.log(`🔒 Max deployments: ${MAX_DEPLOYMENTS}`);
  });
});