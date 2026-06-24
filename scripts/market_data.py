#!/usr/bin/env python3
import sys
import json
import math
from datetime import datetime, timedelta
from typing import Any, Dict

try:
    import numpy as np
    import pandas as pd
    import yfinance as yf
except ImportError:
    print(json.dumps({"error": "required market data dependencies not installed"}))
    sys.exit(1)

def safe_float(val, default=0.0):
    if val is None or (isinstance(val, float) and math.isnan(val)):
        return default
    try:
        return float(val)
    except:
        return default

def safe_str(val, default=""):
    return str(val) if val is not None else default

def get_ticker_data(symbol):
    try:
        ticker = yf.Ticker(symbol)
        info = ticker.info or {}
        
        # Basic info
        result = {
            "symbol": symbol.upper(),
            "name": info.get("longName") or info.get("shortName") or symbol.upper(),
            "price": safe_float(info.get("currentPrice") or info.get("regularMarketPrice")),
            "previousClose": safe_float(info.get("previousClose") or info.get("regularMarketPreviousClose")),
            "open": safe_float(info.get("open") or info.get("regularMarketOpen")),
            "dayHigh": safe_float(info.get("dayHigh") or info.get("regularMarketDayHigh")),
            "dayLow": safe_float(info.get("dayLow") or info.get("regularMarketDayLow")),
            "volume": safe_float(info.get("volume") or info.get("regularMarketVolume")),
            "avgVolume": safe_float(info.get("averageVolume")),
            "marketCap": safe_float(info.get("marketCap")),
            "beta": safe_float(info.get("beta"), 1.0),
            "debtToEquity": safe_float(info.get("debtToEquity")),
            "trailingPE": safe_float(info.get("trailingPE")),
            "forwardPE": safe_float(info.get("forwardPE")),
            "dividendYield": safe_float(info.get("dividendYield")),
            "fiftyTwoWeekHigh": safe_float(info.get("fiftyTwoWeekHigh")),
            "fiftyTwoWeekLow": safe_float(info.get("fiftyTwoWeekLow")),
            "sector": safe_str(info.get("sector")),
            "industry": safe_str(info.get("industry")),
            "currency": safe_str(info.get("currency"), "USD"),
        }
        
        # Calculate change
        if result["price"] > 0 and result["previousClose"] > 0:
            result["change"] = result["price"] - result["previousClose"]
            result["changePercent"] = (result["change"] / result["previousClose"]) * 100
        else:
            result["change"] = 0
            result["changePercent"] = 0

        return result
    except Exception as e:
        return {"symbol": symbol.upper(), "error": str(e)}

def get_historical(symbol, period="6mo"):
    try:
        ticker = yf.Ticker(symbol)
        hist = ticker.history(period=period)
        if hist.empty:
            return []
        records = []
        for date, row in hist.iterrows():
            records.append({
                "date": date.strftime("%Y-%m-%d"),
                "open": safe_float(row.get("Open")),
                "high": safe_float(row.get("High")),
                "low": safe_float(row.get("Low")),
                "close": safe_float(row.get("Close")),
                "volume": safe_float(row.get("Volume")),
            })
        return records
    except:
        return []

def compute_technical_indicators(hist: pd.DataFrame) -> Dict[str, Any]:
    """Robust technical state for AI insights. Returns None on insufficient history."""
    if hist.empty or len(hist) < 20:
        return {"rsi_14": None, "macd_histogram": None, "bollinger_pct_b": None, "above_sma50": None}

    close = hist["Close"].astype(float)

    delta = close.diff()
    gain = delta.where(delta > 0, 0.0).rolling(14).mean()
    loss = (-delta.where(delta < 0, 0.0)).rolling(14).mean()
    rs = gain / loss.replace(0, np.nan)
    rsi = (100 - (100 / (1 + rs))).iloc[-1]

    ema12 = close.ewm(span=12, adjust=False).mean()
    ema26 = close.ewm(span=26, adjust=False).mean()
    macd_line = ema12 - ema26
    signal = macd_line.ewm(span=9, adjust=False).mean()
    macd_hist = (macd_line - signal).iloc[-1]

    sma20 = close.rolling(20).mean()
    std20 = close.rolling(20).std()
    upper = sma20 + 2 * std20
    lower = sma20 - 2 * std20
    band_width = upper.iloc[-1] - lower.iloc[-1]
    bb_pos = (close.iloc[-1] - lower.iloc[-1]) / band_width if pd.notna(band_width) and band_width != 0 else 0.5

    sma50 = close.rolling(50).mean().iloc[-1] if len(close) >= 50 else None
    above_sma50 = bool(close.iloc[-1] > sma50) if sma50 is not None and pd.notna(sma50) else None

    return {
        "rsi_14": round(float(rsi), 1) if pd.notna(rsi) else None,
        "macd_histogram": round(float(macd_hist), 4) if pd.notna(macd_hist) else None,
        "bollinger_pct_b": round(float(bb_pos), 2) if pd.notna(bb_pos) else None,
        "above_sma50": above_sma50,
    }

