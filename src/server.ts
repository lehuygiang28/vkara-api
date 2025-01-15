import { Elysia, t } from 'elysia';
import { ElysiaWS } from 'elysia/dist/ws';
import { Redis } from 'ioredis';
import { scheduleCleanupJobs } from './queues/cleanup';
import { wsLogger, roomLogger, logger } from './utils/logger';
import { shuffleArray } from './utils/common';
import type { ClientMessage, ServerMessage, Room, ClientInfo, YouTubeVideo } from './types';
import { ErrorCode, RoomError } from './errors';

const redis = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT ? parseInt(process.env.REDIS_PORT) : 6379,
    password: process.env.REDIS_PASSWORD,
});

export const wsConnections = new Map<string, ElysiaWS>();

// Core utilities
export function sendToClient(ws: ElysiaWS, message: ServerMessage) {
    return ws.send(JSON.stringify(message));
}

function handleError(ws: ElysiaWS, error: Error | RoomError) {
    if (error instanceof RoomError) {
        sendToClient(ws, {
            type: 'errorWithCode',
            code: error.code,
            message: error.message,
        });
    } else {
        sendToClient(ws, {
            type: 'error',
            message: 'An unexpected error occurred',
        });
        logger.error('Unexpected error', { error });
    }
}

// Room utilities
async function validateRoom(roomId: string): Promise<Room> {
    const roomData = await redis.get(`room:${roomId}`);
    if (!roomData) {
        throw new RoomError(ErrorCode.ROOM_NOT_FOUND);
    }
    return JSON.parse(roomData);
}

async function validateClientInRoom(ws: ElysiaWS): Promise<string> {
    const roomId = await findRoomIdByClient(ws);
    if (!roomId) {
        throw new RoomError(ErrorCode.NOT_IN_ROOM);
    }
    return roomId;
}

async function getClientInfo(wsId: string): Promise<ClientInfo | null> {
    const clientInfo = await redis.hgetall(`client:${wsId}`);
    return clientInfo.roomId ? { id: wsId, roomId: clientInfo.roomId } : null;
}

async function findRoomIdByClient(ws: ElysiaWS): Promise<string | undefined> {
    const clientInfo = await getClientInfo(ws.id);
    return clientInfo?.roomId;
}

function generateRoomId(): string {
    return Math.floor(10000000 + Math.random() * 90000000).toString();
}

async function roomIdExists(roomId: string): Promise<boolean> {
    return Boolean(await redis.exists(`room:${roomId}`));
}

// Room operations
async function createRoom(ws: ElysiaWS, password?: string) {
    let roomId: string;
    let roomExists: boolean;

    do {
        roomId = generateRoomId();
        roomExists = await roomIdExists(roomId);
    } while (roomExists);

    roomLogger.info(`Creating new room`, { roomId, creatorId: ws.id });

    const room: Room = {
        id: roomId,
        password: password
            ? await Bun.password.hash(password, {
                  algorithm: 'bcrypt',
                  cost: 4,
              })
            : undefined,
        clients: [ws.id],
        videoQueue: [],
        historyQueue: [],
        volume: 100,
        playingNow: null,
        lastActivity: Date.now(),
        creatorId: ws.id,
        isPlaying: false,
        currentTime: 0,
    };

    await redis.set(`room:${roomId}`, JSON.stringify(room));
    await joinRoomInternal(ws, roomId);
    sendToClient(ws, { type: 'roomCreated', roomId });
}

async function joinRoom(ws: ElysiaWS, roomId: string, password?: string) {
    const room = await validateRoom(roomId);

    if (room.password && (!password || !(await Bun.password.verify(password, room.password)))) {
        throw new RoomError(ErrorCode.INCORRECT_PASSWORD);
    }

    await joinRoomInternal(ws, roomId);
    await updateRoomActivity(roomId);
}

