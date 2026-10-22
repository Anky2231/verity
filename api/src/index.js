import { createApp } from './app.js';
import { openDb } from './db.js';
import { seed } from './seed.js';
import { seedHistory } from './seed-history.js';

const db = await openDb();
await seed(db);
if (process.env.SEED_HISTORY !== 'off') await seedHistory(db);
const port = process.env.PORT || 4000;
const app = createApp({ db });
const server = app.listen(port, () => console.log(`verity-api listening on :${port} (db: ${db.kind})`));

// Close the HTTP server, the Redis queue connections and the database cleanly on shutdown.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, async () => {
    server.close();
    await Promise.allSettled([app.locals.closeQueue?.(), db.close?.()]);
    process.exit(0);
  });
}
