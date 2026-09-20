<script setup>
import { useI18n } from 'vue-i18n'
import { ShieldAlert, Wallet as WalletIcon, KeyRound, Loader2, Trash2 } from 'lucide-vue-next'
import BottomSheet from './BottomSheet.vue'
import AccountIdentity from './AccountIdentity.vue'
defineProps({ account: { type: Object, default: null }, hasWallet: Boolean, busy: Boolean })
const emit = defineEmits(['close', 'confirm', 'backup'])
const { t } = useI18n()
</script>
<template>
            <BottomSheet :open="!!account" variant="danger" @close="!busy && emit('close')">
              <template #title>{{ t('account.deleteTitle') }}</template>
              <template #content>
                <div class="space-y-4 px-1">
                  <!-- Account being deleted -->
                  <AccountIdentity v-if="account" :account="account" />

                  <!-- Warning banner (local keys only) -->
                  <div v-if="account?.mode !== 'nip46'" class="flex gap-2.5 p-3 rounded-2xl bg-warning/8 border border-warning/15">
                    <ShieldAlert class="w-4 h-4 text-warning shrink-0 mt-0.5" />
                    <div>
                      <p class="text-xs font-semibold text-warning leading-tight">{{ t('account.deleteBackupWarning') }}</p>
                      <p class="text-xs text-text-muted leading-snug mt-1">{{ t('account.deleteBackupHint') }}</p>
                    </div>
                  </div>

                  <!-- Remote signer info -->
                  <div v-else class="flex gap-2.5 p-3 rounded-2xl bg-surface-base border border-border">
                    <ShieldAlert class="w-4 h-4 text-text-muted shrink-0 mt-0.5" />
                    <p class="text-xs text-text-muted leading-snug">{{ t('account.deleteDescRemote') }}</p>
                  </div>

                  <!-- This identity owns an eCash wallet -->
                  <div v-if="hasWallet" class="flex gap-2.5 p-3 rounded-2xl bg-error/8 border border-error/15">
                    <WalletIcon class="w-4 h-4 text-error shrink-0 mt-0.5" />
                    <p class="text-xs text-text-muted leading-snug">{{ t('account.deleteWalletWarning') }}</p>
                  </div>

                  <!-- Description -->
                  <p class="text-xs text-text-muted leading-relaxed text-center">
                    {{ account?.mode === 'nip46' ? t('account.deleteRemoteExplain') : t('account.deleteLocalExplain') }}
                  </p>

                  <!-- Action buttons -->
                  <div class="space-y-2">
                    <!-- Backup CTA (local keys only) -->
                    <button v-if="account?.mode !== 'nip46'"
                      @click="emit('backup')" :disabled="busy"
                      class="w-full flex items-center justify-center gap-2 py-2.5 text-xs rounded-2xl bg-surface-elevated hover:bg-surface-hover border border-border transition-all duration-200 font-semibold text-text-primary">
                      <KeyRound class="w-3.5 h-3.5" />
                      {{ t('account.deleteBackupCta') }}
                    </button>

                    <!-- Delete button -->
                    <button @click="emit('confirm')"
                      :disabled="busy"
                      class="w-full py-2.5 text-xs rounded-2xl bg-error text-white hover:bg-error/90 transition-all duration-200 font-semibold flex items-center justify-center gap-1.5 disabled:opacity-60">
                      <Loader2 v-if="busy" class="w-3 h-3 animate-spin" />
                      <Trash2 v-else class="w-3 h-3" />
                      {{ busy ? t('account.removing') : t('account.deleteForever') }}
                    </button>

                    <!-- Cancel -->
                    <button @click="emit('close')"
                      :disabled="busy"
                      class="w-full py-2 text-xs rounded-2xl text-text-muted hover:text-text-secondary transition-all duration-200 font-medium disabled:opacity-60">
                      {{ t('common.cancel') }}
                    </button>
                  </div>
                </div>
              </template>
            </BottomSheet>
</template>
