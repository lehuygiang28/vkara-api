import { Elysia, t } from 'elysia';
import { Redis } from 'ioredis';
import { Queue, Worker } from 'bullmq';
import { Client, type VideoCompact, type SearchResult } from 'youtubei';
import youtube from 'youtube-sr';

import { createContextLogger } from '@/utils/logger';
import type { YouTubeVideo } from './types';
import { cleanUpVideoField, formatSeconds } from './utils/common';

const logger = createContextLogger('Search-Youtubei');
const youtubeiLogger = createContextLogger('Queue/Youtubei');
const youtubei = new Client();

// Redis connection
const redis = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT ? parseInt(process.env.REDIS_PORT) : 6379,
    password: process.env.REDIS_PASSWORD,
    maxRetriesPerRequest: null,
});

// Cleanup time in milliseconds (5 minutes)
const CLEANUP_TIMEOUT = 5 * 60 * 1000;

// Create the cleanup queue
const cleanupQueue = new Queue('search-instance-cleanup', { connection: redis });

interface SearchInstanceWithTimestamp {
    instance: SearchResult<'video'>;
    timestamp: number;
}

// Store SearchResult instances in memory
const searchInstances = new Map<string, SearchInstanceWithTimestamp>();

// Cleanup function to remove old instances
const cleanupOldInstances = async () => {
    const now = Date.now();
    let cleaned = 0;

    const keys = await redis.keys('search-instance:*');
    for (const key of keys) {
        const value = await redis.get(key);
        if (value) {
            const timestamp = parseInt(value);
            if (now - timestamp > CLEANUP_TIMEOUT) {
                await redis.del(key);
                searchInstances.delete(key.replace('search-instance:', ''));
                cleaned++;
            }
        }
    }

    if (cleaned > 0) {
        youtubeiLogger.info(`Cleaned up ${cleaned} expired search instances`);
    }
};

// Create a worker to process cleanup jobs
const worker = new Worker(
    'search-instance-cleanup',
    async () => {
        await cleanupOldInstances();
    },
    { connection: redis },
);

// Handle worker events
worker.on('completed', (job) => {
    youtubeiLogger.debug(`Cleanup job ${job.id} has completed`, { jobId: job.id });
});

worker.on('failed', (job, error) => {
    youtubeiLogger.error(`Cleanup job ${job?.id} has failed`, {
        jobId: job?.id,
        error: error.message,
        stack: error.stack,
    });
});

// Schedule cleanup job to run every 5 minutes
const scheduleCleanupYoutubeiInstance = async () => {
    await cleanupQueue.add(
        'cleanup',
        {},
        {
            repeat: {
                pattern: '*/5 * * * *', // Every 5 minutes
            },
        },
    );
    youtubeiLogger.info('Scheduled recurring cleanup job');
};

