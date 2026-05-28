const express = require('express')
const cors = require('cors')
const helmet = require('helmet')
const rateLimit = require('express-rate-limit')
const { z } = require('zod')
const dotenv = require('dotenv')

dotenv.config()

const app = express()
const PORT = process.env.PORT || 8787
const DEFAULT_PROVIDER = process.env.API_PROVIDER || 'duckduckgo'
const SERPER_API_KEY = process.env.SERPER_API_KEY || ''
const SEC_USER_AGENT =
  process.env.SEC_USER_AGENT || 'AirZARWebsearcher/1.0 (contact@example.com)'
const LLM_API_URL = process.env.LLM_API_URL || ''
const LLM_API_KEY = process.env.LLM_API_KEY || ''
const LLM_MODEL = process.env.LLM_MODEL || 'gpt-4o-mini'

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

app.use(helmet())
app.use(express.json({ limit: '256kb' }))
app.use(
  cors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : true,
  })
)

app.use(
  '/api',
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
  })
)

const searchSchema = z.object({
  q: z.string().min(2).max(200),
  provider: z.enum(['duckduckgo', 'serper']).optional(),
})

const instrumentSchema = z.object({
  q: z.string().min(1).max(100),
  type: z.enum(['stock', 'etf', 'crypto', 'forex']),
  includeInsights: z.preprocess(
    (value) =>
      value === true || value === 'true' || value === '1' || value === 1,
    z.boolean()
  ).optional(),
})

const newsSchema = z.object({
  q: z.string().min(2).max(200),
})

const filingsSchema = z.object({
  q: z.string().min(1).max(20),
})

const summarySchema = z.object({
  q: z.string().min(2).max(200),
  web: z.array(z.any()).optional(),
  news: z.array(z.any()).optional(),
  filings: z.array(z.any()).optional(),
  instruments: z.array(z.any()).optional(),
})

const hexSchema = z.object({
  url: z.string().url().max(2048),
})

let secTickerCache = null
let secTickerCacheAt = 0

const fetchJson = async (...args) => {
  const { default: fetch } = await import('node-fetch')
  const response = await fetch(...args)
  return response
}

const MAX_HEX_BYTES = 2_000_000

const isAllowedUrl = (value) => {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch (error) {
    return false
  }
}

const toHexLines = (buffer, bytesPerLine = 32) => {
  const hex = buffer.toString('hex')
  if (bytesPerLine <= 0) {
    return hex
  }

  const chunkSize = bytesPerLine * 2
  const lines = []
  for (let i = 0; i < hex.length; i += chunkSize) {
    const chunk = hex.slice(i, i + chunkSize)
    lines.push(chunk.match(/.{1,2}/g)?.join(' ') || '')
  }
  return lines.join('\n')
}

const normalizeResults = (items, source) =>
  items
    .filter((item) => item && item.title && item.url)
    .map((item) => ({
      title: item.title,
      url: item.url,
      snippet: item.snippet || '',
      source,
      publishedAt: item.publishedAt,
      publisher: item.publisher,
      filingDate: item.filingDate,
    }))

const scoreResult = (result, terms) => {
  const text = `${result.title} ${result.snippet}`.toLowerCase()
  let score = 0
  terms.forEach((term) => {
    if (!term) return
    if (text.includes(term)) {
      score += 3
    }
  })
  if (result.source === 'serper') score += 2
  if (result.source === 'wikipedia') score += 1
  return score
}

const rankAndDedupe = (results, query) => {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean)

  const seen = new Set()
  const unique = []
  results.forEach((result) => {
    try {
      const url = new URL(result.url)
      const key = `${url.hostname}${url.pathname}`
      if (seen.has(key)) return
      seen.add(key)
      unique.push(result)
    } catch (error) {
      if (!seen.has(result.url)) {
        seen.add(result.url)
        unique.push(result)
      }
    }
  })

  return unique
    .map((result) => ({
      ...result,
      _score: scoreResult(result, terms),
    }))
    .sort((a, b) => b._score - a._score)
    .map(({ _score, ...rest }) => rest)
}