def compute_risk_metrics(hist: pd.DataFrame) -> Dict[str, Any]:
    """Annualized volatility, max drawdown, and historical VaR(95%)."""
    if hist.empty or len(hist) < 30:
        return {"ann_vol_pct": None, "max_drawdown_pct": None, "hist_var_95_pct": None}

    rets = hist["Close"].astype(float).pct_change().dropna()
    if rets.empty:
        return {"ann_vol_pct": None, "max_drawdown_pct": None, "hist_var_95_pct": None}

    ann_vol = rets.std() * np.sqrt(252)
    cum = (1 + rets).cumprod()
    peak = cum.cummax()
    drawdown = (cum - peak) / peak
    max_drawdown = drawdown.min()
    var_95 = np.percentile(rets, 5)

    return {
        "ann_vol_pct": round(float(ann_vol * 100), 1) if pd.notna(ann_vol) else None,
        "max_drawdown_pct": round(float(max_drawdown * 100), 1) if pd.notna(max_drawdown) else None,
        "hist_var_95_pct": round(float(var_95 * 100), 2) if pd.notna(var_95) else None,
    }

def simple_statistical_forecast(hist: pd.DataFrame, horizon_days: int = 5) -> Dict[str, Any]:
    """Naive but transparent forward expectation + uncertainty. Do not treat as a primary signal."""
    if hist.empty or len(hist) < 20:
        return {"expected_return_pct": None, "std_err_pct": None, "method": "insufficient_history"}

    rets = hist["Close"].astype(float).pct_change().dropna()
    if rets.empty:
        return {"expected_return_pct": None, "std_err_pct": None, "method": "insufficient_history"}

    mu = rets.mean()
    sigma = rets.std()
    exp_ret = mu * horizon_days

    return {
        "expected_return_pct": round(float(exp_ret * 100), 2) if pd.notna(exp_ret) else None,
        "std_err_pct": round(float(sigma * np.sqrt(horizon_days) * 100), 1) if pd.notna(sigma) else None,
        "method": "historical_mean",
        "horizon_days": horizon_days,
    }

def get_analyst_data(symbol):
    try:
        ticker = yf.Ticker(symbol)
        info = ticker.info or {}
        result = {
            "targetMeanPrice": safe_float(info.get("targetMeanPrice")),
            "targetHighPrice": safe_float(info.get("targetHighPrice")),
            "targetLowPrice": safe_float(info.get("targetLowPrice")),
            "targetMedianPrice": safe_float(info.get("targetMedianPrice")),
            "numberOfAnalysts": safe_float(info.get("numberOfAnalystOpinions")),
            "recommendationKey": safe_str(info.get("recommendationKey")),
            "recommendationMean": safe_float(info.get("recommendationMean")),
        }
        # Try to get recommendations
        try:
            recs = ticker.recommendations
            if recs is not None and not recs.empty:
                recent = recs.tail(10)
                rec_list = []
                for idx, row in recent.iterrows():
                    rec_list.append({
                        "date": str(idx) if not hasattr(idx, 'strftime') else idx.strftime("%Y-%m-%d"),
                        "firm": safe_str(row.get("Firm")),
                        "toGrade": safe_str(row.get("To Grade")),
                        "fromGrade": safe_str(row.get("From Grade")),
                        "action": safe_str(row.get("Action")),
                    })
                result["recentRecs"] = rec_list
            else:
                result["recentRecs"] = []
        except:
            result["recentRecs"] = []
        return result
    except:
        return {}

