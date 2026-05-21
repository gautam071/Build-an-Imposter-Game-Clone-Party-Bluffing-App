/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Volume2,
  VolumeX,
  Plus,
  Users,
  Copy,
  CheckCircle2,
  Timer,
  LogOut,
  Sparkles,
  Smile,
  ShieldAlert,
  Crown,
  Send,
  HelpCircle,
  HelpCircle as QuestionIcon,
  BookOpen,
  UserCheck,
  AlertCircle
} from 'lucide-react';
import { Room, Player, Message, FloatingReaction, RoomStatus } from './types.js';
import { gameAudio } from './utils/audio.js';

const AVAILABLE_AVATARS = ['🥸', '😎', '👽', '🦊', '💀', '👻', '🤖', '🦄', '🤡', '😈', '🦁', '🐸', '👾', '🐹', '🐼', '🐯'];

export default function App() {
  const [playerId, setPlayerId] = useState<string>('');
  const [playerName, setPlayerName] = useState<string>('');
  const [avatar, setAvatar] = useState<string>('🥸');
  const [roomCode, setRoomCode] = useState<string>('');
  const [inputCode, setInputCode] = useState<string>('');
  
  // Game states
  const [room, setRoom] = useState<Room | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [clueInput, setClueInput] = useState<string>('');
  const [votedFor, setVotedFor] = useState<string>('');
  const [chatInput, setChatInput] = useState<string>('');
  const [toast, setToast] = useState<{ text: string; mode: 'success' | 'info' | 'fail' } | null>(null);
  
  // Settings / Create setups
  const [topicPack, setTopicPack] = useState<string>('general');
  const [customTheme, setCustomTheme] = useState<string>('');
  const [isGeneratingPack, setIsGeneratingPack] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'pack' | 'custom'>('pack');
  const [showHowTo, setShowHowTo] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [floatingReactions, setFloatingReactions] = useState<FloatingReaction[]>([]);

  // Refs
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Initialize player data on startup
  useEffect(() => {
    const cachedId = localStorage.getItem('imposter_player_id') || 'p-' + Math.random().toString(36).substring(2, 9);
    const cachedName = localStorage.getItem('imposter_player_name') || '';
    const cachedAvatar = localStorage.getItem('imposter_player_avatar') || AVAILABLE_AVATARS[0];
    localStorage.setItem('imposter_player_id', cachedId);
    
    setPlayerId(cachedId);
    setPlayerName(cachedName);
    setAvatar(cachedAvatar);
    setIsMuted(gameAudio.isMuted());
    
    // Check if room code exists in URL for joining direct
    const params = new URLSearchParams(window.location.search);
    const codeParam = params.get('room');
    if (codeParam) {
      setInputCode(codeParam.toUpperCase());
    }
  }, []);

  // Sync scroll on chat messages
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Toast notifier
  const triggerToast = (text: string, mode: 'success' | 'info' | 'fail' = 'info') => {
    setToast({ text, mode });
    setTimeout(() => {
      setToast(null);
    }, 3000);
  };

  // Sound toggler
  const toggleMute = () => {
    const toState = !isMuted;
    gameAudio.setMute(toState);
    setIsMuted(toState);
    triggerToast(toState ? 'Muted synth audio' : 'Enabled synth audio', 'info');
  };

  // SSE Sync
  useEffect(() => {
    if (!roomCode || !playerId) return;

    // Connect to server event-stream
    const eventSource = new EventSource(`/api/room/${roomCode}/events?playerId=${playerId}`);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.room) {
          setRoom((prevRoom) => {
            const currentRoom: Room = data.room;
            
            // Trigger sound effects on status changes
            if (prevRoom && prevRoom.status !== currentRoom.status) {
              if (currentRoom.status === 'role_reveal') {
                gameAudio.playStartSweep();
              } else if (currentRoom.status === 'clue_phase' || currentRoom.status === 'voting') {
                gameAudio.playVoteClick();
              } else if (currentRoom.status === 'reveal') {
                // If the imposter is caught or successfully blended in
                const caught = isImposterCaught(currentRoom);
                if (caught) {
                  gameAudio.playSuccessFanfare();
                } else {
                  gameAudio.playDetunedBass();
                }
              }
            }
            return currentRoom;
          });
        }
        if (data.messages) {
          setMessages(data.messages);
        }
        if (data.reaction) {
          triggerFloatingReaction(data.reaction);
        }
      } catch (err) {
        console.error('Error parsing SSE payload', err);
      }
    };

    eventSource.onerror = () => {
      // Automatic browser reconnecting is active
    };

    return () => {
      eventSource.close();
    };
  }, [roomCode, playerId]);

  // Floating reactions handler
  const triggerFloatingReaction = (rx: FloatingReaction) => {
    setFloatingReactions((prev) => [...prev, rx]);
    setTimeout(() => {
      setFloatingReactions((prev) => prev.filter((r) => r.id !== rx.id));
    }, 3500);
  };

  function isImposterCaught(curRoom: Room): boolean {
    const voteCounts: Record<string, number> = {};
    curRoom.players.forEach((p) => {
      if (p.votedFor) {
        voteCounts[p.votedFor] = (voteCounts[p.votedFor] || 0) + 1;
      }
    });
    const imposterVotes = voteCounts[curRoom.imposterId] || 0;
    return imposterVotes >= Math.ceil(curRoom.players.length / 2);
  }

  // Action: Create Room
  const handleCreateRoom = async () => {
    if (!playerName.trim()) {
      setErrorMessage('Please enter a nickname first!');
      return;
    }
    setErrorMessage('');
    localStorage.setItem('imposter_player_name', playerName);
    localStorage.setItem('imposter_player_avatar', avatar);

    try {
      const selectedPack = activeTab === 'pack' ? topicPack : 'custom';
      const response = await fetch('/api/room/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hostName: playerName.trim(),
          avatar,
          topicPack: selectedPack
        })
      });
      const data = await response.json();
      if (data.error) {
        setErrorMessage(data.error);
        return;
      }
      setRoomCode(data.code);
      triggerToast('Room created! Share the code.', 'success');
    } catch (err) {
      setErrorMessage('Failed to connect to full-stack server.');
    }
  };

  // Action: Join Room
  const handleJoinRoom = async () => {
    if (!playerName.trim()) {
      setErrorMessage('Please enter a nickname first!');
      return;
    }
    if (!inputCode.trim()) {
      setErrorMessage('Please enter a 6-letter room code!');
      return;
    }
    setErrorMessage('');
    localStorage.setItem('imposter_player_name', playerName);
    localStorage.setItem('imposter_player_avatar', avatar);

    try {
      const response = await fetch('/api/room/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: inputCode.trim().toUpperCase(),
          name: playerName.trim(),
          avatar,
          playerId
        })
      });
      const data = await response.json();
      if (data.error) {
        setErrorMessage(data.error);
        return;
      }
      setRoomCode(data.code);
      triggerToast('Successfully joined the party!', 'success');
    } catch (err) {
      setErrorMessage('Failed to connect to full-stack server.');
    }
  };

  // Action: Ready Up / Host Start Game
  const handleToggleReady = async () => {
    if (!roomCode) return;
    try {
      await fetch(`/api/room/${roomCode}/toggle-ready`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId })
      });
    } catch (err) {}
  };

  const handleStartGame = async () => {
    if (!roomCode) return;
    try {
      const res = await fetch(`/api/room/${roomCode}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topicPack: activeTab === 'pack' ? topicPack : 'custom',
          customTheme: customTheme.trim() ? customTheme.trim() : undefined
        })
      });
      const data = await res.json();
      if (data.error) {
        triggerToast(data.error, 'fail');
      }
    } catch (err) {}
  };

  // Action: AI pack generator trigger preview helper
  const handleAITopicSuggest = async () => {
    if (!customTheme.trim()) {
      triggerToast('Type custom category idea first!', 'fail');
      return;
    }
    setIsGeneratingPack(true);
    try {
      const response = await fetch('/api/ai/generate-topics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme: customTheme })
      });
      const data = await response.json();
      setIsGeneratingPack(false);
      if (data.topics) {
        triggerToast(`AIS Suggested Topics: ${data.topics.slice(0, 3).join(', ')}`, 'success');
      }
    } catch (err) {
      setIsGeneratingPack(false);
    }
  };

  // Action: Send Clue
  const handleSubmitClue = async () => {
    if (!clueInput.trim()) return;
    try {
      const res = await fetch(`/api/room/${roomCode}/clue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId, clue: clueInput })
      });
      const data = await res.json();
      if (data.error) {
        triggerToast(data.error, 'fail');
      } else {
        setClueInput('');
        triggerToast('Clue secure!', 'success');
      }
    } catch (err) {}
  };

  // Action: Send Chat Message (Discussion)
  const handleSendChat = async () => {
    if (!chatInput.trim()) return;
    try {
      await fetch(`/api/room/${roomCode}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          senderId: playerId,
          senderName: playerName,
          text: chatInput
        })
      });
      setChatInput('');
    } catch (err) {}
  };

  // Action: Send Emoji Reaction
  const handleSendReaction = async (emoji: string) => {
    if (!roomCode) return;
    triggerFloatingReaction({
      id: Math.random().toString(),
      emoji,
      playerName,
      createdAt: Date.now()
    });
    try {
      await fetch(`/api/room/${roomCode}/react`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emoji, playerName })
      });
    } catch (err) {}
  };

  // Action: Submit Vote
  const handleLockVote = async (targetId: string) => {
    if (votedFor) return; // one-time lock
    setVotedFor(targetId);
    gameAudio.playVoteClick();
    try {
      await fetch(`/api/room/${roomCode}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId, votedForId: targetId })
      });
      triggerToast('Secret vote registered!', 'success');
    } catch (err) {}
  };

  // Action: Reset Lobby for Next Round
  const handleNextRound = async () => {
    if (!roomCode) return;
    setVotedFor('');
    try {
      await fetch(`/api/room/${roomCode}/next-round`, {
        method: 'POST'
      });
    } catch (err) {}
  };

  // Action: Leave Room
  const handleLeaveRoom = () => {
    setRoomCode('');
    setRoom(null);
    setMessages([]);
    setVotedFor('');
    setClueInput('');
  };

  const copyInviteLink = () => {
    const inviteUrl = `${window.location.origin}${window.location.pathname}?room=${roomCode}`;
    navigator.clipboard.writeText(inviteUrl);
    triggerToast('Invite link copied to clipboard!', 'success');
  };

  // Helper variables
  const myPlayer = room?.players.find((p) => p.id === playerId);
  const isHost = myPlayer?.isHost || false;

  return (
    <div className="relative min-h-screen bg-[#050508] font-sans text-slate-100 overflow-x-hidden selection:bg-purple-500 selection:text-white pb-6">
      {/* Ambient Glow Effects */}
      <div className="absolute top-[-10%] left-[-10%] w-[45%] h-[45%] bg-purple-600/15 blur-[130px] rounded-full pointer-events-none"></div>
      <div className="absolute bottom-[-10%] right-[-14%] w-[45%] h-[45%] bg-cyan-600/15 blur-[130px] rounded-full pointer-events-none"></div>

      {/* Persistent Audio Controls at Top Right */}
      <div className="absolute top-4 right-4 z-50 flex items-center gap-3">
        <button
          onClick={() => setShowHowTo(!showHowTo)}
          className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900/80 border border-slate-800 hover:border-purple-500 hover:text-purple-400 font-medium transition cursor-pointer"
          title="How to Play Guidelines"
        >
          <BookOpen size={18} />
        </button>
        <button
          onClick={toggleMute}
          className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900/80 border border-slate-800 hover:border-pink-500 hover:text-pink-400 font-medium transition cursor-pointer"
          title="Toggle Sounds"
        >
          {isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
        </button>
      </div>

      {/* Toast Notification Banner */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            className={`fixed top-18 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2.5 rounded-2xl border backdrop-blur-md shadow-lg ${
              toast.mode === 'success'
                ? 'bg-purple-950/90 border-purple-500 text-purple-200 shadow-purple-950/20'
                : toast.mode === 'fail'
                ? 'bg-pink-950/90 border-pink-500 text-pink-200 shadow-pink-950/20'
                : 'bg-blue-950/90 border-blue-500 text-blue-200'
            }`}
          >
            <Sparkles className="h-4 w-4 text-purple-400 animate-pulse" />
            <span className="text-sm font-medium">{toast.text}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating Real-time Reactive Emojis */}
      <div className="fixed inset-0 pointer-events-none z-40 overflow-hidden">
        {floatingReactions.map((rx) => (
          <div
            key={rx.id}
            className="absolute left-1/2 bottom-0 text-7xl select-none animate-float-emoji pointer-events-none"
            style={{
              marginLeft: `${Math.random() * 80 - 40}vw`
            }}
          >
            <div className="relative">
              <span>{rx.emoji}</span>
              <span className="absolute -top-6 left-1/2 -translate-x-1/2 bg-slate-900/95 border border-slate-700/80 text-[10px] py-0.5 px-2 rounded-md font-mono text-slate-300 shadow-xl whitespace-nowrap">
                {rx.playerName}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Main Layout Area */}
      <main className="max-w-4xl mx-auto px-4 pt-8 md:pt-12 pb-12 relative z-10">
        {!roomCode ? (
          /* ========================================================== */
          /* LANDING PAGE - CREATING / JOINING LOBBIES                  */
          /* ========================================================== */
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="space-y-8"
          >
            {/* Top Navigation */}
            <header className="flex justify-between items-center mb-6 w-full border-b border-white/10 pb-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gradient-to-br from-pink-500 to-purple-600 rounded-xl flex items-center justify-center shadow-[0_0_20px_rgba(236,72,153,0.4)] select-none">
                  <span className="text-2xl font-black italic text-white">?</span>
                </div>
                <h1 className="text-2xl font-black tracking-tighter bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-500">
                  IMPOSTER.LIVE
                </h1>
              </div>
              <div className="flex items-center gap-6">
                <div className="flex flex-col items-end">
                  <span className="text-[10px] uppercase tracking-widest text-gray-500 font-bold">Players Online</span>
                  <span className="text-sm font-mono text-cyan-400">12,842</span>
                </div>
                <div className="w-10 h-10 rounded-full border border-white/10 p-1 bg-white/5 hidden sm:block">
                  <div className="w-full h-full rounded-full bg-gradient-to-tr from-cyan-400 to-blue-550"></div>
                </div>
              </div>
            </header>

            {/* Elegant Hero Title updated for Vibrant Theme */}
            <div className="text-center space-y-4">
              <div className="inline-flex items-center gap-2.5 px-4 py-1 rounded-full bg-white/5 border border-white/10 backdrop-blur-md">
                <span className="text-xs font-bold text-pink-400 uppercase tracking-widest">🔥 Live Party social Game</span>
              </div>
              <h1 className="text-5xl md:text-8xl font-black leading-none tracking-tighter text-white">
                TRUST <br/>
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-pink-500 via-purple-500 to-cyan-400 animate-pulse">
                  NOBODY.
                </span>
              </h1>
              <p className="text-gray-400 max-w-md mx-auto text-sm md:text-base leading-relaxed">
                Find the liar among your friends. One player doesn't know the topic. Everyone else has hints. Deduce, trick, and survive!
              </p>
            </div>

            {/* Error Message Box */}
            {errorMessage && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="p-4 bg-pink-950/70 border border-pink-700/80 rounded-2xl flex items-start gap-3 justify-center text-pink-200 text-sm max-w-md mx-auto"
              >
                <ShieldAlert className="h-5 w-5 text-pink-400 shrink-0" />
                <span>{errorMessage}</span>
              </motion.div>
            )}

            {/* Setup Form Block */}
            <div className="max-w-md mx-auto bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-6 md:p-8 space-y-6 shadow-[0_0_50px_rgba(168,85,247,0.1)] relative">
              <div className="absolute top-0 right-1/4 h-[1px] w-1/3 bg-gradient-to-r from-transparent via-purple-500 to-transparent" />
              <div className="absolute bottom-0 left-1/4 h-[1px] w-1/3 bg-gradient-to-r from-transparent via-pink-500 to-transparent" />

              {/* Set Nickname */}
              <div className="space-y-2">
                <label className="text-xs font-mono text-purple-300 uppercase tracking-widest block font-bold">Choose Playname</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    maxLength={15}
                    value={playerName}
                    onChange={(e) => setPlayerName(e.target.value)}
                    placeholder="Enter cool nickname..."
                    className="flex-1 bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:border-pink-500/50 focus:ring-1 focus:ring-pink-500/50 transition font-sans text-white placeholder-gray-500"
                  />
                  <div className="relative group">
                    <button
                      type="button"
                      className="h-12 w-12 bg-white/5 border border-white/10 rounded-2xl flex items-center justify-center text-2xl hover:bg-white/10 transition cursor-pointer active:scale-95"
                      title="Select Character Avatar"
                    >
                      {avatar}
                    </button>
                    {/* Popover helper selection list */}
                    <div className="absolute right-0 top-14 bg-[#050508]/95 border border-white/10 rounded-2xl p-2 shadow-2xl grid grid-cols-4 gap-1.5 w-44 z-50 invisible group-hover:visible hover:visible transition-all duration-300 opacity-0 group-hover:opacity-100 animate-fade">
                      {AVAILABLE_AVATARS.map((emoji) => (
                        <button
                          key={emoji}
                          type="button"
                          onClick={() => setAvatar(emoji)}
                          className={`h-8 w-8 rounded-lg flex items-center justify-center text-lg hover:bg-white/10 cursor-pointer ${
                            avatar === emoji ? 'bg-purple-500/20 border border-purple-500' : ''
                          }`}
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Joining Or Creating selector layout */}
              <div className="grid grid-cols-2 gap-3 pt-3 border-t border-white/10">
                {/* 1. Host Panel Toggle */}
                <div className="space-y-4 col-span-2">
                  <div className="flex border border-white/10 rounded-xl bg-white/5 p-1">
                    <button
                      type="button"
                      onClick={() => setActiveTab('pack')}
                      className={`flex-1 py-1.5 text-xs font-mono tracking-wider rounded-lg transition text-center cursor-pointer ${
                        activeTab === 'pack' ? 'bg-gradient-to-r from-pink-600 to-purple-600 text-white font-extrabold shadow-sm' : 'text-slate-400'
                      }`}
                    >
                      Standard Packs
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveTab('custom')}
                      className={`flex-1 py-1.5 text-xs font-mono tracking-wider rounded-lg transition text-center cursor-pointer ${
                        activeTab === 'custom' ? 'bg-gradient-to-r from-purple-600 to-cyan-500 text-white font-extrabold shadow-sm' : 'text-slate-400'
                      }`}
                    >
                      AI Topic Engine ✨
                    </button>
                  </div>

                  {activeTab === 'pack' ? (
                    <div className="space-y-2">
                      <label className="text-[10px] font-mono text-slate-500 uppercase block tracking-widest">Select Category Pack</label>
                      <select
                        value={topicPack}
                        onChange={(e) => setTopicPack(e.target.value)}
                        className="w-full bg-white/5 border border-white/15 rounded-2xl px-4 py-3 text-xs md:text-sm text-slate-200 focus:outline-none focus:border-purple-500/50"
                      >
                        <option value="general" className="bg-[#050508]">🌍 General Pack (Standard Trivia)</option>
                        <option value="funny" className="bg-[#050508]">🌈 Chaos & Funny (Controversies)</option>
                        <option value="family" className="bg-[#050508]">🏡 Family Cozy Pack (Squeaky Clean)</option>
                        <option value="internet" className="bg-[#050508]">🌐 Internet Culture (Memes & TikToks)</option>
                        <option value="adult" className="bg-[#050508]">🌶️ Adult (Spice & Dark Humor)</option>
                      </select>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <label className="text-[10px] font-mono text-slate-500 uppercase tracking-widest">Enter Subtheme ideas (Gemini AI)</label>
                        <button
                          type="button"
                          onClick={handleAITopicSuggest}
                          disabled={isGeneratingPack}
                          className="text-[10px] font-mono text-purple-400 hover:text-purple-300 cursor-pointer underline flex items-center gap-1"
                        >
                          Preview Topics
                        </button>
                      </div>
                      <input
                        type="text"
                        maxLength={50}
                        value={customTheme}
                        onChange={(e) => setCustomTheme(e.target.value)}
                        placeholder="e.g. Harry Potter universe, 2000s cartoon trivia..."
                        className="w-full bg-white/5 border border-white/15 rounded-2xl px-4 py-3 text-xs md:text-sm text-white placeholder-gray-500 focus:outline-none focus:border-purple-500/50"
                      />
                    </div>
                  )}
                </div>

                <div className="col-span-2 pt-2 grid grid-cols-2 gap-3.5">
                  {/* Create Room Button with premium Vibrant theme glow border */}
                  <button
                    onClick={handleCreateRoom}
                    className="group relative h-12 transition-transform cursor-pointer active:scale-95 text-left"
                  >
                    <div className="absolute inset-0 bg-pink-500 blur-xl opacity-10 group-hover:opacity-30 transition-opacity rounded-2xl"></div>
                    <div className="relative bg-gradient-to-r from-pink-600 to-purple-600 p-[1px] rounded-2xl h-full">
                      <div className="bg-[#050508] hover:bg-transparent transition-colors h-full rounded-2xl flex items-center justify-center gap-1.5 px-2">
                        <Plus className="h-4 w-4 text-pink-400 group-hover:text-white shrink-0" />
                        <span className="text-xs font-black uppercase tracking-wider text-white">CREATE ROOM</span>
                      </div>
                    </div>
                  </button>

                  {/* Join Room Button with premium Vibrant theme cyan-blue border */}
                  <button
                    onClick={() => {
                      if (!inputCode.trim()) {
                        setErrorMessage('Please type standard 6-character room code to join!');
                        return;
                      }
                      handleJoinRoom();
                    }}
                    className="group relative h-12 transition-transform cursor-pointer active:scale-95 text-left"
                  >
                    <div className="absolute inset-0 bg-cyan-500 blur-xl opacity-10 group-hover:opacity-30 transition-opacity rounded-2xl"></div>
                    <div className="relative bg-gradient-to-r from-cyan-500 to-blue-500 p-[1px] rounded-2xl h-full">
                      <div className="bg-white/5 hover:bg-white/10 transition-colors h-full rounded-2xl flex items-center justify-center gap-1.5 px-2">
                        <UserCheck className="h-4 w-4 text-cyan-400 shrink-0 animate-pulse" />
                        <span className="text-xs font-black uppercase tracking-wider text-white">JOIN ROOM</span>
                      </div>
                    </div>
                  </button>
                </div>

                {/* Direct Room Join Keyboard Input Option */}
                <div className="col-span-2 pt-2">
                  <div className="relative">
                    <input
                      type="text"
                      maxLength={6}
                      value={inputCode}
                      onChange={(e) => setInputCode(e.target.value.toUpperCase())}
                      placeholder="ENTER 6-LETTER CODE"
                      className="w-full tracking-[0.2em] text-center bg-white/5 border border-white/10 rounded-2xl px-4 py-3 font-mono text-sm uppercase text-white focus:outline-none focus:border-pink-500/50"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Category Footer Selection */}
            <section className="relative z-10 pt-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xs font-black uppercase tracking-[0.3em] text-white/40">Select Topic Pack</h3>
                <div className="h-[1px] flex-1 bg-white/10 mx-6"></div>
                <span className="text-xs font-bold text-cyan-400 font-sans tracking-wide">QUICK CHOOSE</span>
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div 
                  onClick={() => {
                    setTopicPack('general');
                    setActiveTab('pack');
                    triggerToast('Selected General Pack 🍕', 'success');
                  }}
                  className={`border rounded-2xl p-4 flex items-center gap-4 hover:bg-white/10 cursor-pointer transition-all ${
                    topicPack === 'general' && activeTab === 'pack' ? 'bg-purple-500/20 border-purple-500 shadow-[0_0_15px_rgba(168,85,247,0.3)]' : 'bg-white/5 border-white/10'
                  }`}
                >
                  <div className="w-12 h-12 rounded-xl bg-orange-500/20 flex items-center justify-center text-orange-500 text-2xl shrink-0">🍕</div>
                  <div className="truncate">
                    <p className="text-sm font-bold text-white">General</p>
                    <p className="text-[10px] text-gray-500 uppercase font-bold">520 Topics</p>
                  </div>
                </div>

                <div 
                  onClick={() => {
                    setTopicPack('adult');
                    setActiveTab('pack');
                    triggerToast('Selected Adult Night Pack 🔞', 'success');
                  }}
                  className={`border rounded-2xl p-4 flex items-center gap-4 hover:bg-white/10 cursor-pointer transition-all ${
                    topicPack === 'adult' && activeTab === 'pack' ? 'bg-pink-500/20 border-pink-500 shadow-[0_0_15px_rgba(236,72,153,0.3)]' : 'bg-white/5 border-white/10'
                  }`}
                >
                  <div className="w-12 h-12 rounded-xl bg-pink-500/20 flex items-center justify-center text-pink-500 text-2xl shrink-0">🔞</div>
                  <div className="truncate">
                    <p className="text-sm font-bold text-white">Adult Night</p>
                    <p className="text-[10px] text-pink-500/70 uppercase font-bold">340 Topics</p>
                  </div>
                </div>

                <div 
                  onClick={() => {
                    setTopicPack('internet');
                    setActiveTab('pack');
                    triggerToast('Selected Internet Lore Pack 🎭', 'success');
                  }}
                  className={`border rounded-2xl p-4 flex items-center gap-4 hover:bg-white/10 cursor-pointer transition-all ${
                    topicPack === 'internet' && activeTab === 'pack' ? 'bg-purple-500/20 border-purple-500 shadow-[0_0_15px_rgba(168,85,247,0.3)]' : 'bg-white/5 border-white/10'
                  }`}
                >
                  <div className="w-12 h-12 rounded-xl bg-purple-500/20 flex items-center justify-center text-purple-500 text-2xl shrink-0">🎭</div>
                  <div className="truncate">
                    <p className="text-sm font-bold text-white">Internet Lore</p>
                    <p className="text-[10px] text-gray-500 uppercase font-bold">180 Topics</p>
                  </div>
                </div>

                <div 
                  onClick={() => {
                    setTopicPack('funny');
                    setActiveTab('pack');
                    triggerToast('Selected Total Chaos Pack 🌪️', 'success');
                  }}
                  className={`border rounded-2xl p-4 flex items-center gap-4 hover:bg-white/10 cursor-pointer transition-all ${
                    topicPack === 'funny' && activeTab === 'pack' ? 'bg-cyan-500/20 border-cyan-500 shadow-[0_0_15px_rgba(6,182,212,0.3)]' : 'bg-white/5 border-white/10'
                  }`}
                >
                  <div className="w-12 h-12 rounded-xl bg-cyan-550/20 flex items-center justify-center text-cyan-500 text-2xl shrink-0">🌪️</div>
                  <div className="truncate">
                    <p className="text-sm font-bold text-white">Total Chaos</p>
                    <p className="text-[10px] text-gray-500 uppercase font-bold">95 Topics</p>
                  </div>
                </div>
              </div>
            </section>

            {/* Mobile Footer Indicator */}
            <div className="flex justify-center mt-8 opacity-20">
              <div className="w-32 h-1 bg-white rounded-full"></div>
            </div>
          </motion.div>
        ) : (
          /* ========================================================== */
          /* ACTIVE ROOM SCREEN - RENDERS ALL STAGES                   */
          /* ========================================================== */
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-6"
          >
            {/* Real-time Status Banner Header */}
            <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-3xl p-4 flex flex-wrap items-center justify-between gap-4 shadow-xl">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-purple-500/10 text-pink-400 border border-purple-500/20">
                  <Users size={18} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-slate-400">ROOM:</span>
                    <span onClick={copyInviteLink} className="text-sm font-mono font-bold bg-gradient-to-r from-pink-400 to-cyan-400 bg-clip-text text-transparent cursor-pointer hover:opacity-80 transition tracking-wider flex items-center gap-1 select-none">
                      {roomCode} <Copy size={12} className="text-pink-400" />
                    </span>
                  </div>
                  <div className="text-xs text-slate-400 flex items-center gap-1">
                    <span>Pack:</span>
                    <span className="text-cyan-400 font-mono font-medium">
                      {room?.topicPack === 'custom' ? `AI-Generated ✨` : room?.topicPack.toUpperCase()}
                    </span>
                  </div>
                </div>
              </div>

              {/* Game State Header status indicator */}
              <div className="flex items-center gap-3">
                {room && room.status !== 'waiting' && room.status !== 'scoreboard' && (
                  <div className="flex items-center gap-2.5 px-3.5 py-1.5 rounded-2xl bg-white/5 border border-white/10 font-mono text-xs text-white">
                    <Timer size={14} className="text-pink-400 animate-pulse" />
                    <span className={`${room.timerSeconds <= 5 ? 'text-pink-500 font-bold scale-[1.05] inline-block transition' : 'text-slate-350'}`}>
                      {room.timerSeconds}s
                    </span>
                    <div className="h-1.5 w-16 bg-white/15 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-pink-500 to-cyan-400 transition-all duration-1000"
                        style={{ width: `${(room.timerSeconds / room.timerMax) * 100}%` }}
                      />
                    </div>
                  </div>
                )}

                <button
                  onClick={handleLeaveRoom}
                  className="flex h-9 items-center gap-1.5 px-3.5 rounded-xl border border-white/10 bg-white/5 text-[11px] font-mono text-white hover:bg-pink-550 hover:bg-opacity-20 hover:border-pink-500 transition cursor-pointer active:scale-95"
                >
                  <LogOut size={12} className="text-pink-400" /> LEAVE
                </button>
              </div>
            </div>

            {/* Active stage details router wrapper */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
              
              {/* LEFT SIDE: Players list on grid (survives refreshes elegantly) */}
              <div className="space-y-4 order-last md:order-first">
                <div className="bg-white/5 border border-white/10 rounded-3xl p-5 shadow-lg">
                  <div className="flex justify-between items-center mb-4 font-sans">
                    <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-slate-400">Players ({room?.players.length || 0})</h3>
                    {room?.status === 'waiting' && (
                      <span className="text-[10px] font-mono text-pink-400 font-bold">Require min. 2</span>
                    )}
                  </div>

                  <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1">
                    {room?.players.map((p) => {
                      const isMe = p.id === playerId;
                      const hasVoted = p.votedFor !== undefined;
                      const hasTypedClue = p.clue !== undefined && p.clue !== '';
                      
                      return (
                        <div
                          key={p.id}
                          className={`flex items-center justify-between p-3 rounded-2xl transition border ${
                            isMe ? 'bg-gradient-to-r from-pink-500/10 via-purple-500/10 to-transparent border-purple-500/40' : 'bg-white/5 border-white/5 hover:bg-white/10'
                          }`}
                        >
                          <div className="flex items-center gap-2.5">
                            <span className="text-2xl filter drop-shadow selection:bg-transparent">{p.avatar}</span>
                            <div>
                              <div className="flex items-center gap-1">
                                <span className="font-bold text-sm text-white truncate max-w-28">{p.name}</span>
                                {p.isHost && <Crown size={12} className="text-yellow-500 shrink-0" />}
                                {isMe && <span className="text-[9px] font-mono text-purple-400 font-bold bg-purple-950 px-1 py-0.5 rounded shrink-0">YOU</span>}
                              </div>
                              <div className="flex items-center gap-1.5 mt-0.5">
                                {/* Online Status indicator reconnect tracker */}
                                <span className={`h-1.5 w-1.5 rounded-full inline-block ${p.isConnected ? 'bg-cyan-400 animate-pulse' : 'bg-slate-600'}`} />
                                <span className="text-[10px] font-mono text-slate-400">
                                  {p.isConnected ? 'Connected' : 'Disconnected'} • {p.score}pt
                                </span>
                              </div>
                            </div>
                          </div>

                          {/* Action badges during match runs */}
                          <div className="flex items-center gap-2">
                            {room.status === 'clue_phase' && (
                              <span className={`text-[10px] font-mono rounded-lg px-2 py-0.5 ${
                                hasTypedClue ? 'bg-emerald-900/30 text-emerald-400 border border-emerald-800/40' : 'bg-slate-900 text-slate-500'
                              }`}>
                                {hasTypedClue ? 'Clue In' : 'Typing...'}
                              </span>
                            )}
                            {room.status === 'voting' && (
                              <span className={`text-[10px] font-mono rounded-lg px-2 py-0.5 ${
                                hasVoted ? 'bg-purple-900/30 text-purple-400 border border-purple-800/40' : 'bg-slate-900 text-slate-500'
                              }`}>
                                {hasVoted ? 'Voted' : 'Voting...'}
                              </span>
                            )}
                            {room.status === 'waiting' && (
                              <span className={`text-[10px] font-mono rounded-lg px-2 py-0.5 font-bold ${
                                p.isReady ? 'bg-purple-900/30 text-purple-400' : 'bg-slate-900 text-slate-500'
                              }`}>
                                {p.isReady ? 'READY' : 'WAITING'}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Floating Emoji quickdeck controls for party reactions */}
                <div className="bg-white/5 border border-white/10 rounded-3xl p-4 shadow-lg space-y-2">
                  <h4 className="text-[10px] font-mono text-purple-300 uppercase tracking-widest text-center font-bold">Buzz Reactions 📣</h4>
                  <div className="grid grid-cols-6 gap-2">
                    {['😂', '🤔', '🤫', '🚨', '👑', '😱'].map((emoji) => (
                      <button
                        key={emoji}
                        onClick={() => handleSendReaction(emoji)}
                        className="py-1.5 rounded-xl border border-white/10 bg-white/5 hover:bg-purple-500/10 hover:border-purple-500 transition text-2xl active:scale-75 select-none cursor-pointer"
                        title="React live"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* RIGHT SIDE: Game actions panel, changes dynamically with room status */}
              <div className="col-span-1 md:col-span-2 space-y-6">
                
                {/* 1. LOBBY STATE (Waiting Room) */}
                {room?.status === 'waiting' && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="bg-white/5 border border-white/10 rounded-3xl p-6 md:p-8 space-y-6 shadow-xl relative"
                  >
                    <div className="space-y-2">
                      <h2 className="text-3xl font-mono font-black tracking-tight bg-gradient-to-r from-pink-400 via-purple-400 to-cyan-400 bg-clip-text text-transparent">THE PARTY IS IN LOBBY</h2>
                      <p className="text-gray-450 text-xs md:text-sm">
                        Share the 6-letter room code above so online partners can pop in. Host can select settings and launch!
                      </p>
                    </div>

                    {/* QR join code template placeholder mock */}
                    <div className="p-4 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-between gap-4">
                      <div className="space-y-1">
                        <span className="text-xs font-mono text-pink-400 font-bold block">DIRECT JOIN LINK</span>
                        <p className="text-gray-400 text-[10px] sm:text-xs">
                          Copy direct-join address including code so they bypass entering details!
                        </p>
                      </div>
                      <button
                        onClick={copyInviteLink}
                        className="h-10 px-4 rounded-xl font-mono text-xs font-bold text-slate-100 bg-gradient-to-r from-pink-600 to-purple-600 hover:brightness-110 transition cursor-pointer flex items-center gap-1.5 select-none shrink-0"
                      >
                        <Copy size={14} /> COPY LINK
                      </button>
                    </div>

                    {/* Category setting indicator summaries */}
                    <div className="p-4 bg-white/5 border border-white/10 rounded-2xl space-y-2 text-xs">
                      <span className="font-mono text-[10px] text-gray-400 uppercase block tracking-widest font-bold">Active Game Parameter Selection</span>
                      <div className="grid grid-cols-2 gap-4 pt-1">
                        <div>
                          <span className="text-gray-405 block mb-0.5">Category Pack:</span>
                          <span className="font-mono text-purple-400 font-bold">
                            {room.topicPack === 'custom' ? 'AI Suggestion ✨' : room.topicPack.toUpperCase()}
                          </span>
                        </div>
                        <div>
                          <span className="text-gray-405 block mb-0.5">Min Players required:</span>
                          <span className="font-mono text-cyan-400 font-bold">2 Players</span>
                        </div>
                      </div>
                    </div>

                    {/* Controller bar */}
                    <div className="flex flex-col sm:flex-row gap-4 pt-4 border-t border-white/10">
                      <button
                        onClick={handleToggleReady}
                        className={`flex-1 py-3 px-4 rounded-2xl font-mono text-xs font-extrabold tracking-wider transition cursor-pointer flex items-center justify-center gap-2 ${
                          myPlayer?.isReady
                            ? 'bg-transparent border-2 border-pink-500/80 text-pink-400'
                            : 'bg-gradient-to-r from-pink-500 via-purple-500 to-cyan-500 text-white shadow-[0_0_20px_rgba(168,85,247,0.3)]'
                        }`}
                      >
                        <CheckCircle2 size={16} />
                        {myPlayer?.isReady ? 'UNREADY LOBBY' : 'READY TO PLAY'}
                      </button>

                      {isHost && (
                        <button
                          onClick={handleStartGame}
                          className="flex-1 bg-gradient-to-r from-emerald-500 to-cyan-500 text-slate-950 py-3 px-4 rounded-2xl font-mono text-xs font-black tracking-wider transition-all cursor-pointer flex items-center justify-center gap-1.5 shadow-[0_0_20px_rgba(16,185,129,0.3)] hover:brightness-110 active:scale-95"
                        >
                          <Sparkles size={16} /> START GAME MASTER
                        </button>
                      )}
                    </div>
                  </motion.div>
                )}

                {/* 2. ROLE REVEAL PHASE */}
                {room?.status === 'role_reveal' && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="bg-white/5 border border-white/10 rounded-3xl p-6 md:p-8 space-y-6 shadow-xl text-center relative overflow-hidden"
                  >
                    <div className="absolute top-0 left-0 h-1.5 bg-gradient-to-r from-pink-500 via-purple-500 to-cyan-400 w-full animate-pulse" />
                    
                    <div className="space-y-2">
                      <div className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-pink-500/10 text-pink-500 animate-bounce">
                        <Sparkles size={16} />
                      </div>
                      <h2 className="text-3xl font-black bg-clip-text text-transparent bg-gradient-to-r from-white to-purple-400 font-sans uppercase">ROLE REVEAL</h2>
                      <p className="text-gray-400 text-xs">
                        Keep your screens private! The game chosen your target card identity.
                      </p>
                    </div>

                    {/* Tap-to-reveal card */}
                    <div className="max-w-sm mx-auto mt-4">
                      {myPlayer?.role === 'imposter' ? (
                        <div className="rounded-2xl border-2 border-pink-500/80 p-6 md:p-8 bg-gradient-to-b from-[#050508]/85 to-[#050508]/60 text-center space-y-4 shadow-[0_0_20px_rgba(236,72,153,0.3)] animate-pulse">
                          <span className="text-7xl block animate-bounce" style={{ animationDuration: '3s' }}>🤫</span>
                          <span className="font-mono text-xs tracking-widest text-pink-400 font-extrabold uppercase block font-sans">YOUR ID: THE IMPOSTER</span>
                          <h3 className="text-2xl font-bold font-sans text-pink-200">YOU DO NOT KNOW THE TOPIC</h3>
                          <p className="text-slate-400 text-xs">
                            Goal: Listen to other players' clues carefully. Copy their descriptions, drop a vague word, and pretend you know the keyword to blend in!
                          </p>
                        </div>
                      ) : (
                        <div className="rounded-2xl border-2 border-purple-500/80 p-6 md:p-8 bg-gradient-to-b from-[#050508]/85 to-[#050508]/60 text-center space-y-4 shadow-[0_0_20px_rgba(168,85,247,0.3)]">
                          <span className="text-7xl block animate-bounce" style={{ animationDuration: '3s' }}>🧐</span>
                          <span className="font-mono text-xs tracking-widest text-purple-400 font-extrabold uppercase block font-sans">YOUR ID: NORMAL PLAYER</span>
                          <div className="p-3 bg-white/5 rounded-2xl border border-white/10 space-y-1">
                            <span className="text-[10px] font-mono text-slate-400 block tracking-wider">SECRET WORD</span>
                            <h3 className="text-3xl font-black font-sans text-transparent bg-clip-text bg-gradient-to-r from-pink-400 to-purple-300">{room.secretTopic}</h3>
                          </div>
                          <p className="text-slate-400 text-xs">
                            Goal: Provide a subtle clue describing the word. Don't make it too obvious, or the Imposter will guess it! Find the agent of deception.
                          </p>
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}

                {/* 3. CLUE PHASE (Turn-based entry) */}
                {room?.status === 'clue_phase' && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="bg-white/5 border border-white/10 rounded-3xl p-6 md:p-8 space-y-6 shadow-xl relative"
                  >
                    {/* Active turn header banner */}
                    {(() => {
                      const activePlayer = room.players[room.activeCluePlayerIndex];
                      const isMyTurn = activePlayer?.id === playerId;
                      
                      return (
                        <>
                          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-4">
                            <span className="text-xs font-mono tracking-widest text-[#9ca3af] uppercase font-bold">
                              CLUE TURN PROGRESS: {room.activeCluePlayerIndex + 1} / {room.players.length}
                            </span>
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] font-mono text-slate-500">ACTIVE:</span>
                              <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/5 border border-white/10">
                                <span className="text-lg filter drop-shadow selection:bg-transparent">{activePlayer?.avatar}</span>
                                <span className="text-xs font-bold font-mono text-white">{activePlayer?.name}</span>
                              </div>
                            </div>
                          </div>

                          {/* Render clue typing or wait states */}
                          {isMyTurn ? (
                            <div className="space-y-4">
                              <div className="space-y-1 text-center sm:text-left">
                                <h3 className="text-xl font-bold bg-gradient-to-r from-pink-400 to-purple-400 bg-clip-text text-transparent uppercase">ITS YOUR TURN TO ENTER THE CLUE! 👑</h3>
                                <p className="text-gray-400 text-xs">
                                  {myPlayer?.role === 'imposter'
                                    ? 'Blend in! Try giving a broad clue that fits multiple related keywords.'
                                    : `Describe [${room.secretTopic}] with a single, creative word or short phrase.`}
                                </p>
                              </div>

                              <div className="flex flex-col sm:flex-row gap-2 pt-2">
                                <input
                                  type="text"
                                  maxLength={40}
                                  value={clueInput}
                                  onChange={(e) => setClueInput(e.target.value)}
                                  placeholder="Type clever clue... (e.g. Cheesy, Electric, Morning)"
                                  className="flex-1 bg-slate-900 border border-white/10 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:border-purple-500 font-sans text-white placeholder-gray-500"
                                />
                                <button
                                  onClick={handleSubmitClue}
                                  className="bg-gradient-to-r from-pink-600 to-purple-600 text-white font-extrabold font-mono text-xs px-6 py-3 rounded-2xl cursor-pointer hover:brightness-110 transition active:scale-95 shadow-[0_0_15px_rgba(236,72,153,0.3)]"
                                >
                                  SUBMIT CLUE
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="space-y-4 py-4 text-center">
                              <div className="max-w-sm mx-auto space-y-2">
                                <div className="h-2.5 w-2.5 bg-pink-500 rounded-full animate-ping mx-auto" />
                                <h3 className="text-lg font-bold text-slate-200">Waiting for {activePlayer?.name} to submit Clue</h3>
                                <p className="text-xs text-slate-500 leading-relaxed">
                                  Keep your poker face secure. Use the quick reaction soundboard or dynamic emojis to distract the player.
                                </p>
                              </div>
                            </div>
                          )}
                        </>
                      );
                    })()}

                    {/* Summary row displaying entered clues */}
                    <div className="pt-4 border-t border-white/10 space-y-3">
                      <span className="text-[10px] font-mono text-pink-400 uppercase block tracking-widest font-bold">Active Clues Board</span>
                      <div className="grid grid-cols-2 gap-3.5">
                        {room.players.map((p) => (
                          <div key={p.id} className="p-3 rounded-2xl bg-white/5 border border-white/5 flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 truncate">
                              <span className="text-lg shrink-0">{p.avatar}</span>
                              <span className="text-xs text-slate-400 font-mono truncate">{p.name}</span>
                            </div>
                            <span className="text-xs font-sans font-bold text-white truncate">
                              {p.clue ? `“${p.clue}”` : <span className="text-[10px] text-pink-400/50 font-mono italic">Thinking...</span>}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </motion.div>
                )}

                {/* 4. DISCUSSION PHASE */}
                {room?.status === 'discussion' && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="bg-white/5 border border-white/10 rounded-3xl p-6 md:p-8 space-y-6 shadow-xl relative"
                  >
                    <div className="flex items-center justify-between border-b border-white/10 pb-3">
                      <div className="space-y-1">
                        <h2 className="text-2xl font-black bg-clip-text text-transparent bg-gradient-to-r from-white to-purple-400 font-sans uppercase">SPEECH & DISCUSSION OPEN</h2>
                        <p className="text-gray-400 text-xs">
                          Expose gaps in clues! interrogate players or defend yourself from allegations.
                        </p>
                      </div>
                    </div>

                    {/* Active Clues Board review list */}
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3.5">
                      {room.players.map((p) => (
                        <div key={p.id} className="p-3 rounded-2xl bg-white/5 border border-white/10 text-center space-y-1.5 relative overflow-hidden">
                          {p.id === playerId && <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-purple-500 animate-pulse" />}
                          <span className="text-3xl block filter drop-shadow">{p.avatar}</span>
                          <span className="text-xs text-gray-400 block font-mono truncate">{p.name}</span>
                          <div className="text-xs text-purple-200 font-sans font-bold py-1 bg-purple-500/20 border border-purple-500/20 rounded-lg truncate">
                            “{p.clue}”
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Mini live in-app chat drawer layout */}
                    <div className="border border-white/10 rounded-2xl overflow-hidden bg-[#050508]/60 flex flex-col h-64 shadow-inner">
                      <div className="p-2 border-b border-white/10 bg-white/5 flex justify-between items-center">
                        <span className="text-[10px] font-mono text-pink-400 font-bold block">REAL-TIME PARTY MESSAGES</span>
                        <HelpCircle size={12} className="text-slate-400 cursor-pointer" title="Double check messages for contradictions." />
                      </div>

                      {/* Chat stream */}
                      <div className="flex-1 overflow-y-auto p-4 space-y-3">
                        {messages.length === 0 ? (
                          <div className="h-full flex items-center justify-center text-xs text-slate-500 font-mono italic">
                            No messages. Type below to lobby accusations!
                          </div>
                        ) : (
                          messages.map((m) => {
                            if (m.isSystem) {
                              return (
                                <div key={m.id} className="text-[11px] font-mono text-center text-pink-400 py-1 bg-pink-950/20 border-y border-pink-500/20 px-3 rounded-xl animate-fade font-bold">
                                  {m.text}
                                </div>
                              );
                            }
                            const isMe = m.senderId === playerId;
                            return (
                              <div key={m.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                                <div className={`max-w-[80%] rounded-2xl px-3.5 py-1.5 text-xs ${
                                  isMe ? 'bg-gradient-to-r from-pink-600 to-purple-600 text-white rounded-tr-none' : 'bg-white/10 text-slate-200 rounded-tl-none'
                                }`}>
                                  {!isMe && <span className="block text-[9px] font-mono text-slate-400 mb-0.5 font-bold">{m.senderName}</span>}
                                  <p>{m.text}</p>
                                </div>
                              </div>
                            );
                          })
                        )}
                        <div ref={chatEndRef} />
                      </div>

                      {/* Input bar */}
                      <div className="p-2 border-t border-white/10 bg-white/5 flex gap-2">
                        <input
                          type="text"
                          maxLength={100}
                          value={chatInput}
                          onChange={(e) => setChatInput(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleSendChat()}
                          placeholder="Type accusation or evidence..."
                          className="flex-1 bg-slate-900 border border-white/10 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none"
                        />
                        <button
                          onClick={handleSendChat}
                          className="p-1.5 bg-gradient-to-r from-pink-500 to-purple-500 hover:brightness-110 text-white rounded-xl cursor-pointer transition flex items-center justify-center shrink-0"
                        >
                          <Send size={14} />
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )}

                {/* 5. VOTING PHASE */}
                {room?.status === 'voting' && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="bg-white/5 border border-white/10 rounded-3xl p-6 md:p-8 space-y-6 shadow-xl relative text-center"
                  >
                    <div className="space-y-1">
                      <h2 className="text-2xl font-black bg-clip-text text-transparent bg-gradient-to-r from-white to-pink-400 uppercase font-sans">CAST THE DECISION</h2>
                      <p className="text-gray-400 text-xs">
                        Flip cards, trace clues, and click to vote for who is NOT a normal player. You cannot vote for yourself!
                      </p>
                    </div>

                    {/* Voter selection grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                      {room.players.map((p) => {
                        const isMe = p.id === playerId;
                        const votesOnCurrent = room.players.filter(x => x.votedFor === p.id).length;
                        
                        return (
                          <div
                            key={p.id}
                            className={`p-4 rounded-3xl border transition relative overflow-hidden flex flex-col items-center justify-center space-y-3 ${
                              votedFor === p.id
                                ? 'bg-pink-500/20 border-pink-500 shadow-[0_0_15px_rgba(236,72,153,0.3)] font-sans'
                                : 'bg-[#050508]/50 border-white/5 hover:border-pink-550/40 hover:bg-white/5'
                            }`}
                          >
                            <span className="text-4xl">{p.avatar}</span>
                            <div className="text-center">
                              <span className="text-sm font-bold text-white block">{p.name}</span>
                              <span className="text-[10px] font-mono text-purple-400">clue: “{p.clue}”</span>
                            </div>

                            {/* Enable submit buttons except self */}
                            {isMe ? (
                              <span className="text-[10px] font-mono text-slate-500 italic">This is you</span>
                            ) : (
                              <button
                                onClick={() => handleLockVote(p.id)}
                                disabled={votedFor !== ''}
                                className={`w-full py-2 rounded-xl text-xs font-mono font-bold transition cursor-pointer select-none ${
                                  votedFor === p.id
                                    ? 'bg-pink-500 text-slate-950'
                                    : votedFor !== ''
                                    ? 'bg-slate-900 text-slate-600 cursor-not-allowed'
                                    : 'bg-purple-900/40 text-purple-300 border border-purple-800 hover:bg-purple-800 transition'
                                }`}
                              >
                                {votedFor === p.id ? 'VOTED & LOCKED' : 'ACCUSE'}
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </motion.div>
                )}

                {/* 6. REVEAL STAGE */}
                {room?.status === 'reveal' && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="bg-white/5 border border-white/10 rounded-3xl p-6 md:p-8 space-y-6 shadow-xl text-center relative overflow-hidden"
                  >
                    <div className="space-y-1">
                      <span className="text-xs font-mono tracking-widest text-pink-400 font-extrabold uppercase animate-pulse">CINEMATIC SUSPENSE REVEAL</span>
                      <h2 className="text-4xl font-black bg-clip-text text-transparent bg-gradient-to-r from-white to-purple-400 uppercase font-sans">THE IMPOSER IS UNVEILED</h2>
                    </div>

                    {/* Spotlight Reveal Card */}
                    {(() => {
                      const imposterObj = room.players.find((p) => p.id === room.imposterId);
                      const caught = isImposterCaught(room);
                      
                      return (
                        <div className="max-w-md mx-auto space-y-6 mt-4">
                          <div className={`p-8 rounded-3xl border-2 text-center space-y-4 shadow-2xl relative ${
                            caught ? 'bg-emerald-950/20 border-emerald-500 shadow-[0_0_20px_rgba(16,185,129,0.2)]' : 'bg-pink-950/20 border-pink-500 shadow-[0_0_20px_rgba(236,72,153,0.2)]'
                          }`}>
                            <span className="text-7xl block animate-bounce" style={{ animationDuration: '4s' }}>
                              {caught ? '🎉' : '🤫'}
                            </span>
                            <h3 className="text-xl font-bold font-mono">
                              {caught ? 'THE IMPOSTER WAS EXPOSED!' : 'THE IMPOSTER FOOLED THE PARTY!'}
                            </h3>
                            <div className="flex items-center justify-center gap-2 px-4 py-2.5 bg-[#050508]/60 border border-white/10 rounded-2xl w-fit mx-auto">
                              <span className="text-2xl">{imposterObj?.avatar}</span>
                              <span className="text-sm font-bold font-mono text-purple-450">{imposterObj?.name}</span>
                              <span className="text-xs font-mono text-slate-400">was indeed the IMPOSTER!</span>
                            </div>

                            <p className="text-xs text-slate-300 leading-relaxed pt-2">
                              {caught
                                ? 'Normal players successfully matched explanations and identified the agent of deception.'
                                : 'The Imposter successfully blended in, avoided detection, and claimed victory!'}
                            </p>
                          </div>

                          {/* Secret topic revealed in major styling */}
                          <div className="p-4 bg-[#050508]/50 border border-white/15 rounded-2xl">
                            <span className="text-[10px] font-mono text-[#9ca3af] uppercase tracking-widest block mb-1">SECRET KEYWORD WAS</span>
                            <span className="text-3xl font-sans font-black text-transparent bg-clip-text bg-gradient-to-r from-pink-400 to-purple-400 select-all tracking-wider">
                              {room.secretTopic}
                            </span>
                          </div>

                          {/* Ballot list highlighting voter selections */}
                          <div className="p-4 bg-white/5 border border-white/10 rounded-3xl space-y-2 text-left">
                            <span className="text-[10px] font-mono text-slate-450 block mb-2 font-bold tracking-widest">Final Ballots Grid</span>
                            <div className="space-y-2 max-h-40 overflow-y-auto">
                              {room.players.map((p) => {
                                const targetVoting = room.players.find(x => x.id === p.votedFor);
                                return (
                                  <div key={p.id} className="flex items-center justify-between text-xs py-1 border-b border-white/5">
                                    <div className="flex items-center gap-1">
                                      <span>{p.avatar}</span>
                                      <span className="font-mono text-slate-200">{p.name}</span>
                                    </div>
                                    <span className="text-slate-500 font-mono">voted for ➔</span>
                                    {targetVoting ? (
                                      <div className="flex items-center gap-1">
                                        <span>{targetVoting.avatar}</span>
                                        <span className={`font-mono ${p.votedFor === room.imposterId ? 'text-emerald-400 font-bold' : 'text-pink-400'}`}>
                                          {targetVoting.name}
                                        </span>
                                      </div>
                                    ) : (
                                      <span className="text-slate-600 italic">Abstained</span>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                  </motion.div>
                )}

                {/* 7. SCOREBOARD STATE */}
                {room?.status === 'scoreboard' && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="bg-white/5 border border-white/10 rounded-3xl p-6 md:p-8 space-y-6 shadow-xl relative"
                  >
                    <div className="space-y-2 text-center">
                      <div className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-purple-500/10 text-purple-405 hover:scale-110 transition border border-purple-500/20">
                        <Crown size={18} />
                      </div>
                      <h2 className="text-3xl font-black bg-clip-text text-transparent bg-gradient-to-r from-pink-400 via-purple-400 to-cyan-400 font-sans uppercase">SCOREBOARD</h2>
                      <p className="text-gray-400 text-xs">
                        Who dominates the social deduction hierarchy? View standings and launch cumulative rounds!
                      </p>
                    </div>

                    {/* Standing list sorting ascending points */}
                    <div className="space-y-3 pt-2">
                      {[...room.players]
                        .sort((a, b) => b.score - a.score)
                        .map((p, idx) => {
                          const isLead = idx === 0 && p.score > 0;
                          return (
                            <div
                              key={p.id}
                              className={`p-4 rounded-2xl border flex items-center justify-between transition ${
                                isLead
                                  ? 'bg-purple-500/10 border-purple-500/40 shadow-lg shadow-purple-950/10'
                                  : 'bg-white/5 border-white/5'
                              }`}
                            >
                              <div className="flex items-center gap-3">
                                <span className={`text-xs font-mono font-bold ${isLead ? 'text-purple-400' : 'text-slate-500'}`}>
                                  #{idx + 1}
                                </span>
                                <span className="text-3xl filter drop-shadow selection:bg-transparent">{p.avatar}</span>
                                <div>
                                  <div className="flex items-center gap-1.5">
                                    <span className="font-bold text-sm text-white">{p.name}</span>
                                    {isLead && <Crown size={14} className="text-yellow-500 shrink-0" />}
                                  </div>
                                  <span className="text-[10px] font-mono text-slate-400">
                                    This round: <span className="text-purple-400 font-bold font-mono">+{p.pointsEarnedThisRound || 0}pt</span>
                                  </span>
                                </div>
                              </div>

                              <div className="text-right">
                                <span className="text-lg font-mono font-extrabold text-white block">{p.score}</span>
                                <span className="text-[9px] font-mono text-slate-500 uppercase tracking-wider">TOTAL SCORE</span>
                              </div>
                            </div>
                          );
                        })}
                    </div>

                    {/* Controller bar */}
                    {isHost && (
                      <div className="pt-4 border-t border-white/10 flex justify-center">
                        <button
                          onClick={handleNextRound}
                          className="bg-gradient-to-r from-emerald-500 to-cyan-500 text-slate-950 font-black font-mono text-xs px-8 py-3.5 rounded-2xl transition cursor-pointer flex items-center gap-2 active:scale-95 shadow-[0_0_20px_rgba(16,185,129,0.3)] hover:brightness-110"
                        >
                          <Plus className="h-4 w-4" /> PLAY NEXT ROUND
                        </button>
                      </div>
                    )}
                  </motion.div>
                )}

              </div>
            </div>
          </motion.div>
        )}

        {/* ========================================================== */}
        {/* SLIDE-OUT HOW TO PLAY HANDBOOK MANUAL                      */}
        {/* ========================================================== */}
        <AnimatePresence>
          {showHowTo && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              {/* Overlay Backdrop */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setShowHowTo(false)}
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              />

              {/* Guide modal card */}
              <motion.div
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 10 }}
                className="relative w-full max-w-lg bg-slate-900 border border-slate-800 p-6 md:p-8 rounded-3xl shadow-2xl space-y-6 z-10 max-h-[85vh] overflow-y-auto"
              >
                <div className="space-y-2 text-center md:text-left">
                  <span className="text-[10px] font-mono text-purple-400 uppercase tracking-widest block font-bold">Party Instructions</span>
                  <h3 className="text-2xl font-mono font-bold tracking-tight text-slate-100 flex items-center justify-center md:justify-start gap-2 select-none">
                    <BookOpen className="text-purple-400" /> HOW TO PLAY IMPOSTER
                  </h3>
                </div>

                <div className="space-y-4 text-xs md:text-sm text-slate-300 leading-relaxed font-sans">
                  <div className="p-4 bg-slate-950 border border-slate-850 rounded-2xl space-y-2">
                    <span className="font-mono text-[10px] text-purple-400 font-bold block">1. ROLE GENERATOR</span>
                    <p>
                      At the beginning of each game, one player is chosen randomly to be the <span className="text-pink-400 font-bold">Imposter</span>. 
                      Everyone else is a <span className="text-purple-400 font-bold">Normal Player</span> and is shown a secret topic keyword (e.g. <strong>"Pizza"</strong>).
                    </p>
                  </div>

                  <div className="p-4 bg-slate-950 border border-slate-850 rounded-2xl space-y-2">
                    <span className="font-mono text-[10px] text-purple-400 font-bold block">2. THE CLUE TURN</span>
                    <p>
                      Each player, following a strict turn order, gets 25 seconds to submit a simple, clever, single-word or phrase clue describing the secret topic. 
                      <strong>Tip:</strong> If you are a Normal Player, describe carefully! If it's too obvious, the Imposter will guess it. If it's too vague, you'll sound suspicious.
                    </p>
                  </div>

                  <div className="p-4 bg-slate-950 border border-slate-850 rounded-2xl space-y-2">
                    <span className="font-mono text-[10px] text-purple-400 font-bold block">3. DISCUSS & SURVIVE</span>
                    <p>
                      Clues are laid out side-by-side. 50 seconds of open discussion opens. Defend, point out gaps, and interrogate players.
                    </p>
                  </div>

                  <div className="p-4 bg-slate-950 border border-slate-850 rounded-2xl space-y-2">
                    <span className="font-mono text-[10px] text-purple-400 font-bold block">4. BLIND SECRET VOTING</span>
                    <p>
                      Cast votes for who you think is the Imposter. 
                      If the Imposter is caught by majority votes, Normal Players score 10pts. If the Imposter survives, they score 15pts (or 25pts if nobody suspected them!).
                    </p>
                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    onClick={() => setShowHowTo(false)}
                    className="w-full sm:w-auto bg-gradient-to-r from-purple-500 to-pink-500 text-slate-950 font-bold font-mono text-xs px-6 py-2.5 rounded-xl transition hover:opacity-95 cursor-pointer flex items-center justify-center select-none"
                  >
                    GOT IT! LET'S PARTY
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
