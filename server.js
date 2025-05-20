import express from 'express';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const activeDeployments = new Map();

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/deploy', async (req, res) => {
  const { sessionId } = req.body;
  const deploymentId = uuidv4();

  if (!sessionId || !sessionId.startsWith("Demo-Slayer~") || !sessionId.includes("#")) {
    return res.status(400).json({ error: 'Invalid session format' });
  }

  // Create deployment directory
  const deploymentDir = path.join(__dirname, 'deployments', deploymentId);
  fs.mkdirSync(deploymentDir, { recursive: true });

  // Save session ID to config
  fs.writeFileSync(path.join(deploymentDir, 'config.json'), JSON.stringify({
    sessionId,
    deploymentId
  }));

  // Start bot process
  const botProcess = spawn('node', ['bot.js', deploymentId], {
    cwd: __dirname,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  // Track deployment progress
  activeDeployments.set(deploymentId, {
    process: botProcess,
    logs: [],
    status: 'starting'
  });

  // Capture logs
  botProcess.stdout.on('data', (data) => {
    const log = data.toString().trim();
    activeDeployments.get(deploymentId).logs.push(log);
    console.log(`[${deploymentId}]: ${log}`);
  });

  botProcess.stderr.on('data', (data) => {
    const log = data.toString().trim();
    activeDeployments.get(deploymentId).logs.push(`ERROR: ${log}`);
    console.error(`[${deploymentId}]: ${log}`);
  });

  botProcess.on('close', (code) => {
    activeDeployments.get(deploymentId).status = code === 0 ? 'completed' : 'failed';
  });

  res.json({ 
    success: true,
    deploymentId,
    message: 'Deployment started'
  });
});

app.get('/deployment/:id/status', (req, res) => {
  const deployment = activeDeployments.get(req.params.id);
  if (!deployment) {
    return res.status(404).json({ error: 'Deployment not found' });
  }
  
  res.json({
    status: deployment.status,
    logs: deployment.logs
  });
});

app.listen(3000, () => {
  console.log('Server running on port 3000');
  if (!fs.existsSync(path.join(__dirname, 'deployments'))) {
    fs.mkdirSync(path.join(__dirname, 'deployments'));
  }
});
