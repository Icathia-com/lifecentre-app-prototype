// A full-screen crop for a picture chosen on the phone: drag to move it, pinch, scroll or use the slider to zoom. The profile
// photo is cropped to a circle (saved square, shown round) and the banner to a wide 3:1 strip. Resolves with a small JPEG as a
// data address, or null when cancelled. Nothing leaves the phone.
import { h } from './util.js';
import { ic } from './ui.js';

export async function openCropper({ file, shape = 'circle', width = 320, height = 320, title = 'Crop', quality = 0.85, host = document.querySelector('.app') ?? document.body }) {
  const bitmap = await createImageBitmap(file);
  return new Promise((resolve) => {
    const aspect = width / height;
    const img = h('canvas', { class: 'crop-img', width: bitmap.width, height: bitmap.height, 'aria-hidden': 'true' });
    img.getContext('2d').drawImage(bitmap, 0, 0);
    const frame = h('div', { class: `crop-frame ${shape}` }, img, h('span', { class: 'crop-mask', 'aria-hidden': 'true' }));
    frame.style.aspectRatio = `${width} / ${height}`;
    const zoomInput = h('input', { type: 'range', class: 'crop-zoom', min: '1', max: '4', step: '0.01', value: '1', 'aria-label': 'Zoom', oninput: () => { setZoom(Number(zoomInput.value)); } });
    const done = (result) => { layer.remove(); bitmap.close?.(); resolve(result); };
    const layer = h('div', { class: 'crop-layer', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'crop-h' },
      h('div', { class: 'crop-top' },
        h('button', { type: 'button', class: 'crop-icon', 'aria-label': 'Cancel', onclick: () => done(null) }, ic('close', 20, 2.4)),
        h('h2', { id: 'crop-h' }, title),
        h('button', { type: 'button', class: 'crop-icon crop-use', 'aria-label': 'Use this', onclick: () => done(output()) }, ic('check', 22, 2.6))),
      h('div', { class: 'crop-stage' }, frame),
      h('div', { class: 'crop-bottom' }, ic('image', 16, 2), zoomInput, ic('image', 22, 2)));
    layer.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(null); } });

    // The picture's place: its top-left corner (x, y) in the frame and its scale, always covering the whole frame.
    let zoom = 1;
    let x = 0;
    let y = 0;
    const size = () => { const r = frame.getBoundingClientRect(); return { w: r.width || 300, h: r.height || 300 / aspect }; };
    const base = () => { const f = size(); return Math.max(f.w / bitmap.width, f.h / bitmap.height); };
    const clamp = () => {
      const f = size();
      const s = base() * zoom;
      x = Math.min(0, Math.max(f.w - bitmap.width * s, x));
      y = Math.min(0, Math.max(f.h - bitmap.height * s, y));
    };
    const paint = () => { clamp(); img.style.transform = `translate(${x}px, ${y}px) scale(${base() * zoom})`; };
    // Zooming keeps the point at (cx, cy) in the frame where it is (the middle by default).
    function setZoom(z, cx, cy) {
      const f = size();
      const px = cx ?? f.w / 2;
      const py = cy ?? f.h / 2;
      const before = base() * zoom;
      zoom = Math.max(1, Math.min(4, z));
      const after = base() * zoom;
      x = px - ((px - x) * after) / before;
      y = py - ((py - y) * after) / before;
      zoomInput.value = String(zoom);
      paint();
    }
    function center() { const f = size(); const s = base(); x = (f.w - bitmap.width * s) / 2; y = (f.h - bitmap.height * s) / 2; paint(); }

    const pointers = new Map();
    let pinch = null;
    frame.addEventListener('pointerdown', (e) => { frame.setPointerCapture(e.pointerId); pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: zoom }; } });
    frame.addEventListener('pointermove', (e) => {
      const last = pointers.get(e.pointerId);
      if (!last) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2 && pinch) {
        const [a, b] = [...pointers.values()];
        const r = frame.getBoundingClientRect();
        setZoom(pinch.z * (Math.hypot(a.x - b.x, a.y - b.y) / (pinch.d || 1)), (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
      } else if (pointers.size === 1) { x += e.clientX - last.x; y += e.clientY - last.y; paint(); }
    });
    const up = (e) => { pointers.delete(e.pointerId); if (pointers.size < 2) pinch = null; };
    frame.addEventListener('pointerup', up);
    frame.addEventListener('pointercancel', up);
    frame.addEventListener('wheel', (e) => { e.preventDefault(); const r = frame.getBoundingClientRect(); setZoom(zoom * Math.exp(-e.deltaY / 400), e.clientX - r.left, e.clientY - r.top); }, { passive: false });

    // What is inside the frame, drawn at the saved size.
    function output() {
      const f = size();
      const s = base() * zoom;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const g = canvas.getContext('2d');
      g.fillStyle = '#fff';
      g.fillRect(0, 0, width, height);
      g.drawImage(bitmap, -x / s, -y / s, f.w / s, f.h / s, 0, 0, width, height);
      return canvas.toDataURL('image/jpeg', quality);
    }

    host.append(layer);
    requestAnimationFrame(center);
    layer.querySelector('.crop-use').focus();
  });
}
