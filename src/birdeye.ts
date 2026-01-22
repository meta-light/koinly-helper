import * as fs from 'fs';
import { TOKEN_ADDRESS_MAP, BIRDEYE_SUPPORTED_CHAINS } from "./mappings";
import { findCoinGeckoId, fetchCoinGeckoPrice } from "./coingecko";
import { delay, parseCSVLine, extractTokenInfo } from './utils';
import dotenv from 'dotenv';
import * as path from 'path';
dotenv.config();

const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY;
if (!BIRDEYE_API_KEY) {throw new Error('BIRDEYE_API_KEY is not set');}
const CANDLES_PATH = path.join(process.cwd(), '.cache/birdeye_candles.json');
export let lastCallTime = 0;
const MIN_GAP = 5000; // 0.2 RPS (safe for free tier) for Birdeye
let candleCache: Record<string, any[]> = {};
if (fs.existsSync(CANDLES_PATH)) {candleCache = JSON.parse(fs.readFileSync(CANDLES_PATH, 'utf-8'));}


export function fetchPriceFromCache(tokenAddress: string, timestamp: number): number | null {
  const candles = candleCache[tokenAddress];
  if (!candles || candles.length === 0) return null;
  let closestPrice = candles[0].value;
  let minDiff = Math.abs(candles[0].unixTime - timestamp);
  for (const candle of candles) {
    const diff = Math.abs(candle.unixTime - timestamp);
    if (diff < minDiff) {minDiff = diff; closestPrice = candle.value;}
  }
  return closestPrice;
}

interface Transaction {
  id: string;
  date: string;
  fromCurrency: string;
  toCurrency: string;
  feeCurrency: string;
  fromAmount: string;
  toAmount: string;
  feeAmount: string;
  chain: string;
  [key: string]: string;
}

interface PriceData {
  transactionId: string;
  currency: string;
  timestamp: number;
  price: number | null;
  error?: string;
}

export function getTokenAddress(tokenId: string, chain: string): string | null {
  if (TOKEN_ADDRESS_MAP[`${tokenId}_${chain}`]) {return TOKEN_ADDRESS_MAP[`${tokenId}_${chain}`];}
  return TOKEN_ADDRESS_MAP[tokenId] || null;
}

export async function fetchBirdeyePrice(tokenAddress: string, timestamp: number, chain: string, windowSeconds: number): Promise<number | null | -429> {
  const currentMs = Date.now();
  const timeSinceLastCall = currentMs - lastCallTime;
  if (timeSinceLastCall < MIN_GAP) {await delay(MIN_GAP - timeSinceLastCall);}
  lastCallTime = Date.now();
  const headers = {'X-API-KEY': BIRDEYE_API_KEY, 'accept': 'application/json', 'x-chain': chain};
  const url = new URL('https://public-api.birdeye.so/defi/history_price');
  url.searchParams.append('address', tokenAddress);
  url.searchParams.append('address_type', 'token');
  url.searchParams.append('type', '1H');
  url.searchParams.append('time_from', (timestamp - windowSeconds).toString());
  url.searchParams.append('time_to', (timestamp + windowSeconds).toString());
  const response = await fetch(url.toString(), { headers });
  if (response.status === 429) return -429;
  if (!response.ok) {
    const errorText = await response.text();
    console.error(`API error for ${tokenAddress} on ${chain}: ${response.status}`, errorText);
    return null;
  }
  const data = await response.json() as any;
  if (!data.success || !data.data || !data.data.items || data.data.items.length === 0) {return null;}
  let closestItem = data.data.items[0];
  let minDiff = Math.abs(closestItem.unixTime - timestamp);
  for (const item of data.data.items) {
    const diff = Math.abs(item.unixTime - timestamp);
    if (diff < minDiff) {minDiff = diff; closestItem = item;}
  }
  return closestItem.value;
}

async function fetchHistoricalPrice(tokenId: string, symbol: string, timestamp: number, chain: string = 'solana', retries = 2): Promise<number | null> {
  const nowUnix = Math.floor(Date.now() / 1000);
  const yearAgo = nowUnix - (365 * 24 * 60 * 60);
  if (timestamp >= yearAgo) {
    const cgId = findCoinGeckoId(tokenId, symbol, chain);
    if (cgId) {
      console.log(`  Trying CoinGecko for ${symbol} (${tokenId})...`);
      const cgPrice = await fetchCoinGeckoPrice(tokenId, symbol, timestamp, chain);
      if (cgPrice !== null) {console.log(`  CoinGecko Success: $${cgPrice}`); return cgPrice;}
    }
  }
  if (!BIRDEYE_SUPPORTED_CHAINS.includes(chain)) {console.log(`  Chain ${chain} not supported by Birdeye. Skipping.`); return null;}
  const tokenAddress = getTokenAddress(tokenId, chain);
  if (!tokenAddress) {return null;}
  const cachedPrice = fetchPriceFromCache(tokenAddress, timestamp);
  if (cachedPrice !== null) {console.log(`  Birdeye Cache Hit for ${symbol}: $${cachedPrice}`); return cachedPrice;}
  console.log(`  CoinGecko failed/skipped & Cache Miss. Trying Birdeye API for ${tokenAddress} on ${chain}...`);
  const currentMs = Date.now();
  const timeSinceLastCall = currentMs - lastCallTime;
  if (timeSinceLastCall < MIN_GAP) {await delay(MIN_GAP - timeSinceLastCall);}
  lastCallTime = Date.now();
  try {
    let price = await fetchBirdeyePrice(tokenAddress, timestamp, chain, 86400);
    if (price === -429 && retries > 0) {
      console.log(`  Birdeye: Rate limited. Backing off for 30s...`);
      await delay(30000);
      return fetchHistoricalPrice(tokenId, symbol, timestamp, chain, retries - 1);
    }
    if (price !== null && price !== -429) return price;
    console.log(`  Birdeye: No price in 24h for ${tokenAddress}. Trying 10-day lookback...`);
    price = await fetchBirdeyePrice(tokenAddress, timestamp, chain, 86400 * 10);
    if (price === -429 && retries > 0) {
      console.log(`  Birdeye: Rate limited. Backing off for 30s...`);
      await delay(30000);
      return fetchHistoricalPrice(tokenId, symbol, timestamp, chain, retries - 1);
    }
    if (price !== null && price !== -429) return price;
    console.log(`  Birdeye: No price found in 10-day range for ${tokenAddress} on ${chain}.`);
    return null;
  } 
  catch (error) {console.error(`Error fetching price for ${tokenAddress} on ${chain}:`, error); return null;}
}