async function joinRoomInternal(ws: ElysiaWS, roomId: string) {
    await leaveCurrentRoom(ws);

    const room = await validateRoom(roomId);

    if (!room.clients.includes(ws.id)) {
        room.clients.push(ws.id);
        await redis.set(`room:${roomId}`, JSON.stringify(room));
    }

    ws.subscribe(roomId);

    await Promise.all([
        redis.hset(`client:${ws.id}`, 'roomId', roomId),
        sendRoomUpdate(ws, roomId),
    ]);
}

async function leaveRoom(ws: ElysiaWS) {
    await leaveCurrentRoom(ws);
    sendToClient(ws, { type: 'leftRoom' });
}

async function leaveCurrentRoom(ws: ElysiaWS) {
    const clientInfo = await getClientInfo(ws.id);
    if (clientInfo?.roomId) {
        ws.unsubscribe(clientInfo.roomId);
        const room = await validateRoom(clientInfo.roomId);
        room.clients = room.clients.filter((id) => id !== ws.id);
        await redis.set(`room:${clientInfo.roomId}`, JSON.stringify(room));
        await redis.hdel(`client:${ws.id}`, 'roomId');
        await updateRoomActivity(clientInfo.roomId);
    }
}

async function handleCloseRoom(ws: ElysiaWS) {
    const roomId = await validateClientInRoom(ws);
    const room = await validateRoom(roomId);

    if (room.creatorId !== ws.id) {
        throw new RoomError(ErrorCode.NOT_CREATOR_OF_ROOM);
    }

    await closeRoom(roomId);
}

async function closeRoom(roomId: string) {
    const room = await validateRoom(roomId);

    for (const clientId of room.clients) {
        const ws = wsConnections.get(clientId);
        if (ws) {
            ws.unsubscribe(roomId);
            sendToClient(ws, {
                type: 'roomClosed',
                reason: 'Room closed by creator',
            });
        }
        await redis.hdel(`client:${clientId}`, 'roomId');
    }

    await redis.del(`room:${roomId}`);
}

// Video operations
async function addVideo(ws: ElysiaWS, video: YouTubeVideo) {
    const roomId = await validateClientInRoom(ws);
    const room = await validateRoom(roomId);

    if (room.videoQueue.some((v) => v.id === video.id)) {
        throw new RoomError(ErrorCode.ALREADY_IN_QUEUE);
    }

    if (!room?.playingNow && room?.videoQueue?.length <= 0) {
        room.playingNow = video;
        room.isPlaying = true;
        room.currentTime = 0;
    } else {
        room.videoQueue.push(video);
    }
    room.lastActivity = Date.now();

    await Promise.all([
        redis.set(`room:${roomId}`, JSON.stringify(room)),
        broadcastToRoom(roomId, { type: 'roomUpdate', room }),
    ]);
}

async function playVideoNow(ws: ElysiaWS, video: YouTubeVideo) {
    const roomId = await validateClientInRoom(ws);
    const room = await validateRoom(roomId);

    if (room.playingNow) {
        room.historyQueue = room.historyQueue.filter((v) => v.id !== video.id);
        room.historyQueue.unshift(room.playingNow);
    }

    room.playingNow = video;
    room.isPlaying = true;
    room.currentTime = 0;
    room.videoQueue = room.videoQueue.filter((v) => v.id !== video.id);
    room.lastActivity = Date.now();

    await Promise.all([
        redis.set(`room:${roomId}`, JSON.stringify(room)),
        broadcastToRoom(roomId, { type: 'roomUpdate', room }),
    ]);
}

async function nextVideo(ws: ElysiaWS) {
    const roomId = await validateClientInRoom(ws);
    const room = await validateRoom(roomId);

    if (room.videoQueue.length > 0) {
        const nextVideo = room.videoQueue.shift()!;
        if (room.playingNow) {
            room.historyQueue.unshift(room.playingNow);
        }
        room.playingNow = nextVideo;
        room.isPlaying = true;
        room.currentTime = 0;
    } else {
        room.playingNow = null;
        room.isPlaying = false;
        room.currentTime = 0;
    }

    room.lastActivity = Date.now();

    await Promise.all([
        redis.set(`room:${roomId}`, JSON.stringify(room)),
        broadcastToRoom(roomId, { type: 'roomUpdate', room }),
    ]);
}

