import { PRIVATE_COMPANIES, fetchYahoo, jsonResponse } from './_yahoo.js';

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim();
  if (!q) {
    return jsonResponse({ results: [] }, 200, 60);
  }

  const lower = q.toLowerCase();
  const privateMatches = PRIVATE_COMPANIES.filter(
    (c) =>
      c.name.toLowerCase().includes(lower) ||
      c.keywords.some((k) => k.includes(lower) || lower.includes(k))
  ).map(({ symbol, name, exchange, quoteType }) => ({
    symbol,
    name,
    exchange,
    quoteType,
  }));

  let yahooResults = [];
  try {
    const resp = await fetchYahoo(
      `/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0&enableFuzzyQuery=true`
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
  } catch {
    // Return private matches if Yahoo lookup fails
  }

  return jsonResponse({ results: [...privateMatches, ...yahooResults] }, 200, 300);
}
