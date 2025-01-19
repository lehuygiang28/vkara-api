import '@/server';
import '@/check-youtube-available';

import { wsServer as wsServer } from '@/server';

import { Elysia } from 'elysia';
import cors from '@elysiajs/cors';
import swagger from '@elysiajs/swagger';

export const aio = new Elysia()
    .use(cors())
    .use(swagger())
    .use(wsServer)
    .listen(process.env.PORT || 8000);
