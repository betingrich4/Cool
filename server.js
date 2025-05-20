import express from 'express';
import { createClient } from 'redis';
import session from 'express-session';
import RedisStore from 'connect-redis';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import nodemailer from 'nodemailer';
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

// Email Configuration
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Auth Middleware
function authenticate(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Auth Routes
app.post('/register', async (req, res) => {
  try {
    const { username, password, email } = req.body;
    
    // Validate input
    if (!username || !password || !email) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    
    // Check if user exists
    const exists = await redisClient.hExists('users', username);
    if (exists) {
      return res.status(400).json({ error: 'Username already exists' });
    }
    
    // Hash password
    const hash = await bcrypt.hash(password, 10);
    
    // Store user
    await redisClient.hSet('users', username, hash);
    await redisClient.hSet('user_emails', username, email);
    
    // Send welcome email
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Welcome to WhatsApp Auto-Deploy',
      text: `Hi ${username},\n\nYour account has been successfully created!`
    });
    
    res.status(201).json({ success: true });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    // Validate input
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    
    // Get user
    const hash = await redisClient.hGet('users', username);
    if (!hash) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Compare passwords
    const match = await bcrypt.compare(password, hash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Create session
    req.session.userId = username;
    req.session.save();
    
    res.json({ success: true });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/logout', authenticate, (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// Deployment Route
app.post('/deploy', authenticate, async (req, res) => {
  try {
    const { sessionId } = req.body;
    const userId = req.session.userId;
    
    if (!sessionId) {
      return res.status(400).json({ error: 'Session ID is required' });
    }
    
    // Cleanup old session if exists
    if (activeSessions.has(userId)) {
      activeSessions.get(userId).process.kill();
      activeSessions.delete(userId);
    }
    
    // Create config file
    const configPath = path.join(__dirname, 'configs', `${userId}.cjs`);
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
  USER_ID: "${userId}"
};\n`;
    
    fs.writeFileSync(configPath, configContent);
    
    // Start bot process
    const botProcess = spawn('node', ['bot.js', userId], {
      detached: true,
      stdio: 'ignore'
    });
    
    botProcess.unref();
    
    // Track session
    activeSessions.set(userId, {
      process: botProcess,
      startedAt: new Date(),
      lastActivity: new Date(),
      sessionId: sessionId.slice(0, 10) + '...' + sessionId.slice(-10)
    });
    
    res.json({ 
      success: true,
      message: 'Session deployed successfully',
      sessionId: sessionId.slice(0, 5) + '...' + sessionId.slice(-5)
    });
  } catch (error) {
    console.error('Deployment error:', error);
    res.status(500).json({ error: 'Failed to deploy session' });
  }
});

// Dashboard Route
app.get('/dashboard', authenticate, (req, res) => {
  const userId = req.session.userId;
  const sessionInfo = activeSessions.get(userId);
  
  if (!sessionInfo) {
    return res.json({ active: false });
  }
  
  res.json({
    active: sessionInfo.process.exitCode === null,
    uptime: Math.floor((new Date() - sessionInfo.startedAt) / 1000 / 60) + ' minutes',
    sessionId: sessionInfo.sessionId
  });
});

// Start Server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  
  // Start cleanup job
  setInterval(cleanupInactiveSessions, 60 * 60 * 1000); // Run hourly
});

// Cleanup Function
async function cleanupInactiveSessions() {
  const now = new Date();
  
  for (const [userId, session] of activeSessions.entries()) {
    if (now - session.lastActivity > 24 * 60 * 60 * 1000) { // 24h inactivity
      try {
        session.process.kill();
        activeSessions.delete(userId);
        
        // Notify user
        const email = await redisClient.hGet('user_emails', userId);
        if (email) {
          await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: email,
            subject: 'Session Terminated Due to Inactivity',
            text: `Your WhatsApp session was automatically terminated after 24 hours of inactivity.`
          });
        }
      } catch (error) {
        console.error('Cleanup error:', error);
      }
    }
  }
      }
