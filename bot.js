import { makeWASocket, useMultiFileAuthState, delay } from '@whiskeysockets/baileys';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const deploymentId = process.argv[2];
if (!deploymentId) {
  console.error('Deployment ID is required');
  process.exit(1);
}

const deploymentDir = path.join(__dirname, 'deployments', deploymentId);
const config = JSON.parse(fs.readFileSync(path.join(deploymentDir, 'config.json')));

console.log('Starting WhatsApp bot...');

try {
  const { state, saveCreds } = await useMultiFileAuthState(path.join(deploymentDir, 'auth'));

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    logger: { level: 'silent' }
  });

  console.log('Connecting to WhatsApp...');

  sock.ev.on('connection.update', (update) => {
    if (update.connection === 'open') {
      console.log('Successfully connected to WhatsApp!');
      console.log('Ready to view and react to status updates');
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const statusMsg = messages.find(m => m.key.remoteJid === 'status@broadcast');
    
    if (statusMsg) {
      try {
        console.log('New status detected');
        
        // 1. First mark as viewed
        console.log('Marking status as read...');
        await sock.readMessages([statusMsg.key]);
        await delay(1000); // Ensure status is marked read
        
        // 2. Then react
        console.log('Reacting to status...');
        const reactions = ['❤️', '🔥', '👍', '😍', '👀', '🎉'];
        const randomReaction = reactions[Math.floor(Math.random() * reactions.length)];
        
        await sock.sendMessage(statusMsg.key.remoteJid, {
          react: {
            text: randomReaction,
            key: statusMsg.key
          }
        });
        
        console.log(`Reacted with ${randomReaction} to status`);
      } catch (error) {
        console.error('Error handling status:', error.message);
      }
    }
  });

  // Keep process alive
  setInterval(() => {}, 1000);

} catch (error) {
  console.error('Bot initialization failed:', error);
  process.exit(1);
}
