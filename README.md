# Koinly Transaction Price Updater

Automatically fetch and update historical cryptocurrency prices for your Koinly transactions using Birdeye and CoinGecko APIs.

## Overview

This tool helps you fill in missing Net Worth and Fee Worth values in your Koinly transaction exports by:
- Building comprehensive price caches from Birdeye and CoinGecko
- Intelligently fetching historical prices with fallback strategies
- Updating your CSV with accurate USD values

## Features

- **Smart Caching**: Pre-fetches and caches historical price data to minimize API calls
- **Multi-Source Price Fetching**: Uses Birdeye and CoinGecko APIs with automatic fallback
- **Rate Limit Handling**: Automatic retry logic with backoff for API rate limits
- **Multi-Chain Support**: Supports Solana, Ethereum, Arbitrum, Base, Polygon, Optimism, and more
- **Configurable Date Ranges**: Customize price search windows via environment variables

## Prerequisites

- Node.js 18 or higher
- A Birdeye API key (free tier available at [birdeye.so](https://birdeye.so/))

## Installation

1. Clone or download this repository
2. Install dependencies:

```bash
npm install
```

3. Create a `.env` file with your Birdeye API key:

```bash
# Create .env file
cat > .env << 'EOF'
BIRDEYE_API_KEY=your_actual_api_key_here
EOF
```

Or manually create `.env` with:

```
BIRDEYE_API_KEY=your_actual_api_key_here

# Optional: Customize date range parameters (in seconds)
# SHORT_RANGE=7200          # 2 hours (default)
# MEDIUM_RANGE=86400        # 24 hours (default)
# LONG_RANGE=864000         # 10 days (default)
```

## Usage

### Step 1: Export from Koinly

1. Go to your Koinly dashboard
2. Select the transactions you want to update
3. Click the **3 dots menu** → **Edit in Excel**
4. Click **Download the selected transactions**
5. Save the downloaded CSV as `transactions.csv` in this project's root directory

### Step 2: Run the Updater

```bash
npm start
```

The script will:
1. Analyze your transactions (identifying old vs. recent)
2. Build Birdeye candles cache for all tokens
3. Build CoinGecko candles cache for recently-traded tokens
4. Check for missing token mappings
5. Fetch and update prices with cache-first approach

### Step 3: Upload Back to Koinly

1. Review the generated `transactions-updated.csv`
2. In Koinly, go back to **Edit in Excel**
3. Click **Upload the modified file**
4. Select `transactions-updated.csv`
5. Confirm the changes in Koinly

## Configuration

### Date Range Parameters

You can customize the time windows used when searching for historical prices by setting these environment variables in your `.env` file:

```env
SHORT_RANGE=7200      # 2 hours (default)
MEDIUM_RANGE=86400    # 24 hours / 1 day (default)
LONG_RANGE=864000     # 10 days (default)
```

These values are in **seconds**. The tool uses:
- **SHORT_RANGE**: For initial narrow searches
- **MEDIUM_RANGE**: Standard daily window (first fallback)
- **LONG_RANGE**: Wide window for sparse data (second fallback)

### Token Mappings

To improve coverage, you can add custom token mappings in `src/mappings.ts`:

#### Birdeye Token Addresses

```typescript
export const TOKEN_ADDRESS_MAP: Record<string, string> = {
  '6166': 'So11111111111111111111111111111111111111112', // SOL
  'your_token_id': 'token_contract_address',
  // Add more...
};
```

#### CoinGecko IDs

```typescript
export const COINGECKO_ID_MAP: Record<string, string> = {
  'bitcoin': 'bitcoin',
  'your_token_id': 'coingecko-id',
  // Add more...
};
```

The script will identify missing mappings and display them for you to add.

## How It Works

### Price Fetching Priority

For each transaction, the tool fetches prices in this order:

1. **Birdeye Cache** (for older transactions or Birdeye-supported chains)
2. **CoinGecko Cache** (for transactions within 365 days)
3. **CoinGecko API** (live API call if not in cache)
4. **Birdeye API** (final fallback for supported chains)

### Transaction Age Logic

- **Transactions older than 1 year**: Primarily uses Birdeye cache/API
- **Transactions within 365 days**: Prefers CoinGecko cache/API for better accuracy

### Supported Chains

- Solana
- Ethereum
- Arbitrum
- Base
- Polygon
- Optimism
- Avalanche
- BSC (Binance Smart Chain)
- zkSync
- Sui

## Project Structure

```
.
├── src/
│   ├── main.ts           # Main orchestration script
│   ├── index.ts          # Core price fetching logic
│   ├── birdeye.ts        # Birdeye API integration
│   ├── coingecko.ts      # CoinGecko API integration
│   ├── mappings.ts       # Token address and ID mappings
│   ├── utils.ts          # CSV parsing and utility functions
│   └── config.ts         # Configuration management
├── .cache/               # Cached price data (auto-generated)
│   ├── birdeye_candles.json
│   ├── coingecko_candles.json
│   └── coingecko_list.json
├── .env                  # Your API keys and config
├── transactions.csv      # Your input file (from Koinly)
└── transactions-updated.csv  # Output file (to upload to Koinly)
```

## Troubleshooting

### "BIRDEYE_API_KEY is not set"

Make sure you've created a `.env` file with your Birdeye API key.

### "transactions.csv not found"

Ensure you've downloaded the CSV from Koinly and placed it in the project root directory.

### Rate Limiting

The tool automatically handles rate limits with delays and retries. If you encounter persistent rate limiting:
- Wait a few minutes and try again
- The cache will preserve already-fetched data

### Missing Prices

If some prices are still missing after running:
1. Check the console output for missing token mappings
2. Add the suggested mappings to `src/mappings.ts`
3. Run the script again

## API Rate Limits

- **Birdeye Free Tier**: 0.2 requests/second (built-in rate limiting)
- **CoinGecko Free Tier**: 15 requests/minute (built-in rate limiting)

The tool respects these limits automatically.

## License

MIT

## Disclaimer

This tool is provided as-is for educational and personal use. Always verify the updated prices before submitting to Koinly. The accuracy of prices depends on the availability and quality of data from Birdeye and CoinGecko APIs.
