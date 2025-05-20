import express from 'express';
import { createClient } from 'redis';
import session from 'express-session';
import RedisStore from 'connect-redis';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Redis
const redisClient = createClient();
redisClient.connect().catch(console.error);

const RedisStoreInstance = RedisStore(session);

// Initialize Express
const app = express();
const PORT = process.env.PORT || 3000;

// Security Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));

// Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// Session Configuration
app.use(session({
  store: new RedisStoreInstance({ client: redisClient }),
  secret: process.env.SESSION_SECRET || uuidv4(),
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Active Sessions Tracker
const activeSessions = new Map();

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Session Deployment
app.post('/deploy', async (req, res) => {
  try {
    const { sessionId } = req.body;
    
    if (!sessionId) {
      return res.status(400).json({ success: false, error: 'Session ID is required' });
    }

    // Validate session ID format
    if (!sessionId.startsWith("Demo-Slayer~") || !sessionId.includes("#")) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid session format. Must be: Demo-Slayer~FILEID#KEY' 
      });
    }

    // Generate unique ID for this deployment
    const deploymentId = uuidv4();

    // Create config file
    const configPath = path.join(__dirname, 'configs', `${deploymentId}.cjs`);
    const configDir = path.dirname(configPath);
    
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    
    const configContent = `module.exports = {
  SESSION_ID: "${sessionId}",
  AUTO_STATUS_REACT: "true",
  AUTO_REACT: false,
  MODE: "private",
  PREFIX: ".",
  DEPLOYMENT_ID: "${deploymentId}"
};\n`;
    
    fs.writeFileSync(configPath, configContent);
    
    // Start bot process
    const botProcess = spawn('node', ['bot.js', deploymentId], {
      detached: true,
      stdio: 'ignore'
    });
    
    botProcess.unref();
    
    // Track session
    activeSessions.set(deploymentId, {
      process: botProcess,
      startedAt: new Date(),
      lastActivity: new Date()
    });
    
    res.json({ 
      success: true,
      message: 'Session deployed successfully! Your bot is now running.',
      deploymentId
    });
  } catch (error) {
    console.error('Deployment error:', error);
    res.status(500).json({ success: false, error: 'Failed to deploy session' });
  }
});

// Cleanup inactive sessions
setInterval(() => {
  const now = new Date();
  activeSessions.forEach((session, deploymentId) => {
    if (now - session.lastActivity > 24 * 60 * 60 * 1000) { // 24h inactivity
      try {
        session.process.kill();
        activeSessions.delete(deploymentId);
        
        // Delete config file
        const configPath = path.join(__dirname, 'configs', `${deploymentId}.cjs`);
        if (fs.existsSync(configPath)) {
          fs.unlinkSync(configPath);
        }
      } catch (error) {
        console.error('Cleanup error:', error);
      }
    }
  });
}, 60 * 60 * 1000); // Run hourly

// Start Server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
