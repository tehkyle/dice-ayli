const REPO = 'tehkyle/dice-ayli';

const btnDownload = document.getElementById('btn-download');
const dlVersion   = document.getElementById('dl-version');
const dlError     = document.getElementById('dl-error');

async function loadLatestRelease() {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
    });

    if (!res.ok) throw new Error(`GitHub API ${res.status}`);

    const release = await res.json();
    const dmg = release.assets.find(a => a.name.endsWith('.dmg'));

    if (!dmg) throw new Error('No .dmg asset found');

    dlVersion.textContent = release.tag_name;
    btnDownload.href = dmg.browser_download_url;
    btnDownload.removeAttribute('aria-disabled');
  } catch (err) {
    console.error('[download]', err.message);
    dlVersion.textContent = '';
    dlError.classList.remove('hidden');
    // Fall back to the releases page so the user can still download manually
    btnDownload.href = `https://github.com/${REPO}/releases/latest`;
    btnDownload.removeAttribute('aria-disabled');
  }
}

loadLatestRelease();
