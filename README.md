# Framebase Presets

Framebase organiza, previsualiza y personaliza presets de títulos, subtítulos, transiciones, efectos, gráficos y stickers para **DaVinci Resolve 21.1+** y **Adobe Premiere Pro**. Está diseñado para Windows con interfaz Estudio Oscuro en español, reproductor interactivo a 60 fps, editor avanzado de curvas y geometría, instalación automática local para Resolve Free / Premiere Pro, paneles nativos para Resolve Studio y Premiere CEP, y sincronización opcional con Supabase.

## Ejecutar en Windows

Instala Node.js y pnpm, abre PowerShell en esta carpeta y ejecuta:

```powershell
pnpm install
pnpm dev
```

Para abrir la aplicación de escritorio durante el desarrollo:

```powershell
pnpm desktop:dev
```

Para crear la aplicación portable para Windows:

```powershell
pnpm desktop:package
```

El ejecutable se genera en `release/Framebase Presets 0.2.0.exe` con icono oficial multi-tamaño (`build/icon.ico`). En modo escritorio incluye el botón **Fijar** (*Always on Top*) para mantener Framebase visible encima de DaVinci Resolve o Premiere Pro mientras editas.

Los presets y archivos importados se guardan localmente. Los clips que cargues en el visor (**Mi clip**) se reproducen exclusivamente en memoria local y nunca se suben.

## DaVinci Resolve

### Resolve Studio

El panel nativo usa el SDK Workflow Integration incluido con Resolve Studio:

1. Ejecuta `pnpm build`.
2. Ejecuta `pnpm resolve:install`.
3. Reinicia Resolve Studio y abre **Workspace → Workflow Integrations → Framebase Presets**.

El panel inserta títulos, subtítulos y generadores en la línea de tiempo, añade transiciones según los FPS activos y aplica efectos Fusion (`.setting` indexados por Resolve 21.1+ o composiciones `.comp`) al clip seleccionado.

### Resolve Free (Instalación y apertura en 1 clic)

DaVinci Resolve Free no habilita paneles Workflow Integration internos, pero Framebase Desktop y el servidor local (`pnpm dev`) instalan y abren los recursos directamente:

- Al pulsar **Aplicar** con el selector superior en **Resolve**, Framebase copia la plantilla `.setting` y sus recursos adjuntos (`Setting:`) en `%APPDATA%\Blackmagic Design\DaVinci Resolve\Support\Fusion\Templates\Edit\{Titles,Generators,Effects,Transitions}` y abre el paquete `.drfx` en `Resolve.exe`.
- También puedes pulsar **Sincronizar con Resolve** para instalar todo el catálogo de una vez o **Exportar .drfx** para compartir el paquete manualmente.

## Adobe Premiere Pro

Cambia el selector superior de la barra principal a **Premiere Pro**:

- **Instalación directa en 1 clic**: Al pulsar **Aplicar**, los títulos, subtítulos, gráficos y stickers se empaquetan e instalan como `.mogrt` en `%APPDATA%\Adobe\Common\Motion Graphics Templates\Framebase` (disponibles de inmediato en **Gráficos esenciales → Examinar → Mis plantillas**). Las transiciones y efectos se guardan como `.prfpset` en `Documentos\Adobe\Premiere Pro\Framebase Presets`.
- **Importación y conversión cruzada**: Framebase importa archivos `.mogrt` y `.prfpset` y también puede exportarlos hacia DaVinci Resolve como plantillas `.drfx` de Fusion.
- **Panel CEP opcional**: Ejecuta `pnpm build` y luego `pnpm premiere:install` para instalar la extensión CEP en `%APPDATA%\Adobe\CEP\extensions\com.framebase.presets.premiere` (**Ventana → Extensiones → Framebase Presets**).

## Sincronización y equipos con Supabase

La sincronización en la nube es opcional y puede configurarse de dos formas:

1. **Desde la interfaz**: Abre **Ajustes y Nube**, pega el URL de tu proyecto (`https://TU-PROYECTO.supabase.co`) y tu clave pública (`anon` o `sb_publishable_`), verifica con **Probar conexión** y pulsa **Guardar y conectar**. Por seguridad, la aplicación bloquea cualquier clave privada (`service_role` / `sb_secret_`).
2. **Al compilar (`.env.local`)**:
   ```powershell
   Copy-Item .env.example .env.local
   ```
   Completa `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` únicamente con valores públicos antes de ejecutar `pnpm desktop:package`.

Para preparar la base de datos y las funciones Edge en tu propio proyecto Supabase:

```powershell
supabase login
supabase link --project-ref TU_PROJECT_REF
supabase db push
supabase secrets set SUPABASE_PUBLISHABLE_KEY=TU_CLAVE_PUBLICA SUPABASE_SECRET_KEY=TU_CLAVE_PRIVADA
supabase functions deploy create-team-invite
supabase functions deploy accept-team-invite
```

## Comprobaciones del proyecto

```powershell
pnpm test
pnpm build
```

## Capacidades actuales

- Interfaz **Estudio Oscuro** (obsidiana, índigo eléctrico y cian) con vista en **cuadrícula o lista**, atajo global `Ctrl+K`, **Drag & Drop** en cualquier zona de la ventana y fijado **Siempre visible** en escritorio Windows.
- **Catálogo Pro de 14 presets iniciales** validados contra `fuscript.exe` de DaVinci Resolve 21.2, incluyendo transiciones de **Zoom óptico** y **Barrido rápido (Whip Pan)**, efectos de **Halation 35mm** y **Viñeta anamórfica**, titulares serif documentales con sombra de cine y cápsulas de capítulo con placa de fondo.
- **Reproductor interactivo a 60 fps** con Play/Pausa, barra de tiempo, bucle, comparador Antes/Después para efectos y selector local **Mi clip** para previsualizar sobre videos o imágenes propios.
- **Editor avanzado y motor tipográfico/óptico**: control de fuente (`Sans`, `Serif`, `Display`, `Mono`, `Humanista`), `tracking`, mayúsculas, sombra cinematográfica (`Shadow`), placa de fondo, estilos de transición/efecto, curvas Bezier/elásticas (`Ease Out`, `S-Curve`, `Spring`, `Exponencial`, `Lineal`) y arrastre directo de coordenadas `(X, Y)` en 16:9.
- **Packs de colección e historial de versiones**: selección múltiple para exportar e importar colecciones completas en un solo archivo `.drfx` (DaVinci Resolve) o `.zip` (Premiere Pro), además de historial de versiones (`v1`, `v2`...) restaurable en un clic tanto en modo local como en Supabase (`preset_versions`).
- **Gestión completa de equipos y roles**: administración de miembros (`Propietario`, `Editor`, `Lector` de solo lectura), revocación de invitaciones pendientes, migración en 1 clic de presets locales hacia el equipo activo y puente dual para **DaVinci Resolve** y **Adobe Premiere Pro**.
