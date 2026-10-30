<script lang="ts">
  import { onMount } from 'svelte';

  import Footer from './components/Footer.svelte';
  import Header from './components/Header.svelte';
  import { lang } from './lib/i18n.svelte';
  import { handleLinkClick, matchRoute, route } from './lib/router.svelte';
  import { startStatsPolling } from './lib/stats.svelte';
  import Blocks from './pages/Blocks.svelte';
  import Explorer from './pages/Explorer.svelte';
  import ExplorerAddress from './pages/ExplorerAddress.svelte';
  import ExplorerBlock from './pages/ExplorerBlock.svelte';
  import ExplorerTx from './pages/ExplorerTx.svelte';
  import Home from './pages/Home.svelte';
  import MinerDashboard from './pages/MinerDashboard.svelte';
  import NotFound from './pages/NotFound.svelte';
  import PoolDashboard from './pages/PoolDashboard.svelte';
  import ShareCard from './pages/ShareCard.svelte';

  const routes: { pattern: string, component: any }[] = [
    { pattern: '/', component: Home },
    { pattern: '/pool', component: PoolDashboard },
    { pattern: '/blocks', component: Blocks },
    { pattern: '/d/:address', component: MinerDashboard },
    { pattern: '/explorer', component: Explorer },
    { pattern: '/explorer/:chain/block/:id', component: ExplorerBlock },
    { pattern: '/explorer/:chain/tx/:txid', component: ExplorerTx },
    { pattern: '/explorer/:chain/address/:address', component: ExplorerAddress },
    { pattern: '/share/:chain/:height', component: ShareCard },
  ];

  const matched = $derived.by(() => {
    for (const r of routes) {
      const params = matchRoute(r.pattern, route.path);
      if (params != null) {
        return { component: r.component, params, key: r.pattern + JSON.stringify(params) };
      }
    }
    return { component: NotFound, params: {}, key: '404' };
  });

  const isShare = $derived(route.path.startsWith('/share/'));

  onMount(() => {
    startStatsPolling();
    document.documentElement.lang = lang.current;
  });
</script>

<svelte:document onclick={handleLinkClick} />

{#if !isShare}
  <Header />
{/if}
{#key matched.key}
  <matched.component {...matched.params} />
{/key}
{#if !isShare}
  <Footer />
{/if}
