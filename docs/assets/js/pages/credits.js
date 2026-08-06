/* Photo credits. Generated from the manifest, so an image cannot ship
   un-attributed: if it is in the build, it is on this page. */
import { page, el, clear, qs } from '../ui.js';
import { loadPhotos, Photos } from '../photos.js';

await page({ active: 'help', depth: Number(document.body.dataset.depth || 0) });
await loadPhotos();

const mount = qs('#credits');
clear(mount);

const entries = Object.entries(Photos.map).sort(([a], [b]) => a.localeCompare(b));

function creditRow([, p]) {
  const smallest = p.files[p.files.length - 1];
  const thumb = el('img', {
    src: `assets/photos/${smallest.file}`,
    alt: '',
    width: 120,
    height: p.kind === 'wide' ? 60 : 80,
    loading: 'lazy',
    decoding: 'async',
    style: 'border-radius:var(--radius-sm)',
  });

  const source = p.source
    ? el('a', {
        class: 'link-quiet', href: p.source, rel: 'noopener', target: '_blank',
        style: 'font-size:var(--step--2)',
      }, 'View on Wikimedia Commons')
    : null;

  return el('tr', {},
    el('td', {}, thumb),
    el('td', {}, el('div', { style: 'max-width:44ch' }, p.title), source ? el('div', { class: 'mt-2' }, source) : null),
    el('td', {}, p.author || 'Unknown'),
    el('td', {}, el('span', { class: 'badge' }, p.licence)));
}

const head = el('thead', {}, el('tr', {},
  el('th', { scope: 'col' }, 'Image'),
  el('th', { scope: 'col' }, 'Title'),
  el('th', { scope: 'col' }, 'Photographer'),
  el('th', { scope: 'col' }, 'Licence')));

const body = el('tbody', {}, entries.map(creditRow));

const table = el('table', { class: 'table' },
  el('caption', {}, `${entries.length} photographs, all from Wikimedia Commons`),
  head,
  body);

mount.append(el('div', { class: 'table-scroll' }, table));