def get_news(symbol):
    try:
        ticker = yf.Ticker(symbol)
        news = ticker.news or []
        credibility_map = {
            "reuters.com": "High", "bloomberg.com": "High", "wsj.com": "High",
            "ft.com": "High", "cnbc.com": "High", "nytimes.com": "High",
            "barrons.com": "High", "marketwatch.com": "High",
            "fool.com": "Medium", "seekingalpha.com": "Medium",
            "investopedia.com": "Medium", "yahoo.com": "Medium",
            "finance.yahoo.com": "Medium", "businessinsider.com": "Medium",
            "benzinga.com": "Medium", "thestreet.com": "Medium",
        }
        results = []
        for item in news[:15]:
            content = item.get("content", {}) if isinstance(item, dict) else {}
            title = content.get("title") or item.get("title", "")
            publisher = content.get("provider", {}).get("displayName") or item.get("publisher", "Unknown")
            link = content.get("canonicalUrl", {}).get("url") or item.get("link", "")
            pub_date = content.get("pubDate") or item.get("providerPublishTime", "")
            
            # Determine credibility
            source_lower = publisher.lower() if publisher else ""
            link_lower = link.lower() if link else ""
            credibility = "Low"
            for domain, cred in credibility_map.items():
                if domain in source_lower or domain in link_lower:
                    credibility = cred
                    break
            if credibility == "Low" and any(kw in source_lower for kw in ["reuters", "bloomberg", "cnbc", "wsj", "barron"]):
                credibility = "High"
            elif credibility == "Low" and any(kw in source_lower for kw in ["seeking", "motley", "benzinga", "yahoo", "insider"]):
                credibility = "Medium"
            
            results.append({
                "title": title,
                "publisher": publisher,
                "link": link,
                "publishedAt": str(pub_date),
                "credibility": credibility,
            })
        return results
    except:
        return []

def compute_technicals(symbol):
    """Compute RSI, MACD, and detect divergence signals"""
    try:
        ticker = yf.Ticker(symbol)
        hist = ticker.history(period="3mo")
        if hist.empty or len(hist) < 30:
            return {"rsi": 50, "macd": 0, "macdSignal": 0, "macdHist": 0, "signals": []}
        
        closes = hist["Close"].values
        
        # RSI (14-day)
        deltas = [closes[i] - closes[i-1] for i in range(1, len(closes))]
        gains = [d if d > 0 else 0 for d in deltas]
        losses = [-d if d < 0 else 0 for d in deltas]
        
        period = 14
        if len(gains) < period:
            avg_gain = sum(gains) / max(len(gains), 1)
            avg_loss = sum(losses) / max(len(losses), 1)
        else:
            avg_gain = sum(gains[:period]) / period
            avg_loss = sum(losses[:period]) / period
            for i in range(period, len(gains)):
                avg_gain = (avg_gain * (period - 1) + gains[i]) / period
                avg_loss = (avg_loss * (period - 1) + losses[i]) / period
        
        if avg_loss == 0:
            rsi = 100
        else:
            rs = avg_gain / avg_loss
            rsi = 100 - (100 / (1 + rs))
        
        # MACD (12, 26, 9)
        def ema(data, span):
            multiplier = 2 / (span + 1)
            result = [data[0]]
            for i in range(1, len(data)):
                result.append((data[i] * multiplier) + (result[-1] * (1 - multiplier)))
            return result
        
        ema12 = ema(list(closes), 12)
        ema26 = ema(list(closes), 26)
        macd_line = [ema12[i] - ema26[i] for i in range(len(closes))]
        signal_line = ema(macd_line, 9)
        macd_hist = [macd_line[i] - signal_line[i] for i in range(len(macd_line))]
        
        signals = []
        
        # Bearish RSI divergence: price making highs but RSI declining
        if rsi > 70:
            signals.append({"type": "warning", "message": "RSI in overbought territory (>70) — historically suggests potential pullback"})
        elif rsi < 30:
            signals.append({"type": "info", "message": "RSI in oversold territory (<30) — historically suggests potential bounce"})
        
        # MACD crossover signals
        if len(macd_hist) >= 2:
            if macd_hist[-1] < 0 and macd_hist[-2] >= 0:
                signals.append({"type": "warning", "message": "Bearish MACD crossover detected — momentum indicator suggests weakening"})
            elif macd_hist[-1] > 0 and macd_hist[-2] <= 0:
                signals.append({"type": "info", "message": "Bullish MACD crossover detected — momentum indicator suggests strengthening"})
        
        # Check for bearish divergence (simplified)
        if len(closes) >= 20:
            price_recent_high = max(closes[-10:])
            price_prior_high = max(closes[-20:-10])
            # Get RSI values for both periods
            if price_recent_high > price_prior_high and rsi < 60:
                signals.append({"type": "warning", "message": "Potential bearish divergence: price making new highs while RSI declining"})
        
        return {
            "rsi": round(rsi, 2),
            "macd": round(macd_line[-1], 4),
            "macdSignal": round(signal_line[-1], 4),
            "macdHist": round(macd_hist[-1], 4),
            "macdHistory": [{"value": round(v, 4)} for v in macd_hist[-30:]],
            "signals": signals,
        }
    except Exception as e:
        return {"rsi": 50, "macd": 0, "macdSignal": 0, "macdHist": 0, "signals": [], "error": str(e)}

