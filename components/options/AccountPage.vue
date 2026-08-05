<script setup>
/**
 * Account & Identity page — active identity card, account list,
 * backup key export, add/import accounts.
 */
import { ref, computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAccounts } from '../../composables/useAccounts.js'
import { useMessaging } from '../../composables/useMessaging.js'
import { useToast } from '../../composables/useToast.js'
import { truncateKey } from '../../lib/utils.js'
import { getAvatarColor } from '../../lib/avatarColor.js'
import IdentityWizard from '../IdentityWizard.vue'
import LightningLogin from '../LightningLogin.vue'
import BottomSheet from '../BottomSheet.vue'
import {
  Copy, Check, Trash2, User, Plus, Loader2, AlertTriangle,
  Eye, EyeOff, Download, ShieldAlert, KeyRound, Wallet,
} from 'lucide-vue-next'

const { t } = useI18n()
const { accounts, activeAccount, load, switchTo, remove, fetchProfile, publishProfile } = useAccounts()
const { send } = useMessaging()
const toast = useToast()

const showWizard = ref(false)
const copied = ref(false)
const profileData = ref(null)
const profileLoading = ref(false)
const showProfileEdit = ref(false)
const profileSaving = ref(false)
const profileError = ref('')
const profileForm = ref({})
const lightningLoginSites = ref([])
const clearingLoginActivity = ref(false)
const vaultError = ref('')

// Switch / delete state
const switchingAccount = ref(null)
const confirmSwitchId = ref(null)
const confirmingDelete = ref(null)
const deletingAccount = ref(false)

// Backup key state
const showBackup = ref(false)
const backupNsec = ref('')
const backupKind = ref('nsec')
const backupAccountId = ref('')
const backupChallenge = ref(null)
const backupAnswers = ref([])
const backupStage = ref('auth') // auth | show | verify | done
const backupPassword = ref('')
const backupError = ref('')
const backupLoading = ref(false)
const nsecRevealed = ref(false)
const nsecCopied = ref(false)
const nsecDownloaded = ref(false)

const displayName = computed(() => {
  return profileData.value?.display_name || profileData.value?.name || activeAccount.value?.name || '?'
})

onMounted(async () => {
  try {
    await load()
  } catch (error) {
    vaultError.value = error.message === 'errors.VAULT_INTEGRITY'
      ? t('errors.VAULT_INTEGRITY')
      : (error.message || t('common.error'))
    return
  }
  if (activeAccount.value?.pubkey) {
    profileLoading.value = true
    try {
      profileData.value = await fetchProfile(activeAccount.value.pubkey)
    } catch { profileData.value = null }
    finally { profileLoading.value = false }
  }
  await loadLightningLoginSites()
})

watch(() => activeAccount.value?.pubkey, async (pk) => {
  if (!pk) { profileData.value = null; await loadLightningLoginSites(); return }
  profileLoading.value = true
  try { profileData.value = await fetchProfile(pk) }
  catch { profileData.value = null }
  finally { profileLoading.value = false }
  await loadLightningLoginSites()
})

async function loadLightningLoginSites() {
  if (!activeAccount.value) { lightningLoginSites.value = []; return }
  try { lightningLoginSites.value = await send('GET_LIGHTNING_LOGIN_SITES') || [] }
  catch { lightningLoginSites.value = [] }
}

function openProfileEdit() {
  const profile = profileData.value || {}
  profileForm.value = {
    name: profile.name || activeAccount.value?.name || '',
    display_name: profile.display_name || '',
    about: profile.about || '',
    picture: profile.picture || '',
    banner: profile.banner || '',
    nip05: profile.nip05 || '',
    lud16: profile.lud16 || '',
  }
  profileError.value = ''
  showProfileEdit.value = true
}

async function saveProfile() {
  if (profileSaving.value) return
  profileSaving.value = true
  profileError.value = ''
  try {
    await publishProfile(profileForm.value)
    profileData.value = { ...profileForm.value }
    showProfileEdit.value = false
    await load()
    toast.success(t('wizard.profileSaved'))
  } catch (error) {
    profileError.value = error.message || t('common.error')
  } finally {
    profileSaving.value = false
  }
}

async function clearLightningLoginActivity() {
  clearingLoginActivity.value = true
  try {
    await send('CLEAR_LIGHTNING_LOGIN_SITES')
    lightningLoginSites.value = []
  } finally {
    clearingLoginActivity.value = false
  }
}

