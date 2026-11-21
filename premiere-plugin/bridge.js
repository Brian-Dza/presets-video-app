(function initFramebasePremiereBridge() {
  if (typeof window === 'undefined' || !window.__adobe_cep__) return;

  const fs = typeof require === 'function' ? require('fs') : null;
  const os = typeof require === 'function' ? require('os') : null;
  const path = typeof require === 'function' ? require('path') : null;

  function evalExtendScript(script) {
    return new Promise((resolve) => {
      window.__adobe_cep__.evalScript(script, (result) => resolve(result));
    });
  }

  function escapeExtendScriptArg(value) {
    return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  function safeStem(value) {
    return String(value || 'Framebase_Preset')
      .replace(/[^a-zA-Z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 64) || 'Framebase_Preset';
  }

  function writePackageOnDisk(payload) {
    if (!fs || !os || !path) return null;
    const extension = payload.extension === 'prfpset' ? 'prfpset' : 'mogrt';
    const targetDir = extension === 'mogrt'
      ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Adobe', 'Common', 'Motion Graphics Templates', 'Framebase')
      : path.join(os.homedir(), 'Documents', 'Adobe', 'Premiere Pro', 'Framebase Presets');
    fs.mkdirSync(targetDir, { recursive: true });
    const filePath = path.join(targetDir, `${safeStem(payload.name || payload.fileName)}.${extension}`);
    fs.writeFileSync(filePath, Buffer.from(String(payload.packageBase64 || ''), 'base64'));
    return filePath;
  }

  window.premiereBridge = {
    async getContext() {
      try {
        const raw = await evalExtendScript('framebaseGetContext()');
        return JSON.parse(raw || '{"connected":false}');
      } catch (err) {
        return { connected: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    async applyPreset(payload) {
      try {
        const savedPath = writePackageOnDisk(payload);
        if (!savedPath) {
          return { success: false, message: 'No se pudo escribir el archivo local desde CEP.' };
        }
        const escapedPath = escapeExtendScriptArg(savedPath);
        const escapedName = escapeExtendScriptArg(payload.name);
        const call = payload.extension === 'mogrt'
          ? `framebaseImportMogrt("${escapedPath}", "${escapedName}")`
          : `framebaseImportPresetFile("${escapedPath}", "${escapedName}")`;
        const raw = await evalExtendScript(call);
        return JSON.parse(raw || '{"success":false,"message":"Sin respuesta de Premiere Pro."}');
      } catch (err) {
        return { success: false, message: err instanceof Error ? err.message : String(err) };
      }
    },
    async saveProject() {
      const raw = await evalExtendScript('framebaseSaveProject()');
      return raw === 'true';
    },
  };
})();