export async function cacheBirdeyeCandles() {
  const cache: Record<string, any> = fs.existsSync(CANDLES_PATH) ? JSON.parse(fs.readFileSync(CANDLES_PATH, 'utf-8')) : {};
  const inputFile = path.join(process.cwd(), 'transactions.csv');
  const fileContent = fs.readFileSync(inputFile, 'utf-8');
  const lines = fileContent.split('\n');
  const headers = parseCSVLine(lines[0]);
  const fromCurrencyIndex = headers.indexOf('From Currency');
  const toCurrencyIndex = headers.indexOf('To Currency');
  const feeCurrencyIndex = headers.indexOf('Fee Currency');
  const fromWalletIndex = headers.indexOf('From Wallet (read-only)');
  const toWalletIndex = headers.indexOf('To Wallet (read-only)');
  const uniqueTokens = new Map<string, { address: string; chain: string; symbol: string }>();
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const fields = parseCSVLine(lines[i]);
    let val = fields[fromWalletIndex];
    if (!val || !val.includes(';')) {val = fields[toWalletIndex];}
    let chain = 'solana';
    if (val && val.includes(';')) {
      const rawChain = val.split(';')[1].toLowerCase();
      const chainMap: Record<string, string> = {
        'eth': 'ethereum', 'ethereum': 'ethereum', 'solana': 'solana',
        'arbitrum': 'arbitrum', 'base': 'base', 'hyperevm': 'hyperevm',
        'polygon': 'polygon', 'optimism': 'optimism'
      };
      chain = chainMap[rawChain] || rawChain;
    }
    [fields[fromCurrencyIndex], fields[toCurrencyIndex], fields[feeCurrencyIndex]].forEach(curr => {
      const info = extractTokenInfo(curr);
      if (info) {
        const address = TOKEN_ADDRESS_MAP[`${info.tokenId}_${chain}`] || TOKEN_ADDRESS_MAP[info.tokenId];
        if (address) {uniqueTokens.set(address, { address, chain, symbol: info.symbol });}
      }
    });
  }
  const tokensToFetch = Array.from(uniqueTokens.values()).filter(t => !cache[t.address]);
  console.log(`Found ${uniqueTokens.size} unique tokens, ${tokensToFetch.length} need fetching...`);
  for (let i = 0; i < tokensToFetch.length; i++) {
    const { address, chain, symbol } = tokensToFetch[i];
    console.log(`[${i + 1}/${tokensToFetch.length}] Fetching 1D candles for ${symbol} (${address}) on ${chain}...`);
    const now = Math.floor(Date.now() / 1000);
    const yearAgo = now - (365 * 24 * 60 * 60);
    const url = new URL('https://public-api.birdeye.so/defi/history_price');
    url.searchParams.append('address', address);
    url.searchParams.append('address_type', 'token');
    url.searchParams.append('type', '1D');
    url.searchParams.append('time_from', yearAgo.toString());
    url.searchParams.append('time_to', now.toString());
    const headers = {'X-API-KEY': BIRDEYE_API_KEY, 'accept': 'application/json', 'x-chain': chain};
    try {
      const response = await fetch(url.toString(), { headers });
      if (response.status === 429) {console.log(`  Rate limited for ${address}. Sleeping 30s...`); await delay(30000); i--; continue;}
      if (!response.ok) {console.error(`  Error fetching ${address}: ${response.status}`); continue;}
      const data = await response.json() as any;
      if (data.success && data.data && data.data.items) {
        cache[address] = data.data.items;
        fs.writeFileSync(CANDLES_PATH, JSON.stringify(cache, null, 2));
        console.log(`  Success: Found ${data.data.items.length} daily candles.`);
      } else {console.log(`  Failed or no data for ${address}`);}
    } 
    catch (e) {console.error(`  Fetch error for ${address}:`, e);}
    if (i < tokensToFetch.length - 1) {await delay(MIN_GAP);}
  }
  console.log('All tokens processed.');
}