export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const [solRes, btcRes] = await Promise.all([
      fetch('https://api.coinpaprika.com/v1/tickers/sol-solana'),
      fetch('https://api.coinpaprika.com/v1/tickers/btc-bitcoin'),
    ]);

    if (!solRes.ok || !btcRes.ok) throw new Error('Coinpaprika request failed');

    const [solData, btcData] = await Promise.all([solRes.json(), btcRes.json()]);

    const sol = solData.quotes.USD.price;
    const solChange = solData.quotes.USD.percent_change_24h;
    const btc = btcData.quotes.USD.price;
    const btcChange = btcData.quotes.USD.percent_change_24h;

    res.status(200).json({ sol, solChange, btc, btcChange });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
