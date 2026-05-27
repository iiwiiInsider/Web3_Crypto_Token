import { useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import { deployment, tokens } from "./config/tokens";
import { shortenAddress, formatNumber } from "./utils/format";

const exchangeAbi = [
  "function buy(address token, uint256 tokenAmount) external",
  "function sell(address token, uint256 airzarAmount) external"
];

const erc20Abi = [
  "function balanceOf(address account) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function decimals() view returns (uint8)"
];

const hexToString = (hex) => {
  if (!hex) return "";
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  let output = "";
  for (let i = 0; i < clean.length; i += 2) {
    output += String.fromCharCode(parseInt(clean.slice(i, i + 2), 16));
  }
  return output;
};

export default function App() {
  const [account, setAccount] = useState("");
  const [selected, setSelected] = useState(tokens[0] || null);
  const [amount, setAmount] = useState("");
  const [apiAmount, setApiAmount] = useState("100");
  const [airzarBalance, setAirzarBalance] = useState("0");
  const [tokenBalance, setTokenBalance] = useState("0");
  const [status, setStatus] = useState("");
  const [apiStatus, setApiStatus] = useState("");
  const [rampSession, setRampSession] = useState(null);
  const [apiBalances, setApiBalances] = useState(null);

  const hasDeployment = deployment.exchange && deployment.exchange !== "0x0000000000000000000000000000000000000000";

  const [provider, setProvider] = useState(null);
  const apiBase = import.meta.env.VITE_API_BASE || "";

  const getWalletProvider = (type) => {
    if (type === "metamask") return window.ethereum;
    if (type === "bitget") return window.bitkeep?.ethereum || window.bitget?.ethereum || null;
    return window.ethereum;
  };

  const selectedLogo = useMemo(() => {
    if (!selected?.logoHex) return "";
    const svg = hexToString(selected.logoHex);
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  }, [selected]);

  const connect = async (type = "metamask") => {
    const rawProvider = getWalletProvider(type);
    if (!rawProvider) {
      setStatus(`${type === "bitget" ? "Bitget" : "MetaMask"} wallet not detected.`);
      return;
    }
    const nextProvider = new ethers.BrowserProvider(rawProvider);
    setProvider(nextProvider);
    const accounts = await nextProvider.send("eth_requestAccounts", []);
    setAccount(accounts[0]);
  };

  const refreshBalances = async (addr, token) => {
    if (!provider || !addr || !token) return;
    const airzar = new ethers.Contract(deployment.airzar, erc20Abi, provider);
    const tokenContract = new ethers.Contract(token.address, erc20Abi, provider);
    const [airzarBal, tokenBal, tokenDecimals] = await Promise.all([
      airzar.balanceOf(addr),
      tokenContract.balanceOf(addr),
      tokenContract.decimals()
    ]);
    setAirzarBalance(ethers.formatUnits(airzarBal, 18));
    setTokenBalance(ethers.formatUnits(tokenBal, tokenDecimals));
  };

  useEffect(() => {
    if (account && selected) {
      refreshBalances(account, selected);
    }
  }, [account, selected]);

  const handleBuy = async () => {
    if (!provider || !account || !selected) return;
    if (!hasDeployment) {
      setStatus("Deploy contracts first to get addresses.");
      return;
    }
    try {
      setStatus("Approving token...");
      const signer = await provider.getSigner();
      const tokenContract = new ethers.Contract(selected.address, erc20Abi, signer);
      const exchange = new ethers.Contract(deployment.exchange, exchangeAbi, signer);
      const decimals = await tokenContract.decimals();
      const parsedAmount = ethers.parseUnits(amount || "0", decimals);

      const approveTx = await tokenContract.approve(deployment.exchange, parsedAmount);
      await approveTx.wait();

      setStatus("Buying AirZAR...");
      const buyTx = await exchange.buy(selected.address, parsedAmount);
      await buyTx.wait();

      setStatus("Buy complete.");
      refreshBalances(account, selected);
    } catch (error) {
      setStatus(error?.shortMessage || error?.message || "Transaction failed.");
    }
  };

  const handleSell = async () => {
    if (!provider || !account || !selected) return;
    if (!hasDeployment) {
      setStatus("Deploy contracts first to get addresses.");
      return;
    }
    try {
      setStatus("Approving AirZAR...");
      const signer = await provider.getSigner();
      const airzar = new ethers.Contract(deployment.airzar, erc20Abi, signer);
      const exchange = new ethers.Contract(deployment.exchange, exchangeAbi, signer);
      const parsedAmount = ethers.parseUnits(amount || "0", 18);

      const approveTx = await airzar.approve(deployment.exchange, parsedAmount);
      await approveTx.wait();

      setStatus("Selling AirZAR...");
      const sellTx = await exchange.sell(selected.address, parsedAmount);
      await sellTx.wait();

      setStatus("Sell complete.");
      refreshBalances(account, selected);
    } catch (error) {
      setStatus(error?.shortMessage || error?.message || "Transaction failed.");
    }
  };

  const handleRampSession = async () => {
    try {
      setApiStatus("Creating ramp session...");
      const response = await fetch(`${apiBase}/api/ramp/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: apiAmount || "0",
          currency: "ZAR",
          asset: selected?.symbol || "USDC"
        })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || "Failed to create ramp session.");
      }
      setRampSession(data);
      setApiStatus("Ramp session ready.");
    } catch (error) {
      setApiStatus(error?.message || "Ramp session failed.");
    }
  };

  const handleApiBuy = async () => {
    if (!selected) return;
    try {
      setApiStatus("Submitting web2 buy...");
      const response = await fetch(`${apiBase}/api/bridge/buy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tokenAddress: selected.address,
          amount: apiAmount || "0"
        })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || "Web2 buy failed.");
      }
      setApiStatus(`Buy submitted: ${data.buyTxHash}`);
    } catch (error) {
      setApiStatus(error?.message || "Web2 buy failed.");
    }
  };

  const handleApiSell = async () => {
    if (!selected) return;
    try {
      setApiStatus("Submitting web2 sell...");
      const response = await fetch(`${apiBase}/api/bridge/sell`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tokenAddress: selected.address,
          airzarAmount: apiAmount || "0"
        })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || "Web2 sell failed.");
      }
      setApiStatus(`Sell submitted: ${data.sellTxHash}`);
    } catch (error) {
      setApiStatus(error?.message || "Web2 sell failed.");
    }
  };

  const handleApiBalances = async () => {
    if (!selected) return;
    try {
      setApiStatus("Fetching bridge balances...");
      const response = await fetch(`${apiBase}/api/bridge/balances?tokenAddress=${selected.address}`);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || "Balance fetch failed.");
      }
      setApiBalances(data);
      setApiStatus("Bridge balances updated.");
    } catch (error) {
      setApiStatus(error?.message || "Balance fetch failed.");
    }
  };

  return (
    <div className="app">
      <div className="header">
        <div>
          <div className="badge">AirZAR DeFi</div>
          <h1>Buy & Sell AirZAR</h1>
          <p className="muted">0.5% platform fee • AirZAR pegged to ZAR (oracle placeholder)</p>
        </div>
        <div className="wallet-buttons">
          <button onClick={() => connect("metamask")}>{account ? shortenAddress(account) : "Connect MetaMask"}</button>
          <button onClick={() => connect("bitget")}>Connect Bitget</button>
        </div>
      </div>

      <div className="card">
        <div className="row">
          <div>
            <strong>Selected token:</strong> {selected?.symbol}
          </div>
          <div className="muted">Token balance: {formatNumber(tokenBalance)}</div>
          <div className="muted">AirZAR balance: {formatNumber(airzarBalance)}</div>
        </div>

        <div className="action">
          <div className="input-group">
            {selectedLogo && (
              <img className="input-icon" src={selectedLogo} alt={`${selected?.symbol} logo`} />
            )}
            <input
              className="input-field"
              type="number"
              min="0"
              placeholder={selected ? `${selected.symbol} amount` : "Amount"}
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </div>
          <div className="row">
            <button onClick={handleBuy}>Buy AirZAR</button>
            <button onClick={handleSell}>Sell AirZAR</button>
          </div>
          {status && <div className="status">{status}</div>}
        </div>
      </div>

      <div style={{ height: 24 }} />

      <div className="card">
        <div className="row">
          <div>
            <strong>Unlimint Ramp + Web2 Bridge</strong>
            <div className="muted">Server-side test flow for ramp and exchange actions.</div>
          </div>
          <button onClick={handleApiBalances}>Refresh Bridge Balances</button>
        </div>

        <div className="action">
          <div className="input-group">
            <input
              className="input-field"
              type="number"
              min="0"
              placeholder="Amount for ramp/bridge"
              value={apiAmount}
              onChange={(event) => setApiAmount(event.target.value)}
            />
          </div>
          <div className="row">
            <button onClick={handleRampSession}>Create Ramp Session</button>
            <button onClick={handleApiBuy}>Web2 Buy</button>
            <button onClick={handleApiSell}>Web2 Sell</button>
          </div>
          {apiBalances && (
            <div className="muted">
              Bridge wallet: {shortenAddress(apiBalances.wallet)} • AirZAR: {formatNumber(apiBalances.airzar)} • {selected?.symbol}: {formatNumber(apiBalances.token)}
            </div>
          )}
          {rampSession?.checkoutUrl && (
            <a className="link" href={rampSession.checkoutUrl} target="_blank" rel="noreferrer">
              Open Unlimint checkout (stub)
            </a>
          )}
          {apiStatus && <div className="status">{apiStatus}</div>}
        </div>
      </div>

      <div className="grid">
        {tokens.map((token) => (
          <div className="token-card" key={token.symbol}>
            <div>
              <h4>{token.symbol}</h4>
              <div className="muted">{token.name}</div>
            </div>
            <button onClick={() => setSelected(token)}>Select</button>
          </div>
        ))}
      </div>

      {!hasDeployment && (
        <p className="muted" style={{ marginTop: 18 }}>
          Deploy the contracts to update addresses in frontend config.
        </p>
      )}
    </div>
  );
}