// Playback operations
async function setVolume(ws: ElysiaWS, volume: number) {
    const roomId = await validateClientInRoom(ws);
    const room = await validateRoom(roomId);

    room.volume = Math.min(100, Math.max(0, volume));
    room.lastActivity = Date.now();

    await Promise.all([
        redis.set(`room:${roomId}`, JSON.stringify(room)),
        broadcastToRoom(roomId, { type: 'volumeChanged', volume: room.volume }),
    ]);
}

async function play(ws: ElysiaWS) {
    const roomId = await validateClientInRoom(ws);
    const room = await validateRoom(roomId);

    room.isPlaying = true;
    room.lastActivity = Date.now();

    await Promise.all([
        redis.set(`room:${roomId}`, JSON.stringify(room)),
        broadcastToRoom(roomId, { type: 'play' }),
    ]);
}

async function pause(ws: ElysiaWS) {
    const roomId = await validateClientInRoom(ws);
    const room = await validateRoom(roomId);

    room.isPlaying = false;
    room.lastActivity = Date.now();

    await Promise.all([
        redis.set(`room:${roomId}`, JSON.stringify(room)),
        broadcastToRoom(roomId, { type: 'pause' }),
    ]);
}

async function seek(ws: ElysiaWS, time: number) {
    const roomId = await validateClientInRoom(ws);
    const room = await validateRoom(roomId);

    room.currentTime = time;
    room.lastActivity = Date.now();

    await Promise.all([
        redis.set(`room:${roomId}`, JSON.stringify(room)),
        broadcastToRoom(roomId, { type: 'currentTimeChanged', currentTime: time }),
    ]);
}

async function replay(ws: ElysiaWS) {
    const roomId = await validateClientInRoom(ws);
    const room = await validateRoom(roomId);

    if (!room.playingNow) {
        throw new RoomError(ErrorCode.INVALID_MESSAGE, 'No video is currently playing');
    }

    room.currentTime = 0;
    room.isPlaying = true;
    room.lastActivity = Date.now();

    await Promise.all([
        redis.set(`room:${roomId}`, JSON.stringify(room)),
        broadcastToRoom(roomId, { type: 'replay' }),
    ]);
}

async function moveVideoToTop(ws: ElysiaWS, videoId: string) {
    const roomId = await validateClientInRoom(ws);
    const room = await validateRoom(roomId);

    const videoForMove = room.videoQueue.find((v) => v.id === videoId);
    if (!videoForMove) {
        throw new RoomError(ErrorCode.VIDEO_NOT_FOUND, 'Video not found in queue');
    }

    room.videoQueue = room.videoQueue.filter((v) => v.id !== videoId);
    room.videoQueue.unshift(videoForMove);
    room.lastActivity = Date.now();

    await Promise.all([
        redis.set(`room:${roomId}`, JSON.stringify(room)),
        broadcastToRoom(roomId, { type: 'roomUpdate', room }),
    ]);
}

async function shuffleQueue(ws: ElysiaWS) {
    const roomId = await validateClientInRoom(ws);
    const room = await validateRoom(roomId);

    room.videoQueue = shuffleArray(room.videoQueue);
    room.lastActivity = Date.now();

    await Promise.all([
        redis.set(`room:${roomId}`, JSON.stringify(room)),
        broadcastToRoom(roomId, { type: 'roomUpdate', room }),
    ]);
}

async function clearQueue(ws: ElysiaWS) {
    const roomId = await validateClientInRoom(ws);
    const room = await validateRoom(roomId);

    room.videoQueue = [];
    room.lastActivity = Date.now();

    await Promise.all([
        redis.set(`room:${roomId}`, JSON.stringify(room)),
        broadcastToRoom(roomId, { type: 'roomUpdate', room }),
    ]);
}

async function clearHistory(ws: ElysiaWS) {
    const roomId = await validateClientInRoom(ws);
    const room = await validateRoom(roomId);

    room.historyQueue = [];
    room.lastActivity = Date.now();

    await Promise.all([
        redis.set(`room:${roomId}`, JSON.stringify(room)),
        broadcastToRoom(roomId, { type: 'roomUpdate', room }),
    ]);
}

