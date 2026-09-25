<script lang="ts">
/**
 * The 404 illustration (L-19): a small isometric scene — a tired robot slumped on an isometric
 * tile, smoke rising from its antenna, a magnifying glass dropped mid-search. Every colour is a
 * theme token (`var(--primary)`, `var(--muted)`, …; shading is the foreground at low opacity),
 * so the scene follows any theme and both modes without a second asset (L-2, §4.8). The subtle
 * motion (smoke drift, spark twinkle) stops under `prefers-reduced-motion`.
 */
let { class: className = '' }: { class?: string } = $props();
</script>

<svg
  viewBox="0 0 640 490"
  class={`illustration-404 h-auto w-full ${className}`}
  role="img"
  aria-labelledby="illustration-404-title"
  focusable="false"
>
  <title id="illustration-404-title">Robot pencari yang kelelahan di atas ubin isometrik</title>

  <!-- soft backdrop clouds -->
  <g fill="var(--muted)" opacity="0.9">
    <ellipse cx="110" cy="120" rx="120" ry="70" />
    <ellipse cx="540" cy="90" rx="130" ry="80" />
    <ellipse cx="80" cy="330" rx="90" ry="50" />
    <ellipse cx="575" cy="300" rx="95" ry="52" />
  </g>

  <!-- isometric tile: top face, then the two visible sides -->
  <g class="tile">
    <ellipse cx="322" cy="372" rx="240" ry="26" fill="var(--foreground)" opacity="0.08" />
    <polygon points="320,222 540,332 320,442 100,332" fill="var(--secondary)" />
    <polygon points="100,332 320,442 320,470 100,360" fill="var(--foreground)" opacity="0.16" />
    <polygon points="540,332 320,442 320,470 540,360" fill="var(--foreground)" opacity="0.26" />
    <!-- tile grid lines, faint -->
    <g stroke="var(--foreground)" stroke-width="1" opacity="0.08" fill="none">
      <line x1="210" y1="277" x2="430" y2="387" />
      <line x1="430" y1="277" x2="210" y2="387" />
    </g>
  </g>

  <!-- robot: legs & arms are tubes (a dark stroke under a lighter one), body, then the head -->
  <g class="robot">
    <!-- shadow -->
    <ellipse cx="365" cy="360" rx="120" ry="20" fill="var(--foreground)" opacity="0.12" />
    <!-- back leg -->
    <path d="M420 300c50-40 90-30 96 10" fill="none" stroke="var(--accent-foreground)" stroke-width="22" stroke-linecap="round" />
    <path d="M420 300c50-40 90-30 96 10" fill="none" stroke="var(--primary)" stroke-width="12" stroke-linecap="round" />
    <ellipse cx="520" cy="322" rx="26" ry="12" fill="var(--accent-foreground)" />
    <ellipse cx="520" cy="318" rx="26" ry="12" fill="var(--primary)" />
    <!-- front arm resting on the tile -->
    <path d="M330 300c-30 30-70 34-96 12" fill="none" stroke="var(--accent-foreground)" stroke-width="22" stroke-linecap="round" />
    <path d="M330 300c-30 30-70 34-96 12" fill="none" stroke="var(--primary)" stroke-width="12" stroke-linecap="round" />
    <circle cx="232" cy="312" r="13" fill="var(--accent-foreground)" />
    <circle cx="232" cy="310" r="10" fill="var(--muted)" />
    <!-- body -->
    <ellipse cx="380" cy="300" rx="70" ry="48" fill="var(--accent-foreground)" />
    <ellipse cx="380" cy="292" rx="70" ry="48" fill="var(--primary)" />
    <ellipse cx="360" cy="278" rx="30" ry="16" fill="var(--background)" opacity="0.22" />
    <circle cx="418" cy="300" r="9" fill="var(--foreground)" opacity="0.28" />
    <circle cx="418" cy="298" r="6" fill="var(--muted)" />
    <!-- front leg tucked under -->
    <path d="M360 330c-20 30-60 40-100 22" fill="none" stroke="var(--accent-foreground)" stroke-width="22" stroke-linecap="round" />
    <path d="M360 330c-20 30-60 40-100 22" fill="none" stroke="var(--primary)" stroke-width="12" stroke-linecap="round" />
    <!-- head, tilted -->
    <g transform="rotate(-18 318 226)">
      <rect x="258" y="176" width="120" height="100" rx="26" fill="var(--accent-foreground)" />
      <rect x="258" y="170" width="120" height="100" rx="26" fill="var(--primary)" />
      <rect x="272" y="188" width="92" height="62" rx="12" fill="var(--foreground)" />
      <rect x="272" y="188" width="92" height="20" rx="10" fill="var(--background)" opacity="0.08" />
      <!-- X X eyes -->
      <g stroke="var(--background)" stroke-width="6" stroke-linecap="round">
        <path d="M290 208l16 16M306 208l-16 16" />
        <path d="M330 208l16 16M346 208l-16 16" />
      </g>
      <!-- flat little mouth -->
      <path d="M306 238h24" stroke="var(--background)" stroke-width="5" stroke-linecap="round" opacity="0.7" />
      <!-- antenna -->
      <path d="M318 170v-26" stroke="var(--accent-foreground)" stroke-width="6" stroke-linecap="round" />
      <circle cx="318" cy="140" r="7" fill="var(--destructive)" />
    </g>
  </g>

  <!-- dropped magnifying glass, in front of the robot's hand -->
  <g class="glass">
    <ellipse cx="168" cy="372" rx="52" ry="16" fill="var(--foreground)" opacity="0.1" />
    <path d="M190 364l38 30" stroke="var(--accent-foreground)" stroke-width="14" stroke-linecap="round" />
    <path d="M190 364l38 30" stroke="var(--primary)" stroke-width="7" stroke-linecap="round" />
    <circle cx="160" cy="342" r="30" fill="var(--accent-foreground)" />
    <circle cx="160" cy="338" r="30" fill="var(--primary)" />
    <circle cx="160" cy="338" r="21" fill="var(--accent)" />
    <ellipse cx="152" cy="330" rx="8" ry="4" fill="var(--background)" opacity="0.85" />
  </g>

  <!-- smoke, drifting -->
  <g class="smoke" fill="var(--muted-foreground)" opacity="0.32">
    <ellipse cx="300" cy="112" rx="14" ry="10" />
    <ellipse cx="282" cy="86" rx="20" ry="14" />
    <ellipse cx="300" cy="56" rx="26" ry="18" />
    <ellipse cx="326" cy="26" rx="30" ry="20" />
  </g>

  <!-- sparks -->
  <g class="sparks" fill="var(--warning)">
    <path d="M232 214l16-6-8 10 12 2-22 12 6-10-12-2z" />
    <path d="M404 160l-8 16 12-2-6 14 22-22-12 2 6-12z" />
    <path d="M210 180l3 8 8 3-8 3-3 8-3-8-8-3 8-3z" />
    <path d="M444 236l3 8 8 3-8 3-3 8-3-8-8-3 8-3z" />
    <path d="M262 264l2 6 6 2-6 2-2 6-2-6-6-2 6-2z" />
    <path d="M490 282l2 6 6 2-6 2-2 6-2-6-6-2 6-2z" />
  </g>
</svg>

<style>
  .smoke {
    animation: drift 6s ease-in-out infinite;
    transform-origin: 300px 120px;
  }
  .sparks {
    animation: twinkle 1.8s ease-in-out infinite;
  }
  .sparks path:nth-child(even) {
    animation: twinkle 1.8s ease-in-out infinite 0.9s;
  }
  @keyframes drift {
    0%,
    100% {
      transform: translate(0, 0) scale(1);
      opacity: 0.32;
    }
    50% {
      transform: translate(6px, -8px) scale(1.04);
      opacity: 0.22;
    }
  }
  @keyframes twinkle {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.35;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .smoke,
    .sparks,
    .sparks path {
      animation: none;
    }
  }
</style>
