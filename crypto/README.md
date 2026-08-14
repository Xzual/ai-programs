# Otonom Kripto Trading Agent (Autonomous Crypto Trading Agent)

Yerel bilgisayarınız üzerinde 7/24 çalışan, Ollama tabanlı yerel bir dil modeli kullanan, kripto piyasasını araştıran, teknik analiz yapan, haberleri tarayan, sanal portföy (paper trading) yöneten ve kendi kararlarını analiz ederek kendini geliştiren otonom bir yapay zekâ trading agent sistemidir.

## Mimari ve Modüller

Sistem modüler bir yaklaşımla tasarlanmıştır. Tüm modüller `src/` dizini altında yer alır:

| Modül | Görev |
|---|---|
| `config.py` | Tüm sistem parametreleri, risk kuralları ve izleme listesi |
| `market_data.py` | CCXT kütüphanesi ile Binance borsasından OHLCV ve ticker verisi çekme |
| `technical_analysis.py` | RSI, MACD, EMA, Bollinger Bands, ATR ve VWAP hesaplama |
| `memory_manager.py` | SQLite tabanlı kalıcı hafıza ve veri tabanı yönetimi |
| `news_collector.py` | CoinDesk ve CoinTelegraph RSS beslemelerinden güncel haber çekme |
| `risk_manager.py` | Pozisyon boyutu, stop-loss, take-profit ve risk kuralları denetimi |
| `paper_trading_engine.py` | Sanal bakiye ve pozisyon simülasyon motoru (yeniden başlatmada durumu korur) |
| `llm_decision_engine.py` | Ollama üzerinden yerel LLM ile yapılandırılmış karar üretme |
| `result_analyzer.py` | Kapanan işlemlerin sonuçlarını analiz ederek strateji üretme |
| `agent.py` | Tüm bu süreçleri koordine eden ana döngü (orkestratör) |
| `dashboard.py` | Flask tabanlı web izleme arayüzü (JSON API + koyu tema UI) |

## Kurulum ve Başlangıç

### Ön Gereksinimler
- Python **3.12** (diğer sürümler `pandas-ta` ile uyumsuz olabilir)
- [`uv`](https://docs.astral.sh/uv/) (hızlı Python paket yöneticisi)
- [Ollama](https://ollama.com/) — **Örn.** `ollama run llama3.1` veya `qwen2.5`

### 1. Sanal Ortam Oluşturma

```bash
uv venv --python 3.12
```

### 2. Bağımlılıkların Yüklenmesi

```bash
uv pip install -r requirements.txt
```

### 3. Agent'ın Başlatılması

**Windows üzerinde (önerilen):**
```bat
start_agent.bat
```
Bu dosya `.venv` sanal ortamını kullanır, bağımlılıkları kontrol eder ve agent'ı başlatır.

**Ya da doğrudan:**
```bash
.venv\Scripts\python.exe run_agent.py
```

### 4. Web Arayüzü (Dashboard)

Agent çalışırken tarayıcınızdan [`http://localhost:5000`](http://localhost:5000) adresine giderek portföyünüzü, son kararları, haberleri ve performans grafiğini canlı olarak izleyebilirsiniz. Dashboard her 10 saniyede bir otomatik güncellenir.

## Sistem Döngüsü

```
Piyasayı izle
  → Haberleri RSS üzerinden topla
    → Fiyat ve OHLCV verilerini çek
      → Teknik analiz (RSI, MACD, BB, ATR, EMA)
        → LLM'e gönder → BUY / SELL / HOLD kararı
          → Risk yönetimi kontrolü
            → Sanal işlemi gerçekleştir & kaydet
              → İşlem sonucunu analiz et (LLM)
                → Hafızayı güncelle
                  → Tekrar başa dön
```

## Önemli Notlar

- Tüm işlemler **paper trading (simülasyon)** modundadır — gerçek para kullanılmaz.
- Agent yeniden başlatıldığında portföy bakiyesi ve açık pozisyonlar **SQLite'tan otomatik yüklenir**.
- Karar geçmişi, haber arşivi ve işlem analizleri `data/agent_memory.db` dosyasında kalıcı olarak saklanır.
- LLM bağlantısı kesilirse agent güvenle `HOLD` kararı verir ve döngü devam eder.
