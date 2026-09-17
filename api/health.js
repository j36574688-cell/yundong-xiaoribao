const { allow: rateLimit } = require('./lib/rate-limit');
const { ENABLED: KV_ENABLED } = require('./lib/redis');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  try {
    const rl = await rateLimit(req, 'health', 30, 60000);
    if (!rl.ok) {
      return res.status(429).json({
        version: 'health-v5',
        error: 'rate_limit_exceeded'
      });
    }

    return res.status(200).json({
      version: 'health-v5',
      generatedAt: new Date().toISOString(),
      kvEnabled: KV_ENABLED,
      cache: { hits: 0, misses: 0, hitRate: null },
      sources: [],
      warning: null
    });
  } catch (e) {
    return res.status(200).json({
      version: 'health-v5',
      generatedAt: new Date().toISOString(),
      kvEnabled: KV_ENABLED,
      cache: { hits: 0, misses: 0, hitRate: null },
      sources: [],
      warning: String(e?.message || e)
    });
  }
};
