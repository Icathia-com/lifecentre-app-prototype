// YouTube links for Watch: pick the video id out of a pasted link, and load YouTube's player script.
const ID = /^[A-Za-z0-9_-]{11}$/;
const HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com']);

// Returns { id, url, short } for a regular, Shorts, live, embed or youtu.be link (with or without https://), or null.
// Only the video id is kept; the stored link is always rebuilt from it.
export function parseYouTube(input) {
  const text = String(input ?? '').trim();
  if (!text || /\s/.test(text)) return null;
  let u;
  try { u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.toLowerCase();
  const parts = u.pathname.split('/').filter(Boolean);
  let id = null;
  let short = false;
  if (host === 'youtu.be') id = parts[0];
  else if (HOSTS.has(host)) {
    if (parts[0] === 'watch') id = u.searchParams.get('v');
    else if (['shorts', 'embed', 'live', 'v'].includes(parts[0])) { id = parts[1]; short = parts[0] === 'shorts'; }
  }
  if (!id || !ID.test(id)) return null;
  return { id, url: `https://www.youtube.com/watch?v=${id}`, short };
}

export const thumbnailUrl = (id) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

let loading = null;
// Resolves with the global YT once YouTube's player script has loaded (or straight away when it already has).
export function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  loading ??= new Promise((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { previous?.(); resolve(window.YT); };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.onerror = () => { loading = null; script.remove(); reject(new Error('Could not load YouTube')); };
    document.head.append(script);
  });
  return loading;
}
