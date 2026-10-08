# Aemeath

Aemeath is a private community chat application for small groups. It combines servers, text channels, direct messages, voice rooms, camera calls, and screen sharing in one responsive web interface.

The production service is being moved to Cloudflare Workers.

## What it includes

- Account registration, login, and profile settings
- Private servers joined through expiring invitation links
- Text, forum, and voice channels
- Direct messages and voice/video calls
- Voice rooms for up to 30 participants
- Camera, screen sharing, theater view, picture-in-picture, and fullscreen viewing
- Microphone and shared tab/system audio as separate WebRTC tracks
- Listen-only voice access when a browser blocks microphone permission
- Compressed image attachments with preview, spoiler, replace, and remove controls
- Message actions, reactions, replies, bookmarks, text-to-speech, and image lightbox previews
- Desktop and mobile layouts

## Run locally

Requirements: Node.js 22.13 or newer and a PostgreSQL database such as Supabase.

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env.local` and add your database and WebRTC configuration.

3. Start development:

   ```bash
   npm run dev
   ```

4. Open the local address printed in the terminal.

## Environment variables

The application needs `DATABASE_URL` for PostgreSQL. Set `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET` to route group voice, camera, and screen sharing through LiveKit's SFU. TURN credentials remain available as a fallback for direct calls. See [.env.example](.env.example) for the available names.

Set `RESEND_API_KEY` and `AUTH_EMAIL_FROM` to require a six-digit email code before account creation and after every successful password login. Codes expire after 10 minutes and lock after five incorrect attempts. Without both variables, the existing password flow remains available so a missing mail configuration cannot lock out every account.

Never commit `.env` or `.env.local`.

## Cloudflare production

Create a production build with:

```bash
npm run build
```

Authenticate Wrangler once, create the Worker secrets, and deploy:

```bash
npx wrangler login
npx wrangler secret put DATABASE_URL --config dist/server/wrangler.json
npx wrangler secret put LIVEKIT_URL --config dist/server/wrangler.json
npx wrangler secret put LIVEKIT_API_KEY --config dist/server/wrangler.json
npx wrangler secret put LIVEKIT_API_SECRET --config dist/server/wrangler.json
npm run cloudflare:deploy
```

Run `npm run build` before the first `wrangler secret put` so
`dist/server/wrangler.json` exists. Optional mail and TURN settings use the same
`wrangler secret put NAME --config dist/server/wrangler.json` command. Preview
the Worker runtime with `npm run cloudflare:preview`.

## Browser behavior

- Chromium, Brave, Edge, Chrome, and modern mobile browsers provide the best WebRTC support.
- Steam's embedded browser may reject microphone or screen-capture permission. Aemeath keeps the user connected in listen-only mode when microphone permission is unavailable.
- Shared audio is available only when the browser and selected capture source provide an audio track. When sharing a browser tab, enable the browser's **Share tab audio** option.
- Mobile screen sharing depends on the device browser. If it is unavailable, camera streaming remains available.

## Main technology

- Next.js and React
- TypeScript
- PostgreSQL through Supabase
- WebRTC for voice, camera, and screen sharing
- Cloudflare Workers for production hosting

## Useful commands

```bash
npm run dev       # Start local development
npm run build     # Validate and create a production build
npm run cloudflare:preview # Preview using the remote Workers runtime
npm run cloudflare:deploy  # Build and deploy to Cloudflare Workers
npm run lint      # Run lint checks
```

## Privacy

Servers are private by invitation. Channel and voice access is checked against server membership on the backend. Uploaded chat attachments currently support compressed images only; video uploads are intentionally disabled.

## Desktop app

Aemeath also includes an Electron desktop client for Windows. It opens the production service in a dedicated Chromium window and supports microphone, camera, screen capture, and Windows loopback audio.

```bash
npm run desktop:dev    # Run the desktop client
npm run desktop:pack   # Create an unpacked application for testing
npm run desktop:build  # Create the Windows installer
```

The installer is written to `release/`. Set `AEMEATH_APP_URL` before launching if the desktop client should use a different Aemeath deployment.

## Android app

The Capacitor Android client lives in `android/` and connects to the production Aemeath service. Camera, microphone, image selection, notifications, and media-projection permissions are declared in its native manifest.

```bash
npm run android:sync   # Copy web configuration and update native plugins
npm run android:open   # Open the project in Android Studio
npm run android:build  # Build a debug APK with the installed Android SDK
```

The debug APK is written to `android/app/build/outputs/apk/debug/app-debug.apk`.
