export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const groqKey   = process.env.GROQ_API_KEY;
  const tavilyKey = process.env.TAVILY_API_KEY;
  if (!groqKey) return res.status(500).json({ error: 'GROQ_API_KEY not configured' });

  try {
    // ── 1. Precios en tiempo real (Coinpaprika) ──
    let solPrice = null, btcPrice = null, solChange = null, btcChange = null;
    try {
      const [solRes, btcRes] = await Promise.all([
        fetch('https://api.coinpaprika.com/v1/tickers/sol-solana'),
        fetch('https://api.coinpaprika.com/v1/tickers/btc-bitcoin'),
      ]);
      const [s, b] = await Promise.all([solRes.json(), btcRes.json()]);
      solPrice  = parseFloat(s.quotes.USD.price);
      btcPrice  = parseFloat(b.quotes.USD.price);
      solChange = parseFloat(s.quotes.USD.percent_change_24h);
      btcChange = parseFloat(b.quotes.USD.percent_change_24h);
    } catch(e) { console.warn('Prices error:', e.message); }

    // ── 2. Indicadores técnicos REALES (200 velas diarias Coinpaprika) ──
    let techBlock = '';
    try {
      const end   = new Date();
      const start = new Date(end - 220 * 86400000); // 220 días atrás
      const fmt   = d => d.toISOString().split('T')[0];
      const ohlcvRes = await fetch(
        `https://api.coinpaprika.com/v1/coins/sol-solana/ohlcv/historical?start=${fmt(start)}&end=${fmt(end)}&limit=220`
      );
      const ohlcv = await ohlcvRes.json();

      if (Array.isArray(ohlcv) && ohlcv.length >= 50) {
        const closes = ohlcv.map(c => parseFloat(c.close));
        const highs  = ohlcv.map(c => parseFloat(c.high));
        const lows   = ohlcv.map(c => parseFloat(c.low));

        const ema20  = calcEMA(closes, 20);
        const ema50  = calcEMA(closes, 50);
        const ema200 = closes.length >= 200 ? calcEMA(closes, 200) : null;
        const rsi14  = calcRSI(closes, 14);
        const bb     = calcBB(closes, 20);
        const atr14  = calcATR(ohlcv.slice(-15), 14);
        const atrAvg = calcATRAvg(ohlcv.slice(-28), 14); // ATR promedio 14 días

        // Soporte/Resistencia: mínimo y máximo de las últimas 20 velas
        const recent20highs = highs.slice(-20);
        const recent20lows  = lows.slice(-20);
        const resistance = Math.max(...recent20highs);
        const support    = Math.min(...recent20lows);

        techBlock = `
INDICADORES TÉCNICOS REALES (calculados de ${ohlcv.length} velas diarias):
- Precio actual SOL: $${solPrice?.toFixed(2)}
- EMA 20:  $${ema20.toFixed(2)}  → SOL ${solPrice > ema20 ? 'ENCIMA ↑ (alcista)' : 'DEBAJO ↓ (bajista)'}
- EMA 50:  $${ema50.toFixed(2)}  → SOL ${solPrice > ema50 ? 'ENCIMA ↑ (alcista)' : 'DEBAJO ↓ (bajista)'}
${ema200 ? `- EMA 200: $${ema200.toFixed(2)}  → SOL ${solPrice > ema200 ? 'ENCIMA ↑ (alcista)' : 'DEBAJO ↓ (bajista)'}` : ''}
- RSI 14:  ${rsi14.toFixed(1)} → ${rsi14 > 70 ? 'SOBRECOMPRADO ⚠️' : rsi14 < 30 ? 'SOBREVENDIDO ⚠️' : 'NEUTRAL'}
- Bollinger Bands (20): Upper $${bb.upper.toFixed(2)} | Middle $${bb.middle.toFixed(2)} | Lower $${bb.lower.toFixed(2)}
- BB Width: ${(bb.width * 100).toFixed(2)}% ${bb.width < 0.08 ? '← SQUEEZE ⚠️ volatilidad comprimida' : '← normal'}
- ATR 14:  $${atr14.toFixed(2)} ${atr14 < atrAvg ? '← COMPRIMIDO (debajo del promedio 14d)' : '← normal'}
- ATR avg 14d: $${atrAvg.toFixed(2)}
- Soporte reciente (20d): $${support.toFixed(2)}
- Resistencia reciente (20d): $${resistance.toFixed(2)}

USA ESTOS VALORES EXACTOS para los campos ema20, ema50, ema200, rsi14, support, resistance del JSON.
Para bollingerSqueeze: ${bb.width < 0.08 ? 'true' : 'false'} (BB width ${(bb.width*100).toFixed(2)}%)
Para atrCompressed: ${atr14 < atrAvg ? 'true' : 'false'} (ATR $${atr14.toFixed(2)} vs avg $${atrAvg.toFixed(2)})
`;
      }
    } catch(e) { console.warn('Technicals error:', e.message); }

    // ── 3. Noticias en tiempo real (Tavily) ──
    let newsBlock = '';
    if (tavilyKey) {
      try {
        const today = new Date().toLocaleDateString('es-MX', { timeZone: 'America/Mexico_City', day:'numeric', month:'long', year:'numeric' });
        const [newsRes, macroRes] = await Promise.all([
          fetch('https://api.tavily.com/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              api_key: tavilyKey,
              query: `Solana SOL USDT crypto price news ${today}`,
              search_depth: 'basic',
              max_results: 4,
            }),
          }),
          fetch('https://api.tavily.com/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              api_key: tavilyKey,
              query: `Federal Reserve PCE CPI inflation Bitcoin crypto market ${today}`,
              search_depth: 'basic',
              max_results: 4,
            }),
          }),
        ]);
        const [newsData, macroData] = await Promise.all([newsRes.json(), macroRes.json()]);
        const all = [...(newsData.results || []), ...(macroData.results || [])];
        if (all.length > 0) {
          newsBlock = `\nNOTICIAS WEB EN TIEMPO REAL (${today}):\n` +
            all.map(r => `- ${r.title}: ${(r.content || '').substring(0, 300)}`).join('\n') + '\n';
        }
      } catch(e) { console.warn('Tavily error:', e.message); }
    }

    // ── 4. Construir prompt ──
    const messages   = req.body.messages || [];
    const userMsg    = messages.find(m => m.role === 'user');
    const basePrompt = typeof userMsg?.content === 'string'
      ? userMsg.content : userMsg?.content?.[0]?.text || '';

    const priceBlock = solPrice
      ? `PRECIOS EN TIEMPO REAL:\n- SOL/USDT: $${solPrice.toFixed(2)} (${solChange >= 0 ? '+' : ''}${solChange.toFixed(2)}% 24h)\n- BTC/USDT: $${(btcPrice/1000).toFixed(2)}k (${btcChange >= 0 ? '+' : ''}${btcChange.toFixed(2)}% 24h)\n`
      : '';

    const fullPrompt = priceBlock + techBlock + newsBlock + '\n' + basePrompt;

    // ── 5. Groq / Llama 3.3 ──
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: fullPrompt }],
        temperature: 0.1,
        max_tokens: 2048,
      }),
    });

    const data = await response.json();
    if (!response.ok) return res.status(500).json({ error: data?.error?.message || `Groq error ${response.status}` });

    const text = data?.choices?.[0]?.message?.content || '';
    if (!text) return res.status(500).json({ error: 'Empty response from Groq' });

    res.status(200).json({ content: [{ type: 'text', text }] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ── Funciones técnicas ─────────────────────────────────────────────────────

function calcEMA(prices, period) {
  const k = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return ema;
}

function calcRSI(prices, period = 14) {
  const changes = prices.slice(1).map((p, i) => p - prices[i]);
  let gains = changes.slice(0, period).filter(c => c > 0).reduce((a, b) => a + b, 0) / period;
  let losses = changes.slice(0, period).filter(c => c < 0).reduce((a, b) => a + Math.abs(b), 0) / period;
  for (let i = period; i < changes.length; i++) {
    gains  = (gains  * (period - 1) + Math.max(changes[i], 0)) / period;
    losses = (losses * (period - 1) + Math.max(-changes[i], 0)) / period;
  }
  if (losses === 0) return 100;
  return 100 - 100 / (1 + gains / losses);
}

function calcBB(prices, period = 20, mult = 2) {
  const slice = prices.slice(-period);
  const mean  = slice.reduce((a, b) => a + b, 0) / period;
  const std   = Math.sqrt(slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period);
  return { upper: mean + mult * std, middle: mean, lower: mean - mult * std, width: (mult * 2 * std) / mean };
}

function calcATR(candles, period = 14) {
  if (candles.length < 2) return 0;
  const trs = candles.slice(1).map((c, i) => {
    const prev = candles[i];
    return Math.max(
      parseFloat(c.high) - parseFloat(c.low),
      Math.abs(parseFloat(c.high) - parseFloat(prev.close)),
      Math.abs(parseFloat(c.low)  - parseFloat(prev.close))
    );
  });
  let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / Math.min(period, trs.length);
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
  }
  return atr;
}

function calcATRAvg(candles, period = 14) {
  if (candles.length < period + 2) return calcATR(candles, period);
  const atrs = [];
  for (let i = period; i < candles.length; i++) {
    atrs.push(calcATR(candles.slice(i - period, i + 1), period));
  }
  return atrs.reduce((a, b) => a + b, 0) / atrs.length;
}
