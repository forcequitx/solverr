import sharp from "sharp";
import { ApiError } from "@/lib/api/errors";
import { LOGO_TOO_LARGE, MAX_LOGO_UPLOAD_BYTES } from "@/lib/merchants/logo-upload";

/** Formats sharp may decode; the file's own bytes decide, not its name or declared type. */
const ACCEPTED_FORMATS: ReadonlySet<string> = new Set(["png", "jpeg", "webp"]);
/** Stored logos fit inside this square; the largest place a logo shows is a 52 px tile, so this stays sharp on any screen. */
const LOGO_PIXELS = 256;
/** Images larger than this are refused before decoding, so a small file cannot expand into a huge bitmap. */
const MAX_INPUT_SIDE = 4096;
const MAX_INPUT_PIXELS = MAX_INPUT_SIDE * MAX_INPUT_SIDE;

const UNREADABLE = "Upload a PNG, JPEG or WebP image.";

/** Re-encodes an uploaded logo as a WebP of at most LOGO_PIXELS a side, dropping metadata and anything that is not image data. */
export async function processLogo(file: File): Promise<Uint8Array<ArrayBuffer>> {
  if (file.size > MAX_LOGO_UPLOAD_BYTES) throw new ApiError(400, "invalid_request", LOGO_TOO_LARGE);
  const input = Buffer.from(await file.arrayBuffer());
  /** Reading the header decodes no pixels, so it runs without the pixel limit and the size is checked below. */
  const metadata = await sharp(input, { limitInputPixels: false })
    .metadata()
    .catch(() => null);
  if (!metadata?.format || !ACCEPTED_FORMATS.has(metadata.format)) throw new ApiError(400, "invalid_request", UNREADABLE);
  if ((metadata.width ?? 0) * (metadata.height ?? 0) > MAX_INPUT_PIXELS) {
    throw new ApiError(400, "invalid_request", `The image is too large. Use one of at most ${MAX_INPUT_SIDE} × ${MAX_INPUT_SIDE} pixels.`);
  }
  return sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
    .rotate()
    .resize(LOGO_PIXELS, LOGO_PIXELS, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 90, alphaQuality: 100 })
    .toBuffer()
    .then((output) => new Uint8Array(output))
    .catch(() => {
      throw new ApiError(400, "invalid_request", UNREADABLE);
    });
}

/** Public address of a stored logo, or null when the business has none. */
export function logoUrl(logoId: string | null): string | null {
  return logoId ? `/api/v1/logos/${logoId}` : null;
}
