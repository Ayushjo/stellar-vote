import { useState, useEffect, useRef, useCallback } from 'react'
import { connectWallet, disconnectWallet, initKit } from './lib/wallets'
import {
  fetchVotes,
  checkHasVoted,
  castVote,
  fetchVoteEvents,
  classifyError,
  CONTRACT_ID,
} from './lib/contract'

const POLL_Q = 'Is Stellar the best blockchain for real-world payments?'

const TX_STATUS = { IDLE: 'idle', PENDING: 'pending', SUCCESS: 'success', FAILED: 'failed' }

export default function App() {
  const [address, setAddress] = useState('')
  const [votes, setVotes] = useState({ yes: 0, no: 0 })
  const [hasVoted, setHasVoted] = useState(false)
  const [events, setEvents] = useState([])
  const [txStatus, setTxStatus] = useState(TX_STATUS.IDLE)
  const [txHash, setTxHash] = useState('')
  const [error, setError] = useState(null)
  const [connecting, setConnecting] = useState(false)
  const [contractReady] = useState(!!CONTRACT_ID)
  const pollRef = useRef(null)

  useEffect(() => { initKit() }, [])

  const refreshVotes = useCallback(async (addr) => {
    if (!CONTRACT_ID || !addr) return
    try {
      const [v, voted, evts] = await Promise.all([
        fetchVotes(addr),
        checkHasVoted(addr),
        fetchVoteEvents(),
      ])
      setVotes(v)
      setHasVoted(voted)
      setEvents(evts.slice(-10).reverse())
    } catch {
      // non-fatal — silently skip
    }
  }, [])

  useEffect(() => {
    if (!address || !CONTRACT_ID) return
    refreshVotes(address)
    pollRef.current = setInterval(() => refreshVotes(address), 8000)
    return () => clearInterval(pollRef.current)
  }, [address, refreshVotes])

  async function handleConnect() {
    setConnecting(true)
    setError(null)
    try {
      const addr = await connectWallet()
      setAddress(addr)
    } catch (err) {
      setError(classifyError(err))
    } finally {
      setConnecting(false)
    }
  }

  async function handleDisconnect() {
    await disconnectWallet()
    setAddress('')
    setHasVoted(false)
    setTxStatus(TX_STATUS.IDLE)
    setTxHash('')
    setError(null)
    clearInterval(pollRef.current)
  }

  async function handleVote(option) {
    setError(null)
    setTxStatus(TX_STATUS.PENDING)
    setTxHash('')
    try {
      const { hash } = await castVote(address, option)
      setTxHash(hash)
      setTxStatus(TX_STATUS.SUCCESS)
      await refreshVotes(address)
    } catch (err) {
      const classified = classifyError(err)
      setError(classified)
      setTxStatus(TX_STATUS.FAILED)
      if (err.hash) setTxHash(err.hash)
    }
  }

  const total = votes.yes + votes.no
  const yesPct = total ? Math.round((votes.yes / total) * 100) : 50
  const noPct = total ? Math.round((votes.no / total) * 100) : 50

  function shortAddr(a) { return `${a.slice(0, 6)}…${a.slice(-4)}` }

  return (
    <div className="app">
      <header className="header">
        <div className="logo">
          <span className="logo-star">✦</span>
          <span>StellarVote</span>
        </div>
        {address && (
          <div className="header-right">
            <span className="addr-pill" title={address}>{shortAddr(address)}</span>
            <button className="btn btn-sm btn-outline" onClick={handleDisconnect}>Disconnect</button>
          </div>
        )}
      </header>

      <main className="main">
        {!contractReady && (
          <div className="banner banner-warn">
            <strong>⚠ Contract not deployed yet.</strong> Set <code>VITE_CONTRACT_ID</code> in <code>.env</code> after deploying.
          </div>
        )}

        {/* Wallet connect */}
        {!address && (
          <div className="card hero-card">
            <div className="hero-star">✦</div>
            <h1>StellarVote</h1>
            <p className="subtitle">A live on-chain poll powered by a Soroban smart contract on Stellar Testnet.</p>
            <button className="btn btn-primary btn-lg" onClick={handleConnect} disabled={connecting}>
              {connecting ? 'Connecting…' : 'Connect Wallet'}
            </button>
            <p className="hint">Supports Freighter, xBull, LOBSTR and more.</p>
            {error && <ErrorBox error={error} onDismiss={() => setError(null)} />}
          </div>
        )}

        {/* Poll */}
        {address && (
          <>
            <div className="card poll-card">
              <p className="poll-label">LIVE POLL</p>
              <h2 className="poll-question">{POLL_Q}</h2>

              <div className="results">
                <Bar label="Yes" pct={yesPct} count={votes.yes} color="var(--green)" />
                <Bar label="No"  pct={noPct}  count={votes.no}  color="var(--red)" />
              </div>

              <p className="total">{total} vote{total !== 1 ? 's' : ''} cast</p>

              {!hasVoted && txStatus !== TX_STATUS.SUCCESS && (
                <div className="vote-btns">
                  <button
                    className="btn btn-vote btn-yes"
                    onClick={() => handleVote('yes')}
                    disabled={txStatus === TX_STATUS.PENDING}
                  >
                    👍 Yes
                  </button>
                  <button
                    className="btn btn-vote btn-no"
                    onClick={() => handleVote('no')}
                    disabled={txStatus === TX_STATUS.PENDING}
                  >
                    👎 No
                  </button>
                </div>
              )}

              {hasVoted && txStatus !== TX_STATUS.PENDING && (
                <p className="voted-note">✓ You have already voted. Results update every 8 seconds.</p>
              )}
            </div>

            {/* Transaction status */}
            <TxStatus status={txStatus} hash={txHash} />

            {/* Errors */}
            {error && <ErrorBox error={error} onDismiss={() => setError(null)} />}

            {/* Event feed */}
            {events.length > 0 && (
              <div className="card events-card">
                <h3>Recent Votes</h3>
                <ul className="event-list">
                  {events.map((ev, i) => (
                    <li key={i} className="event-item">
                      <span className={`vote-badge ${ev.topic[1] === 'yes' ? 'badge-yes' : 'badge-no'}`}>
                        {ev.topic[1] === 'yes' ? '👍 Yes' : '👎 No'}
                      </span>
                      <span className="event-ledger">ledger {ev.ledger}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </main>

      <footer className="footer">
        {CONTRACT_ID && (
          <p>
            Contract:{' '}
            <a
              href={`https://stellar.expert/explorer/testnet/contract/${CONTRACT_ID}`}
              target="_blank"
              rel="noreferrer"
              className="contract-link"
            >
              {CONTRACT_ID.slice(0, 10)}…
            </a>
          </p>
        )}
        <p>Stellar Testnet · Soroban Smart Contract · StellarWalletsKit</p>
      </footer>
    </div>
  )
}

function Bar({ label, pct, count, color }) {
  return (
    <div className="bar-row">
      <span className="bar-label">{label}</span>
      <div className="bar-track">
        <div className="bar-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="bar-pct">{pct}%</span>
      <span className="bar-count">({count})</span>
    </div>
  )
}

function TxStatus({ status, hash }) {
  if (status === TX_STATUS.IDLE) return null
  return (
    <div className={`card tx-card ${status}`}>
      {status === TX_STATUS.PENDING && (
        <><span className="tx-spinner" /> <span>Submitting transaction…</span></>
      )}
      {status === TX_STATUS.SUCCESS && (
        <>
          <span className="tx-ok">✓</span>
          <span>Vote recorded on-chain!</span>
          {hash && (
            <a
              className="tx-hash-link"
              href={`https://stellar.expert/explorer/testnet/tx/${hash}`}
              target="_blank"
              rel="noreferrer"
            >
              {hash.slice(0, 12)}… (view on Explorer)
            </a>
          )}
        </>
      )}
      {status === TX_STATUS.FAILED && (
        <><span className="tx-fail">✗</span> <span>Transaction failed.</span></>
      )}
    </div>
  )
}

const ERROR_ICONS = {
  wallet_not_found: '🔌',
  user_rejected: '🚫',
  insufficient_balance: '💸',
  already_voted: 'ℹ',
  timeout: '⏱',
  unknown: '⚠',
}

function ErrorBox({ error, onDismiss }) {
  return (
    <div className="error-box">
      <span>{ERROR_ICONS[error.type] || '⚠'} {error.message}</span>
      <button className="btn-dismiss" onClick={onDismiss}>×</button>
    </div>
  )
}
