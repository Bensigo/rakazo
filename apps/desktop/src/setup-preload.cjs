const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("rakazoSetup", {
  state: () => ipcRenderer.invoke("desktop.setup.state"),
  test: (url) => ipcRenderer.invoke("desktop.setup.test", url),
  save: (setup) => ipcRenderer.invoke("desktop.setup.save", setup),
  quit: () => ipcRenderer.invoke("desktop.setup.quit"),
  onProgress: (listener) => {
    const handler = (_event, message) => {
      if (typeof message === "string") listener(message);
    };
    ipcRenderer.on("desktop.setup.progress", handler);
    return () => ipcRenderer.removeListener("desktop.setup.progress", handler);
  },
});
