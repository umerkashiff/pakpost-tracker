import crypto from 'crypto';

// Secret key derivation: uses ENCRYPTION_KEY or CRON_SECRET with fallback
function getEncryptionKey(): Buffer {
  const secret = process.env.ENCRYPTION_KEY || process.env.CRON_SECRET || 'uwu123-pakpost-secure-key-2026';
  return crypto.createHash('sha256').update(secret).digest();
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
  } catch (err) {
    // If decryption fails (e.g. legacy unencrypted text), return raw text
    return ciphertext;
  }
}

/**
 * Generate a consistent, irreversible opaque alias for a tracking ID
 */
export function generateAlias(id: string): string {
  const secret = process.env.CRON_SECRET || 'uwu123';
  return crypto.createHmac('sha256', secret).update(id.trim().toUpperCase()).digest('hex').slice(0, 16);
}

/**
 * Mask a tracking ID for privacy: e.g. "LT880952265NL" -> "LT••••••NL"
 */
export function maskTrackingId(id: string): string {
  const clean = (id || '').trim().toUpperCase();
  if (clean.length <= 4) return '••••';
  return `${clean.slice(0, 2)}••••••${clean.slice(-2)}`;
}

