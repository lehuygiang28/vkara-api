import { Elysia, t } from 'elysia';
import { Redis } from 'ioredis';
import { v4 as uuid } from 'uuid';
import { ClientMessage, ServerMessage, Room, ServerState } from './types';
import { ServerWebSocket } from 'bun';

const redis = new Redis({
    host: process.env.REDIS_HOST,
    port: process.env.REDIS_PORT ? parseInt(process.env.REDIS_PORT) : undefined,
    password: process.env.REDIS_PASSWORD || undefined,
});

const state: ServerState = {
    rooms: new Map<string, Room>(),
};

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
        message: (ws, message: ClientMessage) =>
            handleMessage(ws.raw as unknown as ServerWebSocket, message),
    })
    .listen(3000);

console.log('WebSocket server is running on ws://localhost:3000/ws');

async function handleMessage(ws: ServerWebSocket, message: ClientMessage) {
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

async function createRoom(ws: ServerWebSocket, password?: string) {
    const roomId = generateRoomId();
    const room: Room = {
        id: roomId,
        password,
        clients: new Set([ws]),
        videoQueue: [],
        volume: 100,
    };
    state.rooms.set(roomId, room);
    await redis.set(
        `room:${roomId}`,
        JSON.stringify({
            password,
            videoQueue: [],
            volume: 100,
        }),
    );
    sendToClient(ws, { type: 'roomCreated', roomId });
}

async function joinRoom(ws: ServerWebSocket, roomId: string, password?: string) {
    const room = state.rooms.get(roomId);
    if (!room) {
        return sendError(ws, 'Room not found');
    }
    if (room.password && room.password !== password) {
        return sendError(ws, 'Incorrect password');
    }
    room.clients.add(ws);
    sendToClient(ws, { type: 'joinedRoom', roomId });
}

async function leaveRoom(ws: ServerWebSocket) {
    for (const [roomId, room] of state.rooms) {
        if (room.clients.has(ws)) {
            room.clients.delete(ws);
            if (room.clients.size === 0) {
                state.rooms.delete(roomId);
                await redis.del(`room:${roomId}`);
            }
            sendToClient(ws, { type: 'leftRoom' });
            break;
        }
    }
}

async function sendMessage(ws: ServerWebSocket, content: string) {
    const room = findRoomByClient(ws);
    if (!room) return sendError(ws, 'Not in a room');
    broadcastToRoom(room, { type: 'message', sender: 'User', content });
}

async function addVideo(ws: ServerWebSocket, url: string) {
    const room = findRoomByClient(ws);
    if (!room) return sendError(ws, 'Not in a room');
    room.videoQueue.push(url);
    await updateRoomInRedis(room);
    broadcastToRoom(room, { type: 'videoAdded', url });
}

async function nextVideo(ws: ServerWebSocket) {
    const room = findRoomByClient(ws);
    if (!room) return sendError(ws, 'Not in a room');
    if (room.videoQueue.length > 0) {
        const nextUrl = room.videoQueue.shift()!;
        await updateRoomInRedis(room);
        broadcastToRoom(room, { type: 'videoChanged', url: nextUrl });
    }
}

async function setVolume(ws: ServerWebSocket, volume: number) {
    const room = findRoomByClient(ws);
    if (!room) return sendError(ws, 'Not in a room');
    room.volume = volume;
    await updateRoomInRedis(room);
    broadcastToRoom(room, { type: 'volumeChanged', volume });
}

function generateRoomId(): string {
    return Math.floor(10000000 + Math.random() * 90000000).toString();
}

function findRoomByClient(ws: ServerWebSocket): Room | undefined {
    for (const room of state.rooms.values()) {
        if (room.clients.has(ws)) return room;
    }
}

function broadcastToRoom(room: Room, message: ServerMessage) {
    for (const client of room.clients) {
        sendToClient(client, message);
    }
}

function sendToClient(ws: ServerWebSocket, message: ServerMessage) {
    ws.send(JSON.stringify(message));
}

function sendError(ws: ServerWebSocket, message: string) {
    sendToClient(ws, { type: 'error', message });
}

async function updateRoomInRedis(room: Room) {
    await redis.set(
        `room:${room.id}`,
        JSON.stringify({
            password: room.password,
            videoQueue: room.videoQueue,
            volume: room.volume,
        }),
    );
}

export type ElysiaApp = typeof app;
