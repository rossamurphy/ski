// Curated "Hall of Fame" stock tracks & private-company easter eggs.
// Each preset generates realistic dated price series so the game works
// immediately even offline, and live tickers can be fetched via /api/chart.

function interpolateKeyframes(keyframes, pointsPerSegment = 8, jitter = 0.015, seed = 42) {
  let s = seed >>> 0;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };

  const out = [];
  for (let i = 0; i < keyframes.length - 1; i++) {
    const [d0, p0] = keyframes[i];
    const [d1, p1] = keyframes[i + 1];
    const t0 = new Date(d0).getTime();
    const t1 = new Date(d1).getTime();

    for (let k = 0; k < pointsPerSegment; k++) {
      const u = k / pointsPerSegment;
      // Smoothstep blend with slight micro-volatility
      const smooth = u * u * (3 - 2 * u);
      const base = p0 + (p1 - p0) * (0.45 * u + 0.55 * smooth);
      const noise = k === 0 ? 0 : (rand() - 0.5) * 2 * jitter * base;
      const close = Math.max(0.01, base + noise);
      out.push({
        t: Math.round(t0 + (t1 - t0) * u),
        close: Number(close.toFixed(2)),
      });
    }
  }
  const [lastDate, lastPrice] = keyframes[keyframes.length - 1];
  out.push({ t: new Date(lastDate).getTime(), close: lastPrice });
  return out;
}

function makeStaircase(rounds, pointsPerStep = 14) {
  const out = [];
  for (let i = 0; i < rounds.length - 1; i++) {
    const [d0, v0] = rounds[i];
    const [d1, v1] = rounds[i + 1];
    const t0 = new Date(d0).getTime();
    const t1 = new Date(d1).getTime();
    for (let k = 0; k < pointsPerStep; k++) {
      const u = k / pointsPerStep;
      // Flat valuation plateau, then a steep ramp right before the next round
      let val = v0;
      if (u > 0.86) {
        const ramp = (u - 0.86) / 0.14;
        val = v0 + (v1 - v0) * (ramp * ramp);
      }
      out.push({
        t: Math.round(t0 + (t1 - t0) * u),
        close: Number(val.toFixed(2)),
      });
    }
  }
  const [lastD, lastV] = rounds[rounds.length - 1];
  out.push({ t: new Date(lastD).getTime(), close: lastV });
  return out;
}

