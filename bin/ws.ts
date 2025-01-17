import '@/server';

import { wsServer } from '@/server';

wsServer.listen(process.env.PORT || 8000);
