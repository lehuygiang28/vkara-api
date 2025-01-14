import { Video } from 'youtube-sr';
import { ErrorCode } from './errors';

export interface ClientInfo {
    id: string;
    roomId?: string;
}

export type YouTubeVideo = ReturnType<Video['toJSON']>;

export interface Room {
    id: string;
    password?: string;
    clients: string[];
    videoQueue: YouTubeVideo[];
    historyQueue: YouTubeVideo[];
    volume: number;
    playingNow: YouTubeVideo | null;
    lastActivity: number;
    creatorId: string;
    isPlaying: boolean;
    currentTime: number;
}

export interface MessageBase {
    id: string;
    timestamp: number;
    requiresAck?: boolean;
}

export type ClientMessage = MessageBase &
    (
        | { type: 'ping' }
        | { type: 'createRoom'; password?: string }
        | { type: 'joinRoom'; roomId: string; password?: string }
        | { type: 'leaveRoom' }
        | { type: 'closeRoom' }
        | { type: 'sendMessage'; message: string }
        | { type: 'addVideo'; video: YouTubeVideo }
        | { type: 'removeVideo'; videoId: string }
        | { type: 'playNow'; video: YouTubeVideo }
        | { type: 'nextVideo' }
        | { type: 'setVolume'; volume: number }
        | { type: 'replay' }
        | { type: 'play' }
        | { type: 'pause' }
        | { type: 'seek'; time: number }
        | { type: 'videoFinished' }
        | { type: 'moveToTop'; videoId: string }
        | { type: 'shuffleQueue' }
        | { type: 'clearQueue' }
        | { type: 'clearHistory' }
    );

export type ServerMessage =
    | { type: 'pong' }
    | { type: 'ack'; messageId: string }
    | { type: 'roomCreated'; roomId: string }
    | { type: 'roomUpdate'; room: Room }
    | { type: 'roomNotFound' }
    | { type: 'leftRoom' }
    | { type: 'message'; sender: string; content: string }
    | { type: 'error'; message: string }
    | { type: 'errorWithCode'; code: ErrorCode; message?: string }
    | { type: 'roomClosed'; reason: string }
    | { type: 'replay' }
    | { type: 'play' }
    | { type: 'pause' }
    | { type: 'volumeChanged'; volume: number }
    | { type: 'currentTimeChanged'; currentTime: number };