export const PRESETS = {
  GME21: {
    id: 'GME21',
    label: "GME '21",
    symbol: 'GME',
    name: 'GameStop Short Squeeze (2021)',
    currency: 'USD',
    range: '6mo',
    isLive: false,
    description: 'The iconic Jan–Mar 2021 meme-stock vertical cliff and double-peak rollercoaster.',
    points: interpolateKeyframes(
      [
        ['2021-01-04', 17.25],
        ['2021-01-12', 19.95],
        ['2021-01-14', 39.91],
        ['2021-01-21', 43.03],
        ['2021-01-25', 76.79],
        ['2021-01-26', 147.98],
        ['2021-01-27', 347.51],
        ['2021-01-28', 193.6],
        ['2021-01-29', 325.0],
        ['2021-02-02', 90.0],
        ['2021-02-04', 53.5],
        ['2021-02-19', 40.59],
        ['2021-02-24', 91.71],
        ['2021-02-25', 108.73],
        ['2021-03-08', 194.5],
        ['2021-03-10', 265.0],
        ['2021-03-15', 220.14],
        ['2021-03-24', 120.34],
        ['2021-03-26', 181.0],
        ['2021-04-15', 156.44],
      ],
      8,
      0.03,
      2021
    ),
  },

  CRASH08: {
    id: 'CRASH08',
    label: '2008 Crash',
    symbol: '^GSPC',
    name: 'S&P 500 Financial Crisis (2007–2009)',
    currency: 'USD',
    range: '2y',
    isLive: false,
    description: 'A legendary downhill speed run from the 2007 peak into the March 2009 trough.',
    points: interpolateKeyframes(
      [
        ['2007-10-09', 1565.15],
        ['2007-11-26', 1407.22],
        ['2007-12-10', 1515.96],
        ['2008-01-22', 1310.5],
        ['2008-03-10', 1273.37],
        ['2008-05-19', 1426.63],
        ['2008-07-15', 1214.91],
        ['2008-08-28', 1300.68],
        ['2008-09-15', 1192.7],
        ['2008-09-19', 1255.08],
        ['2008-10-10', 899.22],
        ['2008-10-13', 1003.35],
        ['2008-11-20', 752.44],
        ['2009-01-06', 934.7],
        ['2009-02-23', 743.33],
        ['2009-03-09', 676.53],
        ['2009-04-17', 869.6],
        ['2009-06-12', 946.21],
      ],
      9,
      0.014,
      2008
    ),
  },

  DOTCOM: {
    id: 'DOTCOM',
    label: 'Dot-Com',
    symbol: '^IXIC',
    name: 'NASDAQ Dot-Com Bubble (1998–2002)',
    currency: 'USD',
    range: '5y',
    isLive: false,
    description: 'Climb the late-90s euphoria, then drop off the 5,048 summit.',
    points: interpolateKeyframes(
      [
        ['1998-10-08', 1419.12],
        ['1999-01-29', 2505.89],
        ['1999-07-16', 2864.48],
        ['1999-10-15', 2731.83],
        ['1999-12-31', 4069.31],
        ['2000-03-10', 5048.62],
        ['2000-04-14', 3321.29],
        ['2000-07-17', 4274.67],
        ['2000-09-01', 4234.33],
        ['2000-12-20', 2332.78],
        ['2001-01-24', 2859.15],
        ['2001-04-04', 1638.8],
        ['2001-05-22', 2313.85],
        ['2001-09-21', 1423.19],
        ['2002-01-04', 2059.38],
        ['2002-07-23', 1229.05],
        ['2002-10-09', 1114.11],
      ],
      9,
      0.018,
      2000
    ),
  },

  BTC: {
    id: 'BTC',
    label: 'BTC',
    symbol: 'BTC-USD',
    name: 'Bitcoin (Live)',
    currency: 'USD',
    range: '5y',
    isLive: true,
    fallbackPoints: interpolateKeyframes(
      [
        ['2020-10-01', 10600],
        ['2021-01-08', 40797],
        ['2021-04-14', 63503],
        ['2021-07-20', 29807],
        ['2021-11-10', 68789],
        ['2022-01-24', 35000],
        ['2022-03-28', 47400],
        ['2022-06-18', 19017],
        ['2022-11-21', 15787],
        ['2023-04-14', 30485],
        ['2023-09-11', 25162],
        ['2024-03-14', 73083],
        ['2024-08-05', 53991],
        ['2024-12-17', 106140],
        ['2025-04-07', 76200],
        ['2025-08-14', 122500],
      ],
      10,
      0.025,
      1337
    ),
  },

  NVDA: {
    id: 'NVDA',
    label: 'NVDA',
    symbol: 'NVDA',
    name: 'NVIDIA Corp (Live)',
    currency: 'USD',
    range: '1y',
    isLive: true,
    fallbackPoints: interpolateKeyframes(
      [
        ['2024-01-02', 48.17],
        ['2024-03-25', 95.0],
        ['2024-04-19', 76.2],
        ['2024-06-18', 135.58],
        ['2024-08-07', 98.91],
        ['2024-11-07', 148.88],
        ['2025-01-06', 149.43],
        ['2025-01-27', 118.42],
        ['2025-04-04', 94.31],
        ['2025-07-15', 170.7],
        ['2025-10-20', 186.2],
      ],
      12,
      0.018,
      4090
    ),
  },

  'PRIVATE:ANTHROPIC': {
    id: 'PRIVATE:ANTHROPIC',
    label: 'Anthropic*',
    symbol: 'ANTHROPIC (Private)',
    name: 'Anthropic — Valuation Stairs ($B)',
    currency: 'USD_B',
    range: 'max',
    isLive: false,
    description:
      'Private company easter egg! Valuation in $B across funding rounds — flat plateaus and sudden jumps. Draw ramps or hit Boost!',
    points: makeStaircase(
      [
        ['2021-05-01', 0.5],
        ['2022-04-01', 3.4],
        ['2023-05-01', 4.1],
        ['2023-10-01', 15.0],
        ['2024-02-01', 18.4],
        ['2025-03-01', 61.5],
        ['2025-09-01', 183.0],
        ['2026-02-01', 350.0],
      ],
      18
    ),
  },

  'PRIVATE:OPENAI': {
    id: 'PRIVATE:OPENAI',
    label: 'OpenAI*',
    symbol: 'OPENAI (Private)',
    name: 'OpenAI — Valuation Rocket ($B)',
    currency: 'USD_B',
    range: 'max',
    isLive: false,
    description: 'Private company valuation steps in $B.',
    points: makeStaircase(
      [
        ['2019-07-01', 3.0],
        ['2021-01-01', 14.0],
        ['2023-01-01', 29.0],
        ['2024-02-01', 80.0],
        ['2024-10-01', 157.0],
        ['2025-03-01', 300.0],
        ['2025-10-01', 500.0],
      ],
      20
    ),
  },

  'PRIVATE:SPACEX': {
    id: 'PRIVATE:SPACEX',
    label: 'SpaceX*',
    symbol: 'SPACEX (Private)',
    name: 'SpaceX — Private Valuation ($B)',
    currency: 'USD_B',
    range: 'max',
    isLive: false,
    description: 'Private company valuation trajectory in $B.',
    points: makeStaircase(
      [
        ['2018-04-01', 25.0],
        ['2020-08-01', 46.0],
        ['2021-10-01', 100.0],
        ['2022-12-01', 137.0],
        ['2023-12-01', 180.0],
        ['2024-12-01', 350.0],
        ['2025-12-01', 400.0],
      ],
      20
    ),
  },

  'PRIVATE:STRIPE': {
    id: 'PRIVATE:STRIPE',
    label: 'Stripe*',
    symbol: 'STRIPE (Private)',
    name: 'Stripe — Valuation Rollercoaster ($B)',
    currency: 'USD_B',
    range: 'max',
    isLive: false,
    description: 'Private company valuation peak, 2023 haircut, and recovery ($B).',
    points: makeStaircase(
      [
        ['2019-09-01', 35.0],
        ['2020-04-01', 36.0],
        ['2021-03-01', 95.0],
        ['2022-07-01', 74.0],
        ['2023-03-01', 50.0],
        ['2024-02-01', 65.0],
        ['2025-02-01', 91.5],
      ],
      20
    ),
  },
};

export const TOOLBAR_PRESET_IDS = [
  'GME21',
  'CRASH08',
  'DOTCOM',
  'BTC',
  'NVDA',
  'PRIVATE:ANTHROPIC',
];
