import { describe, expect, it } from 'vitest';
import { isTerminalYouTubeError, mapYouTubeError } from '../../src/video/youtubeErrors.js';
describe('YouTube error handling', () => {
  it('maps error 150 to the embed-denied code', () => expect(mapYouTubeError(150)).toBe('YOUTUBE_EMBED_NOT_ALLOWED'));
  it('marks documented player failures terminal', () => expect([2, 5, 100, 101, 150].every(isTerminalYouTubeError)).toBe(true));
  it('does not leak arbitrary values through mapping', () => expect(mapYouTubeError(999)).toBe('YOUTUBE_ERROR_999'));
});
