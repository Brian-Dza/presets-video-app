import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from './App';
import { starterPresets } from './data/starterPresets';
import { createDrfxPack } from './lib/presetFiles';

describe('Framebase library, Pro visual engine, packs, version history, and Resolve/Premiere bridges', () => {
  beforeEach(() => {
    localStorage.clear();
    delete window.resolveBridge;
    delete window.premiereBridge;
    delete window.nativeHost;
  });

  afterEach(() => {
    delete window.resolveBridge;
    delete window.premiereBridge;
    delete window.nativeHost;
  });

  it('shows the 14-preset Pro starter library, intact 16:9 .artwork card thumbnails, editor switcher, and Grid/List view toggle', () => {
    const { container } = render(<App />);
    expect(screen.getByRole('heading', { name: /tu biblioteca/i })).toBeInTheDocument();
    const cards = screen.getAllByTestId('preset-card');
    expect(cards).toHaveLength(14);

    // Every card must render the .artwork 16:9 visual stage with --accent and category scene layers
    const artworks = container.querySelectorAll('.preset-card .artwork');
    expect(artworks).toHaveLength(14);
    expect((artworks[0] as HTMLElement).style.getPropertyValue('--accent')).toBeTruthy();
    expect(container.querySelectorAll('.preset-card .preview-shot-a').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('.preset-card .art-horizon').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('.preset-card .preview-effect-layer').length).toBeGreaterThan(0);

    expect(screen.getByRole('button', { name: /importar/i })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /editor de destino/i })).toBeInTheDocument();

    // Switch to List view and verify all 14 presets render cleanly
    fireEvent.click(screen.getByRole('button', { name: /vista en lista/i }));
    expect(screen.getByTestId('preset-list-view')).toBeInTheDocument();
    expect(screen.getAllByTestId('preset-card')).toHaveLength(14);

    // Ctrl+K focuses search box
    const searchInput = screen.getByRole('textbox', { name: /buscar presets/i });
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(document.activeElement).toBe(searchInput);
  });

  it('filters the catalog by category and search text', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('tab', { name: /transiciones/i }));
    expect(screen.getAllByTestId('preset-card')).toHaveLength(4);
    fireEvent.change(screen.getByRole('textbox', { name: /buscar presets/i }), { target: { value: 'fundido' } });
    expect(screen.getAllByTestId('preset-card')).toHaveLength(1);
  });

  it('opens the interactive preview, customizes typography/curves, and restores a previous version', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /ver primera luz/i }));

    // Interactive preview stage & transport bar
    expect(screen.getByTestId('interactive-preview-stage')).toBeInTheDocument();
    const transport = screen.getByTestId('preview-transport');
    expect(within(transport).getByRole('button', { name: /pausar animación/i })).toBeInTheDocument();
    fireEvent.click(within(transport).getByRole('button', { name: /pausar animación/i }));
    expect(within(transport).getByRole('button', { name: /reproducir animación/i })).toBeInTheDocument();

    // Open Advanced Editor from Details modal and customize typography + curve
    fireEvent.click(screen.getByRole('button', { name: /personalizar/i }));
    fireEvent.change(screen.getByLabelText(/nombre del preset/i), { target: { value: 'Primera luz V2' } });
    fireEvent.change(screen.getByLabelText(/tipografía/i), { target: { value: 'Georgia' } });
    fireEvent.change(screen.getByLabelText(/curva de animación/i), { target: { value: 'elastic' } });
    fireEvent.click(screen.getByRole('button', { name: /guardar cambios/i }));

    await waitFor(() => expect(screen.getByText('Primera luz V2')).toBeInTheDocument());

    // Open Details modal again, inspect Version History (v2 & v1), and restore v1!
    fireEvent.click(screen.getByRole('button', { name: /ver primera luz v2/i }));
    const historyPanel = screen.getByTestId('version-history-panel');
    expect(within(historyPanel).getByText('v2')).toBeInTheDocument();
    expect(within(historyPanel).getByText('v1')).toBeInTheDocument();

    fireEvent.click(within(historyPanel).getByRole('button', { name: /restaurar versión 1/i }));
    await waitFor(() => expect(screen.getByText(/versión v1 restaurada/i)).toBeInTheDocument());
    expect(screen.getByText('Versión 3')).toBeInTheDocument();
  });

  it('creates and persists a new preset from the advanced editor', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /^crear preset$/i }));
    fireEvent.change(screen.getByLabelText(/nombre del preset/i), { target: { value: 'Mi título de prueba' } });
    fireEvent.click(screen.getByRole('button', { name: /guardar en la biblioteca/i }));
    await waitFor(() => expect(screen.getByText('Mi título de prueba')).toBeInTheDocument());
    expect(JSON.parse(localStorage.getItem('framebase.presets.v1') ?? '[]')).toHaveLength(1);
  });

  it('connects to Resolve Studio Bridge safely with array versions and applies presets', async () => {
    const applyPreset = vi.fn().mockResolvedValue({
      success: true,
      message: '“Resplandor suave” se aplicó al clip seleccionado.',
    });
    window.resolveBridge = {
      getContext: vi.fn().mockResolvedValue({
        connected: true,
        version: [21, 2, 0, 6, ''],
        projectName: 'Corto Editorial',
        timelineName: 'Montaje Principal',
        selectedClipCount: 1,
      }),
      applyPreset,
      saveProject: vi.fn().mockResolvedValue(true),
    };

    render(<App />);
    await waitFor(() => expect(screen.getAllByText(/resolve conectado/i).length).toBeGreaterThan(0));
    expect(screen.getByText('21.2')).toBeInTheDocument();

    const cards = screen.getAllByTestId('preset-card');
    const glowCard = cards.find((card) => within(card).queryByText('Resplandor suave'))!;
    fireEvent.click(within(glowCard).getByRole('button', { name: /^aplicar$/i }));

    await waitFor(() => expect(applyPreset).toHaveBeenCalledTimes(1));
    expect(applyPreset).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'preset-soft-glow',
        category: 'effect',
        applyMode: 'clip-effect',
        templateName: 'Resplandor_suave_effect',
      })
    );
    await waitFor(() => expect(screen.getByText(/se aplicó al clip seleccionado/i)).toBeInTheDocument());
  });

  it('installs and opens presets in DaVinci Resolve Free and Premiere Pro via native local host', async () => {
    const installInResolve = vi.fn().mockResolvedValue({
      success: true,
      openedEditor: true,
      message: 'Instalado en Biblioteca de efectos → Títulos y abierto en DaVinci Resolve.',
    });
    const installInPremiere = vi.fn().mockResolvedValue({
      success: true,
      openedEditor: false,
      message: 'Plantilla .mogrt instalada en Adobe Motion Graphics Templates.',
    });
    window.nativeHost = {
      isDesktop: true,
      version: '45.0.0',
      platform: 'win32',
      saveFile: vi.fn().mockResolvedValue(true),
      getEditorsStatus: vi.fn().mockResolvedValue({
        available: true,
        resolveInstalled: true,
        premiereInstalled: true,
      }),
      installInResolve,
      installInPremiere,
    };

    render(<App />);
    await waitFor(() => expect(screen.getByText(/davinci resolve listo/i)).toBeInTheDocument());

    const firstLightCard = screen.getAllByTestId('preset-card').find((card) => within(card).queryByText('Primera luz'))!;
    fireEvent.click(within(firstLightCard).getByRole('button', { name: /^aplicar$/i }));
    await waitFor(() => expect(installInResolve).toHaveBeenCalledTimes(1));
    expect(installInResolve).toHaveBeenCalledWith(expect.objectContaining({ presetName: 'Primera luz', openInResolve: true }));

    // Switch target to Premiere Pro and apply
    fireEvent.click(screen.getByRole('button', { name: /^premiere pro$/i }));
    fireEvent.click(within(firstLightCard).getByRole('button', { name: /^aplicar$/i }));
    await waitFor(() => expect(installInPremiere).toHaveBeenCalledTimes(1));
    expect(installInPremiere).toHaveBeenCalledWith(expect.objectContaining({ extension: 'mogrt' }));
  });

  it('blocks private Supabase keys in Settings modal', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /ajustes y nube/i }));
    fireEvent.change(screen.getByLabelText(/url del proyecto supabase/i), {
      target: { value: 'https://mi-estudio.supabase.co' },
    });
    fireEvent.change(screen.getByLabelText(/clave pública/i), {
      target: { value: 'sb_secret_clave_privada_del_servidor' },
    });
    fireEvent.click(screen.getByRole('button', { name: /guardar y conectar/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(/nunca uses una clave privada/i);
  });

  it('supports multi-preset Pack export, Drag & Drop pack import, and Always-on-Top window pinning', async () => {
    const saveFile = vi.fn().mockResolvedValue(true);
    const setAlwaysOnTop = vi.fn().mockResolvedValue(true);
    window.nativeHost = {
      isDesktop: true,
      version: '45.0.0',
      platform: 'win32',
      saveFile,
      getAlwaysOnTop: vi.fn().mockResolvedValue(false),
      setAlwaysOnTop,
      getEditorsStatus: vi.fn().mockResolvedValue({
        available: true,
        resolveInstalled: true,
        premiereInstalled: false,
      }),
    };

    const { container } = render(<App />);

    // Pin window always-on-top
    const pinBtn = screen.getByRole('button', { name: /fijar ventana siempre visible/i });
    fireEvent.click(pinBtn);
    await waitFor(() => expect(setAlwaysOnTop).toHaveBeenCalledWith(true));

    // Select 2 presets and export a Collection Pack
    fireEvent.click(screen.getByRole('button', { name: /seleccionar primera luz/i }));
    fireEvent.click(screen.getByRole('button', { name: /seleccionar zoom óptico/i }));

    const packBar = screen.getByRole('region', { name: /barra de colección/i });
    expect(within(packBar).getByText(/2 seleccionados/i)).toBeInTheDocument();
    fireEvent.change(within(packBar).getByLabelText(/nombre del pack/i), { target: { value: 'Mi_Pack_Estudio' } });
    fireEvent.click(within(packBar).getByRole('button', { name: /exportar pack/i }));
    await waitFor(() => expect(saveFile).toHaveBeenCalledWith('Mi_Pack_Estudio.drfx', expect.any(String)));

    // Global Drag & Drop of a multi-preset DRFX pack
    const customPackBytes = createDrfxPack(
      [
        {
          preset: { ...starterPresets[0], id: 'drop-1', name: 'Drop Transición A' },
          nativeFiles: [],
        },
        {
          preset: { ...starterPresets[2], id: 'drop-2', name: 'Drop Efecto B' },
          nativeFiles: [],
        },
      ],
      'DroppedPack'
    );
    const droppedFile = new File([customPackBytes.slice().buffer], 'DroppedPack.drfx', {
      type: 'application/octet-stream',
    });

    const appShell = container.querySelector('.app-shell')!;
    fireEvent.drop(appShell, {
      dataTransfer: {
        types: ['Files'],
        files: [droppedFile],
      },
    });

    await waitFor(() => expect(screen.getByText('Drop Transición A')).toBeInTheDocument());
    expect(screen.getByText('Drop Efecto B')).toBeInTheDocument();
  });

  it('loads a Pro Recipe, edits EffectStack layers, switches Aspect Ratio & Safe Zones, and saves', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /^crear preset$/i }));

    // Load Pro Recipe
    const recipeSelect = screen.getByLabelText(/plantillas base \/ recetas pro/i);
    fireEvent.change(recipeSelect, { target: { value: 'recipe-punch-shake-doc' } });
    expect(screen.getByDisplayValue('Punch-In + Shake Documental')).toBeInTheDocument();

    // Add a Film Grain layer to the EffectStack
    const addSelect = screen.getByLabelText(/seleccionar capa para añadir/i);
    fireEvent.change(addSelect, { target: { value: 'vfx:film-grain' } });
    fireEvent.click(screen.getByRole('button', { name: /añadir capa al stack/i }));
    expect(screen.getByText(/stack de capas \(5\)/i)).toBeInTheDocument();

    // Toggle visibility of Camera Shake layer
    fireEvent.click(screen.getByRole('button', { name: /desactivar camera shake/i }));
    expect(screen.getByRole('button', { name: /activar camera shake/i })).toBeInTheDocument();

    // Switch Aspect Ratio to 9:16 and toggle Safe Zones
    fireEvent.click(screen.getByRole('button', { name: '9:16' }));
    fireEvent.click(screen.getByRole('button', { name: /zonas seguras/i }));
    expect(screen.getByText(/zona segura reels \/ tiktok/i)).toBeInTheDocument();

    // Save preset and verify persisted layers & aspectRatio
    fireEvent.click(screen.getByRole('button', { name: /guardar en la biblioteca/i }));
    await waitFor(() => expect(screen.getByText('Punch-In + Shake Documental')).toBeInTheDocument());

    const stored = JSON.parse(localStorage.getItem('framebase.presets.v1') ?? '[]');
    expect(stored).toHaveLength(1);
    expect(stored[0].aspectRatio).toBe('9:16');
    expect(stored[0].layers).toHaveLength(5);
    expect(stored[0].scale).toBeCloseTo(1, 2);
    expect(stored[0].tracking).toBeCloseTo(1, 2);
  });

  it('duplicates presets cleanly and shows Restaurar base (instead of Eliminar) on customized starter presets', async () => {
    render(<App />);

    // Open unmodified starter preset editor: should NOT offer Eliminar
    fireEvent.click(screen.getByRole('button', { name: /editar primera luz/i }));
    expect(screen.queryByRole('button', { name: /^eliminar$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /restaurar base/i })).not.toBeInTheDocument();

    // Customize and save starter preset
    fireEvent.change(screen.getByLabelText(/nombre del preset/i), {
      target: { value: 'Primera luz Custom' },
    });
    fireEvent.click(screen.getByRole('button', { name: /guardar cambios/i }));
    await waitFor(() => expect(screen.getByText('Primera luz Custom')).toBeInTheDocument());

    // Re-open customized starter preset: should offer Restaurar base & Duplicar
    fireEvent.click(screen.getByRole('button', { name: /editar primera luz custom/i }));
    expect(screen.getByRole('button', { name: /restaurar base/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^duplicar$/i }));

    await waitFor(() => expect(screen.getByText('Primera luz Custom (Copia)')).toBeInTheDocument());
    expect(screen.getByText('Primera luz Custom')).toBeInTheDocument();

    // Restore factory base on the starter preset
    fireEvent.click(screen.getByRole('button', { name: /editar primera luz custom$/i }));
    fireEvent.click(screen.getByRole('button', { name: /restaurar base/i }));
    await waitFor(() => expect(screen.getByText('Primera luz')).toBeInTheDocument());
  });

  it('configures Typewriter Pro, 3x3 Anchor Point, Dual Accent gradient, and interactive Split Wipe in the balanced 2-column Studio', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /^crear preset$/i }));

    // Compact Identity Strip: Name + Dual Accent gradient
    fireEvent.change(screen.getByLabelText(/nombre del preset/i), {
      target: { value: 'Terminal Matrix Studio' },
    });
    fireEvent.click(screen.getByRole('button', { name: /activar acento dual/i }));
    expect(screen.getByLabelText(/color de acento secundario/i)).toBeInTheDocument();

    // Tab 1 (Contenido y Estilo): switch kinetic typography mode to Typewriter Pro
    fireEvent.change(screen.getByLabelText(/modo de animación tipográfica/i), {
      target: { value: 'typewriter' },
    });
    const twPanel = screen.getByTestId('typewriter-pro-panel');
    fireEvent.change(within(twPanel).getByLabelText(/unidad de avance/i), {
      target: { value: 'cipher' },
    });
    fireEvent.change(within(twPanel).getByLabelText(/símbolo de cursor/i), {
      target: { value: 'block' },
    });
    fireEvent.change(within(twPanel).getByLabelText(/modo de salida typewriter/i), {
      target: { value: 'backspace' },
    });

    // Tab 2 (Geometría y Anclaje): pick Top-Left on the 3x3 9-Point Anchor Grid
    fireEvent.click(screen.getByRole('tab', { name: /geometría y anclaje/i }));
    const anchorGroup = screen.getByRole('radiogroup', { name: /punto de anclaje 3x3/i });
    fireEvent.click(within(anchorGroup).getByRole('radio', { name: /anclaje superior izquierda/i }));
    expect(
      within(anchorGroup).getByRole('radio', { name: /anclaje superior izquierda/i })
    ).toHaveAttribute('aria-checked', 'true');

    // Right Column Monitor: activate interactive Cortinilla (Split Wipe)
    fireEvent.click(screen.getByRole('button', { name: /cortinilla antes y después/i }));
    expect(
      screen.getByRole('slider', { name: /cortinilla divisoria antes y después/i })
    ).toBeInTheDocument();

    // Save and verify persistence of Typewriter Pro, anchorPoint & secondaryAccent
    fireEvent.click(screen.getByRole('button', { name: /guardar en la biblioteca/i }));
    await waitFor(() => expect(screen.getByText('Terminal Matrix Studio')).toBeInTheDocument());

    const stored = JSON.parse(localStorage.getItem('framebase.presets.v1') ?? '[]');
    expect(stored).toHaveLength(1);
    expect(stored[0].anchorPoint).toBe('top-left');
    expect(stored[0].secondaryAccent).toBe('#22d3ee');
    const twLayer = stored[0].layers.find((l: { kind: string }) => l.kind === 'typewriter');
    expect(twLayer).toBeDefined();
    expect(twLayer.params.typewriterUnit).toBe('cipher');
    expect(twLayer.params.cursorStyle).toBe('block');
    expect(twLayer.params.outBehavior).toBe('backspace');
  });

  it('supports switching to Dope Sheet timeline, inserting keyframes, enabling Physics/Modulators, Trim Paths, Mask Reveal & Blend Mode', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /^crear preset$/i }));

    fireEvent.change(screen.getByLabelText(/nombre del preset/i), {
      target: { value: 'HUD Dope Sheet Spring' },
    });

    // Switch Timeline to Dope Sheet mode and insert a Position keyframe
    fireEvent.click(screen.getByRole('tab', { name: /editor de keyframes \(dope sheet\)/i }));
    expect(screen.getByTestId('dope-sheet-editor')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /añadir keyframe en playhead/i }));
    fireEvent.click(screen.getByRole('button', { name: /auto-keyframe \(rec\)/i }));
    expect(screen.getByRole('button', { name: /auto-keyframe \(rec\)/i })).toHaveAttribute(
      'aria-pressed',
      'true'
    );

    // Tab 1 Composition controls: Blend Mode, Trim Paths, Mask Reveal
    fireEvent.change(screen.getByLabelText(/modo de fusión/i), {
      target: { value: 'screen' },
    });
    fireEvent.click(screen.getByLabelText(/animar trazos \(trim paths/i));
    fireEvent.click(screen.getByLabelText(/máscara de revelado/i));
    fireEvent.change(screen.getByLabelText(/dirección de máscara de revelado/i), {
      target: { value: 'diagonal' },
    });

    // Tab 3 Modulators & Real Physics: Spring + Wiggle + LFO
    fireEvent.click(screen.getByRole('tab', { name: /moduladores y física/i }));
    const modPane = screen.getByTestId('modulators-tab-pane');
    fireEvent.click(within(modPane).getByLabelText(/física spring real/i));
    fireEvent.click(within(modPane).getByLabelText(/modulador wiggle/i));
    fireEvent.click(within(modPane).getByLabelText(/oscilador lfo/i));

    // Gizmo should be mounted in interactive preview
    expect(screen.getByTestId('viewport-transform-gizmo')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /guardar en la biblioteca/i }));
    await waitFor(() => expect(screen.getByText('HUD Dope Sheet Spring')).toBeInTheDocument());

    const stored = JSON.parse(localStorage.getItem('framebase.presets.v1') ?? '[]');
    expect(stored).toHaveLength(1);
    expect(stored[0].timelineMode).toBe('keyframes');
    expect(stored[0].keyframeTracks?.length).toBeGreaterThanOrEqual(2);
    expect(stored[0].layers[0].blendMode).toBe('screen');
    expect(stored[0].layers[0].trimPaths?.enabled).toBe(true);
    expect(stored[0].layers[0].maskReveal?.direction).toBe('diagonal');
    expect(stored[0].layers[0].modulators?.spring?.enabled).toBe(true);
    expect(stored[0].layers[0].modulators?.wiggle?.enabled).toBe(true);
    expect(stored[0].layers[0].modulators?.lfo?.enabled).toBe(true);
  });
});
