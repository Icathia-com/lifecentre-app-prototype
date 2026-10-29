// Picking the video id out of a pasted YouTube link.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseYouTube, thumbnailUrl } from '../js/youtube.js';

const ID = 'dQw4w9WgXcQ';

describe('parseYouTube', () => {
  it('reads regular, short, embed, live and youtu.be links, with extra parameters', () => {
    for (const link of [
      `https://www.youtube.com/watch?v=${ID}`, `https://youtube.com/watch?v=${ID}&t=42s&list=PL123`, `https://m.youtube.com/watch?feature=share&v=${ID}`,
      `https://youtu.be/${ID}`, `https://youtu.be/${ID}?si=abc`, `https://www.youtube.com/embed/${ID}`, `https://www.youtube.com/live/${ID}?feature=share`,
      `https://www.youtube-nocookie.com/embed/${ID}`, `http://www.youtube.com/watch?v=${ID}`, `  https://youtu.be/${ID}  `,
    ]) assert.equal(parseYouTube(link)?.id, ID, link);
  });
  it('reads Shorts links and says they are short', () => {
    assert.deepEqual(parseYouTube(`https://www.youtube.com/shorts/${ID}`), { id: ID, url: `https://www.youtube.com/watch?v=${ID}`, short: true });
    assert.equal(parseYouTube(`https://youtube.com/shorts/${ID}?feature=share`).short, true);
    assert.equal(parseYouTube(`https://youtu.be/${ID}`).short, false);
  });
  it('accepts a link pasted without https://', () => {
    assert.equal(parseYouTube(`youtu.be/${ID}`)?.id, ID);
    assert.equal(parseYouTube(`www.youtube.com/shorts/${ID}`)?.id, ID);
  });
  it('rebuilds the stored link from the id alone', () => {
    assert.equal(parseYouTube(`https://youtu.be/${ID}?si=tracking&t=9`).url, `https://www.youtube.com/watch?v=${ID}`);
  });
  it('refuses everything else', () => {
    for (const bad of [
      '', '   ', null, undefined, 'hello', 'https://example.com/watch?v=' + ID, `https://youtube.com.evil.com/watch?v=${ID}`, `https://evil.com/?u=https://youtu.be/${ID}`,
      `javascript:alert(1)//youtu.be/${ID}`, `ftp://youtu.be/${ID}`, 'https://www.youtube.com/watch', 'https://www.youtube.com/watch?v=short', 'https://www.youtube.com/playlist?list=PL1234567890A',
      'https://www.youtube.com/', 'https://youtu.be/', `https://www.youtube.com/watch?v=${ID}x`, `https://www.youtube.com/watch?v=${ID.slice(0, 10)}!`, `https://youtu.be/${ID} extra`, 'https://www.youtube.com/@lifecentre',
    ]) assert.equal(parseYouTube(bad), null, String(bad));
  });
  it('points at YouTube\'s picture for a video', () => {
    assert.equal(thumbnailUrl(ID), `https://i.ytimg.com/vi/${ID}/hqdefault.jpg`);
  });
});
