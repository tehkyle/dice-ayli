const json = (method, path, body) => fetch(path, {
  method,
  ...(body !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
}).then(r => r.json());

export const api = {
  getConfig:        ()          => json('GET',    '/api/config'),
  getShows:         ()          => json('GET',    '/api/shows'),
  getActiveShow:    ()          => json('GET',    '/api/shows/active'),
  createShow:       ()          => json('POST',   '/api/shows', {}),
  deleteShow:       (id)        => fetch(`/api/shows/${id}`, { method: 'DELETE' }),
  endShow:          (id)        => fetch(`/api/shows/${id}/end`,    { method: 'POST' }),
  cancelShow:       (id)        => json('POST',   `/api/shows/${id}/cancel`),
  lockCast:         (id, body)  => json('POST',   `/api/shows/${id}/cast`, body),
  saveCast:         (id, cast)  => json('POST',   `/api/shows/${id}/cast`, { cast }),

  getQlabStatus:    ()          => json('GET',    '/api/qlab/status'),
  getPlayhead:      ()          => json('GET',    '/api/qlab/playhead'),
  postGo:           ()          => json('POST',   '/api/qlab/go'),
  panicAll:         ()          => fetch('/api/qlab/panic', { method: 'POST' }),
  reconnectQLab:    (body)      => json('POST',   '/api/qlab/reconnect', body ?? {}),

  getVersion:       ()          => json('GET',    '/api/version'),

  getAuthStatus:    ()          => json('GET',    '/api/auth/google/status'),
  deleteAuth:       ()          => fetch('/api/auth/google', { method: 'DELETE' }),
  getSheetsConfig:  ()          => json('GET',    '/api/config/sheets'),
  saveSheetsConfig: (body)      => json('POST',   '/api/config/sheets', body),
  saveQlabConfig:   (body)      => json('POST',   '/api/config/qlab', body),
  listSheets:       ()          => json('GET',    '/api/sheets/list'),
  getSheetTabs:     (id)        => json('GET',    `/api/sheets/${id}/tabs`),
};
