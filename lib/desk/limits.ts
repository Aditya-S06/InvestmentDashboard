/** Local read freshness, not a lease or a provider/deadline policy. */
export const DESK_RECONCILE_FRESH_MS = 2_000;
// The launch form is well below 2 KiB, including the checkpoint reference.
export const DESK_LAUNCH_MAX_BYTES = 16 * 1024;
export const DESK_RAW_ANALYST_MAX = 16;

export class DeskRequestError extends Error {
  constructor(message: string, readonly status: 400 | 413) { super(message); }
}

/** Count actual bytes even with absent, misleading or chunked Content-Length. */
export async function readDeskLaunchJson(request: Request): Promise<unknown> {
  const length = request.headers.get('content-length');
  if (length !== null && /^\d+$/.test(length) && Number(length) > DESK_LAUNCH_MAX_BYTES) {
    void request.body?.cancel().catch(() => {});
    throw new DeskRequestError(`Desk launch JSON exceeds ${DESK_LAUNCH_MAX_BYTES} bytes`, 413);
  }
  const reader = request.body?.getReader();
  if (!reader) throw new DeskRequestError('Invalid Desk launch JSON', 400);
  const buffer = new Uint8Array(DESK_LAUNCH_MAX_BYTES);
  let used = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (used + value.byteLength > buffer.length) {
        void reader.cancel().catch(() => {});
        throw new DeskRequestError(`Desk launch JSON exceeds ${DESK_LAUNCH_MAX_BYTES} bytes`, 413);
      }
      buffer.set(value, used); used += value.byteLength;
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, used)));
  } catch (error) {
    if (error instanceof DeskRequestError) throw error;
    throw new DeskRequestError('Invalid Desk launch JSON', 400);
  } finally { reader.releaseLock(); }
}
