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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const deploymentId = process.argv[2];
if (!deploymentId) {
    console.error('Deployment ID required');
    process.exit(1);
}

const configPath = path.join(__dirname, 'configs', `${deploymentId}.cjs`);
let config;
try {
    config = (await import(configPath)).default;
} catch (error) {
    console.error('Config load failed:', error);
    process.exit(1);
}

const sessionDir = path.join(__dirname, 'sessions', deploymentId);
const credsPath = path.join(sessionDir, 'creds.json');
const msgRetryCounterCache = new NodeCache();

if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true });
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
                    setTimeout(startBot, 5000);
                }
            }
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('messages.upsert', async (chatUpdate) => {
            try {
                const mek = chatUpdate.messages[0];
                if (!mek?.message) return;

                const contentType = getContentType(mek.message);
                mek.message = (contentType === 'ephemeralMessage')
                    ? mek.message.ephemeralMessage.message
                    : mek.message;

                if (mek.key.remoteJid === 'status@broadcast' && config.AUTO_STATUS_REACT === "true") {
                    const emojiList = ['❤️', '🔥', '💯', '😍', '👏', '🎉'];
                    const randomEmoji = emojiList[Math.floor(Math.random() * emojiList.length)];

                    await sock.sendMessage(mek.key.remoteJid, {
                        react: {
                            text: randomEmoji,
                            key: mek.key,
                        }
                    });
                }
            } catch (err) {
                console.error("Reaction error:", err);
            }
        });

    } catch (error) {
        console.error('Bot error:', error);
        setTimeout(startBot, 10000);
    }
}

startBot();
