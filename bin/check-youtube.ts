import '@/check-youtube-available';

import { elysiaYoutubeChecker } from '@/check-youtube-available';
import cors from '@elysiajs/cors';
import swagger from '@elysiajs/swagger';

elysiaYoutubeChecker
    .use(cors())
    .use(swagger())
    .listen(process.env.CHECK_YOUTUBE_PORT || 8001);
