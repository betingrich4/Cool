import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/deploy', async (req, res) => {
    const { sessionId } = req.body;
    
    if (!sessionId) {
        return res.status(400).json({ success: false, message: 'Session ID is required' });
    }

    try {
        // Save session ID to config file
        const configPath = path.join(__dirname, 'config.cjs');
        let configContent = `module.exports = {\n`;
        configContent += `    SESSION_ID: "${sessionId}",\n`;
        configContent += `    AUTO_STATUS_REACT: "true",\n`;
        configContent += `    AUTO_REACT: false,\n`;
        configContent += `    MODE: "private",\n`;
        configContent += `    PREFIX: "."\n`;
        configContent += `};\n`;
        
        fs.writeFileSync(configPath, configContent);
        
        // Start the bot in a separate process
        const botProcess = spawn('node', ['bot.js'], {
            detached: true,
            stdio: 'ignore'
        });
        
        botProcess.unref();
        
        res.json({ success: true, message: 'Session deployed successfully' });
    } catch (error) {
        console.error('Deployment error:', error);
        res.status(500).json({ success: false, message: 'Failed to deploy session' });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
