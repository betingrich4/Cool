import { createClient } from 'redis';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const redisClient = createClient();
await redisClient.connect();

async function cleanup() {
    // Cleanup old config files
    const configDir = path.join(__dirname, 'configs');
    if (fs.existsSync(configDir)) {
        fs.readdirSync(configDir).forEach(file => {
            const filePath = path.join(configDir, file);
            const stat = fs.statSync(filePath);
            
            // Delete files older than 7 days
            if (stat.mtime < new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)) {
                fs.unlinkSync(filePath);
            }
        });
    }
    
    // Cleanup old session files
    const sessionsDir = path.join(__dirname, 'sessions');
    if (fs.existsSync(sessionsDir)) {
        fs.readdirSync(sessionsDir).forEach(userDir => {
            const userPath = path.join(sessionsDir, userDir);
            const stat = fs.statSync(userPath);
            
            // Delete user directories older than 7 days
            if (stat.mtime < new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)) {
                fs.rmSync(userPath, { recursive: true, force: true });
            }
        });
    }
    
    console.log('Cleanup completed');
    process.exit(0);
}

cleanup();
