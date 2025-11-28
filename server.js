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
const upload = multer({ dest: 'uploads/' });
const deployments = new Map();
const tunnels = new Map();

// Database connection
let db;
async function initDB() {
  try {
    db = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'clouddeploy',
      password: process.env.DB_PASSWORD || 'password',
      database: process.env.DB_NAME || 'clouddeploy'
    });

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

    console.log('Database connected');
  } catch (error) {
    console.error('Database error:', error);
    setTimeout(initDB, 5000);
  }
}

// Generate random port
function getRandomPort() {
  return Math.floor(Math.random() * (9999 - 5000) + 5000);
}

// Create public tunnel for a port
async function createPublicTunnel(port, deployId) {
  try {
    console.log(`Creating public tunnel for port ${port}...`);
    const ngrok = require('ngrok');

    const tunnelUrl = await ngrok.connect(port);

    console.log(`Tunnel created: ${tunnelUrl}`);
    tunnels.set(deployId, { url: tunnelUrl, close: () => ngrok.disconnect(tunnelUrl) });

    return tunnelUrl;
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
  try {
    const { image, port: appPort = '3000' } = req.body;
    const deployId = uuidv4().substring(0, 8);
    const hostPort = getRandomPort();

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

    // Wait and check if container is actually running
    setTimeout(async () => {
      try {
        const info = await container.inspect();
        if (!info.State.Running) {
          console.log(`Container ${deployId} failed to start`);
          const dep = deployments.get(deployId);
          if (dep) dep.status = 'failed';
        }
      } catch (err) {
        console.error('Container check failed:', err);
      }
    }, 3000);

    sendProgress('Deployment complete!', 100);

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

    const tunnelUrl = null; // Don't wait for tunnel

    const deployment = {
      id: deployId,
      url: tunnelUrl || `http://localhost:${hostPort}`,
      localUrl: `http://localhost:${hostPort}`,
      container: container.id,
      status: 'running',
      type: 'docker',
      source: image,
      hasPublicUrl: !!tunnelUrl
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
    res.status(500).json({ error: error.message });
  }
});

// Deploy from Git repository
app.post('/api/deploy/git', async (req, res) => {
  try {
    const { repo, port: appPort = '3000' } = req.body;
    const deployId = uuidv4().substring(0, 8);
    const hostPort = getRandomPort();
    const buildDir = `/tmp/build-${deployId}`;

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
      hasPublicUrl: false
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

    res.json({ success: true, deploymentId: deployId, url: deployment.url });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Deploy from uploaded Dockerfile
app.post('/api/deploy/dockerfile', upload.single('dockerfile'), async (req, res) => {
  try {
    const deployId = uuidv4().substring(0, 8);
    const port = getRandomPort();

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
      hasPublicUrl: !!tunnelUrl
    };

    deployments.set(deployId, deployment);

    res.json({ success: true, deploymentId: deployId, url: deployment.url });
  } catch (error) {
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

    const container = docker.getContainer(deployment.container);
    await container.stop();
    await container.remove();

    // Close tunnel if exists
    const tunnelProcess = tunnels.get(req.params.id);
    if (tunnelProcess) {
      tunnel.close();
      tunnels.delete(req.params.id);
    }

    deployments.delete(req.params.id);

    // Delete from database
    if (db) {
      await db.execute('DELETE FROM deployments WHERE id = ?', [req.params.id]);
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'healthy', deployments: deployments.size });
});

// Test deployment with simple web server
app.post('/api/deploy/test', async (req, res) => {
  try {
    const deployId = uuidv4().substring(0, 8);
    const hostPort = getRandomPort();

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
      hasPublicUrl: !!tunnelUrl
    };

    deployments.set(deployId, deployment);

    res.json({ success: true, deploymentId: deployId, url: deployment.url });
  } catch (error) {
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

initDB().then(() => {
  server.listen(3000, () => {
    console.log('CloudDeploy running on port 3000');
    console.log('Dashboard: http://localhost:3000');
  });
});