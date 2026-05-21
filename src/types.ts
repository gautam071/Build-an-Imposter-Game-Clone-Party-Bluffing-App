/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Player {
  id: string;
  name: string;
  avatar: string; // Emoji
  score: number;
  isHost: boolean;
  isConnected: boolean;
  isReady: boolean;
  clue?: string;
  votedFor?: string; // Player ID
  role?: 'imposter' | 'player';
  pointsEarnedThisRound?: number;
}

export interface FloatingReaction {
  id: string;
  emoji: string;
  playerName: string;
  createdAt: number;
}

export type RoomStatus =
  | 'waiting'
  | 'role_reveal'
  | 'clue_phase'
  | 'discussion'
  | 'voting'
  | 'reveal'
  | 'scoreboard';

export interface Room {
  code: string;
  status: RoomStatus;
  players: Player[];
  topicPack: string; // 'general' | 'family' | 'funny' | 'adult' | 'internet' | 'custom'
  secretTopic: string;
  imposterId: string;
  activeRound: number;
  activeCluePlayerIndex: number;
  timerSeconds: number;
  timerMax: number;
  lastActive: number;
}

export interface Message {
  id: string;
  senderName: string;
  senderId: string;
  text: string;
  createdAt: number;
  isSystem?: boolean;
}
