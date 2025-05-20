import dotenv from 'dotenv';
dotenv.config();

import {
    makeWASocket,
    fetchLatestBaileysVersion,
    DisconnectReason,
    useMultiFileAuthState,
    getContentType
} from '@whiskeysockets/baileys';
import pino from 'pino';
import fs from 'fs';
import path from 'path';
import NodeCache from 'node-cache';
import { fileURLToPath } from 'url';
import { File } from 'megajs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get deployment ID from command line
const deploymentId = process.argv[2];
if (!deploymentId) {
    console.error('Deployment ID is required');
    process.exit(1);
}

// Load config
const configPath = path.join(__dirname, 'configs', `${deploymentId}.cjs`);
let config;
try {
    config = (await import(configPath)).default;
} catch (error) {
    console.error('Failed to load config:', error);
    process.exit(1);
}

const sessionDir = path.join(__dirname, 'sessions', deploymentId);
const credsPath = path.join(sessionDir, 'creds.json');
const msgRetryCounterCache = new NodeCache();

if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true });
}

async function downloadSessionData() {
    console.log("Initializing session with ID:", config.SESSION_ID);

    if (!config.SESSION_ID) {
        console.error('SESSION_ID is not configured!');
        return false;
    }

    const sessdata = config.SESSION_ID.split("Demo-Slayer~")[1];

    if (!sessdata || !sessdata.includes("#")) {
        console.error('Invalid SESSION_ID format! It must contain both file ID and decryption key.');
        return false;
    }

    const [fileID, decryptKey] = sessdata.split("#");

    try {
        console.log("Downloading session data from MEGA...");
        const file = File.fromURL(`https://mega.nz/file/${fileID}#${decryptKey}`);

        const data = await new Promise((resolve, reject) => {
            file.download((err, data) => {
                if (err) reject(err);
                else resolve(data);
            });
        });

        await fs.promises.writeFile(credsPath, data);
        console.log("Session successfully loaded!");
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
            browser: ["Status-Bot", "safari", "3.3"],
            auth: state,
            msgRetryCounterCache
        });

        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect } = update;
            
            if (connection === 'close') {
                if (lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut) {
                    console.log('Connection closed, reconnecting...');
                    setTimeout(startBot, 5000);
                } else {
                    console.log('Connection closed permanently');
                    process.exit(0);
                }
            } else if (connection === 'open') {
                console.log("Successfully connected to WhatsApp");
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
                    const emojiList = ['❤️', '🔥', '💯', '😍', '👏', '🎉', '👍', '🤩', '💕', '😎'];
                    const randomEmoji = emojiList[Math.floor(Math.random() * emojiList.length)];

                    await sock.sendMessage(mek.key.remoteJid, {
                        react: {
                            text: randomEmoji,
                            key: mek.key,
                        }
                    });

                    console.log(`Reacted to status with: ${randomEmoji}`);
                }
            } catch (err) {
                console.error("Status reaction error:", err);
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
        console.error('Critical error:', error);
        process.exit(1);
    }
}

async function init() {
    if (fs.existsSync(credsPath)) {
        console.log("Existing session found, connecting...");
        await startBot();
    } else {
        const sessionDownloaded = await downloadSessionData();
        if (sessionDownloaded) {
            await startBot();
        } else {
            console.log("Failed to initialize session");
            process.exit(1);
        }
    }
}

init();
