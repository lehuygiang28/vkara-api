import { Redis } from 'ioredis';
import { Queue, Worker } from 'bullmq';

import { closeRoom } from '@/server';
import type { Room } from '@/types';
import { createContextLogger } from '@/utils/logger';
import { validateDataIntegrity } from '@/mongodb-sync';

const INACTIVE_TIMEOUT = parseInt(process.env.INACTIVE_TIMEOUT || '300') * 1000; // default 5 minutes
const ORPHANED_CLIENT_TIMEOUT = 24 * 60 * 60 * 1000; // 24 hours

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
const worker = new Worker(
    'room-cleanup',
    async (job) => {
        if (job.name === 'validate-integrity') {
            return await validateDataIntegrity(connection);
        } else {
            return await cleanupInactiveRooms();
        }
    },
    {
        connection: connection,
        concurrency: 1,
    },
);

// Handle worker events
worker.on('completed', (job) => {
    logger.debug(`Job ${job.id} (${job.name}) has completed`, { jobId: job.id });
});

worker.on('failed', (job, error) => {
    logger.error(`Job ${job?.id} (${job?.name}) has failed`, {
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
    let cleanedRoomsCount = 0;

    for (const key of keys) {
        const roomData = await connection.get(key);
        if (!roomData) {
            logger.warn(`Room data not found for key: ${key}`);
            continue;
        }

        try {
            const room: Room = JSON.parse(roomData);
            const isInactive = room.lastActivity && now - room.lastActivity > INACTIVE_TIMEOUT;

            // Check if room has no clients
            const isEmpty = !room.clients || room.clients.length === 0;

            if (isInactive || isEmpty) {
                logger.info(`Cleaning up room`, {
                    roomId: room.id,
                    reason: isInactive ? 'inactivity' : 'empty room',
                    lastActivity: new Date(room.lastActivity).toISOString(),
                    clientCount: room.clients.length,
                });

                await closeRoom(
                    room.id,
                    isInactive
                        ? 'Room has been closed due to inactivity'
                        : 'Room has been closed because it had no clients',
                );
                cleanedRoomsCount++;
            }
        } catch (error) {
            logger.error(`Failed to process room ${key}`, { error });
        }
    }

    // Also clean up orphaned clients (clients without a valid roomId)
    await cleanupOrphanedClients();

    return { cleanedRoomsCount };
}

// Function to clean up clients that don't have a valid room reference
async function cleanupOrphanedClients() {
    const clientKeys = await connection.keys('client:*');
    let orphanedClientsCount = 0;
    const now = Date.now();

    logger.info(`Checking ${clientKeys.length} clients for orphaned entries`);

    for (const key of clientKeys) {
        const clientData = await connection.hgetall(key);

        // Check if client has a room reference
        if (!clientData.roomId) {
            // If client has lastSeen, check if it's too old
            if (
                clientData.lastSeen &&
                now - parseInt(clientData.lastSeen) > ORPHANED_CLIENT_TIMEOUT
            ) {
                await connection.del(key);
                orphanedClientsCount++;
            }
            continue;
        }

        // Check if the referenced room exists
        const roomExists = await connection.exists(`room:${clientData.roomId}`);
        if (!roomExists) {
            await connection.del(key);
            orphanedClientsCount++;
        }
    }

    if (orphanedClientsCount > 0) {
        logger.info(`Cleaned up ${orphanedClientsCount} orphaned clients`);
    }

    return { orphanedClientsCount };
}

// Add recurring cleanup jobs
export async function scheduleCleanupJobs() {
    try {
        // Regular cleanup job every 10 minutes
        await cleanupQueue.add(
            'cleanup',
            {},
            {
                repeat: {
                    pattern: '*/10 * * * *', // Every 10 minutes
                },
            },
        );

        // Data integrity validation job (once per day at 3:00 AM)
        await cleanupQueue.add(
            'validate-integrity',
            {},
            {
                repeat: {
                    pattern: '0 3 * * *', // At 3:00 AM every day
                },
            },
        );

        logger.info('Scheduled recurring cleanup and integrity validation jobs');
    } catch (error) {
        logger.error('Failed to schedule cleanup jobs', { error });
        throw error;
    }
}