export const searchYoutubeiElysia = new Elysia({})
    .onStart(() => {
        logger.info('Starting search-youtubei');
        scheduleCleanupYoutubeiInstance().catch(youtubeiLogger.error);
    })
    .state('youtubeiClient', youtubei)
    .state('redisClient', redis)
    .state('searchInstances', searchInstances)
    .post(
        '/search',
        async ({
            body: { query, continuation },
            store: { youtubeiClient, redisClient, searchInstances },
        }): Promise<{
            items: YouTubeVideo[];
            continuation?: string | null;
        }> => {
            let results: SearchResult<'video'> | undefined;
            let newItems: VideoCompact[] = [];
            const processedVideoIds = new Set<string>();

            if (
                continuation &&
                (searchInstances.has(continuation) ||
                    (await redisClient.exists(`search-instance:${continuation}`)))
            ) {
                logger.info(`Continuing search: "${query}"`);
                if (!searchInstances.has(continuation)) {
                    const timestamp = parseInt(
                        (await redisClient.get(`search-instance:${continuation}`)) || '0',
                    );
                    if (timestamp) {
                        results = await youtubeiClient.search(query, {
                            type: 'video',
                            sortBy: 'relevance',
                        });
                        results.continuation = continuation;
                        searchInstances.set(continuation, {
                            instance: results,
                            timestamp: timestamp,
                        });
                    }
                } else {
                    const stored = searchInstances.get(continuation)!;
                    results = stored.instance;
                }

                if (results) {
                    const currentLength = results.items.length;
                    await results.next();
                    const allNewItems = results.items.slice(currentLength);

                    // Filter out duplicate videos
                    newItems = allNewItems.filter((item) => !processedVideoIds.has(item.id));
                    newItems.forEach((item) => processedVideoIds.add(item.id));

                    if (results.continuation) {
                        searchInstances.delete(continuation);
                        searchInstances.set(results.continuation, {
                            instance: results,
                            timestamp: Date.now(),
                        });
                        await redisClient.set(
                            `search-instance:${results.continuation}`,
                            Date.now().toString(),
                        );
                        await redisClient.del(`search-instance:${continuation}`);
                    }
                }
            }

            if (!results) {
                logger.info(`New search: "${query}"`);
                results = await youtubeiClient.search(query, {
                    type: 'video',
                    sortBy: 'relevance',
                });

                // Filter out duplicate videos
                newItems = results.items.filter((item) => !processedVideoIds.has(item.id));
                newItems.forEach((item) => processedVideoIds.add(item.id));
            }

            if (results?.continuation) {
                searchInstances.set(results.continuation, {
                    instance: results,
                    timestamp: Date.now(),
                });
                await redisClient.set(
                    `search-instance:${results.continuation}`,
                    Date.now().toString(),
                );
            }

            const embeddableVideos = await Promise.all(
                newItems.map(async (item) => {
                    const video = mapYoutubeiVideo(item);
                    const isEmbeddable = await checkEmbeddable(video.id);
                    return isEmbeddable ? video : null;
                }),
            ).then((videos) =>
                videos.filter((video): video is NonNullable<typeof video> => video !== null),
            );

            // Log current cache size
            logger.debug(`Current search instances cache size: ${searchInstances.size}`);

            return {
                items: embeddableVideos,
                continuation: results?.continuation,
            };
        },
        {
            body: t.Object({
                query: t.String(),
                continuation: t.Optional(t.String()),
            }),
        },
    )
    .post(
        '/suggestions',
        async ({ body: { query } }): Promise<string[]> => {
            try {
                const suggestions = await youtube.getSuggestions(query);
                return suggestions;
            } catch (error) {
                logger.error('Failed to get suggestions', { error });
                return [];
            }
        },
        {
            body: t.Object({
                query: t.String(),
            }),
        },
    )
    .post(
        '/playlist',
        async ({ body: { playlistUrlOrId } }): Promise<YouTubeVideo[]> => {
            if (!playlistUrlOrId.startsWith('http') && !playlistUrlOrId.includes('youtube.com')) {
                playlistUrlOrId = `https://www.youtube.com/playlist?list=${playlistUrlOrId}&playnext=1`;
            }

            const url = new URL(playlistUrlOrId);
            url.searchParams.set('playnext', '1');

            const results = await youtube.getPlaylist(url.toString(), { fetchAll: true });
            return results.videos.map(cleanUpVideoField);
        },
        {
            body: t.Object({
                playlistUrlOrId: t.String(),
            }),
        },
    )
    .post(
        '/related',
        async ({ body: { videoId }, store: { youtubeiClient } }): Promise<YouTubeVideo[]> => {
            try {
                const video = await youtubeiClient.getVideo(videoId);
                const newItems = video?.related?.items;
                if (!newItems) {
                    return [];
                }

                const videos = await Promise.all(
                    newItems.map(async (item) => {
                        const video = mapYoutubeiVideo(item as VideoCompact);
                        const isEmbeddable = await checkEmbeddable(video.id);
                        return isEmbeddable ? video : null;
                    }),
                );
                const embeddableVideos = videos.filter((video) => video !== null);

                return embeddableVideos;
            } catch (error) {
                logger.error('Failed to get related videos', { error });
                console.error(error);
                return [];
            }
        },
        {
            body: t.Object({
                videoId: t.String(),
            }),
        },
    )
    .post(
        '/check-embeddable',
        async ({ body: { videoIds } }): Promise<{ videoId: string; canEmbed: boolean }[]> => {
            const results = await Promise.all(
                videoIds.map(async (videoId) => ({
                    videoId,
                    canEmbed: await checkEmbeddable(videoId),
                })),
            );

            return results;
        },
        {
            body: t.Object({
                videoIds: t.Array(t.String()),
            }),
        },
    );

const mapYoutubeiVideo = (video: VideoCompact): YouTubeVideo => ({
    id: video.id,
    duration: video.duration || 0,
    duration_formatted: formatSeconds(video.duration),
    thumbnail: {
        url: video.thumbnails[0].url,
    },
    title: video.title,
    type: 'video',
    url: '',
    uploadedAt: video.uploadDate || '',
    views: video.viewCount || 0,
    channel: {
        name: video.channel?.name || 'N/A',
        verified: false,
    },
});

export const checkEmbeddable = async (videoId: string): Promise<boolean> => {
    const baseUrls = [`https://www.youtube-nocookie.com/embed/`, `https://www.youtube.com/embed/`];
    const errString = `Playback on other websites has been disabled by the video own`;
    const stringAbility = `previewPlayabilityStatus`;

    const url = `${baseUrls[Math.floor(Math.random() * baseUrls.length)]}${videoId}`;
    const raw = await fetch(url, {
        method: 'GET',
        headers: {
            'User-Agent': 'Mozilla/5.0',
            'accept-language': 'en-US,en;q=0.9',
            accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        },
    });

    if (!raw.ok) {
        return false;
    }

    const text = await raw.text();
    return !text.includes(errString) && text.includes(stringAbility);
};

export type SearchYoutubeiApp = typeof searchYoutubeiElysia;