const buildFallbackResults = (query) => {
  const encoded = encodeURIComponent(query)
  return [
    {
      title: `Overview: ${query}`,
      url: `https://en.wikipedia.org/wiki/Special:Search?search=${encoded}`,
      snippet: 'Start with a high-level overview and definitions.',
      source: 'fallback',
    },
    {
      title: `Market data search: ${query}`,
      url: `https://finance.yahoo.com/quote/${encoded}`,
      snippet: 'Check live quotes, charts, and key statistics.',
      source: 'fallback',
    },
    {
      title: `Crypto market search: ${query}`,
      url: `https://www.coingecko.com/en/search?query=${encoded}`,
      snippet: 'Explore crypto pricing and market cap data.',
      source: 'fallback',
    },
    {
      title: `Investor education: ${query}`,
      url: `https://www.investopedia.com/search?q=${encoded}`,
      snippet: 'Learn foundational terms and investing concepts.',
      source: 'fallback',
    },
  ]
}

const trimItems = (items, max) => (Array.isArray(items) ? items.slice(0, max) : [])

const buildExtractiveSummary = ({ q, web, news, filings, instruments }) => {
  const lines = []
  if (web?.length) {
    lines.push(`Top web items: ${web.slice(0, 3).map((item) => item.title).join(' | ')}`)
  }
  if (news?.length) {
    lines.push(`Market news: ${news.slice(0, 3).map((item) => item.title).join(' | ')}`)
  }
  if (filings?.length) {
    lines.push(`Recent filings: ${filings.slice(0, 3).map((item) => item.title).join(' | ')}`)
  }
  if (instruments?.length) {
    lines.push(
      `Instrument snapshot: ${instruments
        .slice(0, 3)
        .map((item) => `${item.symbol} ${item.price ?? 'n/a'}`)
        .join(' | ')}`
    )
  }

  if (lines.length === 0) {
    return `No summary available for “${q}”. Try a shorter query or a ticker symbol.`
  }

  return lines.join('\n')
}

const generateSummary = async ({ q, web, news, filings, instruments }) => {
  if (!LLM_API_URL || !LLM_API_KEY) {
    return buildExtractiveSummary({ q, web, news, filings, instruments })
  }

  const payload = {
    model: LLM_MODEL,
    messages: [
      {
        role: 'system',
        content:
          'You summarize market search results. Provide concise, factual summaries only. Do not predict prices, do not provide investment advice, and do not suggest orders.',
      },
      {
        role: 'user',
        content: JSON.stringify({
          query: q,
          web: trimItems(web, 5),
          news: trimItems(news, 5),
          filings: trimItems(filings, 5),
          instruments: trimItems(instruments, 5),
        }),
      },
    ],
    temperature: 0.2,
  }

  const response = await fetchJson(LLM_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${LLM_API_KEY}`,
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    return buildExtractiveSummary({ q, web, news, filings, instruments })
  }

  const data = await response.json()
  const content = data?.choices?.[0]?.message?.content
  return content || buildExtractiveSummary({ q, web, news, filings, instruments })
}

const searchDuckDuckGo = async (query) => {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(
    query
  )}&format=json&no_html=1&skip_disambig=1`
  const response = await fetchJson(url)
  if (!response.ok) {
    throw new Error('DuckDuckGo request failed.')
  }
  const data = await response.json()

  const items = []

  if (data?.AbstractURL && data?.AbstractText) {
    items.push({
      title: data.Heading || 'DuckDuckGo Result',
      url: data.AbstractURL,
      snippet: data.AbstractText,
    })
  }

  const related = Array.isArray(data?.RelatedTopics) ? data.RelatedTopics : []
  related.forEach((topic) => {
    if (topic?.FirstURL && topic?.Text) {
      items.push({
        title: topic.Text.split(' - ')[0] || topic.Text,
        url: topic.FirstURL,
        snippet: topic.Text,
      })
    }
    if (Array.isArray(topic?.Topics)) {
      topic.Topics.forEach((nested) => {
        if (nested?.FirstURL && nested?.Text) {
          items.push({
            title: nested.Text.split(' - ')[0] || nested.Text,
            url: nested.FirstURL,
            snippet: nested.Text,
          })
        }
      })
    }
  })

  return normalizeResults(items, 'duckduckgo')
}

const searchSerper = async (query) => {
  if (!SERPER_API_KEY) {
    throw new Error('SERPER_API_KEY is not configured.')
  }

  const response = await fetchJson('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': SERPER_API_KEY,
    },
    body: JSON.stringify({ q: query }),
  })

  if (!response.ok) {
    throw new Error('Serper request failed.')
  }

  const data = await response.json()
  const organic = Array.isArray(data?.organic) ? data.organic : []
  const items = organic.map((entry) => ({
    title: entry.title,
    url: entry.link,
    snippet: entry.snippet,
  }))

  return normalizeResults(items, 'serper')
}

