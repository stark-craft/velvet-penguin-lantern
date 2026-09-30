export const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp';

export function validateReportImage(file) {
  if (!IMAGE_ACCEPT.split(',').includes(file.type)) {
    throw new Error('Choose a PNG, JPEG or WebP image.');
  }
  if (file.size > 1000000) {
    throw new Error('Choose an image smaller than 1 MB.');
  }
}

export async function readReportImage(file) {
  validateReportImage(file);
  const data = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read this image. Try another file.'));
    reader.onabort = () => reject(new Error('Image import cancelled.'));
    reader.readAsDataURL(file);
  });
  // A matching file extension/MIME type alone does not prove it is an image.
  await new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = resolve;
    image.onerror = () => reject(new Error('This file could not be opened as an image.'));
    image.src = data;
  });
  return data;
}
