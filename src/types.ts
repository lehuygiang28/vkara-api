import { ServerWebSocket } from 'bun';

export interface Room {
    id: string;
    password?: string;
    clients: Set<ServerWebSocket>;
    videoQueue: string[];
    volume: number;
}

export interface ServerState {
    rooms: Map<string, Room>;
}

export type ClientMessage =
    | { type: 'createRoom'; password?: string }
    | { type: 'joinRoom'; roomId: string; password?: string }
    | { type: 'leaveRoom' }
    | { type: 'sendMessage'; message: string }
    | { type: 'addVideo'; url: string }
    | { type: 'nextVideo' }
    | { type: 'setVolume'; volume: number };

export type ServerMessage =
    | { type: 'roomCreated'; roomId: string }
    | { type: 'joinedRoom'; roomId: string }
    | { type: 'leftRoom' }
    | { type: 'message'; sender: string; content: string }
    | { type: 'videoAdded'; url: string }
    | { type: 'videoChanged'; url: string }
    | { type: 'volumeChanged'; volume: number }
    | { type: 'error'; message: string };