function formatLoginDate(timestamp) {
  if (!timestamp) return ''
  return new Date(timestamp * 1000).toLocaleDateString(undefined, { dateStyle: 'medium' })
}

function copyPubkey() {
  if (!activeAccount.value?.npub) return
  navigator.clipboard.writeText(activeAccount.value.npub)
  copied.value = true
  toast.success(t('common.copiedToClipboard'))
  setTimeout(() => (copied.value = false), 2500)
}

// ── Account switching ──
function requestSwitch(id) { confirmSwitchId.value = id }
function cancelSwitch() { confirmSwitchId.value = null }

const switchTargetAccount = computed(() =>
  accounts.value.find(a => a.id === confirmSwitchId.value)
)

async function confirmSwitch() {
  const id = confirmSwitchId.value
  if (!id || switchingAccount.value) return
  confirmSwitchId.value = null
  switchingAccount.value = id
  try {
    const acc = accounts.value.find(a => a.id === id)
    await switchTo(id)
    toast.success(t('toast.switchedTo', { name: acc?.name || t('tabs.account') }))
  } catch {
    toast.error(t('toast.failedSwitch'))
  } finally {
    switchingAccount.value = null
  }
}

// ── Account deletion ──
function requestDelete(id) { confirmingDelete.value = id }
function cancelDelete() { confirmingDelete.value = null }

async function confirmDelete() {
  if (!confirmingDelete.value || deletingAccount.value) return
  deletingAccount.value = true
  try {
    const acc = accounts.value.find(a => a.id === confirmingDelete.value)
    await remove(confirmingDelete.value)
    confirmingDelete.value = null
    toast.info(t('toast.accountRemoved', { name: acc?.name || t('tabs.account') }))
  } catch (error) {
    toast.error(error.message?.startsWith('errors.') ? t(error.message) : t('toast.failedRemove'))
  } finally {
    deletingAccount.value = false
  }
}

// ── Backup key ──
function openBackup() {
  showBackup.value = true
  backupStage.value = 'auth'
  backupPassword.value = ''
  backupError.value = ''
}

async function loadBackupKey() {
  if (!backupPassword.value || backupLoading.value) return
  backupLoading.value = true
  backupError.value = ''
  try {
    const result = await send('EXPORT_IDENTITY_BACKUP', backupPassword.value)
    if (result?.value) {
      backupNsec.value = result.value
      backupKind.value = result.kind || 'nsec'
      backupAccountId.value = result.accountId || activeAccount.value?.id || ''
      backupChallenge.value = result.challenge || null
      backupAnswers.value = Array(result.challenge?.type === 'words' ? result.challenge.indices.length : 1).fill('')
      backupStage.value = 'show'
      backupPassword.value = ''
      nsecRevealed.value = false
      nsecCopied.value = false
      nsecDownloaded.value = false
    }
  } catch (err) {
    const message = err.message || ''
    backupError.value = message.startsWith('TOO_MANY_ATTEMPTS:')
      ? t('lock.tooManyAttempts', { seconds: message.split(':')[1] })
      : message === 'errors.WRONG_PASSWORD' ? t('lock.wrongPassword') : (message || t('common.error'))
  } finally {
    backupLoading.value = false
  }
}

function beginBackupVerification() {
  nsecRevealed.value = false
  backupStage.value = 'verify'
  backupError.value = ''
}

async function verifyBackup() {
  if (!backupChallenge.value?.token || backupLoading.value) return
  backupLoading.value = true
  backupError.value = ''
  try {
    await send(
      'CONFIRM_IDENTITY_BACKUP',
      backupAccountId.value,
      backupChallenge.value.token,
      backupAnswers.value,
    )
    backupStage.value = 'done'
    await load()
  } catch {
    backupError.value = t('wizard.backupVerificationFailed')
  } finally {
    backupLoading.value = false
  }
}

function copyNsec() {
  if (!backupNsec.value) return
  navigator.clipboard.writeText(backupNsec.value)
  nsecCopied.value = true
  toast.success(t('common.copiedToClipboard'))
  setTimeout(() => (nsecCopied.value = false), 2500)
}

