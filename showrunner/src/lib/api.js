const json = (method, path, body) => fetch(path, {
  method,
  cache: 'no-store',
  ...(body !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
}).then(r => r.json());

export const api = {
  getConfig:        ()          => json('GET',    '/api/config'),
  getShows:         ()          => json('GET',    '/api/shows'),
  getActiveShow:    ()          => json('GET',    '/api/shows/active'),
  getLatestShow:    ()          => json('GET',    '/api/shows/latest'),
  createShow:       ()          => json('POST',   '/api/shows', {}),
  deleteShow:       (id)        => fetch(`/api/shows/${id}`, { method: 'DELETE' }),
  clearAllShows:    ()          => fetch('/api/shows', { method: 'DELETE' }),
  endShow:          (id)        => fetch(`/api/shows/${id}/end`,    { method: 'POST' }),
  cancelShow:       (id)        => json('POST',   `/api/shows/${id}/cancel`),
  lockCast:         (id, body)  => json('POST',   `/api/shows/${id}/cast`, body),
  saveCast:         (id, cast)  => json('POST',   `/api/shows/${id}/cast`, { cast }),

  getQlabStatus:    ()          => json('GET',    '/api/qlab/status'),
  getPlayhead:      ()          => json('GET',    '/api/qlab/playhead'),
  getOscLog:        ()          => json('GET',    '/api/qlab/osc-log'),
  postGo:           ()          => json('POST',   '/api/qlab/go'),
  panicAll:         ()          => json('POST',   '/api/qlab/panic'),
  reconnectQLab:    (body)      => json('POST',   '/api/qlab/reconnect', body ?? {}),
  syncCast:         (body)      => json('POST',   '/api/qlab/sync-cast', body),

  getVersion:       ()          => json('GET',    '/api/version'),

  getAuthStatus:    ()          => json('GET',    '/api/auth/google/status'),
  deleteAuth:       ()          => fetch('/api/auth/google', { method: 'DELETE' }),
  getSheetsConfig:  ()          => json('GET',    '/api/config/sheets'),
  saveSheetsConfig: (body)      => json('POST',   '/api/config/sheets', body),
  saveQlabConfig:   (body)      => json('POST',   '/api/config/qlab', body),
  listSheets:       ()          => json('GET',    '/api/sheets/list'),
  getSheetTabs:     (id)        => json('GET',    `/api/sheets/${id}/tabs`),

  importHistory: (file) => {
    const formData = new FormData();
    formData.append('archive', file);
    return fetch('/api/shows/import', { method: 'POST', body: formData }).then(r => r.json());
  },

  openPhotoWindow:      (id) => json('POST', `/api/shows/${id}/photo-window/open`),
  closePhotoWindow:     (id) => json('POST', `/api/shows/${id}/photo-window/close`),
  getPhotoWindowStatus: (id) => json('GET',  `/api/shows/${id}/photo-window/status`),
  getPhotos:            (id) => json('GET',  `/api/photos/${id}`),
  deletePhoto:          (id, filename) => json('DELETE', `/api/photos/${id}/${encodeURIComponent(filename)}`),
};
