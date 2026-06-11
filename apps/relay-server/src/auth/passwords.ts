import { Buffer } from 'node:buffer'
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'

const PASSWORD_SCHEME = 'scrypt'
const PASSWORD_KEY_LENGTH = 64
const PASSWORD_SALT_LENGTH = 16
const SCRYPT_N = 16_384
const SCRYPT_R = 8
const SCRYPT_P = 1
const SCRYPT_MAXMEM = 64 * 1024 * 1024

export const MIN_PASSWORD_LENGTH = 8

export class PasswordValidationError extends Error {
  constructor(message = `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`) {
    super(message)
    this.name = 'PasswordValidationError'
  }
}

const encode = (value: Buffer) => value.toString('base64url')

const decode = (value: string) => Buffer.from(value, 'base64url')

const derivePasswordKey = async (password: string, salt: Buffer) =>
  await new Promise<Buffer>((resolve, reject) => {
    scryptCallback(
      password,
      salt,
      PASSWORD_KEY_LENGTH,
      {
        N: SCRYPT_N,
        maxmem: SCRYPT_MAXMEM,
        p: SCRYPT_P,
        r: SCRYPT_R
      },
      (error, derivedKey) => {
        if (error != null) {
          reject(error)
          return
        }
        resolve(derivedKey)
      }
    )
  })

export const assertValidPassword = (password: string) => {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new PasswordValidationError()
  }
}

export const hashPassword = async (password: string) => {
  assertValidPassword(password)
  const salt = randomBytes(PASSWORD_SALT_LENGTH)
  const key = await derivePasswordKey(password, salt)
  return [
    PASSWORD_SCHEME,
    String(SCRYPT_N),
    String(SCRYPT_R),
    String(SCRYPT_P),
    encode(salt),
    encode(key)
  ].join('$')
}

export const verifyPassword = async (password: string, passwordHash: string | undefined) => {
  if (passwordHash == null || passwordHash.trim() === '') return false
  const [scheme, n, r, p, saltValue, keyValue] = passwordHash.split('$')
  if (
    scheme !== PASSWORD_SCHEME ||
    n !== String(SCRYPT_N) ||
    r !== String(SCRYPT_R) ||
    p !== String(SCRYPT_P) ||
    saltValue == null ||
    keyValue == null
  ) {
    return false
  }

  try {
    const expectedKey = decode(keyValue)
    const actualKey = await derivePasswordKey(password, decode(saltValue))
    return expectedKey.length === actualKey.length && timingSafeEqual(expectedKey, actualKey)
  } catch {
    return false
  }
}
