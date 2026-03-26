<template>
  <!-- Buho-style chat illustration — speech bubbles -->
  <svg viewBox="0 0 120 100" fill="none" xmlns="http://www.w3.org/2000/svg" class="w-full h-full">
    <!-- Left bubble -->
    <rect x="15" y="25" width="50" height="28" rx="14" fill="var(--brand-primary)" opacity="0.1" stroke="var(--brand-primary)" stroke-width="1.2" opacity="0.25"/>
    <path d="M30 53L25 62L37 53" fill="var(--brand-primary)" opacity="0.1"/>
    <!-- Right bubble -->
    <rect x="50" y="50" width="55" height="24" rx="12" fill="var(--brand-primary)" opacity="0.08" stroke="var(--brand-primary)" stroke-width="1.2" opacity="0.2"/>
    <path d="M90 74L96 82L85 74" fill="var(--brand-primary)" opacity="0.08"/>
    <!-- Dots in left bubble -->
    <circle cx="32" cy="39" r="2.5" fill="var(--brand-primary)" opacity="0.25"/>
    <circle cx="40" cy="39" r="2.5" fill="var(--brand-primary)" opacity="0.2"/>
    <circle cx="48" cy="39" r="2.5" fill="var(--brand-primary)" opacity="0.15"/>
  </svg>
</template>
