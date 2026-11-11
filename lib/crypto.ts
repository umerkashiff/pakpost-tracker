import crypto from 'crypto';

// Secret key derivation for AES-256-GCM encryption
function getEncryptionSecret(): string {
  const secret =
    process.env.ENCRYPTION_KEY ||
    process.env.CRON_SECRET ||
    process.env.SETTINGS_PASSCODE;

  if (!secret || !secret.trim()) {
    throw new Error(
      'Missing server secret: configure ENCRYPTION_KEY, CRON_SECRET, or SETTINGS_PASSCODE.'
    );
  }
  return secret.trim();
}

function getEncryptionKey(): Buffer {
  return crypto.createHash('sha256').update(getEncryptionSecret()).digest();
}

/**
 * Constant-time string comparison using SHA-256 digests so lengths never leak.
 */
export function safeCompare(a: string, b: string): boolean {
  const digestA = crypto.createHash('sha256').update(a).digest();
  const digestB = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(digestA, digestB);
}

/**
 * Hash a passcode with a random 16-byte salt using scrypt (format: "saltHex:hashHex").
 */
export function hashPasscode(passcode: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(passcode, salt, 32).toString('hex');
  return `${salt}:${derived}`;
}

/**
 * Verify a candidate passcode against a salted scrypt hash in constant time.
 */
export function verifyPasscodeHash(passcode: string, storedHash: string): boolean {
  try {
    const [salt, hashHex] = storedHash.split(':');
    if (!salt || !hashHex) return false;
    const expected = Buffer.from(hashHex, 'hex');
    const actual = crypto.scryptSync(passcode, salt, expected.length);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

/**
 * Encrypt any text/JSON string using AES-256-GCM
 */
export function encrypt(text: string): string {
  try {
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag().toString('hex');

    // Format: iv:authTag:ciphertext
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
  } catch (err) {
    console.error('Encryption failed:', err);
    return text;
  }
}

/**
 * Decrypt AES-256-GCM ciphertext
 */
export function decrypt(ciphertext: string): string {
  try {
    if (!ciphertext || !ciphertext.includes(':')) return ciphertext;

    const [ivHex, authTagHex, encryptedData] = ciphertext.split(':');
    if (!ivHex || !authTagHex || !encryptedData) return ciphertext;

    const key = getEncryptionKey();
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch {
    // If decryption fails (e.g. legacy unencrypted text), return raw text
    return ciphertext;
  }
}

/**
 * Generate a consistent, irreversible opaque alias for a tracking ID
 */
export function generateAlias(id: string): string {
  const secret =
    process.env.CRON_SECRET ||
    process.env.ENCRYPTION_KEY ||
    process.env.SETTINGS_PASSCODE ||
    'pakpost-alias';
  return crypto
    .createHmac('sha256', secret)
    .update(id.trim().toUpperCase())
    .digest('hex')
    .slice(0, 16);
}

/**
 * Mask a tracking ID for privacy: e.g. "CP123456789PK" -> "CP••••••PK"
 */
export function maskTrackingId(id: string): string {
  const clean = (id || '').trim().toUpperCase();
  if (clean.length <= 4) return '••••';
  return `${clean.slice(0, 2)}••••••${clean.slice(-2)}`;
}
