export const mapYouTubeError = (code: number): string => ({ 2: 'YOUTUBE_INVALID_VIDEO_ID', 5: 'YOUTUBE_HTML5_PLAYBACK_ERROR', 100: 'YOUTUBE_VIDEO_NOT_FOUND', 101: 'YOUTUBE_EMBED_NOT_ALLOWED', 150: 'YOUTUBE_EMBED_NOT_ALLOWED' }[code] ?? `YOUTUBE_ERROR_${code}`);
export const isTerminalYouTubeError = (code: number | null): boolean => code !== null && [2, 5, 100, 101, 150].includes(code);
