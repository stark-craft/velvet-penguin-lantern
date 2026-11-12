// Real transparent artwork goes in ./assets/. An incomplete pack never renders.
// Animated WebP clips can occupy the motion slots; PNG/WebP stills suit short holds.
const assetFiles = import.meta.glob('./assets/*.{webp,png}', {
  eager: true,
  query: '?url',
  import: 'default',
});

export const MASCOT_ASSET_SLOTS = Object.freeze([
  'monkey-tail-hidden',
  'monkey-hanging',
  'monkey-hanging-newspaper',
  'monkey-grip-strain',
  'monkey-slip',
  'monkey-falling',
  'monkey-land',
  'monkey-dust-off',
  'monkey-walk-newspaper',
  'monkey-drag-newspaper',
  'monkey-pull-chair',
  'monkey-sit',
  'monkey-reading',
  'newspaper',
  'chair',
  'dust-puff',
]);

function resolveMascotAssets() {
  const files = Object.fromEntries(Object.entries(assetFiles).map(([path, url]) => [
    path.split('/').pop().replace(/\.(webp|png)$/i, ''),
    url,
  ]));
  const missing = MASCOT_ASSET_SLOTS.filter((slot) => !files[slot]);
  return { files, missing };
}

export const mascotAssetAvailability = resolveMascotAssets();

export async function loadMascotAssets() {
  const { files, missing } = mascotAssetAvailability;
  if (missing.length) return { ready: false, missing, files: null };
  try {
    await Promise.all(MASCOT_ASSET_SLOTS.map((slot) => new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => image.naturalWidth > 0 ? resolve() : reject(new Error(`Empty mascot asset: ${slot}`));
      image.onerror = () => reject(new Error(`Unreadable mascot asset: ${slot}`));
      image.src = files[slot];
    })));
    return { ready: true, missing: [], files };
  } catch {
    return { ready: false, missing: ['unreadable asset'], files: null };
  }
}
