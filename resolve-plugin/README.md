# Framebase panel para DaVinci Resolve Studio

Este panel usa el módulo `WorkflowIntegration.node` incluido con Resolve. No se incluye en el repositorio: el instalador lo copia desde la carpeta Developer de la instalación local.

1. Construye la interfaz con `pnpm build`.
2. Ejecuta `pnpm resolve:install` desde PowerShell.
3. Reinicia Resolve Studio y abre **Workspace → Workflow Integrations → Framebase Presets**.

La edición Free no carga paneles Workflow Integration. Usa Framebase Desktop para organizar recursos y exportar paquetes `.drfx`.
