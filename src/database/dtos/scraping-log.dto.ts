export class CreateScrapingLogDto {
  id?: string;
  created_at?: string;
  status: string;
  started_at?: string;
  ended_at?: string;
  items_scraped?: number;
}
