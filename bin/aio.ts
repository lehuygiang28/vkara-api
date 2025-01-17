import '@/server';
import '@/check-youtube-available';

import { Elysia } from 'elysia';
import { wsServer as wsServer } from '@/server';
import { elysiaYoutubeChecker } from '@/check-youtube-available';

export const aio = new Elysia()
    .use(wsServer)
    .use(elysiaYoutubeChecker)
    .listen(process.env.PORT || 8000);
