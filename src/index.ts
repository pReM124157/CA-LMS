import { createApp } from './server/app.js';
import { Runner } from './orchestration/runner.js';
import { env } from './config/env.js';
import { logger } from './util/logger.js';
const runner = new Runner(); const server = createApp(runner).listen(env.PORT, '0.0.0.0', () => logger.info({ port: env.PORT }, 'LMS Cloud Runner listening'));
const shutdown = async (): Promise<void> => { await runner.stop(); server.close(); };
process.on('SIGTERM', () => void shutdown()); process.on('SIGINT', () => void shutdown());
