import dotenv from 'dotenv';
dotenv.config();

import {
    makeWASocket,
    fetchLatestBaileysVersion,
    DisconnectReason,
    useMultiFileAuthState,
    getContentType
} from '@adiwajshing/baileys';
import pino from 'pino';
import fs from 'fs';
import path from 'path';
import NodeCache from 'node-cache';
import { fileURLToPath } from 'url';
import { postToDashboard } from './utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get user ID from command line
const userId = process.argv[2];
if (!userId) {
    console.error('User ID is required');
    process.exit(1);
}

// Load config
const configPath = path.join(__dirname, 'configs', `${userId}.cjs`);
let config;
try {
    config = (await import(configPath)).default;
} catch (error) {
    console.error('Failed to load config:', error);
    process.exit(1);
}

const sessionDir = path.join(__dirname, 'sessions', userId);
const credsPath = path.join(sessionDir, 'creds.json');
const msgRetryCounterCache = new NodeCache();

if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true });
}

async function downloadSessionData() {
    if (!config.SESSION_ID) {
        console.error('SESSION_ID is not configured!');
        return false;
    }

    try {
        console.log("Downloading session data...");
        // Implement your session download logic here
        // For now, we'll just create an empty creds file
        fs.writeFileSync(credsPath, JSON.stringify({}));
        return true;
    } catch (error) {
        console.error('Failed to download session data:', error);
        return false;
    }
}

async function startBot() {
    try {
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
        const { version } = await fetchLatestBaileysVersion();

        const sock = makeWASocket({
            version,
            logger: pino({ level: 'silent' }),
            printQRInTerminal: false,
            browser: ["Auto-Deploy-Bot", "safari", "3.3"],
            auth: state,
            msgRetryCounterCache
        });

        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect } = update;
            
            if (connection === 'close') {
                if (lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut) {
                    console.log('Reconnecting...');
                    setTimeout(startBot, 5000);
                } else {
                    console.log('Connection closed, not reconnecting');
                    postToDashboard(userId, 'disconnected');
                }
            } else if (connection === 'open') {
                console.log("Bot connected successfully");
                postToDashboard(userId, 'connected');
            }
        });

        sock.ev.on('creds.update', saveCreds);

        // Auto Like Status
        sock.ev.on('messages.upsert', async (chatUpdate) => {
            try {
                const mek = chatUpdate.messages[0];
                if (!mek || !mek.message) return;

                const contentType = getContentType(mek.message);
                mek.message = (contentType === 'ephemeralMessage')
                    ? mek.message.ephemeralMessage.message
                    : mek.message;

                if (mek.key.remoteJid === 'status@broadcast' && config.AUTO_STATUS_REACT === "true") {
                    const userJid = sock.user?.id;
                    if (!userJid) return;

                    const emojiList = ['❤️', '😇', '💯', '🔥', '💎', '💗', '🤍', '👀', '🥰', '😎'];
                    const randomEmoji = emojiList[Math.floor(Math.random() * emojiList.length)];

                    await sock.sendMessage(mek.key.remoteJid, {
                        react: {
                            text: randomEmoji,
                            key: mek.key,
                        }
                    });

                    console.log(`Auto-reacted to status with: ${randomEmoji}`);
                    postToDashboard(userId, 'status_reacted');
                }
            } catch (err) {
                console.error("Auto Like Status Error:", err);
            }
        });

        // Handle process termination
        process.on('SIGTERM', () => {
            console.log('Received SIGTERM, cleaning up...');
            sock.end();
            process.exit(0);
        });

        process.on('SIGINT', () => {
            console.log('Received SIGINT, cleaning up...');
            sock.end();
            process.exit(0);
        });

    } catch (error) {
        console.error('Critical Error:', error);
        postToDashboard(userId, 'error', error.message);
        process.exit(1);
    }
}

async function init() {
    if (fs.existsSync(credsPath)) {
        console.log("Session file found, starting bot...");
        await startBot();
    } else {
        const sessionDownloaded = await downloadSessionData();
        if (sessionDownloaded) {
            await startBot();
        } else {
            console.log("Failed to initialize session");
            postToDashboard(userId, 'init_failed');
            process.exit(1);
        }
    }
}

init();
