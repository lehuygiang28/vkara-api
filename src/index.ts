import { Elysia, t } from 'elysia';
import { ElysiaWS } from 'elysia/dist/ws';
import { Redis } from 'ioredis';

// Type definitions
interface ClientInfo {
    id: string;
    roomId?: string;
}

interface Room {
    id: string;
    password?: string;
    clients: string[];
    videoQueue: string[];
    volume: number;
}

type ClientMessage =
    | { type: 'createRoom'; password?: string }
    | { type: 'joinRoom'; roomId: string; password?: string }
    | { type: 'leaveRoom' }
    | { type: 'sendMessage'; message: string }
    | { type: 'addVideo'; url: string }
    | { type: 'nextVideo' }
    | { type: 'setVolume'; volume: number };

type ServerMessage =
    | { type: 'roomCreated'; roomId: string }
    | { type: 'joinedRoom'; roomId: string }
    | { type: 'leftRoom' }
    | { type: 'message'; sender: string; content: string }
    | { type: 'videoAdded'; url: string }
    | { type: 'videoChanged'; url: string }
    | { type: 'volumeChanged'; volume: number }
    | { type: 'error'; message: string };

// Redis client setup
const redis = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT ? parseInt(process.env.REDIS_PORT) : 6379,
    password: process.env.REDIS_PASSWORD,
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
            console.log(`Client connected: ${ws.id}`);
            wsConnections.set(ws.id, ws);
        },
        close: async (ws) => {
            console.log(`Client disconnected: ${ws.id}`);
            await leaveRoom(ws);
            wsConnections.delete(ws.id);
        },
        message: (ws, message: ClientMessage) => handleMessage(ws, message),
    })
    .listen(3000);

console.log('WebSocket server is running on ws://localhost:3000/ws');

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
        case 'sendMessage':
            await sendMessage(ws, message.message);
            break;
        case 'addVideo':
            await addVideo(ws, message.url);
            break;
        case 'nextVideo':
            await nextVideo(ws);
            break;
        case 'setVolume':
            await setVolume(ws, message.volume);
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

    const room: Room = {
        id: roomId,
        password,
        clients: [ws.id],
        videoQueue: [],
        volume: 100,
    };

    await redis.set(`room:${roomId}`, JSON.stringify(room));
    await joinRoomInternal(ws, roomId);
    sendToClient(ws, { type: 'roomCreated', roomId });
}

// Room joining
async function joinRoom(ws: ElysiaWS, roomId: string, password?: string) {
    const roomData = await redis.get(`room:${roomId}`);
    if (!roomData) {
        sendError(ws, 'Room not found');
        return;
    }
    const room: Room = JSON.parse(roomData);
    if (room.password && room.password !== password) {
        sendError(ws, 'Incorrect password');
        return;
    }
    await joinRoomInternal(ws, roomId);
}

async function joinRoomInternal(ws: ElysiaWS, roomId: string) {
    await leaveCurrentRoom(ws);
    const roomData = await redis.get(`room:${roomId}`);
    if (!roomData) return;
    const room: Room = JSON.parse(roomData);
    room.clients.push(ws.id);
    await redis.set(`room:${roomId}`, JSON.stringify(room));
    await redis.hset(`client:${ws.id}`, 'roomId', roomId);
    sendToClient(ws, { type: 'joinedRoom', roomId });
    broadcastToRoom(roomId, {
        type: 'videoChanged',
        url: room.videoQueue[0] || '',
    });
    broadcastToRoom(roomId, {
        type: 'volumeChanged',
        volume: room.volume,
    });
}

// Room leaving
async function leaveRoom(ws: ElysiaWS) {
    await leaveCurrentRoom(ws);
    sendToClient(ws, { type: 'leftRoom' });
}

async function leaveCurrentRoom(ws: ElysiaWS) {
    const clientInfo = await getClientInfo(ws.id);
    if (clientInfo && clientInfo.roomId) {
        const roomData = await redis.get(`room:${clientInfo.roomId}`);
        if (roomData) {
            const room: Room = JSON.parse(roomData);
            room.clients = room.clients.filter((id) => id !== ws.id);
            if (room.clients.length === 0) {
                await redis.del(`room:${clientInfo.roomId}`);
                console.log(`Room ${clientInfo.roomId} has been removed as it's empty.`);
            } else {
                await redis.set(`room:${clientInfo.roomId}`, JSON.stringify(room));
                broadcastToRoom(clientInfo.roomId, {
                    type: 'message',
                    sender: 'System',
                    content: `User ${ws.id} left the room`,
                });
            }
        }
        await redis.del(`client:${ws.id}`);
    }
}

// Message sending
async function sendMessage(ws: ElysiaWS, content: string) {
    const roomId = await findRoomIdByClient(ws);
    if (!roomId) return sendError(ws, 'Not in a room');
    broadcastToRoom(roomId, { type: 'message', sender: ws.id, content });
}

// Video management
async function addVideo(ws: ElysiaWS, url: string) {
    const roomId = await findRoomIdByClient(ws);
    if (!roomId) return sendError(ws, 'Not in a room');
    const roomData = await redis.get(`room:${roomId}`);
    if (!roomData) return;
    const room: Room = JSON.parse(roomData);
    room.videoQueue.push(url);
    await redis.set(`room:${roomId}`, JSON.stringify(room));
    broadcastToRoom(roomId, { type: 'videoAdded', url });
}

async function nextVideo(ws: ElysiaWS) {
    const roomId = await findRoomIdByClient(ws);
    if (!roomId) return sendError(ws, 'Not in a room');
    const roomData = await redis.get(`room:${roomId}`);
    if (!roomData) return;
    const room: Room = JSON.parse(roomData);
    if (room.videoQueue.length > 0) {
        const nextUrl = room.videoQueue.shift()!;
        await redis.set(`room:${roomId}`, JSON.stringify(room));
        broadcastToRoom(roomId, { type: 'videoChanged', url: nextUrl });
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

// Utility functions
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
    for (const clientId of room.clients) {
        const ws = wsConnections.get(clientId);
        if (ws) {
            sendToClient(ws, message);
        }
    }
}

function sendToClient(ws: ElysiaWS, message: ServerMessage) {
    ws.send(JSON.stringify(message));
}

function sendError(ws: ElysiaWS, message: string) {
    sendToClient(ws, { type: 'error', message });
}

export type ElysiaApp = typeof app;
