import crypto from 'crypto';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const apiKey    = process.env.PIONEX_API_KEY;
  const apiSecret = process.env.PIONEX_API_SECRET;

  if (!apiKey || !apiSecret) {
    return res.status(200).json({ connected: false, error: 'Keys not configured' });
  }

  try {
    const timestamp = Date.now().toString();

    // ── Balances ──
    const balPath    = '/api/v1/account/balances';
    const balParams  = `timestamp=${timestamp}`;
    const balSig     = makeSign(apiSecret, 'GET', balPath, balParams);

    const balRes  = await fetch(`https://api.pionex.com${balPath}?${balParams}`, {
      headers: pionexHeaders(apiKey, balSig),
    });
    const balData = await balRes.json();

    // ── Grid Bot Orders ──
    const botPath    = '/api/v1/trade/gridBot/openOrder';
    const botParams  = `symbol=SOL_USDT&timestamp=${timestamp}`;
    const botSig     = makeSign(apiSecret, 'GET', botPath, botParams);

    const botRes  = await fetch(`https://api.pionex.com${botPath}?${botParams}`, {
      headers: pionexHeaders(apiKey, botSig),
    });
    const botData = await botRes.json();

    // ── Debug: return raw if errors ──
    const balOk = balData?.result === true || balData?.code === 0;
    const botOk = botData?.result === true || botData?.code === 0;

    if (!balOk || !botOk) {
      return res.status(200).json({
        connected: false,
        debug: {
          balMsg: balData?.message || balData?.msg || JSON.stringify(balData).substring(0,200),
          botMsg: botData?.message || botData?.msg || JSON.stringify(botData).substring(0,200),
        }
      });
    }

    // ── Extract balances ──
    const balances = balData?.data?.balances || [];
    const sol  = balances.find(b => b.coin === 'SOL'  || b.asset === 'SOL');
    const usdt = balances.find(b => b.coin === 'USDT' || b.asset === 'USDT');

    // ── Extract bot ──
    const orders  = botData?.data?.orders || botData?.data || [];
    const botList = Array.isArray(orders) ? orders : Object.values(orders);
    const active  = botList[0] || null;

    return res.status(200).json({
      connected: true,
      sol:  sol  ? +(parseFloat(sol.free  || sol.available || 0) + parseFloat(sol.frozen  || sol.locked || 0)).toFixed(4) : null,
      usdt: usdt ? +(parseFloat(usdt.free || usdt.available || 0) + parseFloat(usdt.frozen || usdt.locked || 0)).toFixed(2) : null,
      bot: active ? {
        gridProfit:  active.gridProfit  || active.grid_profit  || active.arbitrageProfit || '0',
        floatingPnl: active.floatingPnl || active.floating_pnl || active.unrealizedProfit || '0',
        totalPnl:    active.totalPnl    || active.total_pnl    || '0',
        rounds:      active.completedTimes || active.filledCount || active.rounds || 0,
        investment:  active.investment  || active.investmentAmount || '0',
        lower:       active.lowerPrice  || active.lower_price  || active.lowerLimit || '—',
        upper:       active.upperPrice  || active.upper_price  || active.upperLimit || '—',
        grids:       active.gridCount   || active.grid_count   || active.gridNum    || '—',
      } : null,
    });

  } catch (err) {
    return res.status(200).json({ connected: false, error: err.message });
  }
}

function makeSign(secret, method, path, queryString) {
  const message = `${method.toUpperCase()}${path}?${queryString}`;
  return crypto.createHmac('sha256', secret).update(message).digest('hex');
}

function pionexHeaders(apiKey, signature) {
  return {
    'PIONEX-KEY':       apiKey,
    'PIONEX-SIGNATURE': signature,
    'Content-Type':     'application/json',
  };
}
