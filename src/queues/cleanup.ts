import { Redis } from 'ioredis';
import { Queue, Worker } from 'bullmq';

import { closeRoom } from '@/server';
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

            await closeRoom(room.id, 'Room has been closed due to inactivity');
        }
    }
}

// Add recurring cleanup job (every 10 minutes)
export async function scheduleCleanupJobs() {
    try {
        await cleanupQueue.add(
            'cleanup',
            {},
            {
                repeat: {
                    pattern: '*/10 * * * *', // Every 10 minutes
                },
            },
        );
        logger.info('Scheduled recurring cleanup job');
    } catch (error) {
        logger.error('Failed to schedule cleanup jobs', { error });
        throw error;
    }
}
