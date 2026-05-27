const RELEASES_PAGE = 'https://github.com/tehkyle/dice-ayli/releases/latest';

const btnDownload  = document.getElementById('btn-download');
const dlVersion    = document.getElementById('dl-version');
const dlError      = document.getElementById('dl-error');
const btnQlab      = document.getElementById('btn-qlab');

async function loadLatestRelease() {
  try {
    const res = await fetch('/latest.json');
    if (!res.ok) throw new Error(`${res.status}`);
    const { version, url, qlabUrl } = await res.json();
    if (!url) throw new Error('no url');

    dlVersion.textContent = version;
    btnDownload.href = url;
    btnDownload.removeAttribute('aria-disabled');

    if (qlabUrl && btnQlab) {
      btnQlab.href = qlabUrl;
      btnQlab.removeAttribute('aria-disabled');
    }
  } catch (err) {
    console.error('[download]', err.message);
    dlVersion.textContent = '';
    dlError.classList.remove('hidden');
    btnDownload.href = RELEASES_PAGE;
    btnDownload.removeAttribute('aria-disabled');
  }
}

loadLatestRelease();
