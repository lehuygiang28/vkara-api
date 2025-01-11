import { Elysia, t } from 'elysia';
import { ElysiaWS } from 'elysia/dist/ws';
import { Redis } from 'ioredis';
import { scheduleCleanupJobs, closeRoom } from './queues/cleanup';
import { wsLogger, roomLogger, redisLogger, logger } from './utils/logger';
import type { ClientMessage, ServerMessage, Room, ClientInfo, YouTubeVideo } from './types';

const port = process.env.PORT || 8000;

// Redis client setup
const redis = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT ? parseInt(process.env.REDIS_PORT) : 6379,
    password: process.env.REDIS_PASSWORD,
});

// Redis subscriber for room notifications
const subscriber = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT ? parseInt(process.env.REDIS_PORT) : 6379,
    password: process.env.REDIS_PASSWORD,
});

subscriber.subscribe('room-notifications', (err) => {
    if (err) {
        redisLogger.error('Failed to subscribe to room notifications', { error: err });
        return;
    }
    redisLogger.info('Subscribed to room notifications');
});

subscriber.on('message', (channel, message) => {
    if (channel === 'room-notifications') {
        try {
            const notification = JSON.parse(message);
            if (notification.type === 'room-closed') {
                const { clientIds, reason, roomId } = notification;
                roomLogger.info(`Processing room closure notification`, { roomId, reason });

                // Notify clients about room closure
                for (const clientId of clientIds) {
                    const ws = wsConnections.get(clientId);
                    if (ws) {
                        sendToClient(ws, {
                            type: 'roomClosed',
                            reason,
                        });
                    }
                }
            }
        } catch (error) {
            redisLogger.error('Error processing room notification', { error });
        }
    }
});

// WebSocket connections map
const wsConnections = new Map<string, ElysiaWS>();

// Elysia app setup
const app = new Elysia({
    websocket: {
        idleTimeout: 960,
    },
})
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
        },
        close: async (ws) => {
            wsLogger.info(`Client disconnected`, { clientId: ws.id });
            await leaveRoom(ws);
            wsConnections.delete(ws.id);
        },
        message: (ws, message: ClientMessage) => handleMessage(ws, message),
    })
    .listen(port);

logger.info(`WebSocket server is running on http://localhost:${port}/ws`);

// Message handler
async function handleMessage(ws: ElysiaWS, message: ClientMessage) {
    switch (message.type) {
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
            await sendMessage(ws, message.message);
            break;
        case 'addVideo':
            await addVideo(ws, message.video);
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
        default:
            sendError(ws, 'Invalid message type');
    }
}

// Room creation
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
        volume: 100,
        playingNow: null,
        lastActivity: Date.now(),
        creatorId: ws.id,
    };

    try {
        await redis.set(`room:${roomId}`, JSON.stringify(room));
        await joinRoomInternal(ws, roomId);
        sendToClient(ws, { type: 'roomCreated', roomId });
        roomLogger.info(`Room created successfully`, { roomId, creatorId: ws.id });
    } catch (error) {
        roomLogger.error(`Failed to create room`, { roomId, error });
        sendError(ws, 'Failed to create room');
    }
}

// Room joining
async function joinRoom(ws: ElysiaWS, roomId: string, password?: string) {
    const roomData = await redis.get(`room:${roomId}`);
    if (!roomData) {
        sendError(ws, 'Room not found');
        return;
    }
    const room: Room = JSON.parse(roomData);
    if (room.password) {
        if (!password || !(await Bun.password.verify(password, room.password))) {
            sendError(ws, 'Incorrect password');
            return;
        }
    }
    await joinRoomInternal(ws, roomId);
    await updateRoomActivity(roomId);
}

async function joinRoomInternal(ws: ElysiaWS, roomId: string) {
    await leaveCurrentRoom(ws);
    const roomData = await redis.get(`room:${roomId}`);
    if (!roomData) return;
    const room: Room = JSON.parse(roomData);
    if (!room.clients.includes(ws.id)) {
        room.clients.push(ws.id);
        await redis.set(`room:${roomId}`, JSON.stringify(room));
    }
    await redis.hset(`client:${ws.id}`, 'roomId', roomId);
    sendToClient(ws, { type: 'joinedRoom', roomId });
    sendToClient(ws, {
        type: 'videoChanged',
        video: room.playingNow,
    });
    sendToClient(ws, {
        type: 'volumeChanged',
        volume: room.volume,
    });
    syncVideoQueue(roomId);
}

// Room leaving
async function leaveRoom(ws: ElysiaWS) {
    await leaveCurrentRoom(ws);
    sendToClient(ws, { type: 'leftRoom' });
}

// Handle room closure by creator
async function handleCloseRoom(ws: ElysiaWS) {
    const roomId = await findRoomIdByClient(ws);
    if (!roomId) {
        wsLogger.warn(`Close room attempt failed - client not in a room`, { clientId: ws.id });
        return sendError(ws, 'Not in a room');
    }

    const roomData = await redis.get(`room:${roomId}`);
    if (!roomData) {
        roomLogger.warn(`Close room attempt failed - room not found`, { roomId });
        return sendError(ws, 'Room not found');
    }

    const room: Room = JSON.parse(roomData);

    if (room.creatorId !== ws.id) {
        roomLogger.warn(`Unauthorized room closure attempt`, {
            roomId,
            attemptedBy: ws.id,
            creatorId: room.creatorId,
        });
        return sendError(ws, 'Only the room creator can close the room');
    }

    roomLogger.info(`Initiating room closure`, { roomId, creatorId: ws.id });
    const closed = await closeRoom(roomId);
    if (!closed) {
        roomLogger.error(`Failed to close room`, { roomId });
        return sendError(ws, 'Failed to close room');
    }
}

