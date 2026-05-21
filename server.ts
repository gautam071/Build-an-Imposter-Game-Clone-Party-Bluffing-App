import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';
import { Room, Player, RoomStatus, FloatingReaction, Message } from './src/types.js';

const app = express();
const PORT = 3000;

app.use(express.json());

// In-memory records
const rooms = new Map<string, Room>();
const sseClients = new Map<string, Array<{ playerId: string; res: any }>>();
const roomMessages = new Map<string, Message[]>();

// Deeply seed amazing topic packs with hilarious items
const TOPIC_PACKS: Record<string, string[]> = {
  general: [
    'Pizza', 'Elon Musk', 'Gym', 'Tinder', 'Horror Movies', 'AI', 'School Teachers',
    'Bitcoin', 'Starbucks', 'TikTok', 'Disney', 'Homework', 'Superheroes',
    'Dating Apps', 'Fortnite', 'Grandmas', 'Shopping Mall', 'Reality TV', 'Camping',
    'K-Pop', 'Monopoly', 'Airport Security', 'Spaghetti', 'Fast Food', 'Siri'
  ],
  family: [
    'Toothbrush', 'Socks', 'Ice Cream', 'Bicycle', 'Fluffy Puppies', 'Washing Machine',
    'Backpack', 'Pancakes', 'Board Games', 'Car Trip', 'Camping', 'School Bus',
    'Rainy Day', 'Zoo', 'Popcorn', 'Hot Chocolate', 'Sledding', 'Treehouse', 'Sandbox'
  ],
  adult: [
    'Hangover', 'One-night Stand', 'OnlyFans', 'Tax Fraud', 'Bachelorette Party',
    'Red Flags', 'Morning After', 'Midlife Crisis', 'Divorce Court', 'In-laws',
    'Corporate Greed', 'Pre-gaming', 'Silent Treatment', 'Passive Aggressiveness',
    'Dreaded Meeting', 'Therapy Sessions', 'Credit Card Debt', 'Drunk Texting'
  ],
  funny: [
    'Banana Peels', 'Awkward Silence', 'Screaming in Public', 'Stubbing a Toe',
    'Accidental Reply-All', 'Forgotten Passwords', 'Ugly Crocs', 'Pineapple on Pizza',
    'Sneezing in a Quiet Room', 'Selfie Stick', 'An Angry Cat', 'Public Transit Sleepers',
    'Dad Jokes', 'Uncomfortable Handshakes', 'Typo in a Bio', 'Bad Hair Day'
  ],
  internet: [
    'Rickroll', 'Doge Meme', 'Brainrot', 'Keyboard Warriors', 'ASMR', 'Vloggers',
    'Canceling', 'Clickbait', 'Cat Videos', 'Influencer Apology', 'Spam Folder',
    'Gamer Rage', '10-Hour Loop', 'Autocorrect Fails', 'Unboxing Videos',
    'Only Slime Videos', 'Clicking "I am a Robot"', 'Unsubscribed'
  ]
};

// Lazy initialization of Gemini client
let aiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI | null {
  if (aiClient) return aiClient;
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    console.warn('GEMINI_API_KEY is not defined. AI Category generation will fallback to random seed lists.');
    return null;
  }
  try {
    aiClient = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build'
        }
      }
    });
    return aiClient;
  } catch (err) {
    console.error('Failed to initialize GoogleGenAI client:', err);
    return null;
  }
}

// Generate code
function generateRoomCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Broadcast room state to all connected SSE clients
function broadcastRoom(code: string, extraData?: any) {
  const room = rooms.get(code);
  if (!room) return;
  const clients = sseClients.get(code) || [];
  const payload = JSON.stringify({ room, messages: roomMessages.get(code) || [], ...extraData });
  clients.forEach((c) => {
    try {
      c.res.write(`data: ${payload}\n\n`);
    } catch (e) {
      // client stale
    }
  });
}

