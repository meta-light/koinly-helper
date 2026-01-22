export function parseCSVLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {current += '"'; i++;} else {inQuotes = !inQuotes;}} 
      else if (char === ',' && !inQuotes) {result.push(current); current = '';} else {current += char;}
    }
    result.push(current);
    return result;
}

export function extractTokenInfo(currencyField: string): { symbol: string; tokenId: string } | null {
    if (!currencyField || currencyField === '0.0') return null;
    const parts = currencyField.split(';');
    if (parts.length !== 2) return null;
    return {symbol: parts[0], tokenId: parts[1]};
}

export function delay(ms: number): Promise<void> {return new Promise(resolve => setTimeout(resolve, ms));}
export function dateToUnixTimestamp(dateStr: string): number {return Math.floor(new Date(dateStr).getTime() / 1000);}

export function stringifyCSVLine(fields: string[]): string {
  return fields.map(f => {
    if (f.includes(',') || f.includes('"') || f.includes('\n')) {return `"${f.replace(/"/g, '""')}"`;}
    return f;
  }).join(',');
}

export function getChain(fields: string[], fromWalletIdx: number, toWalletIdx: number): string {
  let val = fields[fromWalletIdx];
  if (!val || !val.includes(';')) {val = fields[toWalletIdx];}
  if (!val || !val.includes(';')) return 'solana';
  const rawChain = val.split(';')[1].toLowerCase();
  const chainMap: Record<string, string> = {
    'eth': 'ethereum',
    'ethereum': 'ethereum',
    'solana': 'solana',
    'arbitrum': 'arbitrum',
    'base': 'base',
    'hyperevm': 'hyperevm',
    'polygon': 'polygon',
    'optimism': 'optimism'
  };
  return chainMap[rawChain] || rawChain;
}