const searchWikipedia = async (query) => {
  const response = await fetchJson(
    `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
      query
    )}&format=json&origin=*`
  )
  if (!response.ok) {
    throw new Error('Wikipedia request failed.')
  }
  const data = await response.json()
  const items = Array.isArray(data?.query?.search) ? data.query.search : []

  return normalizeResults(
    items.map((item) => ({
      title: item.title,
      url: `https://en.wikipedia.org/wiki/${encodeURIComponent(item.title)}`,
      snippet: item.snippet?.replace(/[<>]/g, '') || '',
    })),
    'wikipedia'
  )
}

const blendedSearch = async (query, providerToUse) => {
  const baseResults =
    providerToUse === 'serper'
      ? await searchSerper(query)
      : await searchDuckDuckGo(query)

  let wikiResults = []
  try {
    wikiResults = await searchWikipedia(query)
  } catch (error) {
    wikiResults = []
  }

  return rankAndDedupe([...baseResults, ...wikiResults], query).slice(0, 20)
}

const calculateInsights = (prices) => {
  if (!prices || prices.length < 10) {
    return null
  }

  const closes = prices.map((point) => point.value)
  const series = prices.slice(-30).map((point) => point.value)
  const lastPrice = closes[closes.length - 1]
  const returns = closes.slice(1).map((price, index) => {
    const prev = closes[index]
    return prev ? (price - prev) / prev : 0
  })

  const mean = returns.reduce((acc, value) => acc + value, 0) / returns.length
  const variance =
    returns.reduce((acc, value) => acc + Math.pow(value - mean, 2), 0) /
    returns.length
  const volatility = Math.sqrt(variance) * Math.sqrt(252) * 100

  const rsiPeriod = 14
  const rsiWindow = returns.slice(-rsiPeriod)
  const gains = rsiWindow.filter((value) => value > 0)
  const losses = rsiWindow.filter((value) => value < 0)
  const avgGain = gains.reduce((acc, value) => acc + value, 0) / rsiPeriod || 0
  const avgLoss =
    Math.abs(losses.reduce((acc, value) => acc + value, 0)) / rsiPeriod || 0
  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss
  const rsi = 100 - 100 / (1 + rs)

  const sma = (length) => {
    const slice = closes.slice(-length)
    return slice.reduce((acc, value) => acc + value, 0) / slice.length
  }

  const return7d =
    closes.length >= 8
      ? ((lastPrice - closes[closes.length - 8]) / closes[closes.length - 8]) * 100
      : null
  const return30d =
    closes.length >= 31
      ? ((lastPrice - closes[closes.length - 31]) / closes[closes.length - 31]) * 100
      : null

  return {
    periodDays: prices.length,
    lastPrice,
    return7d,
    return30d,
    volatility,
    rsi14: rsi,
    sma7: sma(7),
    sma30: sma(30),
    series,
  }
}

