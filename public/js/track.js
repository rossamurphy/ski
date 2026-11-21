// Converts raw stock price points into a Line Rider world track
// with optional smoothing, vertical steepness scaling, launch ramp,
// and fast lookup of historical date/price at any world X coordinate.

export function smoothPoints(points, passes) {
  if (passes <= 0 || points.length < 3) return points;
  let curr = points.map((p) => ({ ...p }));
  for (let pass = 0; pass < passes; pass++) {
    const next = [curr[0]];
    for (let i = 1; i < curr.length - 1; i++) {
      next.push({
        t: curr[i].t,
        close: curr[i - 1].close * 0.25 + curr[i].close * 0.5 + curr[i + 1].close * 0.25,
      });
    }
    next.push(curr[curr.length - 1]);
    curr = next;
  }
  return curr;
}

export function buildLaunchRamp(anchorX, anchorY) {
  const rampLen = 360;
  const rampHeight = 135;
  const steps = 20;
  const rampPts = [];
  for (let i = 0; i <= steps; i++) {
    const u = i / steps; // 0 at top-left, 1 at anchor (exit)
    const x = anchorX - rampLen * (1 - u);
    const ease = Math.pow(1 - u, 1.85);
    const y = anchorY - rampHeight * ease;
    rampPts.push({ x, y });
  }
  const rampSegments = [];
  for (let i = 0; i < rampPts.length - 1; i++) {
    rampSegments.push({
      ax: rampPts[i].x,
      ay: rampPts[i].y,
      bx: rampPts[i + 1].x,
      by: rampPts[i + 1].y,
      type: 'ramp',
      isUp: false,
    });
  }
  const spawn = {
    x: rampPts[1].x + 14,
    y: rampPts[1].y - 28,
  };
  const mid = rampPts[Math.floor(steps * 0.5)];
  return {
    rampSegments,
    spawn,
    anchor: { x: anchorX, y: anchorY },
    handle: { x: mid.x, y: mid.y + 18 },
  };
}

