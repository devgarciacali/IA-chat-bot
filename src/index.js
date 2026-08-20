import 'dotenv/config';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileFromPath } from 'openai/uploads';
import Groq from 'groq-sdk';
import qrcode from 'qrcode-terminal';
import pkg from 'whatsapp-web.js';

const { Client, LocalAuth } = pkg;

const config = {
  botName: env('BOT_NAME', 'Codex'),
  userName: env('USER_NAME', 'Jose'),
  groqApiKey: env('GROQ_API_KEY'),
  chatModel: env('GROQ_MODEL', 'groq/compound-mini'),
  audioModel: env('GROQ_AUDIO_MODEL', 'whisper-large-v3-turbo'),
  allowedChats: parseList(process.env.ALLOWED_CHATS || process.env.ALLOWED_NUMBER),
  maxHistoryMessages: Number(env('MAX_HISTORY_MESSAGES', '12')),
  autoReplyEnabled: env('AUTO_REPLY_ENABLED', 'true').toLowerCase() === 'true',
  autoReplyMessage: env('AUTO_REPLY_MESSAGE', 'Un momento, el master no esta en linea, pero en un momento te responde.'),
  autoReplyCooldownMs: Number(env('AUTO_REPLY_COOLDOWN_MINUTES', '30')) * 60 * 1000,
  personality: env(
    'BOT_PERSONALITY',
    'Eres cercano, claro y practico. Conversas como asistente personal de confianza en español.'
  )
};

if (!config.groqApiKey) {
  console.error('Falta GROQ_API_KEY en .env');
  process.exit(1);
}

const groq = new Groq({ apiKey: config.groqApiKey });
const conversations = new Map();
const autoReplyLog = new Map();
const botStartedAtSeconds = Math.floor(Date.now() / 1000);

const client = new Client({
  authStrategy: new LocalAuth({ clientId: 'codex-bot' }),
  webVersionCache: {
    type: 'remote',
    remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html'
  },
  puppeteer: {
    headless: false,
    args: [
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--disable-extensions',
      '--no-first-run',
      '--no-default-browser-check'
    ]
  }
});

client.on('qr', (qr) => {
  qrcode.generate(qr, { small: true });
  console.log('Escanea este QR con WhatsApp > Dispositivos vinculados.');
});

client.on('ready', () => {
  console.log(`${config.botName} listo. Escribe texto o manda audio por WhatsApp.`);
  console.log(`Modelo de chat: ${config.chatModel}`);
  console.log(`Modelo de audio: ${config.audioModel}`);
  console.log(`Chats permitidos: ${config.allowedChats.join(', ') || 'todos'}`);
});

client.on('message', async (message) => {
  try {
    if (message.fromMe) {
      return;
    }

    if (message.from === 'status@broadcast') {
      return;
    }

    console.log(`Mensaje recibido de: ${message.from}`);

    if (!isAllowed(message.from)) {
      await handleAutoReply(message);
      return;
    }

    const userText = await readIncomingText(message);
    console.log(`Texto detectado: ${userText || '[vacio]'}`);

    if (!userText) {
      await sendReply(message, 'No pude leer ese mensaje. Mandame texto o audio.');
      return;
    }

    const answer = await generateAnswer(message.from, userText);
    await sendReply(message, answer);
  } catch (error) {
    console.error('Error procesando mensaje:', readableError(error));
    await sendReply(message, 'Tuve un error procesando el mensaje. Revisa la terminal para ver el detalle.');
  }
});

function env(name, fallback = '') {
  return process.env[name]?.trim() || fallback;
}

function parseList(value) {
  return (value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function isAllowed(chatId) {
  return config.allowedChats.length === 0 || config.allowedChats.includes(chatId);
}

async function handleAutoReply(message) {
  if (!config.autoReplyEnabled) {
    console.log(`Ignorado: chat no autorizado. Recibido: ${message.from}`);
    return;
  }

  if (message.timestamp && message.timestamp < botStartedAtSeconds) {
    console.log('Auto-respuesta omitida: mensaje viejo de ' + message.from);
    return;
  }

  if (message.from.endsWith('@g.us')) {
    console.log(`Ignorado: grupo no autorizado. Recibido: ${message.from}`);
    return;
  }

  const now = Date.now();
  const lastReplyAt = autoReplyLog.get(message.from) || 0;

  if (now - lastReplyAt < config.autoReplyCooldownMs) {
    console.log(`Auto-respuesta omitida por cooldown: ${message.from}`);
    return;
  }

  autoReplyLog.set(message.from, now);
  console.log(`Auto-respuesta enviada a chat no autorizado: ${message.from}`);
  await sendReply(message, config.autoReplyMessage);
}

async function generateAnswer(chatId, userText) {
  const history = getHistory(chatId);
  history.push({ role: 'user', content: userText });
  trimHistory(history);

  console.log('Enviando mensaje a Groq...');

  const response = await groq.chat.completions.create({
    model: config.chatModel,
    messages: [
      { role: 'system', content: buildSystemPrompt() },
      ...history
    ]
  });

  const answer = response.choices[0]?.message?.content?.trim() || 'No pude generar respuesta.';
  history.push({ role: 'assistant', content: answer });
  trimHistory(history);

  console.log(`Respuesta generada: ${answer}`);
  return answer;
}

function buildSystemPrompt() {
  return `Te llamas ${config.botName}. Estas conversando por WhatsApp con ${config.userName}. ${config.personality}

Reglas:
- Responde natural, como chat de WhatsApp.
- Se breve cuando la pregunta sea simple.
- Si ${config.userName} pide pasos tecnicos, dalos claros y en orden.
- No digas que eres un modelo de IA salvo que sea necesario.
- Si no sabes algo, dilo y pide el dato que falta.`;
}

function getHistory(chatId) {
  if (!conversations.has(chatId)) {
    conversations.set(chatId, []);
  }

  return conversations.get(chatId);
}

function trimHistory(history) {
  while (history.length > config.maxHistoryMessages) {
    history.shift();
  }
}

async function sendReply(message, text) {
  try {
    await message.reply(text);
    console.log('Respuesta enviada con message.reply().');
  } catch (replyError) {
    console.error('Fallo message.reply(); intentando client.sendMessage():', readableError(replyError));
    await client.sendMessage(message.from, text);
    console.log('Respuesta enviada con client.sendMessage().');
  }
}

async function readIncomingText(message) {
  if (!message.hasMedia) {
    return message.body?.trim();
  }

  const media = await message.downloadMedia();

  if (!media?.mimetype?.startsWith('audio/')) {
    return message.body?.trim();
  }

  return transcribeAudio(media);
}

async function transcribeAudio(media) {
  const extension = getAudioExtension(media.mimetype);
  const audioPath = path.join(os.tmpdir(), `wa-audio-${Date.now()}.${extension}`);

  await fs.writeFile(audioPath, Buffer.from(media.data, 'base64'));

  try {
    console.log('Transcribiendo audio con Groq...');

    const transcription = await groq.audio.transcriptions.create({
      file: await fileFromPath(audioPath),
      model: config.audioModel
    });

    return transcription.text?.trim();
  } finally {
    await fs.rm(audioPath, { force: true });
  }
}

function getAudioExtension(mimetype) {
  if (mimetype.includes('ogg')) return 'ogg';
  if (mimetype.includes('webm')) return 'webm';
  if (mimetype.includes('wav')) return 'wav';
  if (mimetype.includes('m4a')) return 'm4a';
  return 'mp3';
}

function readableError(error) {
  return error?.stack || error?.message || String(error);
}

client.initialize();







