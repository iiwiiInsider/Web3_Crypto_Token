import { useMemo, useState, type FormEvent } from 'react'
import './App.css'

type SearchResult = {
  title: string
  url: string
  snippet?: string
  source?: string
  publisher?: string
  publishedAt?: number
  filingDate?: string
}

type InstrumentResult = {
  id?: string
  symbol: string
  name: string
  price?: number
  marketCap?: number
  change24h?: number
  exchange?: string
  source?: string
  type: 'stock' | 'etf' | 'crypto' | 'forex'
  insights?: {
    periodDays: number
    lastPrice: number
    return7d: number | null
    return30d: number | null
    volatility: number
    rsi14: number
    sma7: number
    sma30: number
  } | null
}

function App() {
  const [query, setQuery] = useState('')
  const [provider, setProvider] = useState<'duckduckgo' | 'serper'>('duckduckgo')
  const [instrumentType, setInstrumentType] = useState<
    'all' | 'stock' | 'etf' | 'crypto' | 'forex'
  >('all')
  const [includeInsights, setIncludeInsights] = useState(true)
  const [results, setResults] = useState<SearchResult[]>([])
  const [instrumentResults, setInstrumentResults] = useState<InstrumentResult[]>([])
  const [newsResults, setNewsResults] = useState<SearchResult[]>([])
  const [filingResults, setFilingResults] = useState<SearchResult[]>([])
  const [summary, setSummary] = useState('')
  const [includeSummary, setIncludeSummary] = useState(true)
  const [activeFilter, setActiveFilter] = useState<'all' | 'web' | 'news' | 'filings'>(
    'all'
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [connected, setConnected] = useState(false)

  const isSearchDisabled = useMemo(() => loading || query.trim().length < 2, [loading, query])

  const handleSearch = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    setResults([])
    setInstrumentResults([])
    setNewsResults([])
    setFilingResults([])
    setSummary('')
    const trimmed = query.trim()
    if (trimmed.length < 2) {
      setError('Enter at least 2 characters to search.')
      return
    }

    setLoading(true)
    try {
      let webData: SearchResult[] = []
      let newsData: SearchResult[] = []
      let filingsData: SearchResult[] = []
      let instrumentData: InstrumentResult[] = []

      const searchParams = new URLSearchParams({ q: trimmed, provider })
      const newsParams = new URLSearchParams({ q: trimmed })
      const filingsParams = new URLSearchParams({ q: trimmed })

      const webPromise = fetch(`/api/search?${searchParams.toString()}`)
        .then(async (response) => {
          if (!response.ok) {
            const payload = await response.json().catch(() => ({}))
            throw new Error(payload?.error || 'Search failed.')
          }
          return response.json()
        })
        .then((data) => {
          webData = data.results || []
          setResults(webData)
        })

      const newsPromise = fetch(`/api/news?${newsParams.toString()}`)
        .then((response) => (response.ok ? response.json() : null))
        .then((data) => {
          if (data?.results) {
            newsData = data.results
            setNewsResults(newsData)
          }
        })

      const filingsPromise = fetch(`/api/filings?${filingsParams.toString()}`)
        .then((response) => (response.ok ? response.json() : null))
        .then((data) => {
          if (data?.results) {
            filingsData = data.results
            setFilingResults(filingsData)
          }
        })

      const instrumentPromise = instrumentType !== 'all'
        ? fetch(
            `/api/instruments?${new URLSearchParams({
              q: trimmed,
              type: instrumentType,
              includeInsights: includeInsights ? 'true' : 'false',
            }).toString()}`
          )
            .then((response) => (response.ok ? response.json() : null))
            .then((data) => {
              if (data?.results) {
                instrumentData = data.results
                setInstrumentResults(instrumentData)
              }
            })
        : Promise.resolve()

      await Promise.all([webPromise, newsPromise, filingsPromise, instrumentPromise])

      if (includeSummary) {
        const summaryResponse = await fetch('/api/summary', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            q: trimmed,
            web: webData,
            news: newsData,
            filings: filingsData,
            instruments: instrumentData,
          }),
        })

        if (summaryResponse.ok) {
          const data = await summaryResponse.json()
          setSummary(data.summary || '')
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Search failed.'
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  const renderSparkline = (series?: number[]) => {
    if (!series || series.length < 2) return null
    const width = 160
    const height = 48
    const min = Math.min(...series)
    const max = Math.max(...series)
    const range = max - min || 1
    const points = series.map((value, index) => {
      const x = (index / (series.length - 1)) * width
      const y = height - ((value - min) / range) * height
      return `${x},${y}`
    })

    return (
      <svg className="sparkline" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <polyline points={points.join(' ')} fill="none" stroke="currentColor" strokeWidth="2" />
      </svg>
    )
  }

  const toggleWallet = () => {
    setConnected((prev) => !prev)
  }

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <p className="eyebrow">AirZAR Websearcher</p>
          <h1>Secure Web3 Search Gateway</h1>
          <p className="subtitle">
            A secure, rate-limited web search API with a wallet-ready interface.
          </p>
        </div>
        <button className={`wallet ${connected ? 'connected' : ''}`} onClick={toggleWallet}>
          {connected ? 'Wallet Connected' : 'Connect Wallet'}
        </button>
      </header>

      <section className="search-panel">
        <form className="search-form" onSubmit={handleSearch}>
          <div className="input-group">
            <label htmlFor="query">Search query</label>
            <input
              id="query"
              type="text"
              placeholder="Search the open web..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <div className="input-group">
            <label htmlFor="provider">Provider</label>
            <select
              id="provider"
              value={provider}
              onChange={(event) => setProvider(event.target.value as 'duckduckgo' | 'serper')}
            >
              <option value="duckduckgo">DuckDuckGo (no key)</option>
              <option value="serper">Serper (API key)</option>
            </select>
          </div>
          <div className="input-group">
            <label htmlFor="instrument">Instrument filter</label>
            <select
              id="instrument"
              value={instrumentType}
              onChange={(event) =>
                setInstrumentType(
                  event.target.value as 'all' | 'stock' | 'etf' | 'crypto' | 'forex'
                )
              }
            >
              <option value="all">All (web search)</option>
              <option value="stock">Stocks</option>
              <option value="etf">ETFs</option>
              <option value="crypto">Crypto</option>
              <option value="forex">Forex</option>
            </select>
          </div>
          <div className="input-group">
            <label htmlFor="insights">Market insights</label>
            <label className="toggle">
              <input
                id="insights"
                type="checkbox"
                checked={includeInsights}
                onChange={(event) => setIncludeInsights(event.target.checked)}
              />
              <span>Include analytics</span>
            </label>
          </div>
          <div className="input-group">
            <label htmlFor="summary">LLM summary</label>
            <label className="toggle">
              <input
                id="summary"
                type="checkbox"
                checked={includeSummary}
                onChange={(event) => setIncludeSummary(event.target.checked)}
              />
              <span>Compile readable summary</span>
            </label>
          </div>
          <button type="submit" disabled={isSearchDisabled}>
            {loading ? 'Searching…' : 'Search'}
          </button>
        </form>
        {loading && (
          <p className="hint">
            Results are proxied through the secure backend with validation and rate limiting.
          </p>
        )}
      </section>

        {summary && (
          <section className="results">
            <h2>AI Summary</h2>
            <div className="summary-card">
              {summary.split('\n').map((line, index) => (
                <p key={`${line}-${index}`}>{line}</p>
              ))}
            </div>
          </section>
        )}

        {instrumentResults.length > 0 && activeFilter !== 'news' && activeFilter !== 'filings' && (
        <section className="results">
          <h2>Instrument Insights</h2>
          {instrumentResults.map((item) => (
            <article key={`${item.type}-${item.symbol}`} className="result-card">
              <div>
                <h3>
                  {item.name} <span className="symbol">{item.symbol}</span>
                </h3>
                <p>
                  {item.exchange ? `${item.exchange} • ` : ''}
                  {item.price !== undefined ? `$${item.price}` : 'Price unavailable'}
                  {item.change24h !== undefined
                    ? ` • ${item.change24h.toFixed(2)}%`
                    : ''}
                </p>
                {item.marketCap !== undefined && (
                  <p>Market cap: ${item.marketCap.toLocaleString()}</p>
                )}
                {item.insights && (
                  <div className="insights">
                    <span>RSI 14: {item.insights.rsi14.toFixed(1)}</span>
                    <span>Volatility: {item.insights.volatility.toFixed(2)}%</span>
                    {item.insights.return7d !== null && (
                      <span>Net move 7d: {item.insights.return7d.toFixed(2)}%</span>
                    )}
                    {item.insights.return30d !== null && (
                      <span>Net move 30d: {item.insights.return30d.toFixed(2)}%</span>
                    )}
                  </div>
                )}
              </div>
              {item.insights?.series && renderSparkline(item.insights.series)}
              {item.source && <span className="source">{item.source}</span>}
            </article>
          ))}
        </section>
      )}

      <section className="results">
        {error && <div className="error">{error}</div>}
        {!error && (
          <div className="filters">
            <button
              className={activeFilter === 'all' ? 'active' : ''}
              onClick={() => setActiveFilter('all')}
              type="button"
            >
              All
            </button>
            <button
              className={activeFilter === 'web' ? 'active' : ''}
              onClick={() => setActiveFilter('web')}
              type="button"
            >
              Web
            </button>
            <button
              className={activeFilter === 'news' ? 'active' : ''}
              onClick={() => setActiveFilter('news')}
              type="button"
            >
              Market News
            </button>
            <button
              className={activeFilter === 'filings' ? 'active' : ''}
              onClick={() => setActiveFilter('filings')}
              type="button"
            >
              Investor Updates
            </button>
          </div>
        )}
        {!error && results.length === 0 && !loading && (
          <div className="empty">
            <p>No results yet. Try a shorter query or ticker symbol (e.g., AAPL, BTC).</p>
            <p>Tip: pick an instrument filter to pull market data directly.</p>
          </div>
        )}
        {(activeFilter === 'all' || activeFilter === 'web') &&
          results.map((result) => (
            <article key={result.url} className="result-card">
              <div>
                <h3>
                  <a href={result.url} target="_blank" rel="noreferrer">
                    {result.title}
                  </a>
                </h3>
                {result.snippet && <p>{result.snippet}</p>}
              </div>
              {result.source && <span className="source">{result.source}</span>}
            </article>
          ))}

        {(activeFilter === 'all' || activeFilter === 'news') && newsResults.length > 0 && (
          <div className="group">
            <h2>Market News</h2>
            {newsResults.map((result) => (
              <article key={result.url} className="result-card">
                <div>
                  <h3>
                    <a href={result.url} target="_blank" rel="noreferrer">
                      {result.title}
                    </a>
                  </h3>
                  <p>{result.publisher || result.snippet}</p>
                  {result.publishedAt && (
                    <p className="meta">
                      {new Date(result.publishedAt * 1000).toLocaleString()}
                    </p>
                  )}
                </div>
                {result.source && <span className="source">{result.source}</span>}
              </article>
            ))}
          </div>
        )}

        {(activeFilter === 'all' || activeFilter === 'filings') && filingResults.length > 0 && (
          <div className="group">
            <h2>Investor Updates</h2>
            {filingResults.map((result) => (
              <article key={result.url} className="result-card">
                <div>
                  <h3>
                    <a href={result.url} target="_blank" rel="noreferrer">
                      {result.title}
                    </a>
                  </h3>
                  <p>{result.snippet}</p>
                  {result.filingDate && <p className="meta">Filed: {result.filingDate}</p>}
                </div>
                {result.source && <span className="source">{result.source}</span>}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

export default App
