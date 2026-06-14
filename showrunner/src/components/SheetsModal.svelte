<script>
  import { onMount } from 'svelte';
  import { modalState, closeModal } from '../stores/modal.svelte.js';
  import { refreshBadge } from '../stores/sheets.svelte.js';
  import { api } from '../lib/api.js';

  let connected    = $state(false);
  let disconnected = $state(false);
  let authError    = $state(false);
  let email        = $state('');

  let sheets          = $state([]);
  let selectedSheetId = $state('');
  let selectedSheetName = $state('');
  let sheetsLoading   = $state(false);
  let sheetsError     = $state(false);

  let tabs        = $state([]);
  let selectedTab = $state('');
  let tabsLoading = $state(false);
  let tabsVisible = $state(false);

  let saveStatus = $state('');
  let saveError  = $state(false);
  let saving     = $state(false);

  let saveDisabled = $derived(!selectedSheetId || !selectedTab || saving);

  async function load() {
    connected    = false;
    disconnected = false;
    authError    = false;
    saveStatus   = '';
    saveError    = false;

    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('auth_error') === '1') authError = true;

    let status;
    try {
      status = await api.getAuthStatus();
    } catch {
      disconnected = true;
      return;
    }

    if (!status.connected) {
      disconnected = true;
      return;
    }

    email     = status.email ?? '';
    connected = true;

    let currentCfg = {};
    try { currentCfg = await api.getSheetsConfig(); } catch {}

    await loadSheets(currentCfg.spreadsheetId ?? null);
    if (currentCfg.spreadsheetId && currentCfg.sheetTabName) {
      await loadTabs(currentCfg.spreadsheetId, currentCfg.sheetTabName);
    }
  }

  async function loadSheets(selectedId) {
    sheets      = [];
    sheetsError = false;
    sheetsLoading = true;
    tabsVisible = false;
    tabs        = [];
    selectedTab = '';

    try {
      const files = await api.listSheets();
      sheets          = Array.isArray(files) ? files : [];
      selectedSheetId = selectedId ?? '';
      selectedSheetName = sheets.find(f => f.id === selectedSheetId)?.name ?? '';
    } catch {
      sheetsError = true;
    } finally {
      sheetsLoading = false;
    }
  }

  async function loadTabs(spreadsheetId, selectedTabName) {
    tabsVisible = true;
    tabsLoading = true;
    tabs        = [];
    try {
      tabs        = await api.getSheetTabs(spreadsheetId);
      selectedTab = selectedTabName ?? '';
    } catch {
      tabs = [];
    } finally {
      tabsLoading = false;
    }
  }

  async function handleSheetChange() {
    if (!selectedSheetId) {
      tabsVisible = false;
      tabs        = [];
      selectedTab = '';
      return;
    }
    selectedSheetName = sheets.find(f => f.id === selectedSheetId)?.name ?? '';
    await loadTabs(selectedSheetId, null);
  }

  async function save() {
    saving     = true;
    saveStatus = 'Saving…';
    saveError  = false;
    try {
      const res = await api.saveSheetsConfig({
        spreadsheetId:   selectedSheetId,
        spreadsheetName: selectedSheetName,
        sheetTabName:    selectedTab,
      });
      if (res && !res.error) {
        saveStatus = 'Saved!';
        await refreshBadge();
        setTimeout(() => { saveStatus = ''; }, 2500);
      } else {
        saveError  = true;
        saveStatus = 'Save failed.';
      }
    } catch {
      saveError  = true;
      saveStatus = 'Network error.';
    } finally {
      saving = false;
    }
  }

  async function disconnect() {
    if (!confirm('Disconnect your Google account? Show export will stop working until you reconnect.')) return;
    await api.deleteAuth();
    await refreshBadge();
    await load();
  }

  function handleOverlayClick(e) {
    if (e.target === e.currentTarget) closeModal();
  }

  function handleKeydown(e) {
    if (e.key === 'Escape') closeModal();
  }

  $effect(() => {
    if (modalState.open) load();
  });
</script>

<svelte:window onkeydown={handleKeydown} />

{#if modalState.open}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
  <div
    class="modal-overlay"
    role="dialog"
    aria-modal="true"
    aria-labelledby="modal-title"
    onclick={handleOverlayClick}
  >
    <div class="modal">
      <div class="modal-header">
        <h2 class="modal-title" id="modal-title">Google Sheets</h2>
        <button class="modal-close" onclick={closeModal} aria-label="Close">✕</button>
      </div>
      <div class="modal-body">

        {#if disconnected}
          <div>
            <p class="modal-desc">Connect your Google account to export show data to a spreadsheet after each performance.</p>
            <a href="/api/auth/google" class="btn btn-primary modal-connect-btn">Connect Google Account</a>
            {#if authError}
              <p class="modal-error">Authentication failed — please try again.</p>
            {/if}
          </div>
        {/if}

        {#if connected}
          <div>
            <div class="modal-account-row">
              <span class="modal-account-label">Connected as</span>
              <span class="modal-account-email">{email}</span>
              <button class="btn-link danger" onclick={disconnect}>Disconnect</button>
            </div>

            <div class="modal-field">
              <label class="modal-label" for="sheet-picker">Spreadsheet</label>
              {#if sheetsLoading}
                <select class="modal-select" disabled><option>— Loading… —</option></select>
              {:else if sheetsError}
                <select class="modal-select" disabled><option>— Auth error, reconnect —</option></select>
              {:else}
                <select
                  id="sheet-picker"
                  class="modal-select"
                  bind:value={selectedSheetId}
                  onchange={handleSheetChange}
                >
                  <option value="">— Select a spreadsheet —</option>
                  {#each sheets as f (f.id)}
                    <option value={f.id}>{f.name}</option>
                  {/each}
                </select>
              {/if}
            </div>

            {#if tabsVisible}
              <div class="modal-field">
                <label class="modal-label" for="tab-picker">Sheet tab</label>
                {#if tabsLoading}
                  <select class="modal-select" disabled><option>— Loading tabs… —</option></select>
                {:else}
                  <select id="tab-picker" class="modal-select" bind:value={selectedTab}>
                    <option value="">— Select tab —</option>
                    {#each tabs as tab (tab)}
                      <option value={tab}>{tab}</option>
                    {/each}
                  </select>
                {/if}
              </div>
            {/if}

            <div class="modal-actions">
              <button class="btn btn-primary" disabled={saveDisabled} onclick={save}>Save</button>
              {#if saveStatus}
                <span class="modal-save-status {saveError ? 'error' : ''}">{saveStatus}</span>
              {/if}
            </div>
          </div>
        {/if}

      </div>
    </div>
  </div>
{/if}
