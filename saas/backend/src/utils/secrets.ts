const ENCRYPTED_PREFIX = 'enc:v1:'

const toBase64 = (bytes: Uint8Array): string => {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

const fromBase64 = (value: string): Uint8Array => {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

const getSecretMaterial = (env: { DATA_ENCRYPTION_KEY?: string; JWT_SECRET: string }): string => {
  return env.DATA_ENCRYPTION_KEY || env.JWT_SECRET
}

const getAesKey = async (env: { DATA_ENCRYPTION_KEY?: string; JWT_SECRET: string }) => {
  const material = new TextEncoder().encode(`sbir-keywrap:${getSecretMaterial(env)}`)
  const digest = await crypto.subtle.digest('SHA-256', material)
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

export const encryptSecret = async (
  value: string,
  env: { DATA_ENCRYPTION_KEY?: string; JWT_SECRET: string }
): Promise<string> => {
  const key = await getAesKey(env)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plaintext = new TextEncoder().encode(value)
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext)
  return `${ENCRYPTED_PREFIX}${toBase64(iv)}.${toBase64(new Uint8Array(ciphertext))}`
}

export const decryptSecret = async (
  value: string | null | undefined,
  env: { DATA_ENCRYPTION_KEY?: string; JWT_SECRET: string }
): Promise<string | null> => {
  if (!value || value === 'null') return null
  if (!value.startsWith(ENCRYPTED_PREFIX)) return value

  const encoded = value.slice(ENCRYPTED_PREFIX.length)
  const [ivPart, cipherPart] = encoded.split('.')
  if (!ivPart || !cipherPart) {
    throw new Error('Invalid encrypted secret format')
  }

  const key = await getAesKey(env)
  const iv = fromBase64(ivPart)
  const ciphertext = fromBase64(cipherPart)
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext)
  return new TextDecoder().decode(plaintext)
}
