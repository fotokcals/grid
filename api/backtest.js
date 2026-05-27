// SOL/USDT daily OHLCV — May 13–26 2025
// Fuente: chart Pionex visible en app, rango real ~$76–$90
const MOCK_CANDLES = [
  { date:'2025-05-13', open:84.20, high:87.10, low:82.40, close:85.60 },
  { date:'2025-05-14', open:85.60, high:88.30, low:84.10, close:87.40 },
  { date:'2025-05-15', open:87.40, high:89.50, low:85.80, close:86.20 },
  { date:'2025-05-16', open:86.20, high:87.80, low:83.10, close:83.90 },
  { date:'2025-05-17', open:83.90, high:85.40, low:80.60, close:81.30 },
  { date:'2025-05-18', open:81.30, high:83.20, low:79.10, close:82.50 },
  { date:'2025-05-19', open:82.50, high:85.70, low:81.80, close:84.90 },
  { date:'2025-05-20', open:84.90, high:87.60, low:83.50, close:86.70 },
  { date:'2025-05-21', open:86.70, high:88.80, low:84.20, close:85.10 },
  { date:'2025-05-22', open:85.10, high:86.30, low:81.40, close:82.30 },
  { date:'2025-05-23', open:82.30, high:84.10, low:80.20, close:81.60 },
  { date:'2025-05-24', open:81.60, high:84.80, low:80.90, close:83.70 },
  { date:'2025-05-25', open:83.70, high:85.90, low:82.40, close:84.50 },
  { date:'2025-05-26', open:84.50, high:85.20, low:82.10, close:83.42 },
];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const capital = parseFloat(req.query.capital || 500);
    const candles = MOCK_CANDLES;

    const allLows = candles.map(c => c.low);
    const allHighs = candles.map(c => c.high);
    const periodLow = Math.min(...allLows);
    const periodHigh = Math.max(...allHighs);
    const startPrice = candles[0].open;
    const endPrice = candles[candles.length - 1].close;
    const priceChangePct = ((endPrice - startPrice) / startPrice) * 100;

    // ── Grid Normal — rango ±8%, 15 grids (optimizado para gestión cada 2 días) ──
    const gnLow = startPrice * 0.92;
    const gnHigh = startPrice * 1.08;
    const gnGrids = 15;
    const normalResult = simulateGridNormal(candles, capital, gnLow, gnHigh, gnGrids, startPrice);

    // ── Infinity Grid — límite inferior ±8% abajo, 15 grids a 2.5% ──
    const igLow = startPrice * 0.92;
    const igGrids = 15;
    const infinityResult = simulateInfinityGrid(candles, capital, igLow, igGrids, 0.025, startPrice);

    // ── Buy & Hold ──
    const solBought = capital / startPrice;
    const bhFinal = solBought * endPrice;
    const bhPnL = bhFinal - capital;

    res.status(200).json({
      period: { start: candles[0].date, end: candles[candles.length-1].date, days: candles.length },
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
