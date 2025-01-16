import { Elysia, t } from 'elysia';
import puppeteer, { Browser } from 'puppeteer';
import { redis } from './redis';
import { createContextLogger } from './utils/logger';

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
    if (!browser) {
        browser = await puppeteer.launch({
            headless: true,
        });
    }
};

const getCachedStatus = async (videoId: string): Promise<boolean | null> => {
    const cachedStatus = await redis.get(`${CACHE_PREFIX}${videoId}`);
    return cachedStatus ? cachedStatus === 'true' : null;
};

const setCachedStatus = async (videoId: string, canEmbed: boolean): Promise<void> => {
    await redis.set(`${CACHE_PREFIX}${videoId}`, canEmbed.toString(), 'EX', CACHE_EXPIRATION);
};

const checkEmbedStatus = async (videoId: string): Promise<boolean> => {
    // Check cache first
    const cachedStatus = await getCachedStatus(videoId);
    if (cachedStatus !== null) {
        return cachedStatus;
    }

    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', (request) => {
        const url = request.url();
        const isBlocked = blockedDomains.some((domain) => url.includes(domain));
        if (isBlocked) {
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
            () => !document.body.innerHTML.includes('Video unavailable'),
        );

        // Cache the result
        await setCachedStatus(videoId, canEmbed);

        return canEmbed;
    } catch (error) {
        logger.error(`Error checking video ${videoId}:`, { error });
        return false;
    } finally {
        await page.close();
    }
};

export const elysiaYoutubeChecker = new Elysia()
    .onStart(initBrowser)
    .post(
        '/check-embed',
        async ({ body: { videoIds } }) => {
            await initBrowser(); // Ensure browser is initialized

            const results = await Promise.all(
                videoIds.map(async (videoId: string) => {
                    const cachedStatus = await getCachedStatus(videoId);
                    if (cachedStatus !== null) {
                        return { videoId, canEmbed: cachedStatus };
                    }
                    return {
                        videoId,
                        canEmbed: await checkEmbedStatus(videoId),
                    };
                }),
            );

            return results;
        },
        {
            body: t.Object({
                videoIds: t.Array(t.String()),
            }),
        },
    )
    .listen(8001);
