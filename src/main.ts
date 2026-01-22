#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';
import { cacheBirdeyeCandles } from './birdeye';
import { cacheGCCandles } from './coingecko';
import { fetchAndUpdatePrices, listMissingIds } from './index';
import { parseCSVLine } from './utils';

async function main() {
  console.log('='.repeat(70));
  console.log('🚀 Koinly Transaction Price Updater');
  console.log('='.repeat(70));
  console.log();
  const inputFile = path.join(process.cwd(), 'transactions.csv');
  if (!fs.existsSync(inputFile)) {
    console.error('❌ ERROR: transactions.csv not found in the current directory.');
    console.error('');
    console.error('Please download your transactions from Koinly:');
    console.error('  1. Select transactions to update');
    console.error('  2. Click the 3 dots menu');
    console.error('  3. Choose "Edit in Excel"');
    console.error('  4. Download the CSV file');
    console.error('  5. Place it in this directory as "transactions.csv"');
    console.error('');
    process.exit(1);
  }
  const cacheDir = path.join(process.cwd(), '.cache');
  if (!fs.existsSync(cacheDir)) {console.log('📁 Creating .cache directory...'); fs.mkdirSync(cacheDir, { recursive: true });}
  const fileContent = fs.readFileSync(inputFile, 'utf-8');
  const lines = fileContent.split('\n').filter(line => line.trim());
  const totalTransactions = lines.length - 1;
  console.log(`📊 Found ${totalTransactions} transactions in transactions.csv`);
  console.log();
  console.log('📅 Step 1: Analyzing transaction dates...');
  const headers = parseCSVLine(lines[0]);
  const dateIndex = headers.indexOf('Date (UTC)');
  const now = Math.floor(Date.now() / 1000);
  const oneYearAgo = now - (365 * 24 * 60 * 60);
  let oldTransactionsCount = 0;
  let recentTransactionsCount = 0;
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const fields = parseCSVLine(lines[i]);
    const dateStr = fields[dateIndex];
    const timestamp = Math.floor(new Date(dateStr).getTime() / 1000);
    if (timestamp < oneYearAgo) {oldTransactionsCount++;} 
    else {recentTransactionsCount++;}
  }
  console.log(`   ├─ Transactions older than 1 year: ${oldTransactionsCount}`);
  console.log(`   └─ Transactions within 365 days: ${recentTransactionsCount}`);
  console.log();
  console.log('🐦 Step 2: Building Birdeye candles cache...');
  console.log('   (Fetching historical price data for all tokens)');
  console.log();
  await cacheBirdeyeCandles();
  console.log();
  console.log('🦎 Step 3: Building CoinGecko candles cache...');
  console.log('   (Fetching data for tokens traded within the last 365 days)');
  console.log();
  await cacheGCCandles();
  console.log();
  console.log('🔍 Step 4: Checking for missing token mappings...');
  console.log();
  await listMissingIds();
  console.log();
  console.log('   💡 If tokens are listed above, add them to src/mappings.ts');
  console.log('   and run the script again for better coverage.');
  console.log();
  console.log('💰 Step 5: Fetching and updating prices...');
  console.log('   Priority: Cache → CoinGecko API → Birdeye API');
  console.log();
  await fetchAndUpdatePrices();
  console.log();
  console.log('='.repeat(70));
  console.log('✅ COMPLETE!');
  console.log('='.repeat(70));
  console.log();
  console.log('📄 Updated file: transactions-updated.csv');
  console.log();
  console.log('Next steps:');
  console.log('  1. Review transactions-updated.csv');
  console.log('  2. Upload it back to Koinly using "Edit in Excel" → "Upload"');
  console.log('  3. Verify the updated prices in Koinly');
  console.log();
}

main().catch(error => {console.error('❌ Fatal error:', error); process.exit(1);});