import { createHash } from 'node:crypto'
import { createReadStream, statSync } from 'node:fs'

/** Files larger than this are not hashed (hashing is for identity-join, not integrity). */
const MAX_HASH_BYTES = 512 * 1024 * 1024

/**
 * Streamed SHA-256 of a file — the cross-source document join key (runway step 3;
 * docs/10 §9: real hashes, never randomBytes labeled "hash"). Returns null when the
 * file is missing, unreadable, or oversized: a missing hash degrades to
 * no-join, never to a crash.
 */
export async function sha256File(filePath: string): Promise<string | null> {
  try {
    if (statSync(filePath).size > MAX_HASH_BYTES) return null
    return await new Promise<string | null>((resolve) => {
      const hash = createHash('sha256')
      const stream = createReadStream(filePath)
      stream.on('data', (chunk) => hash.update(chunk))
      stream.on('end', () => resolve(hash.digest('hex')))
      stream.on('error', () => resolve(null))
    })
  } catch {
    return null
  }
}
