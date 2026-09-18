// src/config/redis.js
const cache = new Map();

const redisClient = {
  get: async (key) => cache.get(key) || null,
  setEx: async (key, ttl, value) => { cache.set(key, value); return 'OK'; },
  del: async (key) => { cache.delete(key); return 1; },
  on: () => {},
};

const connectRedis = async () => {
  console.log(' Cache mémoire actif (Redis désactivé)');
};

module.exports = { redisClient, connectRedis };
