import {
  SorobanRpc,
  TransactionBuilder,
  Networks,
  Contract,
  nativeToScVal,
  scValToNative,
  Address,
} from '@stellar/stellar-sdk'
import { signTx } from './wallets'

export const SOROBAN_RPC = 'https://soroban-testnet.stellar.org'
export const NETWORK_PASSPHRASE = Networks.TESTNET

// Filled in after deploy — replaced by the deploy script
export let CONTRACT_ID = import.meta.env.VITE_CONTRACT_ID || ''

export const rpc = new SorobanRpc.Server(SOROBAN_RPC, { allowHttp: false })

// ── Read-only call (simulate, no signature needed) ───────────────────────────

async function readContract(publicKey, fnName, ...args) {
  const account = await rpc.getAccount(publicKey)
  const contract = new Contract(CONTRACT_ID)
  const tx = new TransactionBuilder(account, {
    fee: '1000000',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(fnName, ...args))
    .setTimeout(30)
    .build()
  const sim = await rpc.simulateTransaction(tx)
  if (SorobanRpc.Api.isSimulationError(sim)) throw new Error(sim.error)
  return scValToNative(sim.result.retval)
}

// ── Write call (simulate → assemble → sign → send → poll) ───────────────────

async function writeContract(publicKey, fnName, ...args) {
  const account = await rpc.getAccount(publicKey)
  const contract = new Contract(CONTRACT_ID)
  const tx = new TransactionBuilder(account, {
    fee: '1000000',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(fnName, ...args))
    .setTimeout(30)
    .build()

  const sim = await rpc.simulateTransaction(tx)
  if (SorobanRpc.Api.isSimulationError(sim)) {
    const msg = sim.error || ''
    if (msg.includes('already voted') || msg.includes('duplicate')) {
      throw Object.assign(new Error('You have already voted.'), { code: 'ALREADY_VOTED' })
    }
    throw new Error(sim.error)
  }

  const assembled = SorobanRpc.assembleTransaction(tx, sim).build()
  const signedXdr = await signTx(assembled.toXDR())

  const result = await rpc.sendTransaction(
    TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE)
  )
  if (result.status === 'ERROR') throw new Error(result.errorResult?.toString() || 'Send failed')

  return pollTransaction(result.hash)
}

async function pollTransaction(hash) {
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 2000))
    const res = await rpc.getTransaction(hash)
    if (res.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) return { hash, res }
    if (res.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
      throw Object.assign(new Error('Transaction failed on-chain.'), { code: 'TX_FAILED', hash })
    }
  }
  throw Object.assign(new Error('Transaction timed out.'), { code: 'TX_TIMEOUT' })
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function fetchVotes(anyPublicKey) {
  const [yes, no] = await Promise.all([
    readContract(anyPublicKey, 'get_votes', nativeToScVal('yes', { type: 'symbol' })),
    readContract(anyPublicKey, 'get_votes', nativeToScVal('no', { type: 'symbol' })),
  ])
  return { yes: Number(yes), no: Number(no) }
}

export async function checkHasVoted(publicKey) {
  return readContract(publicKey, 'has_voted', Address.fromString(publicKey).toScVal())
}

export async function castVote(publicKey, option) {
  return writeContract(
    publicKey,
    'vote',
    Address.fromString(publicKey).toScVal(),
    nativeToScVal(option, { type: 'symbol' })
  )
}

// ── Event polling (Soroban ledger events) ────────────────────────────────────

export async function fetchVoteEvents() {
  try {
    const latest = await rpc.getLatestLedger()
    const startLedger = Math.max(1, latest.sequence - 4000)
    const events = await rpc.getEvents({
      startLedger,
      filters: [
        {
          type: 'contract',
          contractIds: [CONTRACT_ID],
          topics: [['AAAADwAAAAR2b3Rl']],   // base64 ScVal for Symbol("vote")
        },
      ],
      limit: 200,
    })
    return events.events || []
  } catch {
    return []
  }
}

// ── Error classifier ─────────────────────────────────────────────────────────

export function classifyError(err) {
  const msg = (err?.message || '').toLowerCase()
  const code = err?.code || ''

  if (code === 'ALREADY_VOTED') return { type: 'already_voted', message: 'You have already voted on this poll.' }
  if (msg.includes('not found') || msg.includes('no wallet') || msg.includes('extension not found')) {
    return { type: 'wallet_not_found', message: 'Wallet not found. Please install Freighter or another supported wallet.' }
  }
  if (msg.includes('rejected') || msg.includes('declined') || msg.includes('user denied') || msg.includes('closed the modal')) {
    return { type: 'user_rejected', message: 'Transaction rejected. You cancelled the signing request.' }
  }
  if (msg.includes('insufficient') || msg.includes('balance')) {
    return { type: 'insufficient_balance', message: 'Insufficient balance. You need XLM to cover the transaction fee.' }
  }
  if (msg.includes('timeout')) return { type: 'timeout', message: 'Transaction timed out. The network may be congested.' }
  return { type: 'unknown', message: err?.message || 'An unexpected error occurred.' }
}