// Handle transition triggers when timer expires or manual early pass
function handleStateTimeout(room: Room) {
  room.lastActive = Date.now();
  
  if (room.status === 'role_reveal') {
    // Go to clue phase
    room.status = 'clue_phase';
    room.activeCluePlayerIndex = 0;
    room.timerMax = 25;
    room.timerSeconds = 25;
    
    // Clear all player clues
    room.players.forEach((p) => {
      p.clue = '';
      p.votedFor = undefined;
      p.pointsEarnedThisRound = 0;
    });

    addSystemMessage(room.code, '🔎 Clue Phase started! Submit a clue when it is your turn.');
    
  } else if (room.status === 'clue_phase') {
    const activePlayer = room.players[room.activeCluePlayerIndex];
    if (activePlayer && !activePlayer.clue) {
      activePlayer.clue = '🤐 Thought too long... No Clue!';
    }
    
    if (room.activeCluePlayerIndex < room.players.length - 1) {
      room.activeCluePlayerIndex++;
      room.timerMax = 25;
      room.timerSeconds = 25;
    } else {
      // Clues completed, transition to Discussion
      room.status = 'discussion';
      room.timerMax = 50;
      room.timerSeconds = 50;
      addSystemMessage(room.code, '🗣️ Clues are in! Discussion Phase is now open.');
    }
    
  } else if (room.status === 'discussion') {
    // Transition to Voting
    room.status = 'voting';
    room.timerMax = 35;
    room.timerSeconds = 35;
    addSystemMessage(room.code, '🗳️ Voting Phase started! Blindly submit your vote for who you think the Imposter is.');
    
  } else if (room.status === 'voting') {
    // Transition to Reveal! Calculate scores!
    calculateRoundScores(room);
    room.status = 'reveal';
    room.timerMax = 15;
    room.timerSeconds = 15;
    
  } else if (room.status === 'reveal') {
    // Transition to Scoreboard
    room.status = 'scoreboard';
    room.timerSeconds = 0;
    room.timerMax = 0;
  }
  
  broadcastRoom(room.code);
}

// Score calculation logic
function calculateRoundScores(room: Room) {
  const imposter = room.players.find((p) => p.id === room.imposterId);
  if (!imposter) return;

  // Track vote counts
  const voteCounts: Record<string, number> = {};
  room.players.forEach((p) => {
    if (p.votedFor) {
      voteCounts[p.votedFor] = (voteCounts[p.votedFor] || 0) + 1;
    }
  });

  const imposterVotes = voteCounts[room.imposterId] || 0;
  const totalVotesCast = room.players.filter(p => p.votedFor).length;

  let caught = false;
  // If the majority of cast votes are on the imposter, they are caught!
  if (imposterVotes >= Math.ceil(room.players.length / 2)) {
    caught = true;
  }

  room.players.forEach((p) => {
    p.pointsEarnedThisRound = 0;

    if (p.id === room.imposterId) {
      if (!caught) {
        // Imposter blended in successfully!
        if (imposterVotes === 0) {
          p.pointsEarnedThisRound = 25; // Perfect blending
          p.score += 25;
          addSystemMessage(room.code, `🌟 Master Imposter! Nobody suspecting ${p.name}. Imposter scores +25 XP!`);
        } else {
          p.pointsEarnedThisRound = 15;
          p.score += 15;
          addSystemMessage(room.code, `🤫 ${p.name} blended in and fooled the party! Imposter scores +15 XP!`);
        }
      } else {
        p.pointsEarnedThisRound = 0;
        addSystemMessage(room.code, `💥 Caught! Imposter ${p.name} received ${imposterVotes} votes and scores 0 XP.`);
      }
    } else {
      // Normal players
      if (p.votedFor === room.imposterId) {
        p.pointsEarnedThisRound = 10;
        p.score += 10;
      } else {
        p.pointsEarnedThisRound = 0;
      }
    }
  });
}

function addSystemMessage(roomCode: string, text: string) {
  const list = roomMessages.get(roomCode) || [];
  const systemMsg: Message = {
    id: Math.random().toString(),
    senderId: 'SYSTEM',
    senderName: 'Host',
    text,
    createdAt: Date.now(),
    isSystem: true
  };
  list.push(systemMsg);
  roomMessages.set(roomCode, list);
}

// Background cleanup and tick
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms.entries()) {
    // Auto cleanup room after 3 hours
    if (now - room.lastActive > 3 * 60 * 60 * 1000) {
      rooms.delete(code);
      sseClients.delete(code);
      roomMessages.delete(code);
      console.log(`Cleaned up stale room ${code}`);
      continue;
    }

    // Server-side active timer updates
    if (room.status !== 'waiting' && room.status !== 'scoreboard') {
      if (room.timerSeconds > 0) {
        room.timerSeconds--;
        broadcastRoom(code);
      } else {
        handleStateTimeout(room);
      }
    }
  }
}, 1000);

