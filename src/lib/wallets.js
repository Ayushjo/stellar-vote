import { StellarWalletsKit, Networks } from '@creit.tech/stellar-wallets-kit'
import { FreighterModule } from '@creit.tech/stellar-wallets-kit/modules/freighter'
import { xBullModule } from '@creit.tech/stellar-wallets-kit/modules/xbull'
import { LobstrModule } from '@creit.tech/stellar-wallets-kit/modules/lobstr'

export { Networks }
export const WALLET_NETWORK = Networks.TESTNET

let initialized = false

export function initKit() {
  if (initialized) return
  StellarWalletsKit.init({
    network: WALLET_NETWORK,
    modules: [new FreighterModule(), new xBullModule(), new LobstrModule()],
  })
  initialized = true
}

export async function connectWallet() {
  initKit()
  const { address } = await StellarWalletsKit.authModal({})
  return address
}

export async function disconnectWallet() {
  await StellarWalletsKit.disconnect()
}

export async function getConnectedAddress() {
  const { address } = await StellarWalletsKit.getAddress()
  return address
}

export async function signTx(xdr) {
  const { address } = await StellarWalletsKit.getAddress()
  const { signedTxXdr } = await StellarWalletsKit.signTransaction(xdr, {
    address,
    networkPassphrase: WALLET_NETWORK,
  })
  return signedTxXdr
}
