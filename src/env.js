/**
 * Environment variable loading utilities
 */
const path = require('path');
const dotenv = require('dotenv');

// Load .env file from project root
dotenv.config({ path: path.join(__dirname, '..', '.env') });

/**
 * Get string env var with default
 */
function getString(key, defaultValue = '') {
  const value = process.env[key];
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  // Remove surrounding quotes if present
  return value.replace(/^["']|["']$/g, '');
}

/**
 * Get number env var with default
 */
function getNumber(key, defaultValue = 0) {
  const value = process.env[key];
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  const num = Number(value);
  return isNaN(num) ? defaultValue : num;
}

/**
 * Get boolean env var (1/0 or true/false)
 */
function getBoolean(key, defaultValue = false) {
  const value = process.env[key];
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  return value === '1' || value.toLowerCase() === 'true';
}

module.exports = {
  getString,
  getNumber,
  getBoolean
};
