"""
News Collector for the Autonomous Crypto Trading Agent.
Fetches news from RSS feeds to bypass Cloudflare scraping blockages.
"""
import feedparser
import logging
import re
from typing import List, Dict

from config import CONFIG
from memory_manager import MemoryManager

logger = logging.getLogger("news_collector")

class NewsCollector:
    def __init__(self, memory: MemoryManager):
        self.memory = memory
        # RSS feed mapping for the sources
        self.feeds = {
            "CoinDesk": "https://www.coindesk.com/arc/outboundfeeds/rss/",
            "CoinTelegraph": "https://cointelegraph.com/rss"
        }

    def fetch_feed(self, source_name: str, feed_url: str) -> List[Dict]:
        """Fetch and parse news items from a single RSS feed."""
        news_items = []
        try:
            logger.info(f"Fetching RSS feed for {source_name}...")
            feed = feedparser.parse(feed_url)
            
            # Check parsing status or errors
            if feed.bozo:
                logger.warning(f"Possible parsing issue with {source_name} feed: {feed.bozo_exception}")
                
            entries = feed.entries
            logger.info(f"Found {len(entries)} entries for {source_name}.")
            
            for entry in entries[:15]:  # Limit to top 15 news items per source to save context space
                title = entry.get("title", "").strip()
                link = entry.get("link", "").strip()
                
                # Try to get clean summary text
                summary = entry.get("summary", "")
                if summary:
                    # Remove HTML tags if present
                    summary = re.sub(r'<[^>]*>', '', summary)
                    summary = summary.strip()
                
                news_items.append({
                    "source": source_name,
                    "title": title,
                    "summary": summary[:200] if summary else "",  # Limit summary length
                    "url": link
                })
        except Exception as e:
            logger.error(f"Error fetching/parsing {source_name} news: {e}")
            
        return news_items

    def collect_all(self) -> List[Dict]:
        """Collect news from all RSS sources and save to database."""
        logger.info("Starting news collection...")
        all_news = []
        
        for name, url in self.feeds.items():
            all_news.extend(self.fetch_feed(name, url))
            
        count = 0
        for item in all_news:
            self.memory.save_news_item(
                source=item['source'],
                title=item['title'],
                summary=item['summary'],
                url=item['url']
            )
            count += 1
            
        logger.info(f"News collection finished. Saved/Processed {count} items.")
        return all_news
