// Registreras efter tsx (`node --import tsx --import <denna fil> <entry>`).
// Krokar som registreras senare körs först, så link-only-krokarna lindar tsx:s.
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

const entry = process.env.LINK_ONLY_ENTRY;
if (!entry) {
  throw new Error('link-only: LINK_ONLY_ENTRY is not set');
}

register('./link-only-hooks.mjs', import.meta.url, {
  data: { entryUrl: pathToFileURL(entry).href },
});
