import express from 'express';
import session from 'express-session';
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

const app = express();
const PORT = process.env.PORT || 3000;

// Security Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
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

// Session Configuration (using memory store for Heroku)
app.use(session({
  secret: process.env.SESSION_SECRET || uuidv4(),
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000
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

app.post('/deploy', async (req, res) => {
  try {
    const { sessionId } = req.body;
    
    if (!sessionId) {
      return res.status(400).json({ success: false, error: 'Session ID required' });
    }

    if (!sessionId.startsWith("Demo-Slayer~") || !sessionId.includes("#")) {
      return res.status(400).json({ 
        success: false, 
        error: 'Format: Demo-Slayer~FILEID#KEY' 
      });
    }

    const deploymentId = uuidv4();
    const configPath = path.join(__dirname, 'configs', `${deploymentId}.cjs`);
    
    if (!fs.existsSync(path.dirname(configPath))) {
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
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
    
    activeSessions.set(deploymentId, {
      process: botProcess,
      startedAt: new Date()
    });
    
    res.json({ 
      success: true,
      message: 'Bot deployed successfully!',
      deploymentId: deploymentId.slice(0, 8)
    });
  } catch (error) {
    console.error('Deployment error:', error);
    res.status(500).json({ success: false, error: 'Deployment failed' });
  }
});

// Cleanup inactive sessions
setInterval(() => {
  const now = new Date();
  activeSessions.forEach((session, id) => {
    if (now - session.startedAt > 24 * 60 * 60 * 1000) {
      session.process.kill();
      activeSessions.delete(id);
      
      const configPath = path.join(__dirname, 'configs', `${id}.cjs`);
      if (fs.existsSync(configPath)) {
        fs.unlinkSync(configPath);
      }
    }
  });
}, 60 * 60 * 1000);

// Health check
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// Start Server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
