<script lang="ts">
  // Ring-Instrument wie im Mockup: Anteil 0..1, Text in der Mitte, Unterzeile.
  interface Props {
    value: number | null;
    label: string;
    sub?: string;
    color?: string;
    size?: number;
    stroke?: number;
    track?: string;
    ariaLabel?: string;
    pulse?: boolean;
    fontSize?: number;
  }
  let {
    value,
    label,
    sub = '',
    color = 'var(--accent)',
    size = 92,
    stroke = 8,
    track = 'var(--border)',
    ariaLabel = '',
    pulse = false,
    fontSize = 17,
  }: Props = $props();

  const radius = $derived((size - stroke) / 2 - 1);
  const circumference = $derived(2 * Math.PI * radius);
  const fraction = $derived(value == null || !Number.isFinite(value) ? 0 : Math.max(0, Math.min(1, value)));
  const dash = $derived(Math.max(fraction * circumference, fraction > 0 ? 1.5 : 0));
</script>

<svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={ariaLabel || label} class:pulse={pulse} style="flex: none">
  <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={track} stroke-width={stroke}></circle>
  <circle
    cx={size / 2}
    cy={size / 2}
    r={radius}
    fill="none"
    stroke={color}
    stroke-width={stroke}
    stroke-linecap="round"
    stroke-dasharray={`${dash} ${circumference}`}
    transform={`rotate(-90 ${size / 2} ${size / 2})`}
    style="transition: stroke-dasharray .6s ease"
  ></circle>
  <text x={size / 2} y={sub ? size / 2 - 3 : size / 2 + fontSize / 3} text-anchor="middle" fill="var(--text)" font-family="IBM Plex Mono, monospace" font-size={fontSize} font-weight="600">{label}</text>
  {#if sub}
    <text x={size / 2} y={size / 2 + 13} text-anchor="middle" fill="var(--muted)" font-family="Inter, sans-serif" font-size="10">{sub}</text>
  {/if}
</svg>
