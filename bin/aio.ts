import '@/server';
import '@/check-youtube-available';

import { wsServer as wsServer } from '@/server';
import { elysiaYoutubeChecker } from '@/check-youtube-available';

import { Elysia } from 'elysia';
import cors from '@elysiajs/cors';
import swagger from '@elysiajs/swagger';

export const aio = new Elysia()
    .use(cors())
    .use(swagger())
    .use(wsServer)
    .use(elysiaYoutubeChecker)
    .listen(process.env.PORT || 8000);