// API REST Endpoints

// 1. Create Room
app.post('/api/room/create', async (req, res) => {
  const { hostName, avatar, topicPack } = req.body;
  if (!hostName) {
    return res.status(400).json({ error: 'Host name is required' });
  }

  const code = generateRoomCode();
  const playerId = 'p-' + Math.random().toString(36).substring(2, 9);
  
  const host: Player = {
    id: playerId,
    name: hostName,
    avatar: avatar || '🥸',
    score: 0,
    isHost: true,
    isConnected: true,
    isReady: true
  };

  const newRoom: Room = {
    code,
    status: 'waiting',
    players: [host],
    topicPack: topicPack || 'general',
    secretTopic: '',
    imposterId: '',
    activeRound: 0,
    activeCluePlayerIndex: 0,
    timerSeconds: 0,
    timerMax: 0,
    lastActive: Date.now()
  };

  rooms.set(code, newRoom);
  roomMessages.set(code, []);
  addSystemMessage(code, `🎉 Room created! Share the code [${code}] with your friends.`);

  res.json({ code, playerId, player: host });
});

// 2. Join Room
app.post('/api/room/join', (req, res) => {
  const { code, name, avatar, playerId: existingId } = req.body;
  if (!code || !name) {
    return res.status(400).json({ error: 'Code and name are required' });
  }

  const upperCode = code.toUpperCase();
  const room = rooms.get(upperCode);
  if (!room) {
    return res.status(404).json({ error: 'Game room not found.' });
  }

  if (room.status !== 'waiting') {
    // Check if player is rejoining
    const ext = room.players.find((p) => p.name.toLowerCase() === name.toLowerCase());
    if (ext) {
      ext.isConnected = true;
      return res.json({ code: upperCode, playerId: ext.id, player: ext });
    }
    return res.status(400).json({ error: 'Match has already started. Spectate or wait for lobby.' });
  }

  // Check unique username inside room
  if (room.players.some((p) => p.name.toLowerCase() === name.toLowerCase() && p.id !== existingId)) {
    return res.status(400).json({ error: 'Username already taken in this lobby.' });
  }

  // Support 4-8 players, but allow test joins up to 12
  if (room.players.length >= 12) {
    return res.status(400).json({ error: 'Room is full' });
  }

  const playerId = existingId || 'p-' + Math.random().toString(36).substring(2, 9);
  
  // Exists?
  let playerObj = room.players.find((p) => p.id === playerId);
  if (playerObj) {
    playerObj.isConnected = true;
  } else {
    playerObj = {
      id: playerId,
      name,
      avatar: avatar || '😎',
      score: 0,
      isHost: false,
      isConnected: true,
      isReady: false
    };
    room.players.push(playerObj);
    addSystemMessage(upperCode, `👋 ${name} joined the party!`);
  }

  room.lastActive = Date.now();
  broadcastRoom(upperCode);

  res.json({ code: upperCode, playerId, player: playerObj });
});

// 3. Toggle Ready
app.post('/api/room/:code/toggle-ready', (req, res) => {
  const code = req.params.code.toUpperCase();
  const { playerId } = req.body;
  const room = rooms.get(code);

  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }

  const p = room.players.find(p => p.id === playerId);
  if (p) {
    p.isReady = !p.isReady;
    room.lastActive = Date.now();
    broadcastRoom(code);
  }

  res.json({ success: true });
});

// 4. AIS-Generates topics or fallback
app.post('/api/ai/generate-topics', async (req, res) => {
  const { theme } = req.body;
  const client = getGeminiClient();
  
  if (!client) {
    // Mock cool lists based on customized themes or a quick algorithm
    const mockTopics = [
      `${theme || 'AI'} Hackathon`,
      `${theme || 'Space'} Exploration`,
      'Midnight Snack',
      'Virtual Reality',
      'Karaoke Night'
    ];
    return res.json({ topics: mockTopics });
  }

  try {
    const prompt = `Write a list of exactly 6 unique, clear, simple, and funny topic nouns or phrases for a party game about the theme: "${theme || 'general party vibe'}". Ensure they are universally understood and extremely funny. Return the output in strict valid JSON format. Example format: ["Pizza", "Elon Musk", "Pineapple on pizza"]`;
    
    const response = await client.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.ARRAY,
          items: { type: Type.STRING }
        }
      }
    });

    const bodyText = response.text || '[]';
    const topics = JSON.parse(bodyText.trim());
    res.json({ topics });
  } catch (error) {
    console.error('Gemini generate-topics error:', error);
    res.status(500).json({ error: 'Failed to generate topics securely.' });
  }
});

