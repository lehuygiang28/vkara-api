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
    historyQueue: YouTubeVideo[];
    volume: number;
    playingNow: YouTubeVideo | null;
    lastActivity: number;
    creatorId: string;
    isPlaying: boolean;
    currentTime: number;
}

export type ClientMessage =
    | { type: 'ping' }
    | { type: 'createRoom'; password?: string }
    | { type: 'joinRoom'; roomId: string; password?: string }
    | { type: 'leaveRoom' }
    | { type: 'closeRoom' }
    | { type: 'sendMessage'; message: string }
    | { type: 'addVideo'; video: YouTubeVideo }
    | { type: 'playNow'; video: YouTubeVideo }
    | { type: 'nextVideo' }
    | { type: 'setVolume'; volume: number }
    | { type: 'replay' }
    | { type: 'play' }
    | { type: 'pause' }
    | { type: 'seek'; time: number }
    | { type: 'videoFinished' };

export type ServerMessage =
    | { type: 'pong' }
    | { type: 'roomCreated'; roomId: string }
    | { type: 'roomUpdate'; room: Room }
    | { type: 'roomNotFound' }
    | { type: 'leftRoom' }
    | { type: 'message'; sender: string; content: string }
    | { type: 'error'; message: string }
    | { type: 'roomClosed'; reason: string }
    | { type: 'replay' }
    | { type: 'play' }
    | { type: 'pause' }
    | { type: 'volumeChanged'; volume: number }
    | { type: 'currentTimeChanged'; currentTime: number };
