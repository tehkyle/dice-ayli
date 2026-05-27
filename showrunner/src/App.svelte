<script>
  import { onMount } from 'svelte';
  import { nav } from './stores/screen.svelte.js';
  import { openModal } from './stores/modal.svelte.js';

  import HistoryScreen from './screens/HistoryScreen.svelte';
  import WelcomeScreen from './screens/WelcomeScreen.svelte';
  import SceneScreen from './screens/SceneScreen.svelte';
  import CastScreen from './screens/CastScreen.svelte';
  import ConfirmScreen from './screens/ConfirmScreen.svelte';
  import ProgressScreen from './screens/ProgressScreen.svelte';
  import SummaryScreen from './screens/SummaryScreen.svelte';
  import SheetsModal from './components/SheetsModal.svelte';

  onMount(() => {
    if (window.location.pathname.startsWith('/history')) {
      nav.screen = 'history';
      return;
    }
    const params = new URLSearchParams(window.location.search);
    if (params.get('sheets_config') === '1') {
      history.replaceState({}, '', window.location.pathname);
      openModal();
    }
  });
</script>

{#if nav.screen === 'history'}
  <HistoryScreen />
{:else if nav.screen === 'welcome'}
  <WelcomeScreen />
{:else if nav.screen === 'scenes'}
  <SceneScreen />
{:else if nav.screen === 'cast'}
  <CastScreen />
{:else if nav.screen === 'confirm'}
  <ConfirmScreen />
{:else if nav.screen === 'progress'}
  <ProgressScreen />
{:else if nav.screen === 'summary'}
  <SummaryScreen />
{:else}
  <div style="padding: 2rem; color: var(--text)">
    <p>Screen: {nav.screen}</p>
  </div>
{/if}

<SheetsModal />
