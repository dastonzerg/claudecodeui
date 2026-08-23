import { messageBookmarksDb } from '@/modules/database/index.js';

import { createBookmarksRouter } from './bookmarks.routes.js';
import { createBookmarksService } from './bookmarks.service.js';

const bookmarksService = createBookmarksService({ bookmarks: messageBookmarksDb });

export const bookmarksRoutes = createBookmarksRouter(bookmarksService);
