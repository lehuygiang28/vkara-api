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
    | { type: 'videoFinished' }
    | { type: 'syncRequest' };

export type ServerMessage =
    | { type: 'roomCreated'; roomId: string }
    | { type: 'roomUpdate'; room: Room }
    | { type: 'leftRoom' }
    | { type: 'message'; sender: string; content: string }
    | { type: 'error'; message: string }
    | { type: 'roomClosed'; reason: string };