function downloadNsec() {
  if (!backupNsec.value) return
  const blob = new Blob([backupNsec.value], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = backupKind.value === 'mnemonic'
    ? `buho-identity-recovery-words-${Date.now()}.txt`
    : `buho-backup-key-${Date.now()}.txt`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
  nsecDownloaded.value = true
}

function closeBackup() {
  showBackup.value = false
  backupNsec.value = ''
  backupKind.value = 'nsec'
  backupAccountId.value = ''
  backupChallenge.value = null
  backupAnswers.value = []
  backupStage.value = 'auth'
  backupPassword.value = ''
  backupError.value = ''
  nsecRevealed.value = false
}

function onWizardComplete() {
  showWizard.value = false
  load().then(loadLightningLoginSites)
  toast.success(t('toast.accountReady'))
}
</script>

<template>
  <div class="space-y-5">
    <!-- Header -->
    <div>
      <h1 class="text-lg font-extrabold">{{ t('options.account') }}</h1>
      <p class="text-xs text-text-muted mt-0.5">{{ t('options.accountDesc') }}</p>
    </div>

    <div v-if="vaultError" class="max-w-lg rounded-2xl border border-error/25 bg-error/10 p-5 flex items-start gap-3">
      <ShieldAlert class="w-5 h-5 text-error shrink-0 mt-0.5" />
      <div>
        <p class="text-sm font-bold text-error">{{ t('account.vaultProblemTitle') }}</p>
        <p class="text-xs text-text-secondary mt-1 leading-relaxed">{{ vaultError }}</p>
        <p class="text-[10px] text-text-muted mt-2">{{ t('account.vaultProblemHint') }}</p>
      </div>
    </div>

    <!-- Wizard overlay -->
    <div v-else-if="showWizard" class="max-w-md">
      <IdentityWizard @complete="onWizardComplete" @cancel="showWizard = false" />
    </div>

    <template v-else>
      <!-- Active account card -->
      <div v-if="activeAccount" class="bg-surface-card rounded-3xl border border-border shadow-sm overflow-hidden max-w-lg">
        <!-- Banner -->
        <div class="relative">
          <div v-if="profileData?.banner" class="h-24 overflow-hidden">
            <img :src="profileData.banner" alt="" class="w-full h-full object-cover" @error="profileData.banner = null" />
          </div>
          <div v-else class="h-20 bg-gradient-to-br from-brand/15 via-brand/5 to-transparent" />

          <!-- Avatar -->
          <div class="absolute -bottom-6 left-5">
            <div class="w-14 h-14 rounded-full border-3 border-surface-card overflow-hidden shadow-sm"
              :class="profileData?.picture ? '' : 'bg-brand flex items-center justify-center'">
              <img v-if="profileData?.picture" :src="profileData.picture" alt="" class="w-full h-full object-cover" />
              <div v-else-if="profileLoading" class="w-full h-full skeleton-shimmer" />
              <span v-else class="text-surface-base text-base font-bold">{{ displayName[0]?.toUpperCase() }}</span>
            </div>
          </div>

          <!-- Mode badge -->
          <span class="absolute top-3 right-3 flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border backdrop-blur-sm"
            :class="activeAccount.mode === 'local'
              ? 'bg-success/10 text-success border-success/20'
              : 'bg-warning/10 text-warning border-warning/20'">
            <span class="w-1.5 h-1.5 rounded-full" :class="activeAccount.mode === 'local' ? 'bg-success' : 'bg-warning'" />
            {{ activeAccount.mode === 'local' ? t('account.onThisDevice') : t('account.externalSigner') }}
          </span>
        </div>

        <!-- Info -->
        <div class="px-5 pt-9 pb-4 space-y-4">
          <div>
            <div class="flex items-center gap-2">
              <span class="font-bold text-base">{{ displayName }}</span>
              <span v-if="profileData?.nip05" class="text-[10px] text-brand font-medium truncate">{{ profileData.nip05 }}</span>
              <button v-if="activeAccount.mode === 'local'" @click="openProfileEdit"
                class="ml-auto text-[10px] text-text-muted hover:text-brand font-semibold">
                {{ t('account.editProfile') }}
              </button>
            </div>
            <p v-if="profileData?.about" class="text-xs text-text-muted mt-1 leading-relaxed line-clamp-3">{{ profileData.about }}</p>
          </div>

          <!-- Identity model: human-readable, with the exact derivation path available. -->
          <div class="grid grid-cols-2 gap-2">
            <div class="bg-surface-base border border-border rounded-2xl p-3">
              <p class="text-[9px] uppercase tracking-wide text-text-muted font-semibold">{{ t('account.identityType') }}</p>
              <p class="text-[11px] font-semibold mt-1">
                {{ activeAccount.capabilities?.seedBacked ? t('account.recoveryIdentity') : activeAccount.mode === 'nip46' ? t('account.remoteIdentity') : t('account.singleKeyIdentity') }}
              </p>
              <p class="text-[9px] text-text-muted mt-1">
                {{ activeAccount.capabilities?.seedBacked ? t('account.recoveryIdentityHint') : t('account.singleKeyIdentityHint') }}
              </p>
            </div>
            <div class="bg-surface-base border border-border rounded-2xl p-3">
              <p class="text-[9px] uppercase tracking-wide text-text-muted font-semibold">{{ t('account.recoveryStatus') }}</p>
              <p class="text-[11px] font-semibold mt-1"
                :class="activeAccount.identityBackupConfirmed ? 'text-success' : 'text-warning'">
                {{ activeAccount.identityBackupConfirmed ? t('account.backupVerified') : activeAccount.mode === 'nip46' ? t('account.heldBySigner') : t('account.backupNeeded') }}
              </p>
              <p v-if="activeAccount.keyOrigin?.path" class="text-[9px] text-text-muted font-mono mt-1 break-all">
                {{ activeAccount.keyOrigin.path }}
              </p>
            </div>
          </div>

          <!-- Pubkey -->
          <div v-if="activeAccount.npub" class="flex items-center gap-2">
            <code class="flex-1 text-[11px] bg-surface-base px-3 py-2 rounded-lg font-mono text-text-muted truncate">
              {{ truncateKey(activeAccount.npub, 16, 8) }}
            </code>
            <button @click="copyPubkey" :aria-label="t('common.copy')" class="p-2 rounded-lg hover:bg-surface-elevated transition-all duration-200 shrink-0">
              <Check v-if="copied" class="w-4 h-4 text-success" />
              <Copy v-else class="w-4 h-4 text-text-muted" />
            </button>
          </div>

          <!-- Profile metadata pills -->
          <div v-if="profileData?.lud16 || profileData?.lud19 || (profileLoading && !profileData)" class="flex items-center gap-2 flex-wrap">
            <div v-if="profileData?.lud16" class="flex items-center gap-1 text-[10px] px-2.5 py-1 rounded-full bg-warning/8 text-warning border border-warning/15 font-medium">
              <Wallet class="w-3 h-3" />
              <span class="truncate max-w-[220px]">{{ profileData.lud16 }}</span>
            </div>
            <div v-else-if="profileData?.lud19" class="flex items-center gap-1 text-[10px] px-2.5 py-1 rounded-full bg-warning/8 text-warning border border-warning/15 font-medium">
              <Wallet class="w-3 h-3" />
              <span>LNURL set</span>
            </div>
            <div v-if="profileLoading && !profileData" class="skeleton-shimmer h-5 w-28 rounded-full" />
          </div>

          <!-- Backup key button (local accounts only) -->
          <button
            v-if="activeAccount.mode === 'local'"
            @click="openBackup"
            class="w-full flex items-center gap-3 px-4 py-3 bg-surface-base rounded-3xl border border-border hover:border-warning/30 transition-all duration-200 text-left group"
          >
            <div class="w-10 h-10 rounded-[10px] bg-warning/10 flex items-center justify-center shrink-0">
              <KeyRound class="w-4 h-4 text-warning" />
            </div>
            <div class="flex-1 min-w-0">
              <span class="text-sm font-medium block">{{ t('options.exportKey') }}</span>
              <span class="text-[10px] text-text-muted">{{ t('options.exportKeyDesc') }}</span>
            </div>
          </button>
        </div>
      </div>

      <!-- Profile editing uses the same publish flow as onboarding. -->
      <form v-if="showProfileEdit" @submit.prevent="saveProfile"
        class="max-w-lg bg-surface-card rounded-3xl border border-border shadow-sm p-5 space-y-3">
        <div>
          <h3 class="text-sm font-bold">{{ t('account.editProfile') }}</h3>
          <p class="text-[10px] text-text-muted mt-1">{{ t('account.editProfileHint') }}</p>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input v-model="profileForm.name" maxlength="80" :placeholder="t('account.profileName')" class="bg-surface-base border border-border rounded-xl px-3 py-2.5 text-xs outline-none focus:border-brand" />
          <input v-model="profileForm.display_name" maxlength="80" :placeholder="t('account.profileDisplayName')" class="bg-surface-base border border-border rounded-xl px-3 py-2.5 text-xs outline-none focus:border-brand" />
        </div>
        <textarea v-model="profileForm.about" maxlength="1000" rows="3" :placeholder="t('account.profileAbout')" class="w-full bg-surface-base border border-border rounded-xl px-3 py-2.5 text-xs outline-none focus:border-brand resize-none" />
        <input v-model="profileForm.picture" inputmode="url" :placeholder="t('account.profilePicture')" class="w-full bg-surface-base border border-border rounded-xl px-3 py-2.5 text-xs outline-none focus:border-brand" />
        <input v-model="profileForm.banner" inputmode="url" :placeholder="t('account.profileBanner')" class="w-full bg-surface-base border border-border rounded-xl px-3 py-2.5 text-xs outline-none focus:border-brand" />
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input v-model="profileForm.nip05" autocapitalize="none" spellcheck="false" :placeholder="t('account.profileNip05')" class="bg-surface-base border border-border rounded-xl px-3 py-2.5 text-xs outline-none focus:border-brand" />
          <input v-model="profileForm.lud16" autocapitalize="none" spellcheck="false" :placeholder="t('account.profileLightning')" class="bg-surface-base border border-border rounded-xl px-3 py-2.5 text-xs outline-none focus:border-brand" />
        </div>
        <p v-if="profileError" class="text-[10px] text-error">{{ profileError }}</p>
        <div class="grid grid-cols-2 gap-2">
          <button type="button" @click="showProfileEdit = false" class="py-2.5 text-xs rounded-2xl bg-surface-elevated font-semibold">{{ t('common.cancel') }}</button>
          <button type="submit" :disabled="profileSaving" class="py-2.5 text-xs rounded-2xl bg-brand text-surface-base font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50">
            <Loader2 v-if="profileSaving" class="w-3.5 h-3.5 animate-spin" /> {{ t('common.save') }}
          </button>
        </div>
      </form>

      <LightningLogin v-if="activeAccount" :account="activeAccount" class="max-w-lg" @completed="loadLightningLoginSites" />

      <div v-if="activeAccount?.capabilities?.lightningLogin?.supported && lightningLoginSites.length"
        class="max-w-lg bg-surface-card rounded-3xl border border-border shadow-sm p-4 space-y-3">
        <div class="flex items-start justify-between gap-3">
          <div>
            <h3 class="text-xs font-bold">{{ t('lightningLogin.activityTitle') }}</h3>
            <p class="text-[10px] text-text-muted mt-1">{{ t('lightningLogin.activityHint') }}</p>
          </div>
          <button @click="clearLightningLoginActivity" :disabled="clearingLoginActivity"
            class="text-[10px] text-text-muted hover:text-error font-semibold disabled:opacity-50">
            {{ t('lightningLogin.clearActivity') }}
          </button>
        </div>
        <div class="divide-y divide-border">
          <div v-for="site in lightningLoginSites.slice(0, 5)" :key="site.origin" class="flex items-center justify-between gap-3 py-2.5">
            <div class="min-w-0">
              <p class="text-[11px] font-semibold truncate">{{ site.origin }}</p>
              <p class="text-[9px] text-text-muted">{{ t('lightningLogin.loginCount', { count: site.loginCount }) }}</p>
            </div>
            <span class="text-[9px] text-text-muted shrink-0">{{ formatLoginDate(site.lastLoginAt) }}</span>
          </div>
        </div>
      </div>

      <!-- Empty state (no accounts) -->
      <div v-if="!activeAccount" class="bg-surface-card rounded-3xl border border-border shadow-sm p-10 text-center max-w-lg">
        <img src="/Onboarding%20wizard/storyset-Papermap-bro.svg" alt="" class="w-44 h-32 object-contain mx-auto -mt-4 mb-1" />
        <p class="text-sm font-medium text-text-secondary">{{ t('account.noAccountTitle') }}</p>
        <p class="text-xs text-text-muted mt-1">{{ t('account.noAccountDesc') }}</p>
      </div>

      <!-- Backup key modal -->
      <div v-if="showBackup" class="max-w-lg bg-surface-card rounded-3xl border border-border shadow-sm overflow-hidden">
        <div class="bg-warning/8 px-5 py-3 flex items-center gap-2.5 border-b border-warning/15">
          <ShieldAlert class="w-4 h-4 text-warning shrink-0" />
          <span class="text-xs text-warning font-semibold">{{ t('wizard.backupWarning') }}</span>
        </div>

        <div class="p-5 space-y-4">
          <div>
            <h3 class="text-sm font-bold">{{ backupStage === 'auth' ? t('wizard.backupReauthTitle') : backupKind === 'mnemonic' ? t('wizard.backupMnemonicTitle') : t('wizard.backupTitle') }}</h3>
            <p class="text-[11px] text-text-muted mt-1 leading-relaxed">
              {{ backupStage === 'auth' ? t('wizard.backupReauthDesc') : backupStage === 'verify' ? t('wizard.backupVerifyDesc') : backupKind === 'mnemonic' ? t('wizard.backupMnemonicDesc') : t('wizard.backupDesc') }}
            </p>
          </div>

          <!-- Re-authentication gate -->
          <form v-if="backupStage === 'auth'" class="space-y-3" @submit.prevent="loadBackupKey">
            <input v-model="backupPassword" type="password" autocomplete="current-password" autofocus
              :placeholder="t('lock.enterPassword')"
              class="w-full bg-surface-base border border-border rounded-xl px-3.5 py-3 text-sm outline-none focus:border-brand" />
            <p v-if="backupError" class="text-[11px] text-error">{{ backupError }}</p>
            <div class="grid grid-cols-2 gap-2">
              <button type="button" @click="closeBackup" class="py-2.5 text-xs rounded-2xl bg-surface-elevated text-text-secondary font-semibold">{{ t('common.cancel') }}</button>
              <button type="submit" :disabled="!backupPassword || backupLoading"
                class="py-2.5 text-xs rounded-2xl bg-brand text-surface-base font-semibold disabled:opacity-40 flex items-center justify-center gap-1.5">
                <Loader2 v-if="backupLoading" class="w-3.5 h-3.5 animate-spin" />
                {{ t('wizard.revealBackup') }}
              </button>
            </div>
          </form>

          <!-- Key display -->
          <div v-else-if="backupStage === 'show'" class="relative bg-surface-base rounded-3xl px-4 py-3 border border-border">
            <div v-if="backupKind === 'mnemonic'" class="grid grid-cols-3 gap-2"
              :class="nsecRevealed ? '' : 'blur-[6px] select-none pointer-events-none'">
              <div v-for="(word, index) in backupNsec.split(' ')" :key="index" class="flex items-center gap-1.5 bg-surface-card rounded-lg px-2 py-2 border border-border">
                <span class="text-[9px] text-text-muted font-mono w-3 text-right">{{ index + 1 }}</span>
                <span class="text-[11px] text-text-secondary font-medium">{{ word }}</span>
              </div>
            </div>
            <div v-else class="font-mono text-xs break-all leading-relaxed select-all"
              :class="nsecRevealed ? 'text-text-secondary' : 'blur-[6px] text-text-muted select-none pointer-events-none'">
              {{ backupNsec }}
            </div>
            <button v-if="!nsecRevealed" @click="nsecRevealed = true"
              class="absolute inset-0 flex items-center justify-center gap-2 bg-surface-base/60 rounded-3xl cursor-pointer group">
              <Eye class="w-4 h-4 text-text-muted group-hover:text-brand transition-all duration-200" />
              <span class="text-xs text-text-muted group-hover:text-brand transition-all duration-200 font-medium">{{ t('wizard.clickToReveal') }}</span>
            </button>
          </div>

          <!-- Actions -->
          <div v-if="backupStage === 'show'" class="grid grid-cols-2 gap-2">
            <button @click="copyNsec"
              class="flex items-center justify-center gap-1.5 py-2.5 text-xs rounded-2xl font-semibold transition-all duration-200"
              :class="nsecCopied ? 'bg-success/10 text-success' : 'bg-surface-base border border-border hover:border-brand/30 text-text-secondary'">
              <Check v-if="nsecCopied" class="w-3.5 h-3.5" />
              <Copy v-else class="w-3.5 h-3.5" />
              {{ nsecCopied ? t('common.copied') : t('wizard.copyKey') }}
            </button>
            <button @click="downloadNsec"
              class="flex items-center justify-center gap-1.5 py-2.5 text-xs rounded-2xl font-semibold transition-all duration-200"
              :class="nsecDownloaded ? 'bg-success/10 text-success' : 'bg-surface-base border border-border hover:border-brand/30 text-text-secondary'">
              <Check v-if="nsecDownloaded" class="w-3.5 h-3.5" />
              <Download v-else class="w-3.5 h-3.5" />
              {{ nsecDownloaded ? t('common.saved') : t('wizard.downloadFile') }}
            </button>
          </div>

          <button v-if="backupStage === 'show'" @click="beginBackupVerification"
            class="w-full py-2.5 text-xs rounded-2xl bg-brand text-surface-base hover:bg-brand-hover font-semibold btn-primary">
            {{ t('wizard.verifyBackup') }}
          </button>

          <!-- Backup proof -->
          <form v-else-if="backupStage === 'verify'" class="space-y-3" @submit.prevent="verifyBackup">
            <div v-if="backupChallenge?.type === 'words'" class="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <label v-for="(wordIndex, index) in backupChallenge.indices" :key="wordIndex" class="space-y-1">
                <span class="text-[10px] font-semibold text-text-muted">{{ t('wizard.wordNumber', { number: wordIndex + 1 }) }}</span>
                <input v-model="backupAnswers[index]" autocomplete="off" autocapitalize="none" spellcheck="false"
                  class="w-full bg-surface-base border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-brand" />
              </label>
            </div>
            <label v-else class="space-y-1">
              <span class="text-[10px] font-semibold text-text-muted">{{ t('wizard.keyEnding', { count: backupChallenge?.length || 6 }) }}</span>
              <input v-model="backupAnswers[0]" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="6"
                class="w-full bg-surface-base border border-border rounded-xl px-3 py-2.5 text-sm font-mono outline-none focus:border-brand" />
            </label>
            <p v-if="backupError" class="text-[11px] text-error">{{ backupError }}</p>
            <div class="grid grid-cols-2 gap-2">
              <button type="button" @click="backupStage = 'show'; backupError = ''" class="py-2.5 text-xs rounded-2xl bg-surface-elevated text-text-secondary font-semibold">{{ t('wizard.showAgain') }}</button>
              <button type="submit" :disabled="backupAnswers.some(answer => !answer.trim()) || backupLoading"
                class="py-2.5 text-xs rounded-2xl bg-brand text-surface-base font-semibold disabled:opacity-40 flex items-center justify-center gap-1.5">
                <Loader2 v-if="backupLoading" class="w-3.5 h-3.5 animate-spin" />
                {{ t('wizard.confirmBackup') }}
              </button>
            </div>
          </form>

          <div v-else-if="backupStage === 'done'" class="text-center py-3 space-y-3">
            <div class="w-11 h-11 rounded-full bg-success/10 text-success flex items-center justify-center mx-auto"><Check class="w-5 h-5" /></div>
            <p class="text-xs font-semibold">{{ t('wizard.backupVerified') }}</p>
            <button @click="closeBackup" class="w-full py-2.5 text-xs rounded-2xl bg-brand text-surface-base font-semibold">{{ t('common.done') }}</button>
          </div>
        </div>
      </div>

      <!-- Other accounts -->
      <div v-if="accounts.length > 1" class="space-y-2 max-w-lg">
        <p class="text-[10px] uppercase tracking-widest text-text-muted font-semibold px-1">{{ t('account.switchAccount') }}</p>
        <button
          v-for="acc in accounts.filter(a => !a.isActive)"
          :key="acc.id"
          @click="requestSwitch(acc.id)"
          :disabled="!!switchingAccount"
          class="w-full flex items-center justify-between px-4 py-3 rounded-3xl hover:bg-surface-card border border-transparent hover:border-border transition-all duration-200 group disabled:opacity-60"
        >
          <div class="flex items-center gap-3">
            <div v-if="switchingAccount === acc.id"
              class="w-9 h-9 rounded-full bg-brand/10 flex items-center justify-center">
              <Loader2 class="w-4 h-4 text-brand animate-spin" />
            </div>
            <!-- Per-identity color makes same-letter identities distinguishable -->
            <div v-else class="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-white"
              :style="{ background: getAvatarColor(acc.pubkey) }">
              {{ (acc.name || '?')[0].toUpperCase() }}
            </div>
            <div class="text-left">
              <div>
                <span class="text-sm font-medium text-text-secondary">{{ acc.name }}</span>
                <span class="text-[10px] ml-2 px-1.5 py-0.5 rounded font-medium"
                  :class="acc.mode === 'nip46' ? 'bg-warning/10 text-warning' : 'bg-surface-elevated text-text-muted'">
                  {{ acc.mode === 'nip46' ? t('account.external') : t('account.local') }}
                </span>
              </div>
              <code v-if="acc.npub" class="block text-[9px] font-mono text-text-muted/70">{{ truncateKey(acc.npub, 10, 4) }}</code>
            </div>
          </div>
          <span
            v-if="!switchingAccount"
            @click.stop="requestDelete(acc.id)"
            class="p-1.5 rounded-md opacity-0 group-hover:opacity-100 hover:bg-error/10 transition-all cursor-pointer"
          >
            <Trash2 class="w-3.5 h-3.5 text-text-muted hover:text-error" />
          </span>
        </button>
      </div>

      <!-- Add account -->
      <button @click="showWizard = true"
        class="flex items-center justify-center gap-2 py-3 px-6 text-sm rounded-2xl border border-dashed border-border text-text-muted hover:text-brand hover:border-brand transition-all duration-200 max-w-lg">
        <Plus class="w-4 h-4" />
        {{ t('account.addAccount') }}
      </button>

      <!-- Switch confirmation -->
      <BottomSheet :open="!!confirmSwitchId" variant="brand" @close="cancelSwitch">
        <template #icon><AlertTriangle class="w-4 h-4 text-brand" /></template>
        <template #title>{{ t('account.switchConfirmTitle') }}</template>
        <template #description>
          <div v-if="switchTargetAccount" class="flex items-center gap-2 justify-center mb-1">
            <div class="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold text-white"
              :style="{ background: getAvatarColor(switchTargetAccount.pubkey) }">
              {{ (switchTargetAccount.name || '?')[0].toUpperCase() }}
            </div>
            <span class="font-semibold text-text-primary text-xs">{{ switchTargetAccount.name }}</span>
          </div>
          {{ t('account.switchConfirmDesc') }}
        </template>
        <template #actions>
          <button @click="cancelSwitch" :disabled="!!switchingAccount"
            class="py-2 text-xs rounded-2xl bg-surface-elevated text-text-secondary hover:bg-surface-hover transition-all duration-200 font-semibold disabled:opacity-60">
            {{ t('common.cancel') }}
          </button>
          <button @click="confirmSwitch" :disabled="!!switchingAccount"
            class="py-2 text-xs rounded-2xl bg-brand text-surface-base hover:bg-brand-hover transition-all duration-200 font-semibold flex items-center justify-center gap-1.5 disabled:opacity-60 btn-primary">
            <Loader2 v-if="switchingAccount" class="w-3 h-3 animate-spin" />
            {{ switchingAccount ? t('account.switching') : t('account.switchConfirmBtn') }}
          </button>
        </template>
      </BottomSheet>

      <!-- Delete confirmation -->
      <BottomSheet :open="!!confirmingDelete" variant="danger" @close="cancelDelete">
        <template #icon><AlertTriangle class="w-4 h-4 text-error" /></template>
        <template #title>{{ t('account.deleteTitle') }}</template>
        <template #description>{{ accounts.find(a => a.id === confirmingDelete)?.mode === 'nip46' ? t('account.deleteDescRemote') : t('account.deleteDescLocal') }}</template>
        <template #actions>
          <button @click="cancelDelete" :disabled="deletingAccount"
            class="py-2 text-xs rounded-2xl bg-surface-elevated text-text-secondary hover:bg-surface-hover transition-all duration-200 font-semibold disabled:opacity-60">
            {{ t('common.cancel') }}
          </button>
          <button @click="confirmDelete" :disabled="deletingAccount"
            class="py-2 text-xs rounded-2xl bg-error text-white hover:bg-error/90 transition-all duration-200 font-semibold flex items-center justify-center gap-1.5 disabled:opacity-60">
            <Loader2 v-if="deletingAccount" class="w-3 h-3 animate-spin" />
            {{ deletingAccount ? t('account.removing') : t('account.deleteForever') }}
          </button>
        </template>
      </BottomSheet>
    </template>
  </div>
</template>
