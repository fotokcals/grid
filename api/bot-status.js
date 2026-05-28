import crypto from 'crypto';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const apiKey    = process.env.PIONEX_API_KEY;
  const apiSecret = process.env.PIONEX_API_SECRET;

  if (!apiKey || !apiSecret) {
    return res.status(200).json({ connected: false, error: 'PIONEX keys not configured' });
  }

  try {
    const timestamp = Date.now().toString();

    // ── Balances ──
    const balPath = '/api/v1/account/balances';
    const balSig  = sign(apiKey, apiSecret, timestamp, 'GET', balPath, '');
    const balRes  = await fetch(`https://api.pionex.com${balPath}`, {
      headers: {
        'PIONEX-KEY':       apiKey,
        'PIONEX-SIGNATURE': balSig,
        'timestamp':        timestamp,
      },
    });
    const balData = await balRes.json();

    // ── Open Grid Bot Orders ──
    const botPath   = '/api/v1/trade/gridBot/openOrder';
    const botParams = `symbol=SOL_USDT&timestamp=${timestamp}`;
    const botSig    = sign(apiKey, apiSecret, timestamp, 'GET', botPath, botParams);
    const botRes    = await fetch(`https://api.pionex.com${botPath}?${botParams}`, {
      headers: {
        'PIONEX-KEY':       apiKey,
        'PIONEX-SIGNATURE': botSig,
        'timestamp':        timestamp,
      },
    });
    const botData = await botRes.json();

    // ── Extract useful fields ──
    const balances = balData?.data?.balances || [];
    const sol  = balances.find(b => b.coin === 'SOL');
    const usdt = balances.find(b => b.coin === 'USDT');

    const bots    = botData?.data?.orders || botData?.data || [];
    const botList = Array.isArray(bots) ? bots : [];
    const active  = botList[0] || null;

    const result = {
      connected: true,
      sol:  sol  ? parseFloat(sol.free  || 0) + parseFloat(sol.frozen  || 0) : null,
      usdt: usdt ? parseFloat(usdt.free || 0) + parseFloat(usdt.frozen || 0) : null,
      bot: active ? {
        symbol:       active.symbol,
        gridProfit:   active.gridProfit   || active.grid_profit   || '0',
        floatingPnl:  active.floatingPnl  || active.floating_pnl  || '0',
        totalPnl:     active.totalPnl     || active.total_pnl     || '0',
        rounds:       active.completedTimes || active.rounds || 0,
        investment:   active.investment   || '0',
        lower:        active.lowerPrice   || active.lower_price   || '—',
        upper:        active.upperPrice   || active.upper_price   || '—',
        grids:        active.gridCount    || active.grid_count    || '—',
        running:      true,
      } : null,
      raw: { balError: balData?.message, botError: botData?.message },
    };

    res.status(200).json(result);
  } catch (err) {
    res.status(200).json({ connected: false, error: err.message });
  }
}

// ── Pionex HMAC-SHA256 Signature ──
function sign(apiKey, apiSecret, timestamp, method, path, queryString) {
  const payload = timestamp + method.toUpperCase() + path + (queryString ? '?' + queryString : '');
  return crypto.createHmac('sha256', apiSecret).update(payload).digest('hex');
}