def compute_sentiment(symbol):
    """Compute Fear/Greed score using momentum, volume, volatility, and news keywords"""
    try:
        ticker = yf.Ticker(symbol)
        hist = ticker.history(period="3mo")
        info = ticker.info or {}
        
        if hist.empty or len(hist) < 20:
            return {"score": 50, "label": "Neutral", "components": {}}
        
        closes = hist["Close"].values
        volumes = hist["Volume"].values
        
        # 1. Momentum score (5-day vs 20-day return)
        ret_5d = (closes[-1] / closes[-5] - 1) * 100 if len(closes) >= 5 else 0
        ret_20d = (closes[-1] / closes[-20] - 1) * 100 if len(closes) >= 20 else 0
        momentum = 50 + (ret_5d * 5)  # Scale to 0-100 range
        momentum = max(0, min(100, momentum))
        
        # 2. Volume change ratio
        avg_vol_recent = sum(volumes[-5:]) / 5 if len(volumes) >= 5 else 1
        avg_vol_older = sum(volumes[-20:-5]) / 15 if len(volumes) >= 20 else avg_vol_recent
        vol_ratio = avg_vol_recent / max(avg_vol_older, 1)
        volume_score = 50 + (vol_ratio - 1) * 30
        volume_score = max(0, min(100, volume_score))
        
        # 3. Volatility (recent vs historical)
        if len(closes) >= 20:
            recent_returns = [(closes[i]/closes[i-1] - 1) for i in range(max(1, len(closes)-5), len(closes))]
            hist_returns = [(closes[i]/closes[i-1] - 1) for i in range(1, len(closes))]
            recent_vol = (sum([r**2 for r in recent_returns]) / max(len(recent_returns), 1)) ** 0.5
            hist_vol = (sum([r**2 for r in hist_returns]) / max(len(hist_returns), 1)) ** 0.5
            vol_ratio_score = recent_vol / max(hist_vol, 0.0001)
            volatility_score = max(0, min(100, 50 - (vol_ratio_score - 1) * 30))
        else:
            volatility_score = 50
        
        # 4. News keyword sentiment (simplified)
        try:
            news = ticker.news or []
            positive_keywords = ["surge", "rally", "beat", "upgrade", "growth", "bullish", "strong", "record", "boost", "gain", "buy", "outperform"]
            negative_keywords = ["crash", "plunge", "miss", "downgrade", "bearish", "weak", "decline", "loss", "sell", "warning", "risk", "fear"]
            pos_count = 0
            neg_count = 0
            for item in news[:10]:
                content = item.get("content", {}) if isinstance(item, dict) else {}
                title = (content.get("title") or item.get("title", "")).lower()
                for kw in positive_keywords:
                    if kw in title:
                        pos_count += 1
                for kw in negative_keywords:
                    if kw in title:
                        neg_count += 1
            total = pos_count + neg_count
            if total > 0:
                news_score = (pos_count / total) * 100
            else:
                news_score = 50
        except:
            news_score = 50
        
        # Weighted composite
        score = (momentum * 0.35) + (volume_score * 0.2) + (volatility_score * 0.2) + (news_score * 0.25)
        score = max(1, min(100, round(score)))
        
        if score >= 75:
            label = "Extreme Greed"
        elif score >= 55:
            label = "Greed"
        elif score >= 45:
            label = "Neutral"
        elif score >= 25:
            label = "Fear"
        else:
            label = "Extreme Fear"
        
        return {
            "score": score,
            "label": label,
            "components": {
                "momentum": round(momentum, 1),
                "volumeChange": round(volume_score, 1),
                "volatility": round(volatility_score, 1),
                "newsSentiment": round(news_score, 1),
            }
        }
    except Exception as e:
        return {"score": 50, "label": "Neutral", "components": {}, "error": str(e)}

