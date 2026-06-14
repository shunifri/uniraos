/**
 * Lightweight multipart/form-data parser (no multer dependency).
 */

export interface MultipartFile {
  filename: string;
  data: Buffer;
}

export function parseMultipart(buf: Buffer, boundary: string): MultipartFile[] {
  const files: MultipartFile[] = [];
  const boundaryBuf = Buffer.from(`--${boundary}`);
  let start = 0;

  while (true) {
    const idx = buf.indexOf(boundaryBuf, start);
    if (idx < 0) break;
    const nextIdx = buf.indexOf(boundaryBuf, idx + boundaryBuf.length);
    if (nextIdx < 0) break;

    const part = buf.subarray(idx + boundaryBuf.length, nextIdx);
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd < 0) { start = nextIdx; continue; }

    const headers = part.subarray(0, headerEnd).toString();
    const filenameMatch = headers.match(/filename="([^"]+)"/);
    if (!filenameMatch) { start = nextIdx; continue; }

    const data = part.subarray(headerEnd + 4, part.length - 2); // strip trailing \r\n
    files.push({ filename: filenameMatch[1], data });
    start = nextIdx;
  }

  return files;
}
