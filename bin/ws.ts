import '@/server';
import '@/youtubei';
import { wsServer } from '@/server';
import { searchYoutubeiElysia } from '@/youtubei';

import cors from '@elysiajs/cors';
import swagger from '@elysiajs/swagger';
import { serverTiming } from '@elysiajs/server-timing';
import { rateLimit } from 'elysia-rate-limit';

wsServer
    .use(cors())
    .use(swagger())
    .use(serverTiming())
    .use(
        rateLimit({
            scoping: 'global',
            generator: (req, server) =>
                // get client ip via cloudflare header first
                req.headers.get('CF-Connecting-IP') ??
                // if not found, fallback to default generator
                server?.requestIP(req)?.address ??
                '',
            // max 20 requests per duration
            max: 20,
            // milliseconds
            duration: 1000,
        }),
    )
    .use(searchYoutubeiElysia)
    .listen(process.env.PORT || 8000);
