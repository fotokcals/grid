export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GROQ_API_KEY not configured in Vercel' });

  try {
    // ── 1. Fetch live prices from Coinpaprika ──
    let solPrice = null, btcPrice = null, solChange = null, btcChange = null;
    try {
      const [solRes, btcRes] = await Promise.all([
        fetch('https://api.coinpaprika.com/v1/tickers/sol-solana'),
        fetch('https://api.coinpaprika.com/v1/tickers/btc-bitcoin'),
      ]);
      const [solData, btcData] = await Promise.all([solRes.json(), btcRes.json()]);
      solPrice = solData.quotes.USD.price.toFixed(2);
      btcPrice = (btcData.quotes.USD.price / 1000).toFixed(2);
      solChange = solData.quotes.USD.percent_change_24h.toFixed(2);
      btcChange = btcData.quotes.USD.percent_change_24h.toFixed(2);
    } catch (e) {
      console.warn('Coinpaprika fetch failed:', e.message);
    }

    // ── 2. Extract prompt and inject live prices ──
    const messages = req.body.messages || [];
    const userMsg = messages.find(m => m.role === 'user');
    const basePrompt = typeof userMsg?.content === 'string'
      ? userMsg.content
      : userMsg?.content?.[0]?.text || '';

    const priceBlock = solPrice
      ? `PRECIOS EN TIEMPO REAL (Coinpaprika, ahora mismo):
- SOL/USDT: $${solPrice} (${solChange >= 0 ? '+' : ''}${solChange}% en 24h)
- BTC/USDT: $${btcPrice}k (${btcChange >= 0 ? '+' : ''}${btcChange}% en 24h)

`
      : '';

    const fullPrompt = priceBlock + basePrompt;

    // ── 3. Call Groq (Llama 3.3 70B) — OpenAI-compatible format ──
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: fullPrompt }],
        temperature: 0.1,
        max_tokens: 2048,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      const errMsg = data?.error?.message || `Groq API error ${response.status}`;
      return res.status(500).json({ error: errMsg });
    }

    const text = data?.choices?.[0]?.message?.content || '';
    if (!text) return res.status(500).json({ error: 'Empty response from Groq' });

    // Return in same Anthropic-compatible format as v1
    res.status(200).json({ content: [{ type: 'text', text }] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
