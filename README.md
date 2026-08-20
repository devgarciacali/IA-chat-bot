# WhatsApp Codex Bot

Bot local para conversar por WhatsApp Web. Recibe texto o audio, transcribe audios con OpenAI y responde por WhatsApp.

## Requisitos

- Node.js 18 o superior
- Google Chrome instalado
- Una API key de OpenAI

## Instalacion

1. Abre una terminal en esta carpeta:

```powershell
cd "$env:USERPROFILE\whatsapp-codex-bot"
```

2. Instala dependencias:

```powershell
npm install
```

3. Copia `.env.example` a `.env` y pon tu API key:

```powershell
copy .env.example .env
notepad .env
```

4. Ejecuta el bot:

```powershell
npm start
```

5. Escanea el QR con WhatsApp:

WhatsApp > Dispositivos vinculados > Vincular dispositivo.

## Numero permitido

`ALLOWED_NUMBER` evita que cualquiera que te escriba use el bot. Para obtener tu numero en formato WhatsApp, ejecuta el bot una vez y manda un mensaje; en la consola aparecera el identificador.

Para pruebas puedes dejar `ALLOWED_NUMBER` vacio, pero no es recomendable.
