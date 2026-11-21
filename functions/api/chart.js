import { RANGE_INTERVAL_MAP, fetchYahoo, jsonResponse } from './_yahoo.js';

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const sym = (url.searchParams.get('symbol') || '').trim().toUpperCase();
  const rangeParam = url.searchParams.get('range') || '1y';
  const range = RANGE_INTERVAL_MAP[rangeParam] ? rangeParam : '1y';
  const interval = RANGE_INTERVAL_MAP[range];

  if (!sym) {
    return jsonResponse({ error: 'Missing symbol parameter' }, 400);
  }

  try {
    const resp = await fetchYahoo(
      `/v8/finance/chart/${encodeURIComponent(sym)}?range=${range}&interval=${interval}&includePrePost=false`
    );
    if (!resp.ok) {
      return jsonResponse(
        { error: `Yahoo Finance returned HTTP ${resp.status} for ${sym}` },
        resp.status
      );
    }

    const data = await resp.json();
    const result = data?.chart?.result?.[0];
    if (!result) {
      const msg = data?.chart?.error?.description || `No chart data found for ${sym}`;
      return jsonResponse({ error: msg }, 404);
    }

    const meta = result.meta || {};
    const timestamps = result.timestamp || [];
    const quote = result.indicators?.quote?.[0] || {};
    const closes = quote.close || [];
    const highs = quote.high || [];
    const lows = quote.low || [];
    const opens = quote.open || [];

    const points = [];
    for (let i = 0; i < timestamps.length; i++) {
      const c = closes[i];
      if (typeof c === 'number' && Number.isFinite(c)) {
        points.push({
          t: timestamps[i] * 1000,
          close: c,
          open: typeof opens[i] === 'number' ? opens[i] : c,
          high: typeof highs[i] === 'number' ? highs[i] : c,
          low: typeof lows[i] === 'number' ? lows[i] : c,
        });
      }
    }

    if (points.length < 2) {
      return jsonResponse({ error: `Not enough price points for ${sym} (${range})` }, 404);
    }

    return jsonResponse(
      {
        symbol: meta.symbol || sym,
        name: meta.shortName || meta.longName || meta.symbol || sym,
        currency: meta.currency || 'USD',
        exchange: meta.exchangeName || '',
        range,
        points,
      },
      200,
      300
    );
  } catch (err) {
    return jsonResponse(
      { error: `Could not fetch live data for ${sym}: ${err.message}` },
      502
    );
  }
}
