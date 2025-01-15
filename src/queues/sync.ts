import { Redis } from 'ioredis';
import { Queue, Worker } from 'bullmq';

import { createContextLogger } from '@/utils/logger';
import { syncToMongoDB } from '@/mongodb-sync';

const logger = createContextLogger('Queue/Sync');

// Create a new Redis connection for BullMQ
const connection = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT ? parseInt(process.env.REDIS_PORT) : 6379,
    password: process.env.REDIS_PASSWORD,
    maxRetriesPerRequest: null,
});

// Create the sync queue
export const syncRedisToDb = new Queue('sync-redis-to-db', {
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
const worker = new Worker('sync-redis-to-db', async () => await syncToMongoDB(connection), {
    connection,
    concurrency: 1,
});

// Handle worker events
worker.on('completed', (job) => {
    logger.debug(`Sync job ${job.id} has completed`, { jobId: job.id });
});

worker.on('failed', (job, error) => {
    logger.error(`Sync job ${job?.id} has failed`, {
        jobId: job?.id,
        error: error.message,
        stack: error.stack,
    });
});

export async function scheduleSyncRedisToDb() {
    try {
        await syncRedisToDb.add(
            'sync',
            {},
            {
                repeat: {
                    pattern: '*/10 * * * *', // Every 10 minutes
                },
            },
        );
        logger.info('Scheduled recurring sync job');
    } catch (error) {
        logger.error('Failed to schedule sync jobs', { error });
        throw error;
    }
}
