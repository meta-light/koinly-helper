import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';
import { COINGECKO_ID_MAP, BIRDEYE_SUPPORTED_CHAINS } from './mappings';
import { fetchBirdeyePrice, getTokenAddress, fetchPriceFromCache, cacheBirdeyeCandles } from './birdeye';
import { delay, parseCSVLine, extractTokenInfo, dateToUnixTimestamp, stringifyCSVLine, getChain } from './utils'
import { findCoinGeckoId, fetchCoinGeckoPrice, fetchPriceFromCGCache, cacheGCCandles } from './coingecko'
import { getDateRanges } from './config';
dotenv.config();

let coingeckoList: any[] = [];
export const COINGECKO_LIST_PATH = path.join(process.cwd(), '.cache/coingecko_list.json');
if (fs.existsSync(COINGECKO_LIST_PATH)) {coingeckoList = JSON.parse(fs.readFileSync(COINGECKO_LIST_PATH, 'utf-8'));}

export async function listMissingIds() {
  const inputFile = path.join(process.cwd(), 'transactions.csv');
  const fileContent = fs.readFileSync(inputFile, 'utf-8');
  const lines = fileContent.split('\n');
  if (lines.length === 0) return;
  const headers = parseCSVLine(lines[0]);
  const dateIndex = headers.indexOf('Date (UTC)');
  const fromCurrencyIndex = headers.indexOf('From Currency');
  const toCurrencyIndex = headers.indexOf('To Currency');
  const feeCurrencyIndex = headers.indexOf('Fee Currency');
  const now = Math.floor(Date.now() / 1000);
  const yearAgo = now - (365 * 24 * 60 * 60);
  const missingTokens = new Map<string, { symbol: string, tokenId: string }>();
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const fields = parseCSVLine(lines[i]);
    const dateStr = fields[dateIndex];
    const timestamp = Math.floor(new Date(dateStr).getTime() / 1000);
    if (timestamp < yearAgo) continue;
    [fields[fromCurrencyIndex], fields[toCurrencyIndex], fields[feeCurrencyIndex]].forEach(cur => {
      const info = extractTokenInfo(cur);
      if (info) {
        const key = `${info.symbol}:${info.tokenId}`;
        if (!COINGECKO_ID_MAP[info.tokenId] && !COINGECKO_ID_MAP[info.symbol]) {missingTokens.set(key, info);}
      }
    });
  }
  console.log('--- TOKENS NEEDING COINGECKO IDs (Traded in last 365 days) ---');
  console.log('Format for help: symbol (internalId)');
  console.log('------------------------------------------------------------');
  const sortedTokens = Array.from(missingTokens.values()).sort((a, b) => a.symbol.localeCompare(b.symbol));
  for (const token of sortedTokens) {
    console.log(`'${token.tokenId}': '', // ${token.symbol}`);
  }
  console.log('\nTotal unique tokens missing mapping:', sortedTokens.length);
}



