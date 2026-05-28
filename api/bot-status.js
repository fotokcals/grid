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

    // ── Open Orders (grid bot orders for SOL/USDT) ──
    const ordPath   = '/api/v1/trade/openOrders';
    const ordParams = `symbol=SOL_USDT&timestamp=${timestamp}`;
    const ordSig    = makeSign(apiSecret, 'GET', ordPath, ordParams);

    const ordRes  = await fetch(`https://api.pionex.com${ordPath}?${ordParams}`, {
      headers: pionexHeaders(apiKey, ordSig),
    });
    const ordData = await ordRes.json();

    // ── Order History (completed cycles) ──
    const histPath   = '/api/v1/trade/orderHistory';
    const histParams = `symbol=SOL_USDT&limit=50&timestamp=${timestamp}`;
    const histSig    = makeSign(apiSecret, 'GET', histPath, histParams);

    const histRes  = await fetch(`https://api.pionex.com${histPath}?${histParams}`, {
      headers: pionexHeaders(apiKey, histSig),
    });
    const histData = await histRes.json();

    // ── Debug: return raw if balance failed ──
    const balOk = balData?.result === true || balData?.code === 0;
    if (!balOk) {
      return res.status(200).json({
        connected: false,
        debug: { balMsg: JSON.stringify(balData).substring(0,300) }
      });
    }

    // ── Extract balances ──
    const balances = balData?.data?.balances || [];
    const sol  = balances.find(b => b.coin === 'SOL'  || b.asset === 'SOL');
    const usdt = balances.find(b => b.coin === 'USDT' || b.asset === 'USDT');

    // ── Extract open orders (grid levels) ──
    const openOrders = ordData?.data?.orders || ordData?.data || [];
    const openCount  = Array.isArray(openOrders) ? openOrders.length : 0;

    // Detect buy/sell sides and price range from open orders
    const buyOrders  = Array.isArray(openOrders) ? openOrders.filter(o => o.side === 'BUY'  || o.type === 'BUY')  : [];
    const sellOrders = Array.isArray(openOrders) ? openOrders.filter(o => o.side === 'SELL' || o.type === 'SELL') : [];
    const allPrices  = Array.isArray(openOrders) ? openOrders.map(o => parseFloat(o.price)).filter(Boolean) : [];
    const lower      = allPrices.length ? Math.min(...allPrices).toFixed(2) : '—';
    const upper      = allPrices.length ? Math.max(...allPrices).toFixed(2) : '—';

    // ── Completed fills from history ──
    const fills  = histData?.data?.orders || histData?.data || [];
    const filled = Array.isArray(fills) ? fills.filter(o => o.status === 'FILLED' || o.state === 'FILLED') : [];

    return res.status(200).json({
      connected: true,
      sol:  sol  ? +(parseFloat(sol.free  || 0) + parseFloat(sol.frozen  || 0)).toFixed(4) : 0,
      usdt: usdt ? +(parseFloat(usdt.free || 0) + parseFloat(usdt.frozen || 0)).toFixed(2) : 0,
      bot: openCount > 0 ? {
        gridProfit:  '—',
        floatingPnl: '—',
        rounds:      filled.length,
        lower,
        upper,
        grids:       openCount,
        investment:  '454.05',
      } : null,
      debug: {
        openOrders: openCount,
        ordMsg: ordData?.result === false ? (ordData?.message || JSON.stringify(ordData).substring(0,150)) : null,
        histMsg: histData?.result === false ? (histData?.message || JSON.stringify(histData).substring(0,150)) : null,
      }
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