def compute_risk_score(symbol):
    """Risk Score from Beta, IV Rank proxy, and D/E ratio"""
    try:
        ticker = yf.Ticker(symbol)
        info = ticker.info or {}
        hist = ticker.history(period="1y")
        
        # Beta component (0-100, higher beta = higher risk)
        beta = safe_float(info.get("beta"), 1.0)
        beta_score = min(100, max(0, (beta - 0.5) * 40 + 30))  # 0.5 beta=10, 1.0=30, 2.0=70, 3.0=110->100
        
        # IV Rank proxy (historical volatility percentile)
        if not hist.empty and len(hist) >= 30:
            closes = hist["Close"].values
            returns = [(closes[i]/closes[i-1] - 1) for i in range(1, len(closes))]
            # Calculate rolling 20-day volatility
            window = 20
            vols = []
            for i in range(window, len(returns)):
                w = returns[i-window:i]
                vol = (sum([r**2 for r in w]) / window) ** 0.5
                vols.append(vol)
            if vols:
                current_vol = vols[-1]
                rank = sum(1 for v in vols if v <= current_vol) / len(vols) * 100
                iv_rank_score = rank
            else:
                iv_rank_score = 50
        else:
            iv_rank_score = 50
        
        # D/E ratio component
        de_ratio = safe_float(info.get("debtToEquity"), 50)
        de_score = min(100, max(0, de_ratio / 2))  # 0=0, 100=50, 200=100
        
        # Weighted composite
        risk_score = (beta_score * 0.4) + (iv_rank_score * 0.35) + (de_score * 0.25)
        risk_score = max(1, min(100, round(risk_score)))
        
        return {
            "score": risk_score,
            "components": {
                "beta": round(beta, 2),
                "betaScore": round(beta_score, 1),
                "ivRank": round(iv_rank_score, 1),
                "debtToEquity": round(de_ratio, 2),
                "deScore": round(de_score, 1),
            }
        }
    except Exception as e:
        return {"score": 50, "components": {}, "error": str(e)}

def compute_position_sizing(symbol):
    """Kelly Criterion position sizing"""
    try:
        ticker = yf.Ticker(symbol)
        hist = ticker.history(period="1y")
        
        if hist.empty or len(hist) < 30:
            return {"kellyPercent": 5, "suggestedPercent": 2.5, "winRate": 0.5, "avgWin": 0, "avgLoss": 0}
        
        closes = hist["Close"].values
        returns = [(closes[i]/closes[i-1] - 1) for i in range(1, len(closes))]
        
        wins = [r for r in returns if r > 0]
        losses = [r for r in returns if r < 0]
        
        win_rate = len(wins) / max(len(returns), 1)
        avg_win = sum(wins) / max(len(wins), 1) if wins else 0
        avg_loss = abs(sum(losses) / max(len(losses), 1)) if losses else 0.01
        
        # Kelly Criterion: f = (bp - q) / b where b = avg_win/avg_loss, p = win_rate, q = 1-p
        if avg_loss > 0:
            b = avg_win / avg_loss
            kelly = (b * win_rate - (1 - win_rate)) / max(b, 0.01)
        else:
            kelly = 0.1
        
        kelly_pct = max(0, min(25, kelly * 100))  # Cap at 25%
        suggested_pct = kelly_pct * 0.5  # Half-Kelly for safety
        
        return {
            "kellyPercent": round(kelly_pct, 2),
            "suggestedPercent": round(suggested_pct, 2),
            "winRate": round(win_rate * 100, 1),
            "avgWin": round(avg_win * 100, 3),
            "avgLoss": round(avg_loss * 100, 3),
        }
    except Exception as e:
        return {"kellyPercent": 5, "suggestedPercent": 2.5, "error": str(e)}

