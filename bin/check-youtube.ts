import '@/check-youtube-available';

import { elysiaYoutubeChecker } from '@/check-youtube-available';
import cors from '@elysiajs/cors';

elysiaYoutubeChecker.use(cors()).listen(process.env.CHECK_YOUTUBE_PORT || 8001);
