import { parseAbi } from 'viem'

// The zkLighter implementation is not source-verified; these signatures were
// recovered from the 4-byte selectors in its bytecode and cross-checked against
// real transactions (createOrder, burnShares, changePubKey, withdrawPendingBalance)
// and eth_call simulations (withdraw, cancelAllOrders, getPendingBalance).
export const lighterAbi = parseAbi([
  // Reduce-only market order; the price is a bound, not a limit to rest at.
  'function createOrder(uint48 _accountIndex, uint16 _marketIndex, uint48 _baseAmount, uint32 _price, uint8 _isAsk, uint8 _orderType)',
  'function cancelAllOrders(uint48 _accountIndex)',
  'function burnShares(uint48 _accountIndex, uint48 _publicPoolIndex, uint64 _shareAmount)',
  // routeType: 0 = perps collateral, 1 = spot balance. Amount in the asset's L2 decimals.
  'function withdraw(uint48 _accountIndex, uint16 _assetId, uint8 _routeType, uint64 _amount)',
  // Registers a Lighter API public key (40 bytes) at an API key slot.
  'function changePubKey(uint48 _accountIndex, uint8 _apiKeyIndex, bytes _pubKey)',
  // Funds Lighter could not push to the wallet sit here until claimed (L1 token decimals).
  'function getPendingBalance(address _owner, uint16 _assetId) view returns (uint128)',
  'function withdrawPendingBalance(address _owner, uint16 _assetId, uint128 _amount)',
  'function addressToAccountIndex(address _address) view returns (uint48)',
])

export const ORDER_TYPE_MARKET = 1
export const ORDER_SIDE_ASK = 1
export const ORDER_SIDE_BID = 0