export function buildStockTrack(rawPoints, options = {}) {
  const {
    steepness = 1.0, // 0.3 to 2.5
    smoothness = 2, // 0 to 20 passes
    tiltDeg = 0, // -40 to +40 degrees (+ tilts right side downhill)
    launchRamp = true,
    targetWidth = 4600,
    baseHeight = 620,
  } = options;

  if (!rawPoints || rawPoints.length < 2) {
    return {
      segments: [],
      worldPoints: [],
      rampSegments: [],
      spawn: { x: 0, y: -40 },
      bounds: { minX: 0, maxX: 1000, minY: -500, maxY: 500 },
      minPrice: 0,
      maxPrice: 100,
      startPrice: 0,
      getSampleAtX: () => null,
    };
  }

  // Downsample if there are too many points (> 360) for smooth skiing
  let sampled = rawPoints;
  const MAX_PTS = 340;
  if (rawPoints.length > MAX_PTS) {
    sampled = [];
    const step = (rawPoints.length - 1) / (MAX_PTS - 1);
    for (let i = 0; i < MAX_PTS; i++) {
      sampled.push(rawPoints[Math.round(i * step)]);
    }
  }

  const smoothed = smoothPoints(sampled, smoothness);

  let minPrice = Infinity;
  let maxPrice = -Infinity;
  for (const p of smoothed) {
    if (p.close < minPrice) minPrice = p.close;
    if (p.close > maxPrice) maxPrice = p.close;
  }

  const priceSpan = Math.max(maxPrice - minPrice, 1e-6);
  const verticalSpan = baseHeight * steepness;
  const totalWidth = Math.max(2400, Math.min(targetWidth, smoothed.length * 24));
  const dx = totalWidth / (smoothed.length - 1);

  // Convert each price point to world coordinates (Y increases downward, so higher price = smaller Y)
  const midX = totalWidth * 0.5;
  const rad = (tiltDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const worldPoints = smoothed.map((p, i) => {
    const ux = i * dx;
    const norm = (p.close - minPrice) / priceSpan; // 0 = lowest, 1 = highest
    const uy = (0.5 - norm) * verticalSpan;
    // Rotate around chart center (midX, 0): positive tiltDeg rotates clockwise (downhill to the right)
    const x = (ux - midX) * cos - uy * sin + midX;
    const y = (ux - midX) * sin + uy * cos;
    return {
      x,
      y,
      t: p.t,
      price: p.close,
      rawPrice: sampled[Math.min(i, sampled.length - 1)].close,
    };
  });

  const segments = [];
  for (let i = 0; i < worldPoints.length - 1; i++) {
    const a = worldPoints[i];
    const b = worldPoints[i + 1];
    segments.push({
      ax: a.x,
      ay: a.y,
      bx: b.x,
      by: b.y,
      type: 'stock',
      isUp: b.price >= a.price,
    });
  }

  // Anchor launch ramp at the beginning (top-left above the start of the stock price line)
  const firstPt = worldPoints[0];
  const rampExitX = firstPt.x + 6;
  const rampExitY = firstPt.y - 6;

  let rampSegments = [];
  let rampAnchor = { x: rampExitX, y: rampExitY };
  let rampHandle = null;
  let spawn = { x: rampExitX + 12, y: rampExitY - 36 };

  if (launchRamp) {
    const ramp = buildLaunchRamp(rampExitX, rampExitY);
    rampSegments = ramp.rampSegments;
    spawn = ramp.spawn;
    rampHandle = ramp.handle;
  }

  const startPrice = worldPoints[0].rawPrice;
  const minX = launchRamp
    ? Math.min(worldPoints[0].x, rampExitX - 360)
    : worldPoints[0].x;
  const maxX = worldPoints[worldPoints.length - 1].x;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of worldPoints) {
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  if (launchRamp) {
    minY = Math.min(minY, rampExitY - 150);
  }

  function getSampleAtX(worldX) {
    if (worldPoints.length === 0) return null;
    if (worldX <= worldPoints[0].x) {
      return {
        ...worldPoints[0],
        onRamp: true,
        progress: 0,
        pctChange: 0,
      };
    }
    const last = worldPoints[worldPoints.length - 1];
    if (worldX >= last.x) {
      return {
        ...last,
        onRamp: false,
        progress: 1,
        pctChange: ((last.rawPrice - startPrice) / Math.max(startPrice, 1e-6)) * 100,
      };
    }
    // Find bracketing segment (works even when the chart is rotated)
    let i = 0;
    for (let k = 0; k < worldPoints.length - 1; k++) {
      if (worldPoints[k + 1].x >= worldX) {
        i = k;
        break;
      }
    }
    const a = worldPoints[i];
    const b = worldPoints[i + 1];
    const span = Math.max(b.x - a.x, 1e-6);
    const frac = Math.max(0, Math.min(1, (worldX - a.x) / span));
    const price = a.rawPrice + (b.rawPrice - a.rawPrice) * frac;
    const t = a.t + (b.t - a.t) * frac;
    const y = a.y + (b.y - a.y) * frac;
    return {
      x: worldX,
      y,
      t,
      price,
      onRamp: false,
      progress: i / Math.max(worldPoints.length - 1, 1),
      pctChange: ((price - startPrice) / Math.max(startPrice, 1e-6)) * 100,
    };
  }

  return {
    segments,
    rampSegments,
    rampAnchor,
    rampHandle,
    worldPoints,
    spawn,
    dx,
    totalWidth,
    bounds: { minX, maxX, minY, maxY },
    minPrice,
    maxPrice,
    startPrice,
    getSampleAtX,
  };
}

export function formatPrice(price, currency = 'USD') {
  if (!Number.isFinite(price)) return '—';
  if (currency === 'USD_B') {
    return `$${price >= 100 ? price.toFixed(0) : price.toFixed(1)}B`;
  }
  const symbol =
    currency === 'USD'
      ? '$'
      : currency === 'EUR'
        ? '€'
        : currency === 'GBP'
          ? '£'
          : currency === 'JPY'
            ? '¥'
            : `${currency} `;
  if (price >= 1000) {
    return `${symbol}${price.toLocaleString('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    })}`;
  }
  if (price >= 1) {
    return `${symbol}${price.toFixed(2)}`;
  }
  return `${symbol}${price.toFixed(4)}`;
}

export function formatDate(ms, range = '1y') {
  const d = new Date(ms);
  if (range === '1d' || range === '2d' || range === '5d') {
    return d.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
