# 🎭 Imposter Party Game — Full Stack Multiplayer

A thrilling, viral, mobile-first social deduction party game built with **React, TypeScript, Express, and Framer Motion**, optimized for same-room and online real-time gameplay.

One player is secretly the **Imposter** and does NOT know the secret topic. Everyone else (Normal Players) is shown the topic and must input clever subtle clues. After a high-tension discussion, players vote secretly to unveil the imposter or survive!

---

## 🛠️ Tech Stack & Architecture

- **Frontend**: React 19 (Vite), Tailwind CSS, Framer Motion for high-fidelity animations
- **Backend**: Express (Node.js/ESM) serving as a lightweight API and an authoritative state manager
- **Real-time Sync**: Authoritative Server-Sent Events (SSE) with automatic socket-level reconnection and player recovery
- **Sound Module**: Web Audio API (Synthesized countdowns, starts, wins, and loss bass lines)
- **AI Integration**: Google Gemini 3.5-flash with server-side SDK proxies and missing-key fallback guards
- **Relational Mapping**: Prisma schema matching PostgreSQL layouts
- **Deployment**: Docker containerization

---

## 🗺️ Key Real-Time SSE Architecture

The application bypasses complex socket connections by leveraging standard, highly resilient **Server-Sent Events (SSE)**.
1. When a client enters a room, they subscribe to `/api/room/:code/events?playerId=:id`.
2. The server keeps an active HTTP connection open.
3. Every authoritative timer tick or user action triggers a state change on the server, which then broadcasts the entire `Room` object as a serialized payload to all connected subscribers.
4. If a client’s network connection experiences jitter or a drop, the browser’s native `EventSource` automatically handles reconnection seamlessly without state desynchronization.

---

## 🚀 Local Quickstart Guide

### 1. Configure Secrets

Create a `.env` file in your root directory:

```env
PORT=3000
GEMINI_API_KEY="Your_Google_AI_Studio_API_Key"
DATABASE_URL="postgresql://user:password@localhost:5432/imposter_db"
```

### 2. Install Development Dependencies

```bash
# Install NPM packages
npm install
```

### 3. Launch Development Server

```bash
# Starts Express server which proxies Vite dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your mobile browser or emulator screen!

---

## 🐳 Docker Deployment

To build a production Docker image and launch:

```bash
docker build -t imposter-party-game .
docker run -p 3000:3000 --env-file .env imposter-party-game
```

---

## 🎭 Game Phase Walkthrough

### 1. Waiting Room (Lobby)
Invite online partners using the 6-letter room code (e.g. `KDXLRT`) or the invite-link copy button. Select standard category packs (General, Adult, Chaos, Internet, Family) or prompt the **Gemini AI Topic Engine** to generate custom items.

### 2. Private Role Reveal
Keep screens private. Tapping the mystery card displays your hidden identity. Imposter is alerted to blend in. Normal players receive the secret keyword safely.

### 3. Turn-Based Clue Phase
A 25-second active player indicator locks in. Players enter a single creative keyword describing the topic. Other players can select the reaction deck (😂, 🤔, 🤫, etc.) to trigger flying animated emojis across active screens!

### 4. Group Discussion
Lobby accusations, examine clue lists for contradictions, and discuss who is sounding out of sequence on our live synced forum.

### 5. Suspense Ballot Voting
Cast a blind secret ballot accusing the suspect. You cannot vote for yourself. A dramatic card flip highlights the most accused player.

### 6. Scoreboard Standing
Standings update dynamically as points are tallied. Host triggers "Next Round" safely resetting lobby parameters.
# Build-an-Imposter-Game-Clone-Party-Bluffing-App