// 5. Start Game Match
app.post('/api/room/:code/start', async (req, res) => {
  const code = req.params.code.toUpperCase();
  const { topicPack, customTheme } = req.body;
  const room = rooms.get(code);

  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }

  if (room.players.length < 2) {
    return res.status(400).json({ error: 'You need at least 2 players to start!' });
  }

  // Topic selection
  let topic = 'Pizza';
  if (topicPack === 'custom' && customTheme) {
    // Generate topic dynamically!
    const client = getGeminiClient();
    if (client) {
      try {
        const response = await client.models.generateContent({
          model: 'gemini-3.5-flash',
          contents: `Generate ONE funny, popular, or controversial topic noun or short phrase inspired by the subtheme/ideas of: "${customTheme}". Make it directly guessable but subtle. For example, "Toothbrush" or "Meme Lord". Output only the topic name directly, without punctuation.`,
        });
        topic = (response.text || 'Pizza').trim().replace(/['"“”]/g, '');
      } catch (err) {
        // Fallback
        topic = customTheme;
      }
    } else {
      topic = customTheme;
    }
  } else {
    const list = TOPIC_PACKS[topicPack] || TOPIC_PACKS.general;
    topic = list[Math.floor(Math.random() * list.length)];
  }

  // Select Imposter
  const imposterIndex = Math.floor(Math.random() * room.players.length);
  const imposter = room.players[imposterIndex];

  room.imposterId = imposter.id;
  room.secretTopic = topic;
  room.topicPack = topicPack;
  room.activeRound++;
  room.status = 'role_reveal';
  room.timerMax = 12; // 12 seconds reveal
  room.timerSeconds = 12;
  room.lastActive = Date.now();

  // Reset players
  room.players.forEach((p) => {
    p.role = p.id === imposter.id ? 'imposter' : 'player';
    p.clue = '';
    p.votedFor = undefined;
    p.pointsEarnedThisRound = 0;
  });

  // Reset Messages
  roomMessages.set(code, []);
  addSystemMessage(code, `🎬 Game Started! A secret topic was chosen.`);

  broadcastRoom(code);
  res.json({ success: true });
});

// 6. Submit Clue
app.post('/api/room/:code/clue', (req, res) => {
  const code = req.params.code.toUpperCase();
  const { playerId, clue } = req.body;
  const room = rooms.get(code);

  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }

  const activePlayer = room.players[room.activeCluePlayerIndex];
  if (!activePlayer || activePlayer.id !== playerId) {
    return res.status(400).json({ error: 'Not your turn to submit a clue!' });
  }

  activePlayer.clue = clue ? clue.trim() : '🤫 Mute';
  addSystemMessage(code, `✍️ ${activePlayer.name} submitted a clue!`);

  // Advance to next or Discussion
  if (room.activeCluePlayerIndex < room.players.length - 1) {
    room.activeCluePlayerIndex++;
    room.timerMax = 25;
    room.timerSeconds = 25;
  } else {
    room.status = 'discussion';
    room.timerMax = 50;
    room.timerSeconds = 50;
    addSystemMessage(code, '🗣️ Clues are in! Discussion Phase is open.');
  }

  room.lastActive = Date.now();
  broadcastRoom(code);
  res.json({ success: true });
});

// 7. Dynamic Emoji React / Chat
app.post('/api/room/:code/react', (req, res) => {
  const code = req.params.code.toUpperCase();
  const { emoji, playerName } = req.body;
  if (!emoji || !playerName) {
    return res.status(400).json({ error: 'Emoji and Player name required' });
  }

  const react: FloatingReaction = {
    id: Math.random().toString(),
    emoji,
    playerName,
    createdAt: Date.now()
  };

  broadcastRoom(code, { reaction: react });
  res.json({ success: true });
});

