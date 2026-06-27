require('dotenv').config();

const normalizeOrigins = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter(Boolean);
  }

  const trimmedValue = String(value).trim();
  if (!trimmedValue) return [];

  if (trimmedValue.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmedValue);
      if (Array.isArray(parsed)) {
        return parsed.map((entry) => String(entry).trim()).filter(Boolean);
      }
    } catch (error) {
      // Fall back to comma-separated parsing below if the JSON is malformed.
    }
  }

  return trimmedValue
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
};

const parseOrigins = (...values) => {
  const sources = values.flatMap((value) => normalizeOrigins(value));

  if (sources.length === 0) return [];

  return [...new Set(sources)];
};

const parseBoolean = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback;
  return ['true', '1', 'yes', 'on'].includes(String(value).trim().toLowerCase());
};

module.exports = {
  port: Number(process.env.PORT || 4000),
  jwtSecret: process.env.JWT_SECRET || 'green-lynk-secret',
  inviteSecret: process.env.INVITE_SECRET || process.env.JWT_SECRET || 'green-lynk-secret',
  frontendUrl: process.env.FRONTEND_URL || '',
  corsOrigins: parseOrigins(process.env.CORS_ORIGINS, process.env.CORS_ORIGIN, process.env.FRONTEND_URL),
  statusFeatureEnabled: parseBoolean(process.env.STATUS_FEATURE_ENABLED, true),
  storageType: (process.env.STORAGE_TYPE || 'local').trim().toLowerCase(),
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME || '',
    apiKey: process.env.CLOUDINARY_API_KEY || '',
    apiSecret: process.env.CLOUDINARY_API_SECRET || '',
    folder: process.env.CLOUDINARY_FOLDER || 'green-lynk/chat-media'
  }
};
