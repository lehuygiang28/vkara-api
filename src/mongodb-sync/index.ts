import { Redis } from 'ioredis';

import type { Room, ClientInfo } from '@/types';
import { createContextLogger } from '@/utils/logger';

import { RoomModel } from './room.schema';
import { ClientModel } from './client.schema';

const logger = createContextLogger('MongoDB');

export async function syncToMongoDB(redis: Redis) {
    if (!process.env.MONGODB_URI) return;

    try {
        // Clear existing data in MongoDB
        await RoomModel.deleteMany({});
        await ClientModel.deleteMany({});

        // Get all room keys
        const roomKeys = await redis.keys('room:*');
        const clientKeys = await redis.keys('client:*');

        // Sync rooms
        const rooms = [];
        for (const key of roomKeys) {
            const roomData = await redis.get(key);
            if (roomData) {
                const room: Room = JSON.parse(roomData);
                rooms.push(room);
            }
        }
        if (rooms.length > 0) {
            await RoomModel.insertMany(rooms);
        }

        // Sync clients
        const clients = [];
        for (const key of clientKeys) {
            const clientData = await redis.hgetall(key);
            if (clientData.roomId) {
                const clientInfo: ClientInfo = {
                    id: key.replace('client:', ''),
                    roomId: clientData.roomId,
                };
                clients.push(clientInfo);
            }
        }
        if (clients.length > 0) {
            await ClientModel.insertMany(clients);
        }

        logger.info('Successfully synced data to MongoDB');
    } catch (error) {
        logger.error('Failed to sync data to MongoDB', { error });
    }
}

export async function syncFromMongoDB(redis: Redis) {
    if (!process.env.MONGODB_URI) return;

    try {
        // Sync rooms from MongoDB to Redis
        const rooms = await RoomModel.find();
        for (const room of rooms) {
            await redis.set(`room:${room.id}`, JSON.stringify(room.toObject()));
        }

        // Sync clients from MongoDB to Redis
        const clients = await ClientModel.find();
        for (const client of clients) {
            if (!client.roomId) continue;
            await redis.hset(`client:${client.id}`, 'roomId', client.roomId);
        }

        logger.info('Successfully synced data from MongoDB');
    } catch (error) {
        logger.error(`Failed to sync data from MongoDB ${error}`, { error });
    }
}
