/**
 * Configuration for date range parameters used in price fetching
 * 
 * These values determine the time window around a transaction timestamp
 * when searching for historical prices from APIs.
 */

export interface DateRangeConfig {
  /** Short range: 2 hours (7200 seconds) */
  SHORT_RANGE: number;
  /** Medium range: 24 hours (86400 seconds) */
  MEDIUM_RANGE: number;
  /** Long range: 10 days (864000 seconds) */
  LONG_RANGE: number;
}

export const DEFAULT_DATE_RANGES: DateRangeConfig = {
  SHORT_RANGE: 2 * 60 * 60,      // 2 hours
  MEDIUM_RANGE: 24 * 60 * 60,    // 24 hours (1 day)
  LONG_RANGE: 10 * 24 * 60 * 60, // 10 days
};

/**
 * Get date range configuration from environment variables or use defaults
 */
export function getDateRanges(): DateRangeConfig {
  return {
    SHORT_RANGE: process.env.SHORT_RANGE 
      ? parseInt(process.env.SHORT_RANGE) 
      : DEFAULT_DATE_RANGES.SHORT_RANGE,
    
    MEDIUM_RANGE: process.env.MEDIUM_RANGE 
      ? parseInt(process.env.MEDIUM_RANGE) 
      : DEFAULT_DATE_RANGES.MEDIUM_RANGE,
    
    LONG_RANGE: process.env.LONG_RANGE 
      ? parseInt(process.env.LONG_RANGE) 
      : DEFAULT_DATE_RANGES.LONG_RANGE,
  };
}
