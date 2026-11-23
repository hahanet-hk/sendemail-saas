import crypto from 'node:crypto';
import Redis from 'ioredis';

const ALGO = 'aes-256-gcm';
const REDIS_CACHE_KEY = 'sendemail:v42:system_settings_all';
const REDIS_TTL_SEC = 300;

function getMasterKey() {
  const rawMaster = process.env.SETTINGS_MASTER_KEY || process.env.DB_PASSWORD;
  if (!rawMaster) {
    throw new Error('CRITICAL: Neither SETTINGS_MASTER_KEY nor DB_PASSWORD is set.');
  }
  return crypto.createHash('sha256').update(String(rawMaster)).digest();
}

export function encryptSecret(plainText) {
  if (plainText === null || plainText === undefined || plainText === '') return null;
  const key = getMasterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `v1:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptSecret(cipherPayload) {
  if (!cipherPayload || typeof cipherPayload !== 'string') return null;
  if (!cipherPayload.startsWith('v1:')) return cipherPayload;
  const parts = cipherPayload.split(':');
  if (parts.length !== 4) throw new Error('Invalid AES-256-GCM payload format');
  const [, ivHex, tagHex, dataHex] = parts;
  const key = getMasterKey();
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]);
  return decrypted.toString('utf8');
}

export function maskSecretValue(plainValue) {
  if (!plainValue) return '';
  const str = String(plainValue);
  if (str.length <= 6) return '****';
  return `${str.slice(0, 3)}****${str.slice(-4)}`;
}

export class SettingsVault {
  constructor(dbPool, redisConfig) {
    this.db = dbPool;
    this.redis = redisConfig ? new Redis({ ...redisConfig, maxRetriesPerRequest: 2 }) : null;
  }

  async getAllDecryptedMap() {
    if (this.redis) {
      try {
        const cached = await this.redis.get(REDIS_CACHE_KEY);
        if (cached) return JSON.parse(cached);
      } catch (err) {
        console.warn('[SettingsVault] Redis read fallback:', err.message);
      }
    }

    const [rows] = await this.db.query(
      'SELECT setting_key, setting_group, value_encrypted, is_secret, updated_by, updated_at FROM system_settings'
    );

    const map = {};
    for (const row of rows) {
      let plain = null;
      if (row.value_encrypted !== null) {
        plain = row.is_secret ? decryptSecret(row.value_encrypted) : row.value_encrypted;
      }
      map[row.setting_key] = {
        key: row.setting_key,
        group: row.setting_group,
        value: plain,
        is_secret: Boolean(row.is_secret),
        updated_by: row.updated_by,
        updated_at: row.updated_at,
      };
    }

    if (this.redis) {
      try {
        await this.redis.set(REDIS_CACHE_KEY, JSON.stringify(map), 'EX', REDIS_TTL_SEC);
      } catch (err) {
        console.warn('[SettingsVault] Redis write failed:', err.message);
      }
    }
    return map;
  }

  async get(settingKey, fallbackEnvKey = null) {
    const map = await this.getAllDecryptedMap();
    const entry = map[settingKey];
    if (entry && entry.value !== null && entry.value !== '') return entry.value;
    return fallbackEnvKey ? (process.env[fallbackEnvKey] || null) : null;
  }

  async listForAdmin() {
    const map = await this.getAllDecryptedMap();
    return Object.values(map).map((item) => ({
      setting_key: item.key,
      setting_group: item.group,
      value_masked: item.is_secret ? maskSecretValue(item.value) : (item.value || ''),
      has_value: Boolean(item.value && item.value.length > 0),
      is_secret: item.is_secret,
      updated_by: item.updated_by,
      updated_at: item.updated_at,
    }));
  }

  async upsertMany(updates, adminEmail) {
    if (!Array.isArray(updates) || updates.length === 0) return;
    const conn = await this.db.getConnection();
    try {
      await conn.beginTransaction();
      for (const item of updates) {
        const { setting_key, setting_group = 'general', value, is_secret = 1 } = item;
        if (!setting_key) continue;
        if (is_secret && typeof value === 'string' && value.includes('****')) continue;

        const storedValue =
          value === null || value === ''
            ? null
            : is_secret
            ? encryptSecret(value)
            : String(value);

        await conn.query(
          `INSERT INTO system_settings (setting_key, setting_group, value_encrypted, is_secret, updated_by)
           VALUES (?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             setting_group = VALUES(setting_group),
             value_encrypted = VALUES(value_encrypted),
             is_secret = VALUES(is_secret),
             updated_by = VALUES(updated_by)`,
          [setting_key, setting_group, storedValue, is_secret ? 1 : 0, adminEmail]
        );
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    if (this.redis) {
      try {
        await this.redis.del(REDIS_CACHE_KEY);
      } catch (err) {
        console.warn('[SettingsVault] Redis cache invalidation failed:', err.message);
      }
    }
  }
}
