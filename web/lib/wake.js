// Free hosting puts the API to sleep when idle and a cold start takes about 30 seconds. These helpers let the
// landing page tell visitors what is happening and keep trying, instead of showing a blank screen or an error.
export const SLOW_MS = 2500;        // show the "waking up" message if the first check has not answered by then
export const POLL_MS = 3000;        // how often to try again
export const GIVE_UP_MS = 120000;   // stop after two minutes and offer a retry

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Calls ping() until it returns something truthy (the health payload) or giveUpMs has passed. Returns it, or null.
// The clock, the sleep and the ping are injectable so the behaviour can be tested without real waiting.
export async function pollUntilUp({ ping, sleep = wait, now = Date.now, giveUpMs = GIVE_UP_MS, pollMs = POLL_MS } = {}) {
  const started = now();
  for (;;) {
    const health = await ping();
    if (health) return health;
    if (now() - started >= giveUpMs) return null;
    await sleep(pollMs);
  }
}
