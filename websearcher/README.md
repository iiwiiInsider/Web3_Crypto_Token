# AirZAR Websearcher

A secure, rate-limited web search gateway with a Web3-ready frontend.

## Features
- Vite + React (TypeScript) frontend
- Express backend with input validation, rate limiting, and security headers
- Provider abstraction (DuckDuckGo or Serper)
- Market insights for instruments using free APIs (Yahoo Finance, CoinGecko)
- Market news and investor filings (Yahoo Finance news, SEC EDGAR)
- Wallet connect UI stub for future Web3 integration

## Prerequisites
- Node.js 18.x (compatible with the configured Vite version)

## Setup

### Backend
```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

The frontend proxies `/api/*` requests to `http://localhost:8787` during development.

## Environment
Backend environment variables are defined in `backend/.env`:
- `PORT`: API port (default: 8787)
- `API_PROVIDER`: `duckduckgo` or `serper`
- `SERPER_API_KEY`: required if using Serper
- `ALLOWED_ORIGINS`: comma-separated list for CORS
- `SEC_USER_AGENT`: required by SEC for filings requests
- `LLM_API_URL`: optional OpenAI-compatible chat completions endpoint
- `LLM_API_KEY`: optional API key for the LLM endpoint
- `LLM_MODEL`: optional model name (default: gpt-4o-mini)

## Security Notes
- Requests are rate-limited (60 per 15 minutes).
- Input is validated with Zod before executing searches.
- Helmet is enabled for basic security headers.

## Market Insights
Instrument searches can optionally include analytics such as RSI, volatility, and recent returns.
These are descriptive statistics only and are not price predictions.

## LLM Summary
The app can compile a neutral, factual summary of results. It does not provide predictions or investment advice.

## Market News & Filings
News is fetched from Yahoo Finance, and investor updates use SEC EDGAR filings when a valid ticker is provided.

## Next Steps
- Replace the wallet stub with a real wallet connector (e.g., WalletConnect or wagmi).
- Add an LLM summarization layer for the search results if desired.
