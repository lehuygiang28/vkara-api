import { ElysiaWS } from 'elysia/dist/ws';

export interface ClientInfo {
    id: string;
    roomId?: string;
}

export interface YouTubeVideo {
    id: {
        videoId: string;
    };
    snippet: {
        title: string;
        channelTitle: string;
        thumbnails: {
            default: {
                url: string;
                width: number;
                height: number;
            };
        };
        publishedAt: string;
    };
}

export interface Room {
    id: string;
    password?: string;
    clients: string[];
    videoQueue: YouTubeVideo[];
    volume: number;
    playingNow: YouTubeVideo | null;
    lastActivity: number;
    creatorId: string;
}

export type ClientMessage =
    | { type: 'createRoom'; password?: string }
    | { type: 'joinRoom'; roomId: string; password?: string }
    | { type: 'leaveRoom' }
    | { type: 'closeRoom' }
    | { type: 'sendMessage'; message: string }
    | { type: 'addVideo'; video: YouTubeVideo }
    | { type: 'nextVideo' }
    | { type: 'setVolume'; volume: number }
    | { type: 'replay' };

export type ServerMessage =
    | { type: 'roomCreated'; roomId: string }
    | { type: 'joinedRoom'; roomId: string }
    | { type: 'leftRoom' }
    | { type: 'message'; sender: string; content: string }
    | { type: 'videoAdded'; video: YouTubeVideo }
    | { type: 'videoChanged'; video: YouTubeVideo | null }
    | { type: 'videoQueueSync'; queue: YouTubeVideo[] }
    | { type: 'volumeChanged'; volume: number }
    | { type: 'error'; message: string }
    | { type: 'roomClosed'; reason: string };
