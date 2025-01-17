import '@/check-youtube-available';

import { elysiaYoutubeChecker } from '@/check-youtube-available';

elysiaYoutubeChecker.listen(process.env.CHECK_YOUTUBE_PORT || 8001);
