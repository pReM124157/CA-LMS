import 'dotenv/config';
import { z } from 'zod';

const bool = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');
export const envSchema = z
  .object({
    PORT: z.coerce.number().int().positive().default(3000),
    DATABASE_URL: z.string().default('postgresql://postgres:postgres@localhost:5432/lms_runner'),
    LMS_BASE_URL: z.string().url().default('http://localhost:4000'),
    LMS_LOGIN_URL: z.string().url().default('http://localhost:4000/login'),
    TARGET_MODE: z
      .enum(['fake', 'explicit', 'youtube_test', 'hls_test', 'icai_test'])
      .default('fake'),
    TARGET_COURSE_URL: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().url().optional(),
    ),
    TARGET_LESSON_URL: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().url().optional(),
    ),
    REMOTE_BROWSER_WS_URL: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z
        .string()
        .url()
        .refine(
          (value) => value.startsWith('ws://') || value.startsWith('wss://'),
          'must use ws:// or wss://',
        )
        .optional(),
    ),
    REMOTE_BROWSER_SESSION_MAX_SECONDS: z.coerce.number().int().positive().optional(),
    YOUTUBE_TEST_VIDEO_ID: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z
        .string()
        .regex(/^[A-Za-z0-9_-]{11}$/, 'must be a YouTube video ID')
        .optional(),
    ),
    ICAI_LOGIN_URL: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z
        .string()
        .url()
        .refine((value) => {
          const url = new URL(value);
          return url.origin === 'https://lms.icai.org' && !url.username && !url.password;
        }, 'must stay on the ICAI HTTPS origin')
        .default('https://lms.icai.org/'),
    ),
    ICAI_SRN: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().trim().min(1).max(64).optional(),
    ),
    HLS_TEST_URL: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z
        .string()
        .url()
        .refine((value) => {
          const url = new URL(value);
          return (
            url.protocol === 'https:' &&
            url.pathname.endsWith('.m3u8') &&
            !url.username &&
            !url.password
          );
        }, 'must be an HTTPS .m3u8 URL without credentials')
        .optional(),
    ),
    HLS_TEST_MAX_SECONDS: z.coerce.number().int().positive().default(20),
    YOUTUBE_TEST_MAX_SECONDS: z.coerce.number().int().positive().default(60),
    RUNNER_DATA_DIR: z.string().min(1).default('./data'),
    MUTE_VIDEO: bool.default('true'),
    AUTO_SUBMIT: bool,
    REQUIRE_HUMAN_CONFIRMATION: bool.default('true'),
    AUTOSUBMIT_ALLOWED_HOSTS: z.string().default('localhost,127.0.0.1'),
    PLAYBACK_RATE_POLICY: z.enum(['max_allowed', 'fixed']).default('max_allowed'),
    PLAYBACK_RATE: z.coerce.number().min(0.25).max(4).default(2),
    QUESTION_POLL_INTERVAL_MS: z.coerce.number().int().min(500).default(1500),
    DASHBOARD_USERNAME: z.string().min(1).default('admin'),
    DASHBOARD_PASSWORD: z.string().min(1).default('change-me'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  })
  .superRefine((value, context) => {
    if (value.TARGET_MODE === 'icai_test' && !value.ICAI_SRN)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ICAI_SRN'],
        message: 'required for icai_test',
      });
  })
  .transform((value) =>
    value.TARGET_MODE === 'icai_test'
      ? { ...value, AUTO_SUBMIT: false, REQUIRE_HUMAN_CONFIRMATION: true }
      : value,
  );
export const parseEnv = (input: NodeJS.ProcessEnv): z.infer<typeof envSchema> =>
  envSchema.parse(input);
export const env = parseEnv(process.env);
