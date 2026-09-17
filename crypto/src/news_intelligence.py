"""
Lightweight crypto news intelligence for UI-safe summaries.
No news is fabricated; unavailable feeds are reported honestly.
"""
import hashlib
import re
from datetime import datetime
from typing import Dict, Any, List

from config import CONFIG

POSITIVE_WORDS = {
    "bullish", "surge", "rally", "approval", "etf", "adoption", "upgrade",
    "partnership", "growth", "record", "inflow", "launch", "win"
}
NEGATIVE_WORDS = {
    "bearish", "hack", "exploit", "ban", "lawsuit", "selloff", "crash",
    "outflow", "fraud", "risk", "decline", "regulation", "probe"
}
SOURCE_CREDIBILITY = {
    "CoinDesk": 0.82,
    "CoinTelegraph": 0.72,
    "Binance": 0.85,
}


def _asset_tags(text: str) -> List[str]:
    upper = text.upper()
    hits = []
    aliases = {
        "BTC/USDT": ["BTC", "BITCOIN"],
        "ETH/USDT": ["ETH", "ETHEREUM"],
        "SOL/USDT": ["SOL", "SOLANA"],
        "BNB/USDT": ["BNB", "BINANCE"],
        "XRP/USDT": ["XRP", "RIPPLE"],
        "DOGE/USDT": ["DOGE", "DOGECOIN"],
        "ADA/USDT": ["ADA", "CARDANO"],
        "AVAX/USDT": ["AVAX", "AVALANCHE"],
    }
    for symbol in CONFIG.WATCHLIST:
        if any(re.search(rf"\b{re.escape(alias)}\b", upper) for alias in aliases.get(symbol, [])):
            hits.append(symbol)
    return hits


def enrich_news_rows(rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    enriched = []
    seen_groups = set()
    duplicates = 0
    for row in rows:
        title = str(row.get("title") or "").strip()
        summary = str(row.get("summary") or "").strip()
        source = str(row.get("source") or "Unknown")
        text = f"{title} {summary}".lower()
        pos = sum(1 for word in POSITIVE_WORDS if word in text)
        neg = sum(1 for word in NEGATIVE_WORDS if word in text)
        sentiment_score = max(-1.0, min(1.0, (pos - neg) / 3.0))
        sentiment = "positive" if sentiment_score > 0.2 else "negative" if sentiment_score < -0.2 else "neutral"
        group_source = re.sub(r"[^a-z0-9]+", " ", title.lower()).strip()
        group_key = hashlib.sha1(group_source[:120].encode("utf-8")).hexdigest()[:12]
        duplicate = group_key in seen_groups
        duplicates += 1 if duplicate else 0
        seen_groups.add(group_key)
        importance = min(1.0, 0.35 + (0.15 * (pos + neg)) + (0.15 if _asset_tags(text) else 0.0))
        enriched.append({
            "id": row.get("id"),
            "timestamp": row.get("timestamp"),
            "source": source,
            "title": title,
            "summary": summary,
            "url": row.get("url"),
            "relatedAssets": _asset_tags(f"{title} {summary}"),
            "credibility": SOURCE_CREDIBILITY.get(source, 0.6),
            "sentiment": sentiment,
            "sentimentScore": round(sentiment_score, 3),
            "importance": round(importance, 3),
            "duplicate": duplicate,
            "duplicateGroup": group_key,
        })
    return {
        "status": "available" if enriched else "unavailable",
        "updatedAt": datetime.now().isoformat(timespec="seconds"),
        "items": enriched,
        "duplicates": duplicates,
        "sources": sorted({item["source"] for item in enriched}),
    }
