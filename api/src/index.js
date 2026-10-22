import { createApp } from './app.js';
import { openDb } from './db.js';
import { seed } from './seed.js';
import { seedHistory } from './seed-history.js';

const db = await openDb();
await seed(db);
if (process.env.SEED_HISTORY !== 'off') await seedHistory(db);
const port = process.env.PORT || 4000;
createApp({ db }).listen(port, () => console.log(`verity-api listening on :${port} (db: ${db.kind})`));
