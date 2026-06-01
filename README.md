# Void

Void is a browser-based peer-to-peer file transfer app. Two people open the app, connect with a room code or secure link, and transfer files directly between their browsers. Files are never uploaded to a server. PeerJS is used only for hosted WebRTC signaling.

## Use It

1. Open Void.
2. The sender shares the secure link, scans the QR code, or copies the room code.
3. The receiver opens the link or enters the room code.
4. Once connected, drop files into the app or browse for files.
5. Files transfer one at a time with per-file progress, speed, ETA, checksum verification, and automatic download when complete.

The clipboard box syncs text in real time after both peers connect. Paste links, snippets, or short secrets there when you need to move text between devices.

## Privacy

- No backend server is included.
- No accounts, analytics, or tracking are included.
- File chunks are encrypted in the browser with AES-GCM before sending.
- Clipboard messages are encrypted with the same room key.
- The encryption key is stored in the URL fragment, which is not sent to web servers.
- PeerJS Cloud is used for signaling only; file data goes over the WebRTC data channel directly between peers.

## Resuming Transfers

Void stores incomplete received chunks in IndexedDB. If a connection drops, reconnect with the same sender and Void asks for the next missing chunk. If the sender reloads and loses the original `File` object, Void prompts them to re-select the same file so the transfer can continue from the last acknowledged chunk.

## Deploy Your Own Copy

Fork this repository and push to `main`. GitHub Actions installs dependencies, builds the Vite app, and deploys `dist` to GitHub Pages with no backend or manual build step.

Local development:

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
```