// 8. Submit Chat Message
app.post('/api/room/:code/message', (req, res) => {
  const code = req.params.code.toUpperCase();
  const { senderId, senderName, text } = req.body;
  
  const room = rooms.get(code);
  if (!room) return res.status(404).json({ error: 'Room not found' });

  const list = roomMessages.get(code) || [];
  const msg: Message = {
    id: Math.random().toString(),
    senderId,
    senderName,
    text: text ? text.trim() : '',
    createdAt: Date.now(),
  };

  list.push(msg);
  roomMessages.set(code, list);

  broadcastRoom(code);
  res.json({ success: true });
});

// 9. Submit Vote
app.post('/api/room/:code/vote', (req, res) => {
  const code = req.params.code.toUpperCase();
  const { playerId, votedForId } = req.body;
  const room = rooms.get(code);

  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }

  const p = room.players.find(p => p.id === playerId);
  if (!p) return res.status(404).json({ error: 'Player not found' });

  p.votedFor = votedForId;
  addSystemMessage(code, `🗳️ ${p.name} locked in their secret vote.`);

  // Check if all players have voted
  const allVoted = room.players.every(p => p.votedFor || p.id === room.imposterId); // Imposter can vote too, but let's confirm everyone voted or skipped
  const totalVotesCount = room.players.filter(p => p.votedFor).length;

  if (totalVotesCount >= room.players.length) {
    // All votes in! Move to Reveal early!
    calculateRoundScores(room);
    room.status = 'reveal';
    room.timerMax = 15;
    room.timerSeconds = 15;
    addSystemMessage(code, '📢 Everyone voted! Transitioning to Imposter Reveal.');
  }

  room.lastActive = Date.now();
  broadcastRoom(code);
  res.json({ success: true });
});

// 10. Next Round
app.post('/api/room/:code/next-round', (req, res) => {
  const code = req.params.code.toUpperCase();
  const room = rooms.get(code);

  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }

  // Go back to lobby state with same players
  room.status = 'waiting';
  room.timerSeconds = 0;
  room.timerMax = 0;
  room.imposterId = '';
  // Reset players ready status except host helper
  room.players.forEach(p => {
    p.isReady = p.isHost;
    p.clue = undefined;
    p.votedFor = undefined;
    p.role = undefined;
  });

  roomMessages.set(code, []);
  addSystemMessage(code, '🔄 Lobby reset. Ready up for the next round!');

  room.lastActive = Date.now();
  broadcastRoom(code);
  res.json({ success: true });
});

// 11. Event Source SSE Endpoint
app.get('/api/room/:code/events', (req, res) => {
  const code = req.params.code.toUpperCase();
  const playerId = (req.query.playerId as string) || '';

  // Configure headings for holding open SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Add client
  const clients = sseClients.get(code) || [];
  clients.push({ playerId, res });
  sseClients.set(code, clients);

  // Send initial room state
  const room = rooms.get(code);
  if (room) {
    // Set connection status of returning player
    const p = room.players.find(p => p.id === playerId);
    if (p) {
      p.isConnected = true;
      addSystemMessage(code, `🟢 ${p.name} is connected.`);
      broadcastRoom(code);
    }
  }

  // Active connection ping
  const pingInterval = setInterval(() => {
    res.write(': ping\n\n');
  }, 15000);

  // Remove connection on close
  req.on('close', () => {
    clearInterval(pingInterval);
    const codeClients = sseClients.get(code) || [];
    const index = codeClients.findIndex(c => c.res === res);
    if (index >= 0) {
      const removed = codeClients[index];
      codeClients.splice(index, 1);
      sseClients.set(code, codeClients);

      // Handle disconnect flag after 8 seconds of absence
      setTimeout(() => {
        const activeNow = sseClients.get(code) || [];
        const isReconnect = activeNow.some(c => c.playerId === removed.playerId);
        if (!isReconnect) {
          const checkRoom = rooms.get(code);
          if (checkRoom) {
            const player = checkRoom.players.find(p => p.id === removed.playerId);
            if (player) {
              player.isConnected = false;
              addSystemMessage(code, `🔴 ${player.name} disconnected.`);
              broadcastRoom(code);
            }
          }
        }
      }, 8000);
    }
  });
});

// Serve frontend bundler / index.html
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
