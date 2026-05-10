export const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "application/pdf"] as const;
export const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
export const REGIONS = ["MTR", "FTR", "SLTR", "CTR", "GTR", "LTR"] as const;
export type Region = (typeof REGIONS)[number];

export const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "application/pdf": "pdf",
};

export function buildStoragePath(region: Region, exchangeId: string, mdn: string, mimeType: string): string {
  const ext = MIME_TO_EXT[mimeType];
  if (!ext) throw new Error(`Unsupported mime type: ${mimeType}`);
  return `${region}/${exchangeId}/${mdn}.${ext}`;
}

export function validateFile(file: { size: number; type: string }): string | null {
  if (!ALLOWED_MIME_TYPES.includes(file.type as typeof ALLOWED_MIME_TYPES[number])) {
    return "Only JPEG, PNG, or PDF files are allowed.";
  }
  if (file.size > MAX_FILE_SIZE) {
    return "File must be 5 MB or smaller.";
  }
  if (file.size === 0) {
    return "File is empty.";
  }
  return null;
}

export function validateMdn(mdn: string): string | null {
  if (!/^\d{10,15}$/.test(mdn)) return "MDN must be 10–15 digits.";
  return null;
}
