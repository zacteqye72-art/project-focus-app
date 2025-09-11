const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('focusAPI', {
  onActivityUpdate: (handler) => ipcRenderer.on('activity:update', (_, data) => handler?.(data)),
  onDistraction: (handler) => ipcRenderer.on('activity:distraction', (_, data) => handler?.(data)),
  updateRules: (rules) => ipcRenderer.send('rules:update', rules),
  updatePreferences: (prefs) => ipcRenderer.send('preferences:update', prefs),
  history: {
    list: () => ipcRenderer.invoke('history:list'),
    add: (entry) => ipcRenderer.invoke('history:add', entry),
    clear: () => ipcRenderer.invoke('history:clear'),
  },
  ai: {
    chat: (messages, provider, apiKey) => ipcRenderer.invoke('ai:chat', { messages, provider, apiKey }),
    testDistractionMessage: (workContext, base64Image) => ipcRenderer.invoke('ai:test-distraction-message', { workContext, base64Image }),
    testContinuation: (workContext) => ipcRenderer.invoke('ai:test-continuation', { workContext })
  },
  nudge: {
    test: (workContext) => ipcRenderer.invoke('nudge:test', { workContext }),
    stats: () => ipcRenderer.invoke('nudge:stats'),
    sample: () => ipcRenderer.invoke('nudge:sample')
  },
  config: {
    getDefault: () => ipcRenderer.invoke('config:get-default')
  },
  island: {
    update: (data) => ipcRenderer.send('island:update', data),
    show: () => ipcRenderer.send('island:show'),
    hide: () => ipcRenderer.send('island:hide'),
    expand: (data) => ipcRenderer.send('island:expand', data),
    collapse: () => ipcRenderer.send('island:collapse')
  },
  onIslandUpdate: (handler) => ipcRenderer.on('island:update', (_, data) => handler?.(data)),
  onIslandAction: (handler) => ipcRenderer.on('island:action', (_, action) => handler?.(action)),
  onIslandAnimate: (handler) => ipcRenderer.on('island:animate', (_, data) => handler?.(data)),
  onIslandExpand: (handler) => ipcRenderer.on('island:expand', (_, data) => handler?.(data)),
  onIslandCollapse: (handler) => ipcRenderer.on('island:collapse', (_, data) => handler?.(data)),
  islandAction: (action) => ipcRenderer.send('island:action', action),
  windowMonitoring: {
    start: () => ipcRenderer.send('window-monitoring:start'),
    stop: () => ipcRenderer.send('window-monitoring:stop'),
    getCurrent: () => ipcRenderer.invoke('window-monitoring:get-current'),
    testScreenshot: () => ipcRenderer.invoke('window-monitoring:test-screenshot'),
    onWindowChanged: (handler) => ipcRenderer.on('window:changed', (_, data) => handler?.(data))
  },
  aiAnalysis: {
    enable: (workContext) => ipcRenderer.send('ai-analysis:enable', { workContext }),
    disable: () => ipcRenderer.send('ai-analysis:disable'),
    onFocusAnalysis: (handler) => ipcRenderer.on('focus:analysis', (_, data) => handler?.(data))
  },
  onMessageUpdate: (handler) => ipcRenderer.on('update-message', (_, message) => handler?.(message)),
  dnd: {
    toggle: (enable) => ipcRenderer.send('dnd:toggle', enable)
  },
  permissions: {
    check: () => ipcRenderer.invoke('permissions:check')
  },
  test: {
    showDistractionAlert: (message) => ipcRenderer.send('test:show-distraction-alert', message)
  }
});