async function removeVideoFromQueue(ws: ElysiaWS, videoId: string) {
    const roomId = await validateClientInRoom(ws);
    const room = await validateRoom(roomId);

    room.videoQueue = room.videoQueue.filter((v) => v.id !== videoId);
    room.lastActivity = Date.now();

    await Promise.all([
        redis.set(`room:${roomId}`, JSON.stringify(room)),
        broadcastToRoom(roomId, { type: 'roomUpdate', room }),
    ]);
}

// Broadcasting utilities
async function broadcastToRoom(roomId: string, message: ServerMessage): Promise<void> {
    app.server?.publish(roomId, JSON.stringify(message));
}

async function sendRoomUpdate(ws: ElysiaWS, roomId: string) {
    const room = await validateRoom(roomId);
    sendToClient(ws, { type: 'roomUpdate', room });
}

async function updateRoomActivity(roomId: string) {
    const room = await validateRoom(roomId);
    room.lastActivity = Date.now();
    await redis.set(`room:${roomId}`, JSON.stringify(room));
}

// Message handler
async function handleMessage(ws: ElysiaWS, message: ClientMessage) {
    try {
        if (message?.requiresAck && message.id) {
            sendToClient(ws, { type: 'ack', messageId: message.id });
        }

        switch (message.type) {
            case 'ping':
                sendToClient(ws, { type: 'pong' });
                break;

            case 'createRoom':
                await createRoom(ws, message.password);
                break;

            case 'joinRoom':
                await joinRoom(ws, message.roomId, message.password);
                break;

            case 'leaveRoom':
                await leaveRoom(ws);
                break;

            case 'closeRoom':
                await handleCloseRoom(ws);
                break;

            case 'sendMessage':
                const roomId = await validateClientInRoom(ws);
                await broadcastToRoom(roomId, {
                    type: 'message',
                    sender: ws.id,
                    content: message.message,
                });
                break;

            case 'addVideo':
                await addVideo(ws, message.video);
                break;

            case 'playNow':
                await playVideoNow(ws, message.video);
                break;

            case 'nextVideo':
                await nextVideo(ws);
                break;

            case 'setVolume':
                await setVolume(ws, message.volume);
                break;

            case 'replay':
                await replay(ws);
                break;

            case 'play':
                await play(ws);
                break;

            case 'pause':
                await pause(ws);
                break;

            case 'seek':
                await seek(ws, message.time);
                break;

            case 'videoFinished':
                await nextVideo(ws);
                break;

            case 'moveToTop':
                await moveVideoToTop(ws, message.videoId);
                break;

            case 'shuffleQueue':
                await shuffleQueue(ws);
                break;

            case 'clearQueue':
                await clearQueue(ws);
                break;

            case 'clearHistory':
                await clearHistory(ws);
                break;

            case 'removeVideoFromQueue':
                await removeVideoFromQueue(ws, message.videoId);
                break;

            default:
                throw new RoomError(ErrorCode.INVALID_MESSAGE);
        }
    } catch (error) {
        handleError(ws, error instanceof Error ? error : new Error('Unknown error'));
    }
}

// Initialize app
const app = new Elysia({
    websocket: {
        idleTimeout: 960,
    },
})
    .state('wsConnections', wsConnections)
    .ws('/ws', {
        schema: {
            body: t.Object({
                type: t.String(),
                payload: t.Any(),
            }),
        },
        open: async (ws) => {
            wsLogger.info(`Client connected`, { clientId: ws.id });
            wsConnections.set(ws.id, ws);
            sendToClient(ws, { type: 'pong' });
        },
        close: async (ws) => {
            wsLogger.info(`Client disconnected`, { clientId: ws.id });
            await leaveRoom(ws);
            wsConnections.delete(ws.id);
        },
        message: (ws, message: ClientMessage) => handleMessage(ws, message),
    })
    .listen(process.env.PORT || 8000);

// Initialize cleanup jobs
scheduleCleanupJobs().catch(console.error);

export type ElysiaApp = typeof app;