// Utility functions
async function leaveCurrentRoom(ws: ElysiaWS) {
    const clientInfo = await getClientInfo(ws.id);
    if (clientInfo && clientInfo.roomId) {
        const roomData = await redis.get(`room:${clientInfo.roomId}`);
        if (roomData) {
            const room: Room = JSON.parse(roomData);
            room.clients = room.clients.filter((id) => id !== ws.id);
            // Update room without removing it
            await redis.set(`room:${clientInfo.roomId}`, JSON.stringify(room));
            broadcastToRoom(clientInfo.roomId, {
                type: 'message',
                sender: 'System',
                content: `User ${ws.id} left the room`,
            });
        }
        await redis.hdel(`client:${ws.id}`, 'roomId');
    }
}

// Message sending
async function sendMessage(ws: ElysiaWS, content: string) {
    const roomId = await findRoomIdByClient(ws);
    if (!roomId) return sendError(ws, 'Not in a room');
    broadcastToRoom(roomId, { type: 'message', sender: ws.id, content });
}

// Video management
async function addVideo(ws: ElysiaWS, video: YouTubeVideo) {
    const roomId = await findRoomIdByClient(ws);
    if (!roomId) {
        wsLogger.warn(`Add video attempt failed - client not in a room`, { clientId: ws.id });
        return sendError(ws, 'Not in a room');
    }

    roomLogger.info(`Adding video to room`, {
        roomId,
        videoId: video.id.videoId,
        title: video.snippet.title,
    });

    const roomData = await redis.get(`room:${roomId}`);
    if (!roomData) return;

    const room: Room = JSON.parse(roomData);
    room.videoQueue.push(video);

    if (!room.playingNow) {
        room.playingNow = video;
        broadcastToRoom(roomId, { type: 'videoChanged', video });
        roomLogger.info(`Started playing video`, {
            roomId,
            videoId: video.id.videoId,
        });
    }

    try {
        await redis.set(`room:${roomId}`, JSON.stringify(room));
        broadcastToRoom(roomId, { type: 'videoAdded', video });
        syncVideoQueue(roomId);
        roomLogger.info(`Video added successfully`, {
            roomId,
            videoId: video.id.videoId,
            queueLength: room.videoQueue.length,
        });
    } catch (error) {
        roomLogger.error(`Failed to add video`, {
            roomId,
            videoId: video.id.videoId,
            error,
        });
    }
}

async function nextVideo(ws: ElysiaWS) {
    const roomId = await findRoomIdByClient(ws);
    if (!roomId) return sendError(ws, 'Not in a room');
    const roomData = await redis.get(`room:${roomId}`);
    if (!roomData) return;
    const room: Room = JSON.parse(roomData);
    if (room.videoQueue.length > 0) {
        const nextVideo = room.videoQueue.shift()!;
        room.playingNow = nextVideo;
        await redis.set(`room:${roomId}`, JSON.stringify(room));
        broadcastToRoom(roomId, { type: 'videoChanged', video: nextVideo });
        syncVideoQueue(roomId);
    } else {
        room.playingNow = null;
        await redis.set(`room:${roomId}`, JSON.stringify(room));
        broadcastToRoom(roomId, { type: 'videoChanged', video: null });
    }
}

// Replay functionality
async function replay(ws: ElysiaWS) {
    const roomId = await findRoomIdByClient(ws);
    if (!roomId) return sendError(ws, 'Not in a room');
    const roomData = await redis.get(`room:${roomId}`);
    if (!roomData) return;
    const room: Room = JSON.parse(roomData);
    if (room.playingNow) {
        broadcastToRoom(roomId, { type: 'videoChanged', video: room.playingNow });
    } else {
        sendError(ws, 'No video is currently playing');
    }
}

// Volume control
async function setVolume(ws: ElysiaWS, volume: number) {
    const roomId = await findRoomIdByClient(ws);
    if (!roomId) return sendError(ws, 'Not in a room');
    const roomData = await redis.get(`room:${roomId}`);
    if (!roomData) return;
    const room: Room = JSON.parse(roomData);
    room.volume = volume;
    await redis.set(`room:${roomId}`, JSON.stringify(room));
    broadcastToRoom(roomId, { type: 'volumeChanged', volume });
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

async function broadcastToRoom(roomId: string, message: ServerMessage) {
    const roomData = await redis.get(`room:${roomId}`);
    if (!roomData) return;
    const room: Room = JSON.parse(roomData);
    const uniqueClients = new Set(room.clients);
    for (const clientId of uniqueClients) {
        const ws = wsConnections.get(clientId);
        if (ws) {
            sendToClient(ws, message);
        } else {
            // Remove disconnected clients from the room
            room.clients = room.clients.filter((id) => id !== clientId);
        }
    }
    // Update the room with potentially removed clients
    await redis.set(`room:${roomId}`, JSON.stringify(room));
}

function sendToClient(ws: ElysiaWS, message: ServerMessage) {
    ws.send(JSON.stringify(message));
}

function sendError(ws: ElysiaWS, message: string) {
    sendToClient(ws, { type: 'error', message });
}

async function syncVideoQueue(roomId: string) {
    const roomData = await redis.get(`room:${roomId}`);
    if (!roomData) return;
    const room: Room = JSON.parse(roomData);
    broadcastToRoom(roomId, { type: 'videoQueueSync', queue: room.videoQueue });
}

async function updateRoomActivity(roomId: string) {
    const roomData = await redis.get(`room:${roomId}`);
    if (!roomData) return;
    const room: Room = JSON.parse(roomData);
    room.lastActivity = Date.now();
    await redis.set(`room:${roomId}`, JSON.stringify(room));
}

// Initialize cleanup jobs
scheduleCleanupJobs().catch(console.error);

export type ElysiaApp = typeof app;