const getYahooInsights = async (symbol) => {
  const response = await fetchJson(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
      symbol
    )}?range=3mo&interval=1d`,
    {
      headers: {
        'User-Agent': 'Mozilla/5.0',
      },
    }
  )

  if (!response.ok) {
    return null
  }

  const data = await response.json()
  const timestamps = data?.chart?.result?.[0]?.timestamp || []
  const closes = data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || []

  const prices = timestamps
    .map((time, index) => ({ time, value: closes[index] }))
    .filter((point) => Number.isFinite(point.value))

  return calculateInsights(prices)
}

const getCoinGeckoInsights = async (id) => {
  const response = await fetchJson(
    `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(
      id
    )}/market_chart?vs_currency=usd&days=30`
  )
  if (!response.ok) {
    return null
  }
  const data = await response.json()
  const prices = Array.isArray(data?.prices)
    ? data.prices.map((point) => ({ time: point[0], value: point[1] }))
    : []

  return calculateInsights(prices)
}

const searchYahooNews = async (query) => {
  const response = await fetchJson(
    `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(
      query
    )}&quotesCount=0&newsCount=8`,
    {
      headers: {
        'User-Agent': 'Mozilla/5.0',
      },
    }
  )
  if (!response.ok) {
    throw new Error('Yahoo Finance news failed.')
  }
  const data = await response.json()
  const news = Array.isArray(data?.news) ? data.news : []

  return normalizeResults(
    news.map((item) => ({
      title: item.title,
      url: item.link,
      snippet: item.publisher || '',
      publishedAt: item.providerPublishTime,
      publisher: item.publisher,
    })),
    'yahoo-news'
  )
}

const getSecTickerMap = async () => {
  const now = Date.now()
  if (secTickerCache && now - secTickerCacheAt < 24 * 60 * 60 * 1000) {
    return secTickerCache
  }

  const response = await fetchJson('https://www.sec.gov/files/company_tickers.json', {
    headers: {
      'User-Agent': SEC_USER_AGENT,
    },
  })
  if (!response.ok) {
    throw new Error('SEC ticker list failed.')
  }
  const data = await response.json()
  const map = new Map()
  Object.values(data).forEach((entry) => {
    if (entry?.ticker && entry?.cik_str) {
      map.set(entry.ticker.toUpperCase(), String(entry.cik_str).padStart(10, '0'))
    }
  })

  secTickerCache = map
  secTickerCacheAt = now
  return map
}

const searchSecFilings = async (query) => {
  const ticker = query.trim().toUpperCase()
  const map = await getSecTickerMap()
  const cik = map.get(ticker)
  if (!cik) {
    return []
  }

  const response = await fetchJson(
    `https://data.sec.gov/submissions/CIK${cik}.json`,
    {
      headers: {
        'User-Agent': SEC_USER_AGENT,
      },
    }
  )
  if (!response.ok) {
    throw new Error('SEC filings lookup failed.')
  }
  const data = await response.json()
  const recent = data?.filings?.recent
  if (!recent?.accessionNumber) {
    return []
  }

  const results = recent.accessionNumber.slice(0, 6).map((accession, index) => {
    const accessionNoDashes = accession.replace(/-/g, '')
    const form = recent.form?.[index] || 'Filing'
    const filedAt = recent.filingDate?.[index]
    const primaryDoc = recent.primaryDocument?.[index]
    const url = `https://www.sec.gov/Archives/edgar/data/${parseInt(
      cik,
      10
    )}/${accessionNoDashes}/${accession}-index.html`

    return {
      title: `${ticker} ${form}`,
      url,
      snippet: primaryDoc || 'SEC filing',
      filingDate: filedAt,
      source: 'sec-edgar',
    }
  })

  return results
}

const searchCoinGecko = async (query) => {
  const response = await fetchJson(
    `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(query)}`
  )
  if (!response.ok) {
    throw new Error('CoinGecko request failed.')
  }
  const data = await response.json()
  const coins = Array.isArray(data?.coins) ? data.coins.slice(0, 6) : []
  if (coins.length === 0) {
    return []
  }

  const ids = coins.map((coin) => coin.id).join(',')
  const marketResponse = await fetchJson(
    `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${encodeURIComponent(
      ids
    )}&price_change_percentage=24h`
  )
  if (!marketResponse.ok) {
    throw new Error('CoinGecko market request failed.')
  }
  const marketData = await marketResponse.json()

  return marketData.map((coin) => ({
    id: coin.id,
    symbol: coin.symbol?.toUpperCase(),
    name: coin.name,
    price: coin.current_price,
    marketCap: coin.market_cap,
    change24h: coin.price_change_percentage_24h,
    source: 'coingecko',
    type: 'crypto',
  }))
}