export async function fetchHistoricalPrice(tokenId: string, symbol: string, timestamp: number, chain: string = 'solana', retries = 2): Promise<number | null> {
  const dateRanges = getDateRanges();
  if (BIRDEYE_SUPPORTED_CHAINS.includes(chain)) {
    const tokenAddress = getTokenAddress(tokenId, chain);
    if (tokenAddress) {
      const cachedPrice = fetchPriceFromCache(tokenAddress, timestamp);
      if (cachedPrice !== null) {
        console.log(`  Birdeye Cache Hit for ${symbol}: $${cachedPrice}`);
        return cachedPrice;
      }
    }
  }
  const nowUnix = Math.floor(Date.now() / 1000);
  const yearAgo = nowUnix - (365 * 24 * 60 * 60);
  if (timestamp >= yearAgo) {
    const cgId = findCoinGeckoId(tokenId, symbol, chain);
    if (cgId) {
      const cachedCGPrice = fetchPriceFromCGCache(cgId, timestamp);
      if (cachedCGPrice !== null) {
        console.log(`  CoinGecko Cache Hit for ${symbol}: $${cachedCGPrice}`);
        return cachedCGPrice;
      }
      console.log(`  Trying CoinGecko API for ${symbol} (${tokenId})...`);
      let cgPrice = await fetchCoinGeckoPrice(tokenId, symbol, timestamp, chain, dateRanges.MEDIUM_RANGE);
      if (cgPrice === null) {
        console.log(`  Trying looser 10-day window for ${symbol}...`);
        cgPrice = await fetchCoinGeckoPrice(tokenId, symbol, timestamp, chain, dateRanges.LONG_RANGE);
      }
      if (cgPrice !== null) {console.log(`  CoinGecko Success: $${cgPrice}`); return cgPrice;}
    }
  }
  if (BIRDEYE_SUPPORTED_CHAINS.includes(chain)) {
    const tokenAddress = getTokenAddress(tokenId, chain);
    if (tokenAddress) {
      console.log(`  Cache Miss & CoinGecko failed. Trying Birdeye API for ${symbol}...`);
      try {
        let bePrice = await fetchBirdeyePrice(tokenAddress, timestamp, chain, dateRanges.MEDIUM_RANGE);
        if (bePrice === -429) {
          if (retries > 0) {
            console.log(`  Birdeye: Rate limited. Sleeping 30s (Retries left: ${retries})...`);
            await delay(30000);
            return fetchHistoricalPrice(tokenId, symbol, timestamp, chain, retries - 1);
          } 
          else {console.log(`  Birdeye: Rate limited. No retries left.`); return null;}
        }
        if (bePrice === null) {
          console.log(`  Trying looser 10-day window on Birdeye for ${symbol}...`);
          bePrice = await fetchBirdeyePrice(tokenAddress, timestamp, chain, dateRanges.LONG_RANGE);
          if (bePrice === -429) {
            if (retries > 0) {
              console.log(`  Birdeye: Rate limited. Sleeping 30s (Retries left: ${retries})...`);
              await delay(30000);
              return fetchHistoricalPrice(tokenId, symbol, timestamp, chain, retries - 1);
            } 
            else {console.log(`  Birdeye: Rate limited. No retries left.`); return null;}
          }
        }
        if (bePrice !== null && bePrice !== -429) {console.log(`  Birdeye Success: $${bePrice}`); return bePrice;}
      } 
      catch (e) {console.error(`  Birdeye Error:`, e);}
    }
  }
  return null;
}

