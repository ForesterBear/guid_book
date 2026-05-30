// encryption.js — AES-256-GCM шифрування для збережених даних та файлів
'use strict';
const crypto = require('crypto');
const fs     = require('fs');

const ALGORITHM = 'aes-256-gcm';
const IV_LEN    = 16; // bytes
const TAG_LEN   = 16; // bytes

// Ключ задається через ENCRYPTION_KEY (64 hex-символи = 32 байти).
// Якщо не задано — генерується попередження і використовується fallback (НЕ для production!).
function getKey() {
  const raw = process.env.ENCRYPTION_KEY || '';
  if (raw.length === 64) return Buffer.from(raw, 'hex');
  if (raw.length === 32) return Buffer.from(raw);
  console.warn('[Encryption] ENCRYPTION_KEY не задано або невірна довжина — використовується fallback key. Змінна обов\'язкова у production!');
  return Buffer.from('a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4', 'hex');
}

const PREFIX = 'ENC:';

/**
 * Шифрує рядок.
 * Повертає: "ENC:<iv_hex>:<tag_hex>:<ciphertext_hex>"
 */
function encrypt(plaintext) {
  if (plaintext === null || plaintext === undefined) return plaintext;
  const text = String(plaintext);
  if (text.startsWith(PREFIX)) return text; // вже зашифровано

  const key    = getKey();
  const iv     = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let enc  = cipher.update(text, 'utf8', 'hex');
  enc     += cipher.final('hex');
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('hex')}:${tag.toString('hex')}:${enc}`;
}

/**
 * Розшифровує рядок, якщо він починається з "ENC:".
 * Повертає plaintext або оригінальний рядок якщо не зашифрований.
 */
function decrypt(text) {
  if (!text || !String(text).startsWith(PREFIX)) return text;
  try {
    const inner = String(text).slice(PREFIX.length);
    const firstColon  = inner.indexOf(':');
    const secondColon = inner.indexOf(':', firstColon + 1);
    if (firstColon === -1 || secondColon === -1) return text;

    const iv         = Buffer.from(inner.slice(0, firstColon), 'hex');
    const tag        = Buffer.from(inner.slice(firstColon + 1, secondColon), 'hex');
    const ciphertext = inner.slice(secondColon + 1);

    const key      = getKey();
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    let plain  = decipher.update(ciphertext, 'hex', 'utf8');
    plain     += decipher.final('utf8');
    return plain;
  } catch (e) {
    console.error('[Encryption] decrypt error:', e.message);
    return text; // повертаємо як є щоб не ламати систему
  }
}

/**
 * Шифрує файл на диску (in-place).
 * Формат зашифрованого файлу: [16 bytes IV][16 bytes GCM tag][ciphertext]
 * Оновлює файл за тим самим шляхом; повертає шлях.
 */
function encryptFile(filePath) {
  const key       = getKey();
  const plainData = fs.readFileSync(filePath);
  const iv        = crypto.randomBytes(IV_LEN);
  const cipher    = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plainData), cipher.final()]);
  const tag       = cipher.getAuthTag();
  // зберігаємо: IV (16) + Tag (16) + encrypted data
  const result    = Buffer.concat([iv, tag, encrypted]);
  fs.writeFileSync(filePath, result);
  return filePath;
}

/**
 * Розшифровує зашифрований файл.
 * Повертає Buffer з оригінальним вмістом.
 */
function decryptFile(filePath) {
  const key  = getKey();
  const data = fs.readFileSync(filePath);
  if (data.length < IV_LEN + TAG_LEN) throw new Error('Файл надто малий — можливо не зашифрований');
  const iv        = data.slice(0, IV_LEN);
  const tag       = data.slice(IV_LEN, IV_LEN + TAG_LEN);
  const encrypted = data.slice(IV_LEN + TAG_LEN);
  const decipher  = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

/** Повертає true якщо рядок зашифрований цим модулем */
function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

module.exports = { encrypt, decrypt, encryptFile, decryptFile, isEncrypted };
