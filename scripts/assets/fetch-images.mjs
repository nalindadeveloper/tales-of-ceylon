/**
 * Downloads the freely licensed photographs used on the site from Wikimedia
 * Commons, converts them to WebP and writes an attribution file.
 *
 *   npm run assets:images
 *
 * To swap an image, either replace the .webp in public/assets/images/ directly
 * or change the Commons file title below and re-run the script.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CACHE_DIR = resolve(ROOT, '.asset-cache/images');
const IMAGE_DIR = resolve(ROOT, 'public/assets/images');
const USER_AGENT = 'IslandJournalBuild/1.0 (asset fetch script; https://commons.wikimedia.org)';

/** Commons file → local WebP. `width` is the delivered width in pixels. */
const IMAGES = [
  { title: 'Skyline of colombo beira lake.jpg', target: 'destinations/colombo.webp', width: 1600 },
  { title: 'Kandy Lake and the Temple of the Sacred Tooth Relic, Kandy.jpg', target: 'destinations/kandy.webp', width: 1600 },
  { title: 'Nallur Kandaswamy temple.jpg', target: 'destinations/jaffna.webp', width: 1600 },
  { title: 'Tea-plantation Nuwara Eliya-2567.jpg', target: 'destinations/nuwara-eliya.webp', width: 1600 },
  { title: 'GALLE FORT AND LIGHTHOUSE GALLE SRI LANKA JAN2013 (8510167078).jpg', target: 'destinations/galle.webp', width: 1600 },
  { title: 'SL Demodara near Ella asv2020-01 img02.jpg', target: 'editorial/highlands.webp', width: 2200 },
  { title: 'Kandyan Dance Kandy Sri Lanka 1.jpg', target: 'editorial/culture.webp', width: 1400 },
  { title: 'Mirissa beach Sri Lanka (29959458812).jpg', target: 'editorial/landscapes.webp', width: 1400 },
  { title: 'Gal Vihara Polonnaruwa 1.jpg', target: 'editorial/heritage.webp', width: 1400 },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stripHtml = (value = '') => value.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

async function fetchWithRetry(url, attempts = 5) {
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (response.ok) return response;
    if (attempt >= attempts || (response.status !== 429 && response.status < 500)) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }
    await sleep(4000 * attempt);
  }
}

async function imageInfo(title, width) {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    titles: `File:${title}`,
    prop: 'imageinfo',
    iiprop: 'url|extmetadata',
    iiurlwidth: String(width),
    iiextmetadatafilter: 'LicenseShortName|LicenseUrl|Artist',
  });
  const response = await fetchWithRetry(`https://commons.wikimedia.org/w/api.php?${params}`);
  const page = Object.values((await response.json()).query.pages)[0];
  if (!page.imageinfo) throw new Error(`Commons file not found: ${title}`);
  const info = page.imageinfo[0];
  const meta = info.extmetadata ?? {};
  return {
    url: info.thumburl ?? info.url,
    page: info.descriptionurl,
    license: stripHtml(meta.LicenseShortName?.value),
    licenseUrl: stripHtml(meta.LicenseUrl?.value),
    author: stripHtml(meta.Artist?.value),
  };
}

async function main() {
  mkdirSync(CACHE_DIR, { recursive: true });
  const creditsFile = resolve(IMAGE_DIR, 'credits.json');
  const credits = existsSync(creditsFile) ? JSON.parse(readFileSync(creditsFile, 'utf8')) : {};

  for (const image of IMAGES) {
    const target = resolve(IMAGE_DIR, image.target);
    if (existsSync(target) && credits[image.target]) {
      console.log('[images] exists', image.target);
      continue;
    }
    const info = await imageInfo(image.title, image.width);
    const cached = resolve(CACHE_DIR, image.title.replace(/[^a-z0-9.-]+/gi, '_'));
    if (!existsSync(cached)) {
      const response = await fetchWithRetry(info.url);
      writeFileSync(cached, Buffer.from(await response.arrayBuffer()));
    }
    mkdirSync(dirname(target), { recursive: true });
    await sharp(cached).rotate().resize({ width: image.width, withoutEnlargement: true }).webp({ quality: 80 }).toFile(target);
    credits[image.target] = { title: image.title, author: info.author, license: info.license, licenseUrl: info.licenseUrl, source: info.page };
    console.log('[images] saved', image.target, '—', info.license, '—', info.author);
    await sleep(1500);
  }
  writeFileSync(creditsFile, JSON.stringify(credits, null, 2));
}

main().catch((error) => {
  console.error('[images] Failed:', error);
  process.exitCode = 1;
});
