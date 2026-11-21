export const YAHOO_HOSTS = [
  'https://query2.finance.yahoo.com',
  'https://query1.finance.yahoo.com',
];

export const YAHOO_HEADERS = {
  'User-Agent': 'Mozilla/5.0',
  Accept: 'application/json',
};

export const RANGE_INTERVAL_MAP = {
  '1d': '5m',
  '2d': '5m',
  '5d': '15m',
  '1mo': '1d',
  '6mo': '1d',
  '1y': '1d',
  '5y': '1wk',
  max: '1mo',
};

export async function fetchYahoo(pathAndQuery) {
  let lastResp = null;
  let lastErr = null;
  for (const host of YAHOO_HOSTS) {
    try {
      const resp = await fetch(`${host}${pathAndQuery}`, {
        headers: YAHOO_HEADERS,
        cf: { cacheTtl: 300, cacheEverything: true },
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

export function jsonResponse(data, status = 200, cacheSeconds = 0) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control':
        cacheSeconds > 0 ? `public, max-age=${cacheSeconds}` : 'no-cache',
    },
  });
}
