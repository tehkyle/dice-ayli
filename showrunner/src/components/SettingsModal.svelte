<script>
  import { modalState, closeModal } from '../stores/modal.svelte.js';
  import { refreshBadge } from '../stores/sheets.svelte.js';
  import { api } from '../lib/api.js';

  let tab = $state('sheets'); // 'sheets' | 'qlab'

  // ── Google Sheets tab ────────────────────────────────────────────────────
  let connected    = $state(false);
  let disconnected = $state(false);
  let authError    = $state(false);
  let email        = $state('');

  let sheets            = $state([]);
  let selectedSheetId   = $state('');
  let selectedSheetName = $state('');
  let sheetsLoading     = $state(false);
  let sheetsError       = $state(false);

  let tabsList    = $state([]);
  let selectedTab = $state('');
  let tabsLoading = $state(false);
  let tabsVisible = $state(false);

  let sheetsSaveStatus = $state('');
  let sheetsSaveError  = $state(false);
  let sheetsSaving     = $state(false);

  let sheetsSaveDisabled = $derived(!selectedSheetId || !selectedTab || sheetsSaving);

  async function loadSheetsTab() {
    connected    = false;
    disconnected = false;
    authError    = false;
    sheetsSaveStatus = '';
    sheetsSaveError  = false;

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
    sheets        = [];
    sheetsError   = false;
    sheetsLoading = true;
    tabsVisible   = false;
    tabsList      = [];
    selectedTab   = '';

    try {
      const files = await api.listSheets();
      sheets            = Array.isArray(files) ? files : [];
      selectedSheetId   = selectedId ?? '';
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
    tabsList    = [];
    try {
      tabsList    = await api.getSheetTabs(spreadsheetId);
      selectedTab = selectedTabName ?? '';
    } catch {
      tabsList = [];
    } finally {
      tabsLoading = false;
    }
  }

  async function handleSheetChange() {
    if (!selectedSheetId) {
      tabsVisible = false;
      tabsList    = [];
      selectedTab = '';
      return;
    }
    selectedSheetName = sheets.find(f => f.id === selectedSheetId)?.name ?? '';
    await loadTabs(selectedSheetId, null);
  }

  async function saveSheets() {
    sheetsSaving     = true;
    sheetsSaveStatus = 'Saving…';
    sheetsSaveError  = false;
    try {
      const res = await api.saveSheetsConfig({
        spreadsheetId:   selectedSheetId,
        spreadsheetName: selectedSheetName,
        sheetTabName:    selectedTab,
      });
      if (res && !res.error) {
        sheetsSaveStatus = 'Saved!';
        await refreshBadge();
        setTimeout(() => { sheetsSaveStatus = ''; }, 2500);
      } else {
        sheetsSaveError  = true;
        sheetsSaveStatus = 'Save failed.';
      }
    } catch {
      sheetsSaveError  = true;
      sheetsSaveStatus = 'Network error.';
    } finally {
      sheetsSaving = false;
    }
  }

  async function disconnectSheets() {
    if (!confirm('Disconnect your Google account? Show export will stop working until you reconnect.')) return;
    await api.deleteAuth();
    await refreshBadge();
    await loadSheetsTab();
  }

  // ── QLab tab ─────────────────────────────────────────────────────────────
  let qlabHost          = $state('');
  let qlabSendPort      = $state('');
  let qlabCuePort       = $state('');
  let qlabWorkspace = $state('');
  let qlabPasscode  = $state('');

  let qlabStatus = $state('');
  let qlabError  = $state(false);
  let qlabSaving = $state(false);

  async function loadQlabTab() {
    qlabStatus = '';
    qlabError  = false;
    try {
      const cfg = await api.getConfig();
      qlabHost          = cfg.qlabHost ?? '';
      qlabSendPort      = cfg.qlabSendPort ?? '';
      qlabCuePort       = cfg.qlabCuePort ?? '';
      qlabWorkspace     = cfg.qlabWorkspace ?? '';
      qlabPasscode      = cfg.qlabPasscode ?? '';
    } catch {}
  }

  async function saveQlab() {
    qlabSaving = true;
    qlabError  = false;
    qlabStatus = 'Saving…';
    try {
      await api.saveQlabConfig({
        qlabHost, qlabSendPort, qlabCuePort,
        qlabWorkspace, qlabPasscode,
      });
      qlabStatus = 'Reconnecting…';
      const res = await api.reconnectQLab();
      qlabError  = res?.status !== 'ok';
      qlabStatus = qlabError ? 'Saved — QLab unreachable' : 'Saved & connected';
    } catch {
      qlabError  = true;
      qlabStatus = 'Save failed.';
    } finally {
      qlabSaving = false;
    }
  }

  // ── Shared modal chrome ─────────────────────────────────────────────────
  function handleOverlayClick(e) {
    if (e.target === e.currentTarget) closeModal();
  }

  function handleKeydown(e) {
    if (e.key === 'Escape') closeModal();
  }

  $effect(() => {
    if (!modalState.open) return;
    if (tab === 'sheets') loadSheetsTab();
    else loadQlabTab();
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
        <h2 class="modal-title" id="modal-title">Settings</h2>
        <button class="modal-close" onclick={closeModal} aria-label="Close">✕</button>
      </div>

      <div class="modal-tabs">
        <button class="modal-tab {tab === 'sheets' ? 'active' : ''}" onclick={() => tab = 'sheets'}>Google Sheets</button>
        <button class="modal-tab {tab === 'qlab' ? 'active' : ''}" onclick={() => tab = 'qlab'}>QLab Connection</button>
      </div>

      <div class="modal-body">

        {#if tab === 'sheets'}

          {#if disconnected}
            <p class="modal-desc">Connect your Google account to export show data to a spreadsheet after each performance.</p>
            <a href="/api/auth/google" class="btn btn-primary modal-connect-btn">Connect Google Account</a>
            {#if authError}
              <p class="modal-error">Authentication failed — please try again.</p>
            {/if}
          {/if}

          {#if connected}
            <div class="modal-account-row">
              <span class="modal-account-label">Connected as</span>
              <span class="modal-account-email">{email}</span>
              <button class="btn-link danger" onclick={disconnectSheets}>Disconnect</button>
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
                    {#each tabsList as t (t)}
                      <option value={t}>{t}</option>
                    {/each}
                  </select>
                {/if}
              </div>
            {/if}
          {/if}

        {:else}

          <p class="modal-desc">Leave a field blank to use its default.</p>

          <div class="modal-field">
            <label class="modal-label" for="qlab-host">Host / IP</label>
            <input id="qlab-host" class="modal-input" type="text" placeholder="127.0.0.1" bind:value={qlabHost} />
          </div>
          <div class="modal-field">
            <label class="modal-label" for="qlab-send-port">Port</label>
            <input id="qlab-send-port" class="modal-input" type="number" placeholder="53000" bind:value={qlabSendPort} />
          </div>
          <div class="modal-field">
            <label class="modal-label" for="qlab-cue-port">Cue Port (must match QLab's Network Cue patch)</label>
            <input id="qlab-cue-port" class="modal-input" type="number" placeholder="53100" bind:value={qlabCuePort} />
          </div>
          <div class="modal-field">
            <label class="modal-label" for="qlab-ws">Workspace (name or ID)</label>
            <input id="qlab-ws" class="modal-input" type="text" bind:value={qlabWorkspace} />
          </div>
          <div class="modal-field">
            <label class="modal-label" for="qlab-passcode">Access Code</label>
            <input id="qlab-passcode" class="modal-input" type="text" bind:value={qlabPasscode} />
          </div>

        {/if}

      </div>

      <div class="modal-footer">
        {#if tab === 'sheets'}
          {#if connected}
            <button class="btn btn-primary" disabled={sheetsSaveDisabled} onclick={saveSheets}>Save</button>
            {#if sheetsSaveStatus}
              <span class="modal-save-status {sheetsSaveError ? 'error' : ''}">{sheetsSaveStatus}</span>
            {/if}
          {/if}
        {:else}
          <button class="btn btn-primary" disabled={qlabSaving} onclick={saveQlab}>Save</button>
          {#if qlabStatus}
            <span class="modal-save-status {qlabError ? 'error' : ''}">{qlabStatus}</span>
          {/if}
        {/if}
      </div>
    </div>
  </div>
{/if}
