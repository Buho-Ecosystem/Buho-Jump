import { describe, expect, it } from 'vitest'
import { usePopupState } from '../composables/usePopupState.js'

describe('usePopupState', () => {
  it('resets wallet and chat state on tab switch', () => {
    const state = usePopupState()

    state.walletView.value = 'history'
    state.selectedTx.value = { id: 'tx' }
    state.showSendPanel.value = true
    state.chatView.value = 'thread'
    state.chatPubkey.value = 'pubkey'
    state.showPermissionsPopup.value = true

    state.resetForTabSwitch()

    expect(state.walletView.value).toBe('home')
    expect(state.selectedTx.value).toBeNull()
    expect(state.showSendPanel.value).toBe(false)
    expect(state.chatView.value).toBe('home')
    expect(state.chatPubkey.value).toBeNull()
    expect(state.showPermissionsPopup.value).toBe(false)
  })

  it('captures and restores the previous wallet view for tx details', () => {
    const state = usePopupState()
    state.walletView.value = 'history'

    state.showTxDetail({ id: 'tx-1' })
    expect(state.walletView.value).toBe('detail')

    state.closeTxDetail()
    expect(state.walletView.value).toBe('history')
    expect(state.selectedTx.value).toBeNull()
  })

  it('resets account-scoped overlays on account switch', () => {
    const state = usePopupState()

    state.showRelaySettings.value = true
    state.showNotificationSettings.value = true
    state.selectedSite.value = 'example.com'
    state.showSettings.value = true
    state.chatView.value = 'thread'

    state.resetForAccountSwitch()

    expect(state.showRelaySettings.value).toBe(false)
    expect(state.showNotificationSettings.value).toBe(false)
    expect(state.selectedSite.value).toBeNull()
    expect(state.showSettings.value).toBe(false)
    expect(state.chatView.value).toBe('home')
  })
})