export async function fetchAndUpdatePrices() {
  const inputFile = path.join(process.cwd(), 'transactions.csv');
  const outputFile = path.join(process.cwd(), 'transactions-updated.csv');
  const fileContent = fs.readFileSync(inputFile, 'utf-8');
  const lines = fileContent.split('\n');
  if (lines.length === 0) { console.error('Empty CSV file'); return; }
  const headers = parseCSVLine(lines[0]);
  const dateIndex = headers.indexOf('Date (UTC)');
  const fromAmountIndex = headers.indexOf('From Amount');
  const fromCurrencyIndex = headers.indexOf('From Currency');
  const toAmountIndex = headers.indexOf('To Amount');
  const toCurrencyIndex = headers.indexOf('To Currency');
  const feeAmountIndex = headers.indexOf('Fee Amount');
  const feeCurrencyIndex = headers.indexOf('Fee Currency');
  const netWorthAmountIndex = headers.indexOf('Net Worth Amount');
  const netWorthCurrencyIndex = headers.indexOf('Net Worth Currency');
  const feeWorthAmountIndex = headers.indexOf('Fee Worth Amount');
  const feeWorthCurrencyIndex = headers.indexOf('Fee Worth Currency');
  const idIndex = headers.indexOf('ID (read-only)');
  const fromWalletIndex = headers.indexOf('From Wallet (read-only)');
  const toWalletIndex = headers.indexOf('To Wallet (read-only)');
  console.log(`Processing ${lines.length - 1} transactions...`);
  const updatedLines: string[] = [lines[0]];
  let successfulFetches = 0;
  const missingMappings = new Set<string>();
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const fields = parseCSVLine(lines[i]);
    const transactionId = fields[idIndex];
    const dateStr = fields[dateIndex];
    const timestamp = dateToUnixTimestamp(dateStr);
    const chain = getChain(fields, fromWalletIndex, toWalletIndex);
    console.log(`\n[${i}/${lines.length - 1}] Processing transaction ${transactionId} at ${dateStr} on ${chain}`);
    let netWorthUpdated = false;
    let feeWorthUpdated = false;
    const isMissing = (val: string | undefined) => !val || val.trim() === '' || val.trim() === '0.0';
    const existingFeeWorth = fields[feeWorthAmountIndex]?.trim();
    const existingNetWorth = fields[netWorthAmountIndex]?.trim();
    const feeMissing = isMissing(existingFeeWorth);
    const netWorthMissing = isMissing(existingNetWorth);
    if (!feeMissing && !netWorthMissing) {console.log(`  Skipping: Net Worth and Fee Worth already set.`); updatedLines.push(lines[i]); continue;}
    const localFetchCache = new Map<string, number | null>();
    const getCachedOrFetch = async (tokenInfo: { symbol: string; tokenId: string }) => {
      const cacheKey = `${tokenInfo.tokenId}_${chain}`;
      if (localFetchCache.has(cacheKey)) return localFetchCache.get(cacheKey)!;
      const price = await fetchHistoricalPrice(tokenInfo.tokenId, tokenInfo.symbol, timestamp, chain);
      localFetchCache.set(cacheKey, price);
      return price;
    };
    const feeCurrency = fields[feeCurrencyIndex];
    if (feeCurrency && feeMissing) {
      const feeTokenInfo = extractTokenInfo(feeCurrency);
      if (feeTokenInfo) {
        console.log(`  Fetching price for Fee: ${feeTokenInfo.symbol}...`);
        const price = await getCachedOrFetch(feeTokenInfo);
        if (price !== null) {
          const amount = parseFloat(fields[feeAmountIndex] || '0');
          fields[feeWorthAmountIndex] = (amount * price).toFixed(6);
          fields[feeWorthCurrencyIndex] = 'USD';
          feeWorthUpdated = true;
          successfulFetches++;
        }
      }
    }
    if (netWorthMissing) {
      const fromCurrency = fields[fromCurrencyIndex];
      const fromTokenInfo = extractTokenInfo(fromCurrency);
      if (fromTokenInfo) {
        console.log(`  Fetching price for From: ${fromTokenInfo.symbol}...`);
        const price = await getCachedOrFetch(fromTokenInfo);
        if (price !== null) {
          const amount = parseFloat(fields[fromAmountIndex] || '0');
          fields[netWorthAmountIndex] = (amount * price).toFixed(6);
          fields[netWorthCurrencyIndex] = 'USD';
          netWorthUpdated = true;
          successfulFetches++;
        }
      }
      if (!netWorthUpdated) {
        const toCurrency = fields[toCurrencyIndex];
        const toTokenInfo = extractTokenInfo(toCurrency);
        if (toTokenInfo) {
          console.log(`  Fetching price for To: ${toTokenInfo.symbol}...`);
          const price = await getCachedOrFetch(toTokenInfo);
          if (price !== null) {
            const amount = parseFloat(fields[toAmountIndex] || '0');
            fields[netWorthAmountIndex] = (amount * price).toFixed(6);
            fields[netWorthCurrencyIndex] = 'USD';
            netWorthUpdated = true;
            successfulFetches++;
          }
        }
      }
    }
    if (netWorthUpdated || feeWorthUpdated) {updatedLines.push(stringifyCSVLine(fields));} else {updatedLines.push(lines[i]);}
  }
  fs.writeFileSync(outputFile, updatedLines.join('\n'));
  console.log(`\n✅ Done! Updated file written to ${outputFile}`);
  console.log(`Total prices successfully applied: ${successfulFetches}`);
  if (missingMappings.size > 0) {
    console.log('\n--- 📂 MISSING MAPPINGS (Add these to TOKEN_ADDRESS_MAP or COINGECKO_ID_MAP) ---');
    Array.from(missingMappings).sort().forEach(m => console.log(m));
  }
}