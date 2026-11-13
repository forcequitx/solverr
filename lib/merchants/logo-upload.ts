/** Largest logo file accepted; Server Action bodies are limited to 1 MB. Shared by the upload form and the server. */
export const MAX_LOGO_UPLOAD_BYTES = 800 * 1024;
/** Formats accepted for upload; SVG and GIF are refused, since they can carry scripts or animation. */
export const LOGO_UPLOAD_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export const LOGO_TOO_LARGE = `The logo can be at most ${MAX_LOGO_UPLOAD_BYTES / 1024} KB.`;
