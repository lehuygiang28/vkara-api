import '@/server';
import '@/youtubei';
import { wsServer } from '@/server';
import { searchYoutubeiElysia } from '@/youtubei';

import cors from '@elysiajs/cors';
import swagger from '@elysiajs/swagger';
import { serverTiming } from '@elysiajs/server-timing';
wsServer
    .use(cors())
    .use(swagger())
    .use(serverTiming())
    .use(searchYoutubeiElysia)
    .listen(process.env.PORT || 8000);
