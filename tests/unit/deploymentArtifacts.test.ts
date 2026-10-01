import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
describe('deployment artifacts', () => {
  it('commits an initial Prisma migration', () => { expect(existsSync('prisma/migrations/migration_lock.toml')).toBe(true); expect(existsSync('prisma/migrations/20261001132000_init/migration.sql')).toBe(true); });
  it('uses the generated main and fake-LMS entry points', () => { const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> }; expect(manifest.scripts.start).toBe('node dist/src/index.js'); expect(manifest.scripts['start:fake-lms']).toBe('node dist/fake-lms/server.js'); });
});
