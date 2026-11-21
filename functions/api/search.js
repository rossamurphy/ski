import { fetchYahoo, jsonResponse } from './_yahoo.js';

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim();
  if (!q) {
    return jsonResponse({ results: [] }, 200, 60);
  }

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
    // Return empty list on network failure
  }

  return jsonResponse({ results: yahooResults }, 200, 300);
}