def get_exit_signals(symbol):
    """Check exit strategy conditions"""
    try:
        ticker = yf.Ticker(symbol)
        info = ticker.info or {}
        technicals = compute_technicals(symbol)
        
        alerts = []
        
        # Check if price exceeds analyst target by 1+ std deviation
        price = safe_float(info.get("currentPrice") or info.get("regularMarketPrice"))
        target_mean = safe_float(info.get("targetMeanPrice"))
        target_high = safe_float(info.get("targetHighPrice"))
        target_low = safe_float(info.get("targetLowPrice"))
        
        if target_mean > 0 and price > 0:
            if target_high > 0 and target_low > 0:
                target_std = (target_high - target_low) / 4  # Approximate std dev
                if price > target_mean + target_std:
                    alerts.append({
                        "type": "exit",
                        "severity": "high",
                        "message": f"Price (${price:.2f}) exceeds analyst mean target (${target_mean:.2f}) by more than 1 standard deviation — historically suggests overextension"
                    })
        
        # Add technical signals
        for sig in technicals.get("signals", []):
            if sig["type"] == "warning":
                alerts.append({
                    "type": "exit",
                    "severity": "medium",
                    "message": sig["message"]
                })
        
        return {"alerts": alerts, "technicals": technicals}
    except Exception as e:
        return {"alerts": [], "error": str(e)}

def get_macro_data():
    """Get macro indicators: VIX, S&P 500, Treasury yields"""
    try:
        result = {}
        
        # VIX
        vix = yf.Ticker("^VIX")
        vix_info = vix.info or {}
        result["vix"] = {
            "value": safe_float(vix_info.get("regularMarketPrice") or vix_info.get("previousClose")),
            "change": safe_float(vix_info.get("regularMarketChangePercent")),
        }
        
        # S&P 500
        spy = yf.Ticker("^GSPC")
        spy_info = spy.info or {}
        spy_price = safe_float(spy_info.get("regularMarketPrice") or spy_info.get("previousClose"))
        spy_prev = safe_float(spy_info.get("previousClose") or spy_info.get("regularMarketPreviousClose"))
        result["sp500"] = {
            "value": spy_price,
            "change": ((spy_price / spy_prev - 1) * 100) if spy_prev > 0 else 0,
        }
        
        # 10Y Treasury
        tnx = yf.Ticker("^TNX")
        tnx_info = tnx.info or {}
        result["treasury10y"] = {
            "value": safe_float(tnx_info.get("regularMarketPrice") or tnx_info.get("previousClose")),
            "change": safe_float(tnx_info.get("regularMarketChangePercent")),
        }
        
        # Fed Funds Rate (approximate - use DFF proxy or hardcoded recent)
        result["fedFunds"] = {
            "value": 4.33,  # Current approximate - this rarely changes
            "label": "Fed Funds Rate",
        }
        
        # Market status
        from datetime import datetime
        import pytz
        et = pytz.timezone("US/Eastern")
        now = datetime.now(et)
        is_weekday = now.weekday() < 5
        hour = now.hour
        minute = now.minute
        is_open = is_weekday and ((hour == 9 and minute >= 30) or (10 <= hour < 16))
        result["marketStatus"] = "Open" if is_open else "Closed"
        
        return result
    except Exception as e:
        return {"error": str(e)}

def search_ticker(query):
    """Search for ticker symbols"""
    try:
        # Common tickers for quick matching
        common = {
            "AAPL": "Apple Inc.", "MSFT": "Microsoft Corporation", "GOOGL": "Alphabet Inc.",
            "AMZN": "Amazon.com Inc.", "META": "Meta Platforms Inc.", "TSLA": "Tesla Inc.",
            "NVDA": "NVIDIA Corporation", "JPM": "JPMorgan Chase & Co.", "V": "Visa Inc.",
            "JNJ": "Johnson & Johnson", "WMT": "Walmart Inc.", "PG": "Procter & Gamble",
            "MA": "Mastercard Inc.", "UNH": "UnitedHealth Group", "HD": "Home Depot Inc.",
            "DIS": "Walt Disney Company", "NFLX": "Netflix Inc.", "PYPL": "PayPal Holdings",
            "ADBE": "Adobe Inc.", "CRM": "Salesforce Inc.", "AMD": "Advanced Micro Devices",
            "INTC": "Intel Corporation", "BA": "Boeing Company", "GS": "Goldman Sachs",
            "COIN": "Coinbase Global", "SQ": "Block Inc.", "SHOP": "Shopify Inc.",
            "UBER": "Uber Technologies", "ABNB": "Airbnb Inc.", "SNAP": "Snap Inc.",
            "PLTR": "Palantir Technologies", "SOFI": "SoFi Technologies",
            "SPY": "SPDR S&P 500 ETF", "QQQ": "Invesco QQQ Trust",
            "IWM": "iShares Russell 2000", "GLD": "SPDR Gold Shares",
        }
        query_upper = query.upper()
        results = []
        for sym, name in common.items():
            if query_upper in sym or query.lower() in name.lower():
                results.append({"symbol": sym, "name": name})
        
        # Also try yfinance search
        if not results or len(results) < 3:
            try:
                t = yf.Ticker(query_upper)
                info = t.info or {}
                if info.get("symbol"):
                    results.insert(0, {
                        "symbol": info["symbol"],
                        "name": info.get("longName") or info.get("shortName") or query_upper,
                    })
            except:
                pass
        
        return results[:10]
    except:
        return []

