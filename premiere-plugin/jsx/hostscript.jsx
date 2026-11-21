/* global app */
function framebaseEscapeJson(text) {
  return String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');
}

function framebaseJson(payload) {
  var parts = [];
  for (var key in payload) {
    if (!Object.prototype.hasOwnProperty.call(payload, key)) continue;
    var val = payload[key];
    if (typeof val === 'boolean' || typeof val === 'number') {
      parts.push('"' + framebaseEscapeJson(key) + '":' + String(val));
    } else if (val !== undefined && val !== null) {
      parts.push('"' + framebaseEscapeJson(key) + '":"' + framebaseEscapeJson(val) + '"');
    }
  }
  return '{' + parts.join(',') + '}';
}

function framebaseGetContext() {
  try {
    if (!app || !app.project) {
      return framebaseJson({
        connected: false,
        error: 'Abre un proyecto en Adobe Premiere Pro para conectar Framebase.',
      });
    }
    var seq = app.project.activeSequence;
    var playheadSeconds = 0;
    if (seq && seq.getPlayerPosition) {
      var pos = seq.getPlayerPosition();
      if (pos && typeof pos.seconds === 'number') playheadSeconds = pos.seconds;
    }
    return framebaseJson({
      connected: true,
      version: app.version || '25.0',
      projectName: app.project.name || 'Proyecto activo',
      sequenceName: seq ? seq.name : '',
      playheadSeconds: playheadSeconds,
    });
  } catch (err) {
    return framebaseJson({
      connected: false,
      error: err && err.message ? err.message : String(err),
    });
  }
}

function framebaseImportMogrt(mogrtPath, presetName) {
  try {
    if (!app || !app.project) {
      return framebaseJson({ success: false, message: 'No hay un proyecto abierto en Premiere Pro.' });
    }
    var seq = app.project.activeSequence;
    if (!seq) {
      return framebaseJson({
        success: false,
        message: 'Abre una secuencia activa en Premiere Pro para insertar la plantilla Motion Graphics.',
      });
    }
    var timeTicks = seq.getPlayerPosition().ticks;
    var targetVideoTrack = Math.max(0, seq.videoTracks.numTracks - 1);
    var trackItem = seq.importMGT(mogrtPath, timeTicks, targetVideoTrack, 0);
    if (!trackItem) {
      return framebaseJson({
        success: true,
        message: 'Plantilla instalada en Gráficos esenciales → Mis plantillas → Framebase. Arrástrala a tu secuencia.',
      });
    }
    return framebaseJson({
      success: true,
      message: '“' + presetName + '” se insertó en el cabezal de la secuencia activa.',
    });
  } catch (err) {
    return framebaseJson({
      success: false,
      message: err && err.message ? err.message : String(err),
    });
  }
}

function framebaseImportPresetFile(presetPath, presetName) {
  try {
    if (!app || !app.project) {
      return framebaseJson({ success: false, message: 'No hay un proyecto abierto en Premiere Pro.' });
    }
    return framebaseJson({
      success: true,
      message: '“' + presetName + '” se guardó en tu carpeta Framebase Presets. Impórtalo desde Efectos → Ajustes preestablecidos.',
    });
  } catch (err) {
    return framebaseJson({
      success: false,
      message: err && err.message ? err.message : String(err),
    });
  }
}

function framebaseSaveProject() {
  try {
    if (app && app.project && app.project.save) {
      app.project.save();
      return 'true';
    }
    return 'false';
  } catch (_err) {
    return 'false';
  }
}
