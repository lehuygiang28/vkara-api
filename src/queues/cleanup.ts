import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { ElysiaWS } from 'elysia/dist/ws';
import type { Room } from '../types';

const INACTIVE_TIMEOUT = parseInt(process.env.INACTIVE_TIMEOUT || '300') * 1000; // 5 minutes

// Create a new Redis connection for BullMQ
const connection = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT ? parseInt(process.env.REDIS_PORT) : 6379,
    password: process.env.REDIS_PASSWORD,
    maxRetriesPerRequest: null,
});

// Separate Redis connection for the worker
const workerRedis = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT ? parseInt(process.env.REDIS_PORT) : 6379,
    password: process.env.REDIS_PASSWORD,
    maxRetriesPerRequest: null,
});

// Create the cleanup queue
export const cleanupQueue = new Queue('room-cleanup', {
    connection,
    defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: true,
        attempts: 3,
        backoff: {
            type: 'exponential',
            delay: 1000,
        },
    },
});

// Create a worker to process cleanup jobs
const worker = new Worker(
    'room-cleanup',
    async (job) => {
        console.log(`Starting cleanup job ${job.id}`);
        try {
            await cleanupInactiveRooms();
            console.log(`Cleanup job ${job.id} completed successfully`);
        } catch (error) {
            console.error(`Cleanup job ${job.id} failed:`, error);
            throw error;
        }
    },
    {
        connection: workerRedis,
        concurrency: 1,
    },
);

// Handle worker events
worker.on('completed', (job) => {
    console.log(`Job ${job.id} has completed successfully`);
});

worker.on('failed', (job, error) => {
    console.error(`Job ${job?.id} has failed with ${error.message}`);
});

// Function to clean up inactive rooms
async function cleanupInactiveRooms() {
    const keys = await workerRedis.keys('room:*');
    const now = Date.now();

    for (const key of keys) {
        const roomData = await workerRedis.get(key);
        if (!roomData) continue;

        const room: Room = JSON.parse(roomData);
        const isInactive = room.lastActivity && now - room.lastActivity > INACTIVE_TIMEOUT;

        if (isInactive) {
            // Get client IDs for cleanup
            const clientIds = room.clients;

            // Notify connected clients before removing the room
            // We'll use a pub/sub channel to notify the main server
            await workerRedis.publish(
                'room-notifications',
                JSON.stringify({
                    type: 'room-closed',
                    roomId: room.id,
                    clientIds,
                    reason: 'Room has been closed due to inactivity',
                }),
            );

            // Clean up client mappings
            for (const clientId of clientIds) {
                await workerRedis.hdel(`client:${clientId}`, 'roomId');
            }

            // Delete the room
            await workerRedis.del(key);
            console.log(`Room ${room.id} has been removed due to inactivity`);
        }
    }
}

// Add recurring cleanup job (every 5 minutes)
export async function scheduleCleanupJobs() {
    await cleanupQueue.add(
        'cleanup',
        {},
        {
            repeat: {
                // pattern: '*/5 * * * *', // Every 5 minutes
                pattern: '* * * * *', // Every 5 minutes
            },
        },
    );
    console.log('Scheduled recurring cleanup job');
}

// Function to manually close a room
export async function closeRoom(roomId: string) {
    const roomData = await connection.get(`room:${roomId}`);
    if (!roomData) return false;

    const room: Room = JSON.parse(roomData);

    // Get client IDs for cleanup
    const clientIds = room.clients;

    // Notify about room closure through pub/sub
    await connection.publish(
        'room-notifications',
        JSON.stringify({
            type: 'room-closed',
            roomId: room.id,
            clientIds,
            reason: 'Room has been closed by the creator',
        }),
    );

    // Clean up client mappings
    for (const clientId of clientIds) {
        await connection.hdel(`client:${clientId}`, 'roomId');
    }

    // Delete the room
    await connection.del(`room:${roomId}`);
    console.log(`Room ${roomId} has been closed by creator`);
    return true;
}
