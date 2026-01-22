import { COINGECKO_ID_MAP } from './mappings';
import * as fs from 'fs';
import * as path from 'path';
import { parseCSVLine, extractTokenInfo, delay } from './utils';

export const CG_MIN_GAP = 4000; // 15 requests per minute (60s / 15 = 4s)
export const CG_CANDLES_PATH = path.join(process.cwd(), '.cache/coingecko_candles.json');
let lastCGCallTime = 0;
let cgCandleCache: Record<string, any[]> = {};
if (fs.existsSync(CG_CANDLES_PATH)) {cgCandleCache = JSON.parse(fs.readFileSync(CG_CANDLES_PATH, 'utf-8'));}

export function fetchPriceFromCGCache(cgId: string, timestamp: number): number | null {
  const prices = cgCandleCache[cgId];
  if (!prices || prices.length === 0) return null;
  let closestPrice = prices[0][1];
  let minDiff = Math.abs(prices[0][0] / 1000 - timestamp);
  for (const [ms, price] of prices) {
    const diff = Math.abs(ms / 1000 - timestamp);
    if (diff < minDiff) {minDiff = diff; closestPrice = price;}
  }
  return closestPrice;
}

export function findCoinGeckoId(tokenId: string, symbol: string, chain: string): string | null {
    const mappedId = COINGECKO_ID_MAP[tokenId] || COINGECKO_ID_MAP[symbol];
    if (mappedId && mappedId !== '') return mappedId;
    return null;
}

export async function cacheGCCandles() {
    const cache: Record<string, any> = fs.existsSync(CG_CANDLES_PATH) ? JSON.parse(fs.readFileSync(CG_CANDLES_PATH, 'utf-8')) : {};
    const inputFile = path.join(process.cwd(), 'transactions.csv');
    const fileContent = fs.readFileSync(inputFile, 'utf-8');
    const lines = fileContent.split('\n');
    const headers = parseCSVLine(lines[0]);
    const fromCurrencyIndex = headers.indexOf('From Currency');
    const toCurrencyIndex = headers.indexOf('To Currency');
    const feeCurrencyIndex = headers.indexOf('Fee Currency');
    const fromWalletIndex = headers.indexOf('From Wallet (read-only)');
    const toWalletIndex = headers.indexOf('To Wallet (read-only)');
    const cgIdsToFetch = new Set<string>();
    const idToSymbol = new Map<string, string>();
    const getChain = (fields: string[]): string => {
      let val = fields[fromWalletIndex];
      if (!val || !val.includes(';')) val = fields[toWalletIndex];
      if (val && val.includes(';')) {
        const rawChain = val.split(';')[1].toLowerCase();
        if (rawChain === 'eth') return 'ethereum';
        if (rawChain === 'hyperevm') return 'hyperevm';
        return rawChain;
      }
      return 'solana';
    };
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const fields = parseCSVLine(lines[i]);
      const chain = getChain(fields);
      [fields[fromCurrencyIndex], fields[toCurrencyIndex], fields[feeCurrencyIndex]].forEach(curr => {
        const info = extractTokenInfo(curr);
        if (info) {
          const cgId = findCoinGeckoId(info.tokenId, info.symbol, chain);
          if (cgId && !cache[cgId]) {
            cgIdsToFetch.add(cgId);
            idToSymbol.set(cgId, info.symbol);
          }
        }
      });
    }
    const idsArray = Array.from(cgIdsToFetch);
    console.log(`Found ${idsArray.length} missing CoinGecko tokens to fetch...`);
    for (let i = 0; i < idsArray.length; i++) {
      const cgId = idsArray[i];
      const symbol = idToSymbol.get(cgId);
      console.log(`[${i + 1}/${idsArray.length}] Fetching historical data for ${symbol} (${cgId})...`);
      const now = Math.floor(Date.now() / 1000);
      const yearAgo = now - (364 * 24 * 60 * 60); // 364 days to be safe
      const url = `https://api.coingecko.com/api/v3/coins/${cgId}/market_chart/range?vs_currency=usd&from=${yearAgo}&to=${now}`;
      try {
        const response = await fetch(url);
        if (response.status === 429) {
          console.log(`  Rate limited by CoinGecko. Sleeping 60s...`);
          await delay(60000);
          i--;
          continue;
        }
        if (!response.ok) {console.error(`  Error fetching ${cgId}: ${response.status}`); continue;}
        const data: any = await response.json();
        if (data.prices && data.prices.length > 0) {
          cache[cgId] = data.prices;
          fs.writeFileSync(CG_CANDLES_PATH, JSON.stringify(cache, null, 2));
          console.log(`  Success: Found ${data.prices.length} price points.`);
        } 
        else {console.log(`  Failed or no data for ${cgId}`);}
      } 
      catch (e) {console.error(`  Fetch error for ${cgId}:`, e);}
      if (i < idsArray.length - 1) {await delay(CG_MIN_GAP);}
    }
    console.log('All CoinGecko tokens processed.');
}

export async function fetchCoinGeckoPrice(tokenId: string, symbol: string, timestamp: number, chain: string, windowSeconds: number = 86400): Promise<number | null> {
    const now = Math.floor(Date.now() / 1000);
    const yearAgo = now - (365 * 24 * 60 * 60);
    if (timestamp < yearAgo) {return null;}
    const cgId = findCoinGeckoId(tokenId, symbol, chain);
    if (!cgId) return null;
    const currentMs = Date.now();
    const timeSinceLastCall = currentMs - lastCGCallTime;
    if (timeSinceLastCall < CG_MIN_GAP) {await delay(CG_MIN_GAP - timeSinceLastCall);}
    lastCGCallTime = Date.now();
    const url = `https://api.coingecko.com/api/v3/coins/${cgId}/market_chart/range?vs_currency=usd&from=${timestamp - windowSeconds}&to=${timestamp + windowSeconds}`;
    try {
      const response = await fetch(url);
      if (response.status === 429) {await delay(30000); return fetchCoinGeckoPrice(tokenId, symbol, timestamp, chain, windowSeconds);}
      if (!response.ok) return null;
      const data: any = await response.json();
      if (!data.prices || data.prices.length === 0) {console.log(`  CoinGecko: No price data found for ${cgId} in this range (+/- ${windowSeconds}s).`); return null;}
      let closestPrice = data.prices[0][1];
      let minDiff = Math.abs(data.prices[0][0] / 1000 - timestamp);
      for (const [ms, price] of data.prices) {const diff = Math.abs(ms / 1000 - timestamp); if (diff < minDiff) {minDiff = diff; closestPrice = price;}}
      return closestPrice;
    } 
    catch (e) {console.error(`  CoinGecko Error:`, e); return null;}
}