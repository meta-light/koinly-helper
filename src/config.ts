export interface DateRangeConfig {
  SHORT_RANGE: number;
  MEDIUM_RANGE: number;
  LONG_RANGE: number;
}

export const DEFAULT_DATE_RANGES: DateRangeConfig = {
  SHORT_RANGE: 2 * 60 * 60,
  MEDIUM_RANGE: 24 * 60 * 60,
  LONG_RANGE: 10 * 24 * 60 * 60,
};

export function getDateRanges(): DateRangeConfig {
  return {
    SHORT_RANGE: process.env.SHORT_RANGE ? parseInt(process.env.SHORT_RANGE) : DEFAULT_DATE_RANGES.SHORT_RANGE, 
    MEDIUM_RANGE: process.env.MEDIUM_RANGE ? parseInt(process.env.MEDIUM_RANGE) : DEFAULT_DATE_RANGES.MEDIUM_RANGE,
    LONG_RANGE: process.env.LONG_RANGE ? parseInt(process.env.LONG_RANGE) : DEFAULT_DATE_RANGES.LONG_RANGE,
  };
}