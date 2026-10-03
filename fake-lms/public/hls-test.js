/* Controlled canary: all playback measurements come directly from the video element. */
const video = document.querySelector('video');
let hls;
const fail = (code) => {
  if (window.__HLS_TEST_ERROR__) return;
  window.__HLS_TEST_ERROR__ = code;
  video.pause();
  if (hls) hls.destroy();
};
video.addEventListener('error', () =>
  fail(video.error?.code === 3 ? 'MEDIA_DECODE_FAILED' : 'HLS_MEDIA_ERROR'),
);
window.__HLS_TEST_START__ = (source) => {
  video.muted = true;
  const play = () => {
    video.play().catch(() => fail('HLS_MEDIA_ERROR'));
  };
  if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = source;
    video.addEventListener('loadedmetadata', play, { once: true });
  } else if (window.Hls && window.Hls.isSupported()) {
    hls = new window.Hls({ debug: false });
    hls.on(window.Hls.Events.ERROR, (_event, data) => {
      if (!data.fatal) return;
      const manifestFailure = [
        window.Hls.ErrorDetails.MANIFEST_LOAD_ERROR,
        window.Hls.ErrorDetails.MANIFEST_LOAD_TIMEOUT,
        window.Hls.ErrorDetails.MANIFEST_PARSING_ERROR,
      ].includes(data.details);
      fail(manifestFailure ? 'HLS_MANIFEST_LOAD_FAILED' : 'HLS_MEDIA_ERROR');
    });
    hls.on(window.Hls.Events.MANIFEST_PARSED, play);
    hls.loadSource(source);
    hls.attachMedia(video);
  } else fail('HLS_UNSUPPORTED');
};
