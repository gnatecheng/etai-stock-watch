export interface DailyBar {
  instrument_id: string;
  trade_date: string;
  open_cents: number;
  high_cents: number;
  low_cents: number;
  close_cents: number;
  volume: number;
  turnover_cents?: number;
  adj_factor: number;
}

export interface InstrumentMeta {
  id: string;
  symbol: string;
  name_zh: string;
  name_en?: string;
  currency: string;
  board_lot: number;
  exchange: string;
  status: string;
}

export interface MarketDataProvider {
  name: string;
  isDemo: boolean;
  listInstruments(): Promise<InstrumentMeta[]>;
  getBars(instrumentId: string, from: string, to: string): Promise<DailyBar[]>;
  /** 当日 EOD 是否就绪（演示源始终 true；正式源须实现） */
  isEodReady(tradeDate: string): Promise<boolean>;
}

export interface CsvBarRow {
  symbol: string;
  trade_date: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}
