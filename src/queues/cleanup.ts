import { Redis } from 'ioredis';
import { Queue, Worker } from 'bullmq';

import type { Room } from '@/types';
import { createContextLogger } from '@/utils/logger';

const INACTIVE_TIMEOUT = parseInt(process.env.INACTIVE_TIMEOUT || '300') * 1000; // default 5 minutes

const logger = createContextLogger('Queue/Cleanup');

const connection = new Redis({
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
const worker = new Worker('room-cleanup', async () => await cleanupInactiveRooms(), {
    connection: connection,
    concurrency: 1,
});

// Handle worker events
worker.on('completed', (job) => {
    logger.debug(`Cleanup job ${job.id} has completed`, { jobId: job.id });
});

worker.on('failed', (job, error) => {
    logger.error(`Cleanup job ${job?.id} has failed`, {
        jobId: job?.id,
        error: error.message,
        stack: error.stack,
    });
});

// Function to clean up inactive rooms
async function cleanupInactiveRooms() {
    const keys = await connection.keys('room:*');
    const now = Date.now();

    logger.info(`Starting cleanup check for ${keys.length} rooms`);

    for (const key of keys) {
        const roomData = await connection.get(key);
        if (!roomData) {
            logger.warn(`Room data not found for key: ${key}`);
            continue;
        }

        const room: Room = JSON.parse(roomData);
        const isInactive = room.lastActivity && now - room.lastActivity > INACTIVE_TIMEOUT;

        if (isInactive) {
            logger.info(`Cleaning up inactive room`, {
                roomId: room.id,
                lastActivity: new Date(room.lastActivity).toISOString(),
                clientCount: room.clients.length,
            });

            // Get client IDs for cleanup
            const clientIds = room.clients;

            // Notify connected clients before removing the room
            // We'll use a pub/sub channel to notify the main server
            await connection.publish(
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
                await connection.hdel(`client:${clientId}`, 'roomId');
            }

            // Delete the room
            await connection.del(key);
            logger.info(`Room ${room.id} has been removed due to inactivity`, {
                roomId: room.id,
                inactiveDuration: now - room.lastActivity,
            });
        }
    }

    logger.info('Cleanup check completed');
}

// Add recurring cleanup job (every 5 minutes)
export async function scheduleCleanupJobs() {
    try {
        await cleanupQueue.add(
            'cleanup',
            {},
            {
                repeat: {
                    pattern: '*/5 * * * *', // Every 5 minutes
                },
            },
        );
        logger.info('Scheduled recurring cleanup job');
    } catch (error) {
        logger.error('Failed to schedule cleanup jobs', { error });
        throw error;
    }
}
