# Extensión CEP para Adobe Premiere Pro

Este directorio contiene la extensión CEP (`com.framebase.presets.premiere`) para cargar Framebase Presets como panel nativo dentro de **Adobe Premiere Pro 22.0+**.

## Instalación rápida en Windows

1. Compila la interfaz:
   ```powershell
   pnpm build
   ```
2. Instala la extensión en tu carpeta de usuario CEP (`%APPDATA%\Adobe\CEP\extensions\com.framebase.presets.premiere`):
   ```powershell
   pnpm premiere:install
   ```
3. Abre Premiere Pro y activa **Ventana → Extensiones → Framebase Presets**.

## Uso sin extensión CEP

También puedes usar Framebase directamente desde el escritorio o servidor local cambiando el selector superior a **Adobe Premiere Pro**:
- Títulos, subtítulos, gráficos y stickers se instalan automáticamente como `.mogrt` en `%APPDATA%\Adobe\Common\Motion Graphics Templates\Framebase` (visibles al instante en **Gráficos esenciales → Examinar → Mis plantillas**).
- Transiciones y efectos se guardan e importan como `.prfpset` en `Documentos\Adobe\Premiere Pro\Framebase Presets`.
