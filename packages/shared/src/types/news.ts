export interface NewsItem {
  title: string;
  link: string;
  source: string;
  /** ISO timestamp, or '' if unparseable. */
  pubDate: string;
}

export interface NewsData {
  items: NewsItem[];
  fetchedAt: string;
}