const searchYahooFinance = async (query, type) => {
  const response = await fetchJson(
    `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(
      query
    )}&quotesCount=8&newsCount=0`,
    {
      headers: {
        'User-Agent': 'Mozilla/5.0',
      },
    }
  )
  if (!response.ok) {
    throw new Error('Yahoo Finance search failed.')
  }
  const data = await response.json()
  const quotes = Array.isArray(data?.quotes) ? data.quotes : []

  const allowedTypes = {
    stock: new Set(['EQUITY']),
    etf: new Set(['ETF']),
    forex: new Set(['CURRENCY']),
  }

  const filtered = quotes.filter((item) =>
    allowedTypes[type]?.has(item?.quoteType)
  )

  if (filtered.length === 0) {
    return []
  }

  const baseResults = filtered.map((item) => ({
    symbol: item.symbol,
    name: item.shortname || item.longname || item.symbol,
    exchange: item.exchDisp || item.exchange,
    source: 'yahoo-finance',
    type,
  }))

  const symbols = filtered.map((item) => item.symbol).join(',')
  try {
    const quoteResponse = await fetchJson(
      `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(
        symbols
      )}`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0',
        },
      }
    )
    if (!quoteResponse.ok) {
      return baseResults
    }
    const quoteData = await quoteResponse.json()
    const quoteItems = quoteData?.quoteResponse?.result || []

    return quoteItems.map((item) => ({
      symbol: item.symbol,
      name: item.shortName || item.longName || item.symbol,
      price: item.regularMarketPrice,
      change24h: item.regularMarketChangePercent,
      exchange: item.fullExchangeName || item.exchange,
      source: 'yahoo-finance',
      type,
    }))
  } catch (error) {
    return baseResults
  }
}

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' })
})

const handleSearch = async (req, res, source) => {
  const input = source === 'body'
    ? { q: req.body?.q, provider: req.body?.provider }
    : { q: req.query.q, provider: req.query.provider }

  const parsed = searchSchema.safeParse(input)

  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid query parameters.' })
  }

  const { q, provider } = parsed.data
  const providerToUse = provider || DEFAULT_PROVIDER

  try {
    let results = await blendedSearch(q, providerToUse)

    if (results.length === 0) {
      const fallbackQuery = q
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .join(' ')

      if (fallbackQuery && fallbackQuery !== q) {
        results = await blendedSearch(fallbackQuery, providerToUse)
      }
    }

    if (results.length === 0) {
      results = buildFallbackResults(q)
    }

    return res.json({
      query: q,
      provider: providerToUse,
      results,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Search failed.'
    return res.status(500).json({ error: message })
  }
}

app.get('/api/search', async (req, res) => {
  return handleSearch(req, res, 'query')
})

app.post('/api/search', async (req, res) => {
  return handleSearch(req, res, 'body')
})

const handleNewsSearch = async (req, res, source) => {
  const input = source === 'body' ? { q: req.body?.q } : { q: req.query.q }
  const parsed = newsSchema.safeParse(input)
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid news parameters.' })
  }

  try {
    const results = await searchYahooNews(parsed.data.q)
    return res.json({ query: parsed.data.q, results })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'News search failed.'
    return res.status(500).json({ error: message })
  }
}

app.get('/api/news', async (req, res) => {
  return handleNewsSearch(req, res, 'query')
})

app.post('/api/news', async (req, res) => {
  return handleNewsSearch(req, res, 'body')
})

const handleFilingsSearch = async (req, res, source) => {
  const input = source === 'body' ? { q: req.body?.q } : { q: req.query.q }
  const parsed = filingsSchema.safeParse(input)
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid filings parameters.' })
  }

  try {
    const results = await searchSecFilings(parsed.data.q)
    return res.json({ query: parsed.data.q, results })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Filings search failed.'
    return res.status(500).json({ error: message })
  }
}

