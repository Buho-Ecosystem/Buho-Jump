<template>
  <!-- Buho-style transactions illustration — receipt with arrows -->
  <svg viewBox="0 0 120 100" fill="none" xmlns="http://www.w3.org/2000/svg" class="w-full h-full">
    <!-- Receipt shape -->
    <path d="M35 20H85V75L80 70L75 75L70 70L65 75L60 70L55 75L50 70L45 75L40 70L35 75V20Z"
      fill="var(--brand-primary)" opacity="0.08" stroke="var(--brand-primary)" stroke-width="1.2" opacity="0.25"/>
    <!-- Lines on receipt -->
    <line x1="45" y1="34" x2="75" y2="34" stroke="var(--brand-primary)" stroke-width="1.5" opacity="0.2" stroke-linecap="round"/>
    <line x1="45" y1="42" x2="68" y2="42" stroke="var(--brand-primary)" stroke-width="1.5" opacity="0.15" stroke-linecap="round"/>
    <line x1="45" y1="50" x2="72" y2="50" stroke="var(--brand-primary)" stroke-width="1.5" opacity="0.12" stroke-linecap="round"/>
    <line x1="45" y1="58" x2="65" y2="58" stroke="var(--brand-primary)" stroke-width="1.5" opacity="0.1" stroke-linecap="round"/>
    <!-- Arrows -->
    <path d="M20 45L28 38V52Z" fill="var(--brand-primary)" opacity="0.15"/>
    <path d="M100 55L92 48V62Z" fill="var(--brand-primary)" opacity="0.12"/>
  </svg>
</template>
