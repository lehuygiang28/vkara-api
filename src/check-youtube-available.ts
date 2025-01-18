import { Elysia, t } from 'elysia';
import puppeteer, { Browser } from 'puppeteer';
import locateChrome from 'locate-chrome';

import { redis } from './redis';
import { createContextLogger } from './utils/logger';

const executablePath = (await new Promise((resolve) =>
    locateChrome((arg: any) => resolve(arg)),
)) as string;
const logger = createContextLogger('check-youtube-available');
let browser: Browser;

const blockedDomains = [
    'fonts.gstatic.com/s/',
    'youtube-nocookie.com/youtubei/v1/log_event',
    'play.google.com/log',
    'youtube-nocookie.com/favicon.ico',
    'i.ytimg.com',
    'gstatic.com',
    'yt3.ggpht.com',
    'jnn-pa.googleapis.com',
];

const CACHE_PREFIX = 'youtube_embed_status:';
const CACHE_EXPIRATION = 15 * 24 * 60 * 60; // 15 days in seconds

const initBrowser = async () => {
    logger.info('Initializing browser');
    if (!browser) {
        browser = await puppeteer.launch({
            headless: true,
            executablePath: executablePath || '/usr/bin/google-chrome',
            args: [
                '--disable-gpu',
                '--disable-dev-shm-usage',
                '--disable-setuid-sandbox',
                '--no-sandbox',
            ],
        });
        logger.info('Browser initialized successfully');
    } else {
        logger.info('Browser already initialized');
    }
};

const getCachedStatus = async (videoId: string): Promise<boolean | null> => {
    const cachedStatus = await redis.get(`${CACHE_PREFIX}${videoId}`);
    if (cachedStatus !== null) {
        return cachedStatus === 'true';
    }
    return null;
};

const setCachedStatus = async (videoId: string, canEmbed: boolean): Promise<void> => {
    logger.info(`Setting cache for video ${videoId}: ${canEmbed}`);
    await redis.set(`${CACHE_PREFIX}${videoId}`, canEmbed.toString(), 'EX', CACHE_EXPIRATION);
    logger.info(`Cache set successfully for video ${videoId}`);
};

const checkEmbedStatus = async (videoId: string): Promise<boolean> => {
    logger.info(`Checking embed status for video ${videoId}`);

    // Check cache first
    const cachedStatus = await getCachedStatus(videoId);
    if (cachedStatus !== null) {
        logger.info(`HIT: ${videoId}`);
        return cachedStatus;
    }

    logger.info(`MISS: ${videoId}`);
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', (request) => {
        const url = request.url();
        const isBlocked = blockedDomains.some((domain) => url.includes(domain));
        if (isBlocked) {
            logger.debug(`Request blocked: ${url}`);
            request.abort();
        } else {
            request.continue();
        }
    });

    try {
        const url = `https://www.youtube-nocookie.com/embed/${videoId}?rel=0&controls=0&showinfo=0&autoplay=1&mute=1`;

        const response = await page.goto(url, {
            waitUntil: 'load',
            timeout: 8000,
        });

        if (!response) {
            logger.error(`Navigation failed for video ${videoId}`);
            return false;
        }

        if (!response.ok()) {
            logger.error(`HTTP error ${response.status()} for video ${videoId}`);
            return false;
        }

        const canEmbed = await page.evaluate(
            () =>
                !document.body.innerHTML.includes(
                    'Playback on other websites has been disabled by the video owner',
                ),
        );

        logger.info(`Result ${videoId}: ${canEmbed}`);

        // Cache the result
        await setCachedStatus(videoId, canEmbed);

        return canEmbed;
    } catch (error) {
        logger.error(`Error checking video ${videoId}:`, { error });
        return false;
    } finally {
        logger.info(`Closing page for video ${videoId}`);
        await page.close();
    }
};

export const elysiaYoutubeChecker = new Elysia()
    .onStart(() => {
        logger.info('Starting Elysia YouTube Checker');
        return initBrowser();
    })
    .post(
        '/check-embed',
        async ({ body: { videoIds } }) => {
            logger.info(`Received request to check ${videoIds.length} videos`);
            await initBrowser(); // Ensure browser is initialized

            const results = await Promise.all(
                videoIds.map(async (videoId: string) => {
                    const cachedStatus = await getCachedStatus(videoId);
                    if (cachedStatus !== null) {
                        logger.info(`HIT: ${videoId}`);
                        return { videoId, canEmbed: cachedStatus };
                    }
                    const status = await checkEmbedStatus(videoId);
                    return { videoId, canEmbed: status };
                }),
            );

            logger.info(`Finished processing ${videoIds.length} videos`);
            return results;
        },
        {
            body: t.Object({
                videoIds: t.Array(t.String()),
            }),
        },
    );

export type CheckYoutubeApp = typeof elysiaYoutubeChecker;