app.get('/api/filings', async (req, res) => {
  return handleFilingsSearch(req, res, 'query')
})

app.post('/api/filings', async (req, res) => {
  return handleFilingsSearch(req, res, 'body')
})

app.post('/api/summary', async (req, res) => {
  const parsed = summarySchema.safeParse(req.body || {})
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid summary payload.' })
  }

  try {
    const summary = await generateSummary(parsed.data)
    return res.json({ query: parsed.data.q, summary })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Summary failed.'
    return res.status(500).json({ error: message })
  }
})

const handleHexDump = async (req, res, source) => {
  const input = source === 'body'
    ? { url: req.body?.url, format: req.body?.format }
    : { url: req.query.url, format: req.query.format }
  const parsed = hexSchema.safeParse({ url: input.url })
  if (!parsed.success || !isAllowedUrl(parsed.data.url)) {
    return res.status(400).json({ error: 'Invalid or unsupported url.' })
  }

  try {
    const response = await fetchJson(parsed.data.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
      },
    })

    if (!response.ok) {
      return res.status(502).json({ error: 'Failed to fetch webpage.' })
    }

    const contentLength = Number(response.headers.get('content-length'))
    if (Number.isFinite(contentLength) && contentLength > MAX_HEX_BYTES) {
      return res.status(413).json({ error: 'Webpage is too large.' })
    }

    const arrayBuffer = await response.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    if (buffer.length > MAX_HEX_BYTES) {
      return res.status(413).json({ error: 'Webpage is too large.' })
    }

    const hex = toHexLines(buffer, 32)
    const wantsText =
      String(input.format || '').toLowerCase() === 'txt' ||
      String(req.headers.accept || '').includes('text/plain')

    if (wantsText) {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8')
      res.setHeader('Content-Disposition', 'attachment; filename="hex.txt"')
      return res.send(hex)
    }

    return res.json({
      url: parsed.data.url,
      bytes: buffer.length,
      contentType: response.headers.get('content-type') || 'application/octet-stream',
      hex,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Hex dump failed.'
    return res.status(500).json({ error: message })
  }
}

app.get('/api/hex', async (req, res) => {
  return handleHexDump(req, res, 'query')
})

app.post('/api/hex', async (req, res) => {
  return handleHexDump(req, res, 'body')
})

const handleInstrumentSearch = async (req, res, source) => {
  const input = source === 'body'
    ? { q: req.body?.q, type: req.body?.type, includeInsights: req.body?.includeInsights }
    : { q: req.query.q, type: req.query.type, includeInsights: req.query.includeInsights }

  const parsed = instrumentSchema.safeParse(input)
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid instrument parameters.' })
  }

  const { q, type, includeInsights } = parsed.data
  try {
    const results =
      type === 'crypto' ? await searchCoinGecko(q) : await searchYahooFinance(q, type)

    if (!includeInsights) {
      return res.json({
        query: q,
        type,
        results: results.length > 0 ? results : buildFallbackResults(q),
      })
    }

    const limited = results.slice(0, 3)
    const enriched = await Promise.all(
      limited.map(async (item) => {
        if (type === 'crypto' && item.id) {
          const insights = await getCoinGeckoInsights(item.id)
          return { ...item, insights }
        }
        const insights = await getYahooInsights(item.symbol)
        return { ...item, insights }
      })
    )

    const merged = results.map((item) => {
      const match = enriched.find((entry) => entry.symbol === item.symbol)
      return match || item
    })

    return res.json({
      query: q,
      type,
      results: merged.length > 0 ? merged : buildFallbackResults(q),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Instrument search failed.'
    return res.status(500).json({ error: message })
  }
}

app.get('/api/instruments', async (req, res) => {
  return handleInstrumentSearch(req, res, 'query')
})

app.post('/api/instruments', async (req, res) => {
  return handleInstrumentSearch(req, res, 'body')
})

app.listen(PORT, () => {
  console.log(`AirZAR Websearcher backend running on port ${PORT}`)
})
