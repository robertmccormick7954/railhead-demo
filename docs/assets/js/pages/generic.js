/* Content pages: chrome only, no timetable payload. */
import { page } from '../ui.js';

page({
  active: document.body.dataset.nav || '',
  depth: Number(document.body.dataset.depth || 0),
  needsNetwork: false,
}).catch((err) => {
  console.error(err);
  document.body.dataset.ready = 'error';
});
