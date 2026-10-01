import 'dotenv/config';
import { z } from 'zod';

const bool = z.enum(['true', 'false']).default('false').transform((value) => value === 'true');
const schema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().default('postgresql://postgres:postgres@localhost:5432/lms_runner'),
  LMS_BASE_URL: z.string().url().default('http://localhost:4000'),
  LMS_LOGIN_URL: z.string().url().default('http://localhost:4000/login'),
  REMOTE_BROWSER_WS_URL: z.string().url().optional(),
  RUNNER_DATA_DIR: z.string().min(1).default('./data'),
  MUTE_VIDEO: bool.default('true'), AUTO_SUBMIT: bool,
  REQUIRE_HUMAN_CONFIRMATION: bool.default('true'),
  AUTOSUBMIT_ALLOWED_HOSTS: z.string().default('localhost,127.0.0.1'),
  PLAYBACK_RATE_POLICY: z.enum(['max_allowed', 'fixed']).default('max_allowed'),
  PLAYBACK_RATE: z.coerce.number().min(0.25).max(4).default(2),
  QUESTION_POLL_INTERVAL_MS: z.coerce.number().int().min(500).default(1500),
  DASHBOARD_USERNAME: z.string().min(1).default('admin'), DASHBOARD_PASSWORD: z.string().min(1).default('change-me'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});
export const env = schema.parse(process.env);
