// Image input limits, shared by the Worker proxy and the browser island so both reject the same
// bytes. Mirrors the public API rules: one image per request, a data URL or bare base64 of a
// JPEG/PNG/WebP, 5 MB decoded, never a URL. The API decides; these checks only save a round trip.
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** Base64 of the largest accepted image. Checked before any decode. */
export const MAX_IMAGE_CHARS = Math.ceil((MAX_IMAGE_BYTES * 4) / 3);
export const DETAIL_EDGE = { low: 512, medium: 768, high: 1024 } as const;
export type Detail = keyof typeof DETAIL_EDGE;
/** Fixed input tokens billed per image by detail tier, for one forward pass. */
export const IMAGE_TOKENS: Record<Detail, number> = { low: 1000, medium: 2000, high: 4000 };
/**
 * Generation on an image costs more GPU time than a decision does, so those capabilities bill a
 * multiple of the tier: answer x1.5, extract/entities/verify x2 (decision 2026-09-20).
 */
export const GENERATIVE_MULTIPLIER: Record<string, number> = { answer: 1.5, extract: 2, entities: 2, verify: 2 };
/** Billed input tokens for the image part of one request. */
export const imageTokens = (capability: string, detail: Detail) =>
  IMAGE_TOKENS[detail] * (Object.hasOwn(GENERATIVE_MULTIPLIER, capability) ? GENERATIVE_MULTIPLIER[capability] : 1);
export const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const DATA_URL = /^data:image\/(?:jpeg|png|webp);base64,/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** Decoded byte count of a base64 payload, from its length alone. */
export function decodedBytes(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

/** null when the value is an acceptable image field, otherwise the public error code. */
export function imageProblem(value: unknown): 'invalid_image' | 'image_too_large' | null {
  if (typeof value !== 'string' || !value) return 'invalid_image';
  if (/^https?:/i.test(value)) return 'invalid_image';
  if (value.length > MAX_IMAGE_CHARS + 64) return 'image_too_large';
  const base64 = DATA_URL.test(value) ? value.slice(value.indexOf(',') + 1) : value;
  if (!BASE64.test(base64) || base64.length % 4 !== 0) return 'invalid_image';
  return decodedBytes(base64) > MAX_IMAGE_BYTES ? 'image_too_large' : null;
}

export const IMAGE_MESSAGES: Record<'invalid_image' | 'image_too_large' | 'image_with_texts', string> = {
  invalid_image: 'Send one JPEG, PNG or WebP image as base64. Image URLs are not accepted.',
  image_too_large: 'That image is larger than 5 MB. Use a smaller scan or photo.',
  image_with_texts: 'Send one image with optional text, not a batch of texts.',
};

/**
 * Decode a picked file and re-encode it, so the raster the API decodes is the one measured here.
 * `createImageBitmap` applies EXIF orientation and the canvas drops the metadata: a portrait phone
 * photo would otherwise be sent unrotated and every returned box would fall outside the image.
 * The longest edge is capped at the largest detail tier, which is all the model reads anyway.
 */
export async function decodeImage(file: File): Promise<{ dataUrl: string; width: number; height: number }> {
  if (!IMAGE_MIME_TYPES.includes(file.type)) throw new Error(IMAGE_MESSAGES.invalid_image);
  if (file.size > MAX_IMAGE_BYTES) throw new Error(IMAGE_MESSAGES.image_too_large);
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => {
    throw new Error(IMAGE_MESSAGES.invalid_image);
  });
  const scale = Math.min(1, DETAIL_EDGE.high / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error(IMAGE_MESSAGES.invalid_image);
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
  const problem = imageProblem(dataUrl);
  if (problem) throw new Error(IMAGE_MESSAGES[problem]);
  return { dataUrl, width, height };
}
