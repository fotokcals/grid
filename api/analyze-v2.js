export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const groqKey   = process.env.GROQ_API_KEY;
  const tavilyKey = process.env.TAVILY_API_KEY;
  if (!groqKey) return res.status(500).json({ error: 'GROQ_API_KEY not configured in Vercel' });

  try {
    // ── 1. Precios en tiempo real (Coinpaprika) ──
    let solPrice = null, btcPrice = null, solChange = null, btcChange = null;
    try {
      const [solRes, btcRes] = await Promise.all([
        fetch('https://api.coinpaprika.com/v1/tickers/sol-solana'),
        fetch('https://api.coinpaprika.com/v1/tickers/btc-bitcoin'),
      ]);
      const [solData, btcData] = await Promise.all([solRes.json(), btcRes.json()]);
      solPrice  = solData.quotes.USD.price.toFixed(2);
      btcPrice  = (btcData.quotes.USD.price / 1000).toFixed(2);
      solChange = solData.quotes.USD.percent_change_24h.toFixed(2);
      btcChange = btcData.quotes.USD.percent_change_24h.toFixed(2);
    } catch (e) {
      console.warn('Coinpaprika error:', e.message);
    }

    // ── 2. Noticias en tiempo real (Tavily) ──
    let newsBlock = '';
    if (tavilyKey) {
      try {
        const [newsRes, macroRes] = await Promise.all([
          fetch('https://api.tavily.com/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              api_key: tavilyKey,
              query: 'Solana SOL crypto news today price analysis',
              search_depth: 'basic',
              max_results: 4,
              include_answer: false,
            }),
          }),
          fetch('https://api.tavily.com/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              api_key: tavilyKey,
              query: 'Federal Reserve interest rates crypto market today Bitcoin',
              search_depth: 'basic',
              max_results: 3,
              include_answer: false,
            }),
          }),
        ]);
        const [newsData, macroData] = await Promise.all([newsRes.json(), macroRes.json()]);
        const allResults = [
          ...(newsData.results || []),
          ...(macroData.results || []),
        ];
        if (allResults.length > 0) {
          newsBlock = `\nNOTICIAS Y ANÁLISIS (últimas 24h, fuentes web en tiempo real):\n` +
            allResults
              .map(r => `- ${r.title}: ${(r.content || '').substring(0, 250)}`)
              .join('\n') + '\n';
        }
      } catch (e) {
        console.warn('Tavily error:', e.message);
      }
    }

    // ── 3. Construir prompt con contexto real ──
    const messages = req.body.messages || [];
    const userMsg  = messages.find(m => m.role === 'user');
    const basePrompt = typeof userMsg?.content === 'string'
      ? userMsg.content
      : userMsg?.content?.[0]?.text || '';

    const priceBlock = solPrice
      ? `PRECIOS EN TIEMPO REAL (Coinpaprika):\n- SOL/USDT: $${solPrice} (${solChange >= 0 ? '+' : ''}${solChange}% 24h)\n- BTC/USDT: $${btcPrice}k (${btcChange >= 0 ? '+' : ''}${btcChange}% 24h)\n`
      : '';

    const fullPrompt = priceBlock + newsBlock + '\n' + basePrompt;

    // ── 4. Groq / Llama 3.3 70B ──
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${groqKey}`,
      },
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
