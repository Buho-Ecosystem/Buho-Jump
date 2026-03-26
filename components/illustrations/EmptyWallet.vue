<template>
  <!-- Buho-style wallet illustration — simple geometric owl + wallet -->
  <svg viewBox="0 0 120 100" fill="none" xmlns="http://www.w3.org/2000/svg" class="w-full h-full">
    <!-- Wallet body -->
    <rect x="25" y="35" width="70" height="45" rx="8" fill="var(--brand-primary)" opacity="0.1" stroke="var(--brand-primary)" stroke-width="1.5" opacity="0.3"/>
    <!-- Wallet flap -->
    <path d="M25 50C25 46 28 43 32 43H88C92 43 95 46 95 50" stroke="var(--brand-primary)" stroke-width="1.5" opacity="0.4"/>
    <!-- Lightning bolt -->
    <path d="M55 48L62 55H57L60 67L52 58H57L55 48Z" fill="var(--brand-primary)" opacity="0.6"/>
    <!-- Decorative circles -->
    <circle cx="80" cy="60" r="4" fill="var(--brand-primary)" opacity="0.15"/>
    <circle cx="38" cy="55" r="3" fill="var(--brand-primary)" opacity="0.1"/>
  </svg>
</template>
