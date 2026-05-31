const defaultOrigins = ['http://localhost:3000', 'http://localhost:3001','https://stranger-play-chat.netlify.app'];

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

  if (sources.length === 0) return defaultOrigins;

  return [...new Set(sources)];
};

module.exports = {
  port: Number(process.env.PORT || 4000),
  jwtSecret: process.env.JWT_SECRET || 'strangers-play-secret',
  inviteSecret: process.env.INVITE_SECRET || process.env.JWT_SECRET || 'strangers-play-secret',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
  corsOrigins: parseOrigins(process.env.CORS_ORIGINS)
};
