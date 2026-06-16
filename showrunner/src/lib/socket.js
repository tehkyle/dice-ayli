let _source = null;
const listeners = new Map(); // event name -> Set<wrapped handler>

export function getSocket() {
  if (!_source) _source = new EventSource('/api/events');
  return {
    on(event, fn) {
      const wrapped = (e) => {
        let data;
        try { data = e.data != null ? JSON.parse(e.data) : undefined; }
        catch { data = undefined; }
        fn(data);
      };
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(wrapped);
      _source.addEventListener(event, wrapped);
    },
    off(event) {
      const set = listeners.get(event);
      if (!set) return;
      for (const wrapped of set) _source.removeEventListener(event, wrapped);
      listeners.delete(event);
    },
  };
}
