export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const capital = parseFloat(req.query.capital || 500);
    const days = parseInt(req.query.days || 14);

    const end = new Date();
    const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
    const startStr = start.toISOString().split('T')[0];
    const endStr = end.toISOString().split('T')[0];

    const r = await fetch(
      `https://api.coinpaprika.com/v1/coins/sol-solana/ohlcv/historical?start=${startStr}&end=${endStr}&limit=${days + 2}`
    );
    const raw = await r.json();
    if (!Array.isArray(raw) || raw.length < 3) {
      return res.status(500).json({ error: 'No hay suficientes datos históricos' });
    }

    const candles = raw.map(c => ({
      date: c.time_open.substring(0, 10),
      open: c.open, high: c.high, low: c.low, close: c.close,
    }));

    const allLows = candles.map(c => c.low);
    const allHighs = candles.map(c => c.high);
    const periodLow = Math.min(...allLows);
    const periodHigh = Math.max(...allHighs);
    const startPrice = candles[0].open;
    const endPrice = candles[candles.length - 1].close;
    const priceChangePct = ((endPrice - startPrice) / startPrice) * 100;

    // ── Grid Normal ──
    const gnLow = periodLow * 0.97;
    const gnHigh = periodHigh * 1.03;
    const gnGrids = 25;
    const normalResult = simulateGridNormal(candles, capital, gnLow, gnHigh, gnGrids, startPrice);

    // ── Infinity Grid ──
    const igLow = periodLow * 0.95;
    const igGrids = 20;
    const infinityResult = simulateInfinityGrid(candles, capital, igLow, igGrids, 0.025, startPrice);

    // ── Buy & Hold ──
    const solBought = capital / startPrice;
    const bhFinal = solBought * endPrice;
    const bhPnL = bhFinal - capital;

    res.status(200).json({
      period: { start: startStr, end: endStr, days: candles.length },
      capital,
      priceStart: +startPrice.toFixed(2),
      priceEnd: +endPrice.toFixed(2),
      priceChangePct: +priceChangePct.toFixed(2),
      periodLow: +periodLow.toFixed(2),
      periodHigh: +periodHigh.toFixed(2),
      candles,
      gridNormal: normalResult,
      infinityGrid: infinityResult,
      buyAndHold: {
        pnl: +bhPnL.toFixed(2),
        roi: +((bhPnL / capital) * 100).toFixed(2),
        finalValue: +bhFinal.toFixed(2),
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

function simulateGridNormal(candles, capital, low, high, nGrids, startPrice) {
  const spacing = (high - low) / nGrids;
  const capPerGrid = capital / nGrids;
  const levels = Array.from({ length: nGrids + 1 }, (_, i) => low + i * spacing);

  const slots = new Array(nGrids).fill(null); // null or qty of SOL
  let usdt = capital;
  let sol = 0;
  let gridProfit = 0;
  let trades = 0;

  // Place initial buys below start price
  for (let i = 0; i < nGrids; i++) {
    if (levels[i] < startPrice && usdt >= capPerGrid) {
      slots[i] = capPerGrid / levels[i];
      usdt -= capPerGrid;
      sol += slots[i];
    }
  }

  function sweep(from, to) {
    if (to < from) {
      for (let i = nGrids - 1; i >= 0; i--) {
        if (slots[i] === null && levels[i] >= to && levels[i] < from && usdt >= capPerGrid) {
          slots[i] = capPerGrid / levels[i];
          usdt -= capPerGrid;
          sol += slots[i];
          trades++;
        }
      }
    } else {
      for (let i = 0; i < nGrids; i++) {
        if (slots[i] !== null && levels[i + 1] > from && levels[i + 1] <= to) {
          const sellVal = slots[i] * levels[i + 1];
          gridProfit += sellVal - slots[i] * levels[i];
          usdt += sellVal;
          sol -= slots[i];
          slots[i] = null;
          trades++;
        }
      }
    }
  }

  for (const c of candles) {
    sweep(c.open, c.low);
    sweep(c.low, c.high);
    sweep(c.high, c.close);
  }

  const endPrice = candles[candles.length - 1].close;
  const unrealized = sol * endPrice + usdt - capital;
  const totalPnL = gridProfit + unrealized;
  const d = candles.length;

  return {
    gridProfit: +gridProfit.toFixed(2),
    unrealizedPnL: +unrealized.toFixed(2),
    totalPnL: +totalPnL.toFixed(2),
    finalValue: +(capital + totalPnL).toFixed(2),
    roi: +((totalPnL / capital) * 100).toFixed(2),
    apr: +((totalPnL / capital) * (365 / d) * 100).toFixed(1),
    trades,
    low: +low.toFixed(2),
    high: +high.toFixed(2),
    spacing: +spacing.toFixed(2),
    grids: nGrids,
  };
}

function simulateInfinityGrid(candles, capital, low, nGrids, spacingPct, startPrice) {
  // Build geometric levels up from low
  const levels = [low];
  let lvl = low;
  while (levels.length < nGrids * 3 && lvl < startPrice * 3) {
    lvl = lvl * (1 + spacingPct);
    levels.push(lvl);
  }

  const capPerGrid = (capital * 0.5) / nGrids;
  let usdt = capital * 0.5;
  let sol = (capital * 0.5) / startPrice;
  let gridProfit = 0;
  let trades = 0;

  // Slots indexed by grid slot i (buy at levels[i], sell at levels[i+1])
  const slots = {};
  for (let i = 0; i < levels.length - 1; i++) {
    if (levels[i] < startPrice && usdt >= capPerGrid) {
      slots[i] = capPerGrid / levels[i];
      usdt -= capPerGrid;
      sol += slots[i];
    }
  }

  function sweep(from, to) {
    if (to < from) {
      for (let i = levels.length - 2; i >= 0; i--) {
        if (!slots[i] && levels[i] < from && levels[i] >= to && usdt >= capPerGrid) {
          slots[i] = capPerGrid / levels[i];
          usdt -= capPerGrid;
          sol += slots[i];
          trades++;
        }
      }
    } else {
      for (let i = 0; i < levels.length - 1; i++) {
        if (slots[i] && levels[i + 1] > from && levels[i + 1] <= to) {
          const sellVal = slots[i] * levels[i + 1];
          gridProfit += sellVal - slots[i] * levels[i];
          usdt += sellVal;
          sol -= slots[i];
          delete slots[i];
          trades++;
        }
      }
    }
  }

  for (const c of candles) {
    sweep(c.open, c.low);
    sweep(c.low, c.high);
    sweep(c.high, c.close);
  }

  const endPrice = candles[candles.length - 1].close;
  const unrealized = sol * endPrice + usdt - capital;
  const totalPnL = gridProfit + unrealized;
  const d = candles.length;

  return {
    gridProfit: +gridProfit.toFixed(2),
    unrealizedPnL: +unrealized.toFixed(2),
    totalPnL: +totalPnL.toFixed(2),
    finalValue: +(capital + totalPnL).toFixed(2),
    roi: +((totalPnL / capital) * 100).toFixed(2),
    apr: +((totalPnL / capital) * (365 / d) * 100).toFixed(1),
    trades,
    low: +low.toFixed(2),
    spacingPct: +(spacingPct * 100).toFixed(1),
    grids: nGrids,
  };
}
