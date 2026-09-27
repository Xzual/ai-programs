"""One timestamp policy for display and execution; caller flags cannot make old data fresh."""
import math
from datetime import datetime, timezone

from config import CONFIG


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def number(value):
    if isinstance(value, bool):
        return None
    try:
        result = float(value)
        return result if math.isfinite(result) else None
    except (TypeError, ValueError, OverflowError):
        return None


def price_status(market):
    market = market or {}
    ticker = market.get('ticker') or {}
    price = number(ticker.get('last', market.get('currentPrice')))
    stamp = market.get('marketPriceTimestamp') or market.get('currentPriceTimestamp') or market.get('updatedAt')
    age = None
    try:
        parsed = datetime.fromisoformat(str(stamp).replace('Z', '+00:00'))
        if parsed.tzinfo is None:
            raise ValueError('Timezone required')
        age = (datetime.now(timezone.utc) - parsed).total_seconds() * 1000
        if age < -1000:
            age = None
        elif age is not None:
            age = max(0, int(age))
    except (ValueError, TypeError):
        pass
    available = price is not None and price > 0 and age is not None
    status = 'unavailable' if not available else 'stale' if age > CONFIG.MAX_MARKET_DATA_AGE_MS else 'fresh'
    if market.get('fresh') is False or market.get('stale') is True or market.get('status') == 'offline':
        status = 'unavailable' if not available else 'stale'
    return {'currentPrice': price, 'currentPriceTimestamp': stamp, 'marketPriceTimestamp': stamp,
            'marketDataAgeMs': age, 'marketDataStatus': status}
