import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT) || 3000;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const RANGE_INTERVAL_MAP = {
  '1d': '5m',
  '2d': '5m',
  '5d': '15m',
  '1mo': '1d',
  '6mo': '1d',
  '1y': '1d',
  '5y': '1wk',
  'max': '1mo',
};

// Simple in-memory cache (5 min TTL)
const cache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function setCached(key, value) {
  cache.set(key, { ts: Date.now(), value });
}

const YAHOO_HOSTS = ['https://query2.finance.yahoo.com', 'https://query1.finance.yahoo.com'];
const YAHOO_HEADERS = {
  'User-Agent': 'Mozilla/5.0',
  Accept: 'application/json',
};

async function fetchYahoo(pathAndQuery, timeoutMs = 7000) {
  let lastResp = null;
  let lastErr = null;
  for (const host of YAHOO_HOSTS) {
    try {
      const resp = await fetch(`${host}${pathAndQuery}`, {
        headers: YAHOO_HEADERS,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (resp.ok) return resp;
      lastResp = resp;
    } catch (err) {
      lastErr = err;
    }
  }
  if (lastResp) return lastResp;
  throw lastErr || new Error('Yahoo Finance request failed');
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-cache',
  });
  res.end(body);
}

async function handleSearch(query, res) {
  const q = (query || '').trim();
  if (!q) {
    return sendJson(res, 200, { results: [] });
  }

  const lower = q.toLowerCase();
  const cacheKey = `search:${lower}`;
  const cached = getCached(cacheKey);
  if (cached) {
    return sendJson(res, 200, { results: cached });
  }

  let yahooResults = [];
  try {
    const resp = await fetchYahoo(
      `/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0&enableFuzzyQuery=true`,
      7000
    );
    if (resp.ok) {
      const data = await resp.json();
      yahooResults = (data.quotes || [])
        .filter((item) => item.symbol && (item.shortname || item.longname))
        .slice(0, 8)
        .map((item) => ({
          symbol: item.symbol,
          name: item.shortname || item.longname || item.symbol,
          exchange: item.exchDisp || item.exchange || '',
          quoteType: item.quoteType || 'EQUITY',
        }));
    }
  } catch (err) {
    console.warn('[search] Yahoo lookup failed:', err.message);
  }

  setCached(cacheKey, yahooResults);
  return sendJson(res, 200, { results: yahooResults });
}

async function handleChart(symbol, rangeParam, res) {
  const sym = (symbol || '').trim().toUpperCase();
  const range = RANGE_INTERVAL_MAP[rangeParam] ? rangeParam : '1y';
  const interval = RANGE_INTERVAL_MAP[range];

  if (!sym) {
    return sendJson(res, 400, { error: 'Missing symbol parameter' });
  }

  const cacheKey = `chart:${sym}:${range}`;
  const cached = getCached(cacheKey);
  if (cached) {
    return sendJson(res, 200, cached);
  }

  try {
    const resp = await fetchYahoo(
      `/v8/finance/chart/${encodeURIComponent(sym)}?range=${range}&interval=${interval}&includePrePost=false`,
      8000
    );
    if (!resp.ok) {
      return sendJson(res, resp.status, {
        error: `Yahoo Finance returned HTTP ${resp.status} for ${sym}`,
      });
    }

    const data = await resp.json();
    const result = data?.chart?.result?.[0];
    if (!result) {
      const msg = data?.chart?.error?.description || `No chart data found for ${sym}`;
      return sendJson(res, 404, { error: msg });
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
      return sendJson(res, 404, { error: `Not enough price points for ${sym} (${range})` });
    }

    const payload = {
      symbol: meta.symbol || sym,
      name: meta.shortName || meta.longName || meta.symbol || sym,
      currency: meta.currency || 'USD',
      exchange: meta.exchangeName || '',
      range,
      points,
    };

    setCached(cacheKey, payload);
    return sendJson(res, 200, payload);
  } catch (err) {
    console.warn('[chart] Yahoo chart fetch failed:', err.message);
    return sendJson(res, 502, {
      error: `Could not fetch live data for ${sym}: ${err.message}`,
    });
  }
}

async function serveStatic(pathname, res) {
  let reqPath = pathname === '/' ? '/index.html' : pathname;
  reqPath = path.normalize(reqPath).replace(/^(\.\.[/\\])+/, '');
  const fullPath = path.join(PUBLIC_DIR, reqPath);

  if (!fullPath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  try {
    const data = await fs.readFile(fullPath);
    const ext = path.extname(fullPath);
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/api/search') {
    return handleSearch(url.searchParams.get('q'), res);
  }
  if (url.pathname === '/api/chart') {
    return handleChart(
      url.searchParams.get('symbol'),
      url.searchParams.get('range') || '1y',
      res
    );
  }

  return serveStatic(url.pathname, res);
});

server.listen(PORT, () => {
  console.log(`\n  🎿 Stock Ski Rider running at http://localhost:${PORT}\n`);
});