def get_trends(symbol):
    """Extract trending keywords from news"""
    try:
        news = get_news(symbol)
        keyword_categories = {
            "AI Integration": ["ai", "artificial intelligence", "machine learning", "chatgpt", "generative"],
            "Earnings": ["earnings", "revenue", "profit", "quarterly", "eps", "guidance"],
            "Supply Chain": ["supply chain", "logistics", "shipping", "shortage"],
            "Regulation": ["regulation", "antitrust", "sec", "compliance", "lawsuit"],
            "M&A Activity": ["acquisition", "merger", "buyout", "deal"],
            "Market Sentiment": ["rally", "selloff", "bull", "bear", "correction"],
            "Innovation": ["launch", "product", "patent", "innovation", "breakthrough"],
            "ESG": ["climate", "esg", "sustainability", "green", "carbon"],
        }
        found = {}
        for item in news:
            title = item.get("title", "").lower()
            for category, keywords in keyword_categories.items():
                for kw in keywords:
                    if kw in title:
                        found[category] = found.get(category, 0) + 1
        
        trends = [{"topic": k, "mentions": v} for k, v in sorted(found.items(), key=lambda x: -x[1])]
        return trends[:6]
    except:
        return []

if __name__ == "__main__":
    action = sys.argv[1] if len(sys.argv) > 1 else "help"
    symbol = sys.argv[2] if len(sys.argv) > 2 else ""
    
    if action == "ticker":
        print(json.dumps(get_ticker_data(symbol)))
    elif action == "historical":
        period = sys.argv[3] if len(sys.argv) > 3 else "6mo"
        print(json.dumps(get_historical(symbol, period)))
    elif action == "analyst":
        print(json.dumps(get_analyst_data(symbol)))
    elif action == "news":
        print(json.dumps(get_news(symbol)))
    elif action == "sentiment":
        print(json.dumps(compute_sentiment(symbol)))
    elif action == "risk":
        print(json.dumps(compute_risk_score(symbol)))
    elif action == "technicals":
        print(json.dumps(compute_technicals(symbol)))
    elif action == "position":
        print(json.dumps(compute_position_sizing(symbol)))
    elif action == "exit":
        print(json.dumps(get_exit_signals(symbol)))
    elif action == "macro":
        print(json.dumps(get_macro_data()))
    elif action == "search":
        print(json.dumps(search_ticker(symbol)))
    elif action == "trends":
        print(json.dumps(get_trends(symbol)))
    elif action == "full":
        # Full data for detail view
        try:
            hist = yf.Ticker(symbol).history(period="1y")
        except Exception:
            hist = pd.DataFrame()

        try:
            quant_indicators = compute_technical_indicators(hist)
            risk_metrics = compute_risk_metrics(hist)
            predictive = simple_statistical_forecast(hist)
        except Exception:
            quant_indicators = {"rsi_14": None, "macd_histogram": None, "bollinger_pct_b": None, "above_sma50": None}
            risk_metrics = {"ann_vol_pct": None, "max_drawdown_pct": None, "hist_var_95_pct": None}
            predictive = {
                "expected_return_pct": None,
                "std_err_pct": None,
                "method": "computation_failed",
                "horizon_days": 5,
            }

        result = {
            "ticker": get_ticker_data(symbol),
            "analyst": get_analyst_data(symbol),
            "sentiment": compute_sentiment(symbol),
            "risk": compute_risk_score(symbol),
            "technicals": compute_technicals(symbol),
            "quant_indicators": quant_indicators,
            "risk_metrics": risk_metrics,
            "predictive": predictive,
            "position": compute_position_sizing(symbol),
            "exit": get_exit_signals(symbol),
            "news": get_news(symbol),
            "trends": get_trends(symbol),
        }
        print(json.dumps(result))
    else:
        print(json.dumps({"error": f"Unknown action: {action}"}))
