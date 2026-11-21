import {
  BEZIER_PRESETS,
  DEFAULT_TIMELINE_PHASES,
  resolveNormalizedPivot,
  type BezierHandles,
  type KeyframePoint,
  type KeyframeTrack,
  type LayerBlendMode,
  type LfoModulatorConfig,
  type PresetRecord,
  type TimelinePhases,
} from '../domain/preset';
import {
  bakeSpringKeyframes,
  resolveLfoFrequencyHz,
  sortKeyframes,
} from './animationEngine';

function safeMacroName(raw: string): string {
  const cleaned = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!cleaned) return 'FramebasePreset';
  return /^[0-9]/.test(cleaned) ? `Preset_${cleaned}` : cleaned;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function hexToRgbNorm(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean.padEnd(6, '0').slice(0, 6);
  const num = Number.parseInt(full, 16);
  if (Number.isNaN(num)) return [0.486, 0.361, 1.0];
  return [((num >> 16) & 255) / 255, ((num >> 8) & 255) / 255, (num & 255) / 255];
}

function escapeLuaString(input: string): string {
  return input
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, ' ');
}

function escapeXml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function normalizeUnitCoord(raw: number | undefined, fallback: number): number {
  if (raw === undefined || !Number.isFinite(raw)) return fallback;
  return raw > 1.2 ? clamp(raw / 100, 0.05, 0.95) : clamp(raw, 0.05, 0.95);
}

export function normalizeScaleMultiplier(raw: number | undefined, fallback = 1): number {
  if (raw === undefined || !Number.isFinite(raw)) return fallback;
  return raw > 5 ? clamp(raw / 100, 0.2, 3.0) : clamp(raw, 0.2, 3.0);
}

export function normalizeTrackingSpacing(raw: number | undefined): number {
  if (raw === undefined || !Number.isFinite(raw)) return 1.0;
  if (raw >= 0.5 && raw <= 2.0) return clamp(raw, 0.7, 1.8);
  return clamp(1 + raw * 0.01, 0.7, 1.8);
}

export function resolveBezierHandles(preset: Pick<PresetRecord, 'bezier' | 'curve'>): BezierHandles {
  if (preset.bezier && preset.bezier.length === 4) {
    return preset.bezier;
  }
  return BEZIER_PRESETS[preset.curve ?? 'ease-out'] ?? [0.16, 1, 0.3, 1];
}

export function resolveTimelinePhases(preset: Pick<PresetRecord, 'timelinePhases'>): TimelinePhases {
  return preset.timelinePhases ?? DEFAULT_TIMELINE_PHASES;
}

function buildBezierSplineBlock(
  splineName: string,
  startFrame: number,
  endFrame: number,
  startVal: number,
  endVal: number,
  bezier: BezierHandles
): string {
  const span = Math.max(1, endFrame - startFrame);
  const delta = endVal - startVal;
  const rhX = Number((bezier[0] * span).toFixed(2));
  const rhY = Number((bezier[1] * delta).toFixed(4));
  const lhX = Number(((bezier[2] - 1) * span).toFixed(2));
  const lhY = Number(((bezier[3] - 1) * delta).toFixed(4));

  return `                ${splineName} = BezierSpline {
                    SplineColor = { Red = 124, Green = 92, Blue = 255 },
                    CtrlWZoom = false,
                    KeyFrames = {
                        [${startFrame}] = { ${startVal.toFixed(4)}, RH = { ${rhX}, ${rhY} } },
                        [${endFrame}] = { ${endVal.toFixed(4)}, LH = { ${lhX}, ${lhY} } }
                    }
                }`;
}

function buildWriteOnSplineBlock(
  splineName: string,
  inEndFrame: number,
  outStartFrame: number,
  totalFrames: number,
  bezier: BezierHandles,
  outBehavior: string
): string {
  const inSpan = Math.max(1, inEndFrame);
  const inRhX = Number((bezier[0] * inSpan).toFixed(2));
  const inRhY = Number(bezier[1].toFixed(4));
  const inLhX = Number(((bezier[2] - 1) * inSpan).toFixed(2));
  const inLhY = Number((bezier[3] - 1).toFixed(4));

  const keyframes: string[] = [
    `                        [0] = { 0.0000, RH = { ${inRhX}, ${inRhY} } }`,
    `                        [${inEndFrame}] = { 1.0000, LH = { ${inLhX}, ${inLhY} } }`,
  ];

  if (outBehavior === 'backspace' && outStartFrame > inEndFrame && totalFrames > outStartFrame) {
    const outSpan = Math.max(1, totalFrames - outStartFrame);
    const outRhX = Number((outStartFrame + bezier[0] * outSpan).toFixed(2));
    const outRhY = Number((1 - bezier[1]).toFixed(4));
    const outLhX = Number((totalFrames + (bezier[2] - 1) * outSpan).toFixed(2));
    const outLhY = Number((1 - bezier[3]).toFixed(4));
    keyframes.push(
      `                        [${outStartFrame}] = { 1.0000, RH = { ${outRhX}, ${outRhY} } }`,
      `                        [${totalFrames}] = { 0.0000, LH = { ${outLhX}, ${outLhY} } }`
    );
  } else if (outBehavior === 'cut' && totalFrames > inEndFrame + 1) {
    keyframes.push(
      `                        [${totalFrames - 1}] = { 1.0000 }`,
      `                        [${totalFrames}] = { 0.0000 }`
    );
  }

  return `                ${splineName} = BezierSpline {
                    SplineColor = { Red = 34, Green = 211, Blue = 238 },
                    CtrlWZoom = false,
                    KeyFrames = {
${keyframes.join(',\n')}
                    }
                }`;
}

function buildKeyframeTrackSplineBlock(
  splineName: string,
  track: KeyframeTrack,
  defaultBezier: BezierHandles,
  valueMap: (v: number) => number = (v) => v,
  fps = 24
): string {
  const kfs = sortKeyframes(track.keyframes);
  const lines: string[] = [];

  for (let i = 0; i < kfs.length; i += 1) {
    const curr = kfs[i];
    const next = kfs[i + 1];
    const frameA = Math.round(curr.time * fps);
    const valA = valueMap(curr.value);
    const interp = curr.interpolation ?? 'bezier';

    if (!next) {
      lines.push(`                        [${frameA}] = { ${valA.toFixed(4)} }`);
      continue;
    }

    const frameB = Math.round(next.time * fps);
    const valB = valueMap(next.value);

    if (interp === 'spring') {
      const baked = bakeSpringKeyframes(
        frameA,
        Math.max(frameA + 2, frameB),
        valA,
        valB,
        curr.spring,
        2
      );
      // Drop final point if not last segment so next keyframe owns frameB
      const limit = i < kfs.length - 2 ? baked.length - 1 : baked.length;
      for (let j = 0; j < limit; j += 1) {
        lines.push(`                        [${baked[j].frame}] = { ${baked[j].value.toFixed(4)} }`);
      }
      if (i < kfs.length - 2) continue;
      break;
    }

    if (interp === 'hold') {
      lines.push(`                        [${frameA}] = { ${valA.toFixed(4)}, Flags = { StepIn = true } }`);
      continue;
    }

    if (interp === 'linear') {
      lines.push(`                        [${frameA}] = { ${valA.toFixed(4)}, Flags = { Linear = true } }`);
      continue;
    }

    const span = Math.max(1, frameB - frameA);
    const delta = valB - valA;
    const bz = curr.bezier ?? defaultBezier;
    const rhX = Number((bz[0] * span).toFixed(2));
    const rhY = Number((bz[1] * delta).toFixed(4));
    lines.push(`                        [${frameA}] = { ${valA.toFixed(4)}, RH = { ${rhX}, ${rhY} } }`);
  }

  return `                ${splineName} = BezierSpline {
                    SplineColor = { Red = 124, Green = 92, Blue = 255 },
                    CtrlWZoom = false,
                    KeyFrames = {
${lines.join(',\n')}
                    }
                }`;
}

function buildBlendModeInputs(mode: LayerBlendMode | undefined): string {
  if (!mode || mode === 'normal') return '';
  if (mode === 'screen') {
    return `\n                        ApplyMode = Input { Value = FuID { "Screen" }, },`;
  }
  if (mode === 'overlay') {
    return `\n                        ApplyMode = Input { Value = FuID { "Overlay" }, },`;
  }
  if (mode === 'multiply') {
    return `\n                        ApplyMode = Input { Value = FuID { "Multiply" }, },`;
  }
  if (mode === 'add') {
    return `\n                        ApplyMode = Input { Value = FuID { "Normal" }, },\n                        BurnIn = Input { Value = 1, },`;
  }
  return '';
}

function buildLfoLuaExpression(
  baseVal: number,
  lfo: LfoModulatorConfig,
  ampScale = 0.35
): string {
  const freqHz = resolveLfoFrequencyHz(lfo);
  const amp = clamp(lfo.amplitude / 100, 0.01, 1) * ampScale;
  if (lfo.waveform === 'pulse') {
    return `${baseVal.toFixed(3)} + ((((time / 24) * ${freqHz.toFixed(3)}) % 1) < 0.5 and ${amp.toFixed(3)} or ${(-amp).toFixed(3)})`;
  }
  if (lfo.waveform === 'sawtooth') {
    return `${(baseVal - amp).toFixed(3)} + ((((time / 24) * ${freqHz.toFixed(3)}) % 1) * ${(amp * 2).toFixed(3)})`;
  }
  return `${baseVal.toFixed(3)} + ${amp.toFixed(3)} * math.sin((time / 24) * ${(freqHz * Math.PI * 2).toFixed(3)})`;
}

function keyframeTangents(
  curr: KeyframePoint,
  next: KeyframePoint | undefined,
  defaultBezier: BezierHandles
): { inTangent: number; outTangent: number; interp: string } {
  const interp = curr.interpolation ?? 'bezier';
  if (interp === 'hold') return { inTangent: 0, outTangent: 0, interp: 'Hold' };
  if (interp === 'linear') return { inTangent: 1, outTangent: 1, interp: 'Linear' };
  if (interp === 'spring') return { inTangent: 0.25, outTangent: 1.45, interp: 'Spring' };
  const bz = curr.bezier ?? defaultBezier;
  const slopeOut = Number((bz[1] / Math.max(0.05, bz[0])).toFixed(3));
  const slopeIn = next
    ? Number(((1 - bz[3]) / Math.max(0.05, 1 - bz[2])).toFixed(3))
    : 0;
  return { inTangent: slopeIn, outTangent: slopeOut, interp: 'Bezier' };
}

export function compileFusionMacroFromStack(preset: PresetRecord): string {
  const macroName = safeMacroName(preset.name);
  const layers = (preset.layers ?? []).filter((l) => l.enabled);
  const bezier = resolveBezierHandles(preset);
  const phases = resolveTimelinePhases(preset);
  const globalPivot = resolveNormalizedPivot(preset);
  const totalFrames = Math.max(12, Math.round(clamp(preset.durationSeconds || 1.5, 0.5, 8) * 24));
  const inEndFrame = Math.max(2, Math.round(totalFrames * clamp(phases.inRatio, 0.05, 0.45)));
  const outStartFrame = Math.min(
    totalFrames - 2,
    Math.round(totalFrames * (1 - clamp(phases.outRatio, 0.05, 0.45)))
  );

  const motionBlurLayer = layers.find((l) => l.kind === 'motion-blur');
  const globalShutter = motionBlurLayer
    ? clamp(Number(motionBlurLayer.params.shutterAngle ?? 180), 0, 360)
    : 0;

  const [r, g, b] = hexToRgbNorm(preset.accent);
  const tools: string[] = [];
  const exposedInputs: string[] = [];
  let prevOp: string | null = null;
  let firstInputOp: string | null = null;
  let nodeCounter = 0;

  const nextId = (prefix: string) => {
    nodeCounter += 1;
    return `${prefix}_${nodeCounter}`;
  };

  // 1. Transition base (Dissolve A -> B + LUTBezier curve)
  if (preset.category === 'transition') {
    const dissolveId = 'Dissolve1';
    const curveId = 'TransitionCurve';
    const lookupId = 'TransitionLookup';
    tools.push(`                ${dissolveId} = Dissolve {
                    Transitions = {
                        [0] = "DFTDissolve"
                    },
                    CtrlWZoom = false,
                    Inputs = {
                        Mix = Input { SourceOp = "${curveId}", Source = "Value", },
                    },
                    ViewInfo = OperatorInfo { Pos = { 0, 0 } },
                }`);
    tools.push(`                ${curveId} = LUTLookup {
                    CtrlWZoom = false,
                    Inputs = {
                        Source = Input { Value = FuID { "Transition" }, },
                        Curve = Input { Value = FuID { "Bezier" }, },
                        Lookup = Input { SourceOp = "${lookupId}", Source = "Value", },
                    },
                }`);
    tools.push(`                ${lookupId} = LUTBezier {
                    KeyColorSplines = {
                        [0] = {
                            [0] = { 0, RH = { ${bezier[0].toFixed(3)}, ${bezier[1].toFixed(3)} } },
                            [1] = { 1, LH = { ${bezier[2].toFixed(3)}, ${bezier[3].toFixed(3)} } }
                        }
                    },
                    SplineColor = { Red = 255, Green = 255, Blue = 255 },
                    CtrlWZoom = false,
                }`);
    firstInputOp = dissolveId;
    exposedInputs.push(
      `                MainInput1 = InstanceInput { SourceOp = "${dissolveId}", Source = "Background" }`,
      `                MainInput2 = InstanceInput { SourceOp = "${dissolveId}", Source = "Foreground" }`
    );
    prevOp = dissolveId;
  }

  // 2. Typography / Overlay generator base (TextPlus + WriteOn Typewriter Pro + Plate + Shadow)
  const typoLayer = layers.find((l) => l.type === 'typography');
  if (typoLayer || ['title', 'subtitle', 'graphic', 'sticker'].includes(preset.category)) {
    const textVal = preset.text?.trim() || preset.name || 'FRAMEBASE';
    const displayText = preset.uppercase ? textVal.toUpperCase() : textVal;
    const scaleMult = normalizeScaleMultiplier(preset.scale, 1);
    const textSize = Number(clamp(scaleMult * 0.082, 0.025, 0.26).toFixed(4));
    const tracking = Number(normalizeTrackingSpacing(preset.tracking).toFixed(3));
    const posX = Number(normalizeUnitCoord(preset.positionX, 0.5).toFixed(3));
    const posY = Number(normalizeUnitCoord(preset.positionY, preset.category === 'subtitle' ? 0.14 : 0.5).toFixed(3));
    const rotZ = Number((preset.rotationDeg ?? 0).toFixed(2));
    const hJustify = globalPivot.fusionX === 0 ? -1 : globalPivot.fusionX === 1 ? 1 : 0;
    const vJustify = globalPivot.fusionY === 1 ? -1 : globalPivot.fusionY === 0 ? 1 : 0;
    const isPopBounce = typoLayer?.kind === 'pop-bounce' || typoLayer?.kind === 'karaoke';
    const isTypewriter = typoLayer?.kind === 'typewriter';

    const textId = 'TextNode1';
    const splineId = 'TextSizeSpline';
    tools.push(
      buildBezierSplineBlock(
        splineId,
        0,
        inEndFrame,
        isTypewriter ? textSize : isPopBounce ? textSize * 0.2 : textSize * 0.86,
        textSize,
        typoLayer?.bezier ?? bezier
      )
    );

    let writeOnInputs = '';
    let typewriterUserControls = '';
    const extraTypewriterExposed: string[] = [];

    if (isTypewriter) {
      const writeSplineId = 'TextWriteOnSpline';
      const outBehavior = String(typoLayer?.params.outBehavior ?? 'backspace');
      const cursorStyle = String(typoLayer?.params.cursorStyle ?? 'bar');
      const cursorIdx =
        cursorStyle === 'underscore' ? 1 : cursorStyle === 'block' ? 2 : cursorStyle === 'none' ? 3 : 0;
      const jitterNorm = Number(clamp(Number(typoLayer?.params.humanJitter ?? 25) / 100, 0, 1).toFixed(2));

      tools.push(
        buildWriteOnSplineBlock(
          writeSplineId,
          inEndFrame,
          outStartFrame,
          totalFrames,
          typoLayer?.bezier ?? bezier,
          outBehavior
        )
      );

      writeOnInputs = `\n                        Start = Input { Value = 0, },\n                        End = Input { SourceOp = "${writeSplineId}", Source = "Value", },`;
      typewriterUserControls = `,\n                    UserControls = ordered() {
                        VelocidadEscritura = {
                            INPID_InputControl = "SliderControl",
                            INP_Integer = false,
                            INP_Default = 1,
                            INP_MinScale = 0.25,
                            INP_MaxScale = 3,
                            LINKS_Name = "Velocidad Escritura",
                        },
                        EstiloCursor = {
                            INPID_InputControl = "ComboControl",
                            INP_Integer = true,
                            INP_Default = ${cursorIdx},
                            { CCS_AddString = "Barra (|)" },
                            { CCS_AddString = "Guion bajo (_)" },
                            { CCS_AddString = "Bloque" },
                            { CCS_AddString = "Sin cursor" },
                            LINKS_Name = "Estilo Cursor",
                        },
                        Cadencia = {
                            INPID_InputControl = "SliderControl",
                            INP_Integer = false,
                            INP_Default = ${jitterNorm},
                            INP_MinScale = 0,
                            INP_MaxScale = 1,
                            LINKS_Name = "Cadencia",
                        },
                    }`;

      extraTypewriterExposed.push(
        `                TypewriterWriteOn = InstanceInput { SourceOp = "${textId}", Source = "End", Name = "WriteOn (Avance)" }`,
        `                TypewriterSpeed = InstanceInput { SourceOp = "${textId}", Source = "VelocidadEscritura", Name = "Velocidad Escritura", Default = 1 }`,
        `                TypewriterCursor = InstanceInput { SourceOp = "${textId}", Source = "EstiloCursor", Name = "Estilo Cursor", Default = ${cursorIdx} }`,
        `                TypewriterCadence = InstanceInput { SourceOp = "${textId}", Source = "Cadencia", Name = "Cadencia", Default = ${jitterNorm} }`
      );
    }

    tools.push(`                ${textId} = TextPlus {
                    CtrlWZoom = false,
                    Inputs = {
                        GlobalOut = Input { Value = ${totalFrames}, },
                        Width = Input { Value = 1920, },
                        Height = Input { Value = 1080, },
                        UseFrameFormatSettings = Input { Value = 1, },
                        Center = Input { Value = { ${posX}, ${posY} }, },
                        Pivot = Input { Value = { ${globalPivot.fusionX.toFixed(3)}, ${globalPivot.fusionY.toFixed(3)} }, },
                        AngleZ = Input { Value = ${rotZ}, },
                        HorizontalLeftCenterRight = Input { Value = ${hJustify}, },
                        VerticalTopCenterBottom = Input { Value = ${vJustify}, },
                        StyledText = Input { Value = "${escapeLuaString(displayText)}", },
                        Font = Input { Value = "${escapeLuaString(preset.fontFamily ?? 'Segoe UI')}", },
                        Style = Input { Value = "Bold", },
                        Size = Input { SourceOp = "${splineId}", Source = "Value", },
                        CharacterSpacing = Input { Value = ${tracking}, },${writeOnInputs}
                        Red1 = Input { Value = 1, },
                        Green1 = Input { Value = 1, },
                        Blue1 = Input { Value = 1, },
                    },
                    ViewInfo = OperatorInfo { Pos = { 110, 0 } }${typewriterUserControls},
                }`);
    exposedInputs.push(
      `                TitleText = InstanceInput { SourceOp = "${textId}", Source = "StyledText", Name = "Texto" }`,
      `                TitleFont = InstanceInput { SourceOp = "${textId}", Source = "Font", Name = "Tipografía", ControlGroup = 2 }`,
      `                TitleTracking = InstanceInput { SourceOp = "${textId}", Source = "CharacterSpacing", Name = "Tracking", Default = ${tracking} }`,
      `                TitleCenter = InstanceInput { SourceOp = "${textId}", Source = "Center", Name = "Posición" }`,
      ...extraTypewriterExposed
    );

    let overlayChainOp = textId;

    // Companion cursor overlay node with live Lua StyledText Expression for Typewriter Pro
    if (isTypewriter && String(typoLayer?.params.cursorStyle ?? 'bar') !== 'none') {
      const cursorId = 'TypewriterCursor1';
      const cursorMergeId = 'TypewriterCursorMerge1';
      const blinkHz = clamp(Number(typoLayer?.params.cursorBlinkHz ?? 2.5), 0, 6);
      const hideOnComplete = Boolean(typoLayer?.params.hideCursorOnComplete);
      const cursorColorMode = String(typoLayer?.params.cursorColorMode ?? 'accent');
      const [cr, cg, cb] = cursorColorMode === 'white' ? [1, 1, 1] : [r, g, b];
      const blinkExpr =
        blinkHz > 0
          ? `(math.sin((time / 24) * ${(blinkHz * Math.PI * 2).toFixed(3)}) >= -0.15)`
          : 'true';
      const hideExpr = hideOnComplete ? '(TextNode1.End < 0.995)' : 'true';
      const cursorLuaExpr = `Text((TextNode1.EstiloCursor == 3 or not ${hideExpr} or not ${blinkExpr}) and "" or (string.rep(" ", math.max(0, math.floor(#TextNode1.StyledText.Value * TextNode1.End + 0.5))) .. (TextNode1.EstiloCursor == 1 and "_" or (TextNode1.EstiloCursor == 2 and "█" or "|"))))`;

      tools.push(`                ${cursorId} = TextPlus {
                    CtrlWZoom = false,
                    Inputs = {
                        GlobalOut = Input { Value = ${totalFrames}, },
                        Width = Input { Value = 1920, },
                        Height = Input { Value = 1080, },
                        UseFrameFormatSettings = Input { Value = 1, },
                        Center = Input { SourceOp = "${textId}", Source = "Center", },
                        Pivot = Input { Value = { ${globalPivot.fusionX.toFixed(3)}, ${globalPivot.fusionY.toFixed(3)} }, },
                        AngleZ = Input { Value = ${rotZ}, },
                        HorizontalLeftCenterRight = Input { Value = ${hJustify}, },
                        VerticalTopCenterBottom = Input { Value = ${vJustify}, },
                        StyledText = Input {
                            Value = "|",
                            Expression = "${escapeLuaString(cursorLuaExpr)}",
                        },
                        Font = Input { SourceOp = "${textId}", Source = "Font", },
                        Style = Input { Value = "Bold", },
                        Size = Input { SourceOp = "${splineId}", Source = "Value", },
                        CharacterSpacing = Input { SourceOp = "${textId}", Source = "CharacterSpacing", },
                        Red1 = Input { Value = ${cr.toFixed(4)}, },
                        Green1 = Input { Value = ${cg.toFixed(4)}, },
                        Blue1 = Input { Value = ${cb.toFixed(4)}, },
                    },
                    ViewInfo = OperatorInfo { Pos = { 138, 44 } },
                }`);
      tools.push(`                ${cursorMergeId} = Merge {
                    CtrlWZoom = false,
                    Inputs = {
                        Background = Input { SourceOp = "${overlayChainOp}", Source = "Output", },
                        Foreground = Input { SourceOp = "${cursorId}", Source = "Output", },
                    },
                    ViewInfo = OperatorInfo { Pos = { 148, 0 } },
                }`);
      overlayChainOp = cursorMergeId;
    }

    // Optional Background Plate (RectangleMask + Background + Merge, supports Dual Accent gradient)
    const showPlate = preset.backgroundBox ?? preset.category === 'subtitle';
    if (showPlate) {
      const maskId = 'PlateMask1';
      const bgId = 'PlateBg1';
      const mergePlateId = 'PlateMerge1';
      const cornerRadius = Number(clamp((preset.plateRadius ?? 14) / 80, 0, 1).toFixed(3));
      const plateAlpha = Number(clamp((preset.plateOpacity ?? 86) / 100, 0.05, 1).toFixed(3));
      const hasDualAccent = Boolean(preset.secondaryAccent);
      const [r2, g2, b2] = hasDualAccent ? hexToRgbNorm(preset.secondaryAccent!) : [r, g, b];
      const dualGradientInputs = hasDualAccent
        ? `\n                        Type = Input { Value = FuID { "Horizontal" }, },\n                        BottomLeftRed = Input { Value = ${(r * 0.28).toFixed(4)}, },\n                        BottomLeftGreen = Input { Value = ${(g * 0.28).toFixed(4)}, },\n                        BottomLeftBlue = Input { Value = ${(b * 0.32).toFixed(4)}, },\n                        BottomLeftAlpha = Input { Value = ${plateAlpha}, },\n                        TopRightRed = Input { Value = ${(r2 * 0.34).toFixed(4)}, },\n                        TopRightGreen = Input { Value = ${(g2 * 0.34).toFixed(4)}, },\n                        TopRightBlue = Input { Value = ${(b2 * 0.38).toFixed(4)}, },\n                        TopRightAlpha = Input { Value = ${plateAlpha}, },\n                        BottomRightRed = Input { Value = ${(r2 * 0.34).toFixed(4)}, },\n                        BottomRightGreen = Input { Value = ${(g2 * 0.34).toFixed(4)}, },\n                        BottomRightBlue = Input { Value = ${(b2 * 0.38).toFixed(4)}, },\n                        BottomRightAlpha = Input { Value = ${plateAlpha}, },`
        : '';

      tools.push(`                ${maskId} = RectangleMask {
                    CtrlWZoom = false,
                    Inputs = {
                        Center = Input { Value = { ${posX}, ${posY} }, },
                        Width = Input { Value = 0.48, },
                        Height = Input { Value = 0.11, },
                        CornerRadius = Input { Value = ${cornerRadius}, },
                    },
                    ViewInfo = OperatorInfo { Pos = { 110, -88 } },
                }`);
      tools.push(`                ${bgId} = Background {
                    CtrlWZoom = false,
                    Inputs = {
                        GlobalOut = Input { Value = ${totalFrames}, },
                        Width = Input { Value = 1920, },
                        Height = Input { Value = 1080, },
                        UseFrameFormatSettings = Input { Value = 1, },
                        TopLeftRed = Input { Value = ${(r * 0.28).toFixed(4)}, },
                        TopLeftGreen = Input { Value = ${(g * 0.28).toFixed(4)}, },
                        TopLeftBlue = Input { Value = ${(b * 0.32).toFixed(4)}, },
                        TopLeftAlpha = Input { Value = ${plateAlpha}, },${dualGradientInputs}
                        EffectMask = Input { SourceOp = "${maskId}", Source = "Mask", },
                    },
                    ViewInfo = OperatorInfo { Pos = { 110, -44 } },
                }`);
      tools.push(`                ${mergePlateId} = Merge {
                    CtrlWZoom = false,
                    Inputs = {
                        Background = Input { SourceOp = "${bgId}", Source = "Output", },
                        Foreground = Input { SourceOp = "${overlayChainOp}", Source = "Output", },
                    },
                    ViewInfo = OperatorInfo { Pos = { 165, 0 } },
                }`);
      overlayChainOp = mergePlateId;
    }

    // Optional Cinema Drop Shadow
    if (preset.shadow !== false) {
      const shadowId = 'TextShadow1';
      tools.push(`                ${shadowId} = Shadow {
                    CtrlWZoom = false,
                    Inputs = {
                        ShadowOffset = Input { Value = { 0.004, -0.008 }, },
                        Softness = Input { Value = 0.018, },
                        Alpha = Input { Value = 0.72, },
                        Input = Input { SourceOp = "${overlayChainOp}", Source = "Output", },
                    },
                    ViewInfo = OperatorInfo { Pos = { 220, 0 } },
                }`);
      overlayChainOp = shadowId;
    }

    if (prevOp) {
      const mergeId = nextId('MergeTitle');
      const blendInputs = buildBlendModeInputs(typoLayer?.blendMode);
      tools.push(`                ${mergeId} = Merge {
                    CtrlWZoom = false,
                    Inputs = {
                        Background = Input { SourceOp = "${prevOp}", Source = "Output", },
                        Foreground = Input { SourceOp = "${overlayChainOp}", Source = "Output", },${blendInputs}
                    },
                    ViewInfo = OperatorInfo { Pos = { 275, 0 } },
                }`);
      prevOp = mergeId;
    } else if (typoLayer?.blendMode && typoLayer.blendMode !== 'normal') {
      const mergeId = nextId('MergeBlend');
      const blendInputs = buildBlendModeInputs(typoLayer.blendMode);
      tools.push(`                ${mergeId} = Merge {
                    CtrlWZoom = false,
                    Inputs = {
                        Foreground = Input { SourceOp = "${overlayChainOp}", Source = "Output", },${blendInputs}
                    },
                    ViewInfo = OperatorInfo { Pos = { 275, 0 } },
                }`);
      firstInputOp = mergeId;
      exposedInputs.push(`                MainInput1 = InstanceInput { SourceOp = "${mergeId}", Source = "Background" }`);
      prevOp = mergeId;
    } else {
      firstInputOp = textId;
      prevOp = overlayChainOp;
    }
  }

  // 3. Chain every active EffectStack node in serial order
  for (const layer of layers) {
    if (layer.type === 'typography') continue;

    const normInt = clamp(layer.intensity / 100, 0, 1);
    const inputLine = prevOp
      ? `\n                        Input = Input { SourceOp = "${prevOp}", Source = "Output", },`
      : '';

    if (
      layer.kind === 'punch-in' ||
      layer.kind === 'float-drift' ||
      layer.kind === 'speed-ramp' ||
      layer.kind === 'zoom' ||
      layer.kind === 'whip' ||
      layer.kind === 'spin' ||
      layer.kind === 'directional-swish'
    ) {
      const xformId = nextId('Transform');
      const splineId = nextId('TransformSpline');
      const startScale = layer.kind === 'punch-in' ? Number(layer.params.startScale ?? 100) / 100 : 1;
      const endScale =
        layer.kind === 'punch-in'
          ? 1 + ((Number(layer.params.endScale ?? 128) / 100) - 1) * normInt
          : layer.kind === 'zoom'
            ? 1 + normInt * 0.45
            : 1;
      const angle = layer.kind === 'spin' ? Number(layer.params.angleDeg ?? 90) * normInt : 0;
      const hasCustomAnchor =
        layer.params.anchorX !== undefined &&
        layer.params.anchorY !== undefined &&
        (Number(layer.params.anchorX) !== 50 || Number(layer.params.anchorY) !== 50);
      const anchorX = hasCustomAnchor
        ? clamp(Number(layer.params.anchorX) / 100, 0, 1)
        : globalPivot.fusionX;
      const anchorY = hasCustomAnchor
        ? clamp(1 - Number(layer.params.anchorY) / 100, 0, 1)
        : globalPivot.fusionY;
      const shutter = clamp(Number(layer.params.shutterAngle ?? globalShutter), 0, 360);
      const mbBlock =
        shutter > 0
          ? `\n                        MotionBlur = Input { Value = 1, },\n                        Quality = Input { Value = 6, },\n                        ShutterAngle = Input { Value = ${Math.round(shutter)}, },`
          : '';

      tools.push(
        buildBezierSplineBlock(
          splineId,
          0,
          inEndFrame,
          startScale,
          endScale,
          layer.bezier ?? bezier
        )
      );
      tools.push(`                ${xformId} = Transform {
                    CtrlWZoom = false,
                    Inputs = {
                        Pivot = Input { Value = { ${anchorX.toFixed(3)}, ${anchorY.toFixed(3)} }, },
                        Size = Input { SourceOp = "${splineId}", Source = "Value", },
                        Angle = Input { Value = ${angle.toFixed(2)}, },${mbBlock}${inputLine}
                    },
                    ViewInfo = OperatorInfo { Pos = { ${nodeCounter * 130 + 220}, 0 } },
                }`);
      if (!firstInputOp) {
        firstInputOp = xformId;
        exposedInputs.push(`                MainInput1 = InstanceInput { SourceOp = "${xformId}", Source = "Input" }`);
      }
      exposedInputs.push(
        `                ${xformId}_Pivot = InstanceInput { SourceOp = "${xformId}", Source = "Pivot", Name = "${escapeLuaString(layer.name)} · Anclaje" }`
      );
      prevOp = xformId;
    } else if (layer.kind === 'camera-shake') {
      const shakeId = nextId('CameraShake');
      const ampX = Number(clamp((Number(layer.params.amplitudeX ?? 12) / 100) * normInt, 0.002, 0.25).toFixed(4));
      const ampY = Number(clamp((Number(layer.params.amplitudeY ?? 10) / 100) * normInt, 0.002, 0.25).toFixed(4));
      const freq = Number(clamp(Number(layer.params.frequencyHz ?? 8) * 0.12, 0.1, 4).toFixed(3));
      const rot = Number((Number(layer.params.rotationDeg ?? 2) * normInt).toFixed(2));
      const seed = Math.round(Number(layer.params.seed ?? 42));
      const mbBlock =
        globalShutter > 0
          ? `\n                        MotionBlur = Input { Value = 1, },\n                        Quality = Input { Value = 5, },\n                        ShutterAngle = Input { Value = ${Math.round(globalShutter)}, },`
          : '';
      tools.push(`                ${shakeId} = CameraShake {
                    CtrlWZoom = false,
                    Inputs = {
                        XDeviation = Input { Value = ${ampX}, },
                        YDeviation = Input { Value = ${ampY}, },
                        RotationDeviation = Input { Value = ${rot}, },
                        Speed = Input { Value = ${freq}, },
                        RandomSeed = Input { Value = ${seed}, },${mbBlock}${inputLine}
                    },
                    ViewInfo = OperatorInfo { Pos = { ${nodeCounter * 130 + 220}, 0 } },
                }`);
      if (!firstInputOp) {
        firstInputOp = shakeId;
        exposedInputs.push(`                MainInput1 = InstanceInput { SourceOp = "${shakeId}", Source = "Input" }`);
      }
      exposedInputs.push(
        `                ${shakeId}_Speed = InstanceInput { SourceOp = "${shakeId}", Source = "Speed", Name = "Shake · Frecuencia", Default = ${freq} }`,
        `                ${shakeId}_XDev = InstanceInput { SourceOp = "${shakeId}", Source = "XDeviation", Name = "Shake · Amplitud X", Default = ${ampX} }`
      );
      prevOp = shakeId;
    } else if (layer.kind === 'motion-blur' || layer.kind === 'blur') {
      const blurId = nextId('DirectionalBlur');
      const lengthVal =
        layer.kind === 'motion-blur'
          ? clamp((Number(layer.params.shutterAngle ?? 180) / 360) * 0.028 * normInt, 0.001, 0.08)
          : clamp((Number(layer.params.radiusPx ?? 12) / 400) * normInt, 0.001, 0.08);
      const angle = Number(layer.params.angleDeg ?? 0);
      tools.push(`                ${blurId} = DirectionalBlur {
                    CtrlWZoom = false,
                    Inputs = {
                        Length = Input { Value = ${lengthVal.toFixed(4)}, },
                        Angle = Input { Value = ${angle.toFixed(1)}, },${inputLine}
                    },
                    ViewInfo = OperatorInfo { Pos = { ${nodeCounter * 130 + 220}, 0 } },
                }`);
      if (!firstInputOp) {
        firstInputOp = blurId;
        exposedInputs.push(`                MainInput1 = InstanceInput { SourceOp = "${blurId}", Source = "Input" }`);
      }
      exposedInputs.push(
        `                ${blurId}_Len = InstanceInput { SourceOp = "${blurId}", Source = "Length", Name = "${escapeLuaString(layer.name)} · Intensidad", Default = ${lengthVal.toFixed(4)} }`
      );
      prevOp = blurId;
    } else if (layer.kind === 'glow' || layer.kind === 'halation' || layer.kind === 'flash') {
      const glowId = nextId('SoftGlow');
      const spread = clamp(Number(layer.params.spread ?? 40) * 0.4, 2, 40);
      const gain = clamp(normInt * 1.45, 0.1, 2);
      const isHalation = layer.kind === 'halation';
      tools.push(`                ${glowId} = SoftGlow {
                    CtrlWZoom = false,
                    Inputs = {
                        Filter = Input { Value = FuID { "Fast Gaussian" }, },
                        Threshold = Input { Value = ${isHalation ? 0.56 : 0.36}, },
                        Gain = Input { Value = ${gain.toFixed(2)}, },
                        XGlowSize = Input { Value = ${spread.toFixed(1)}, },
                        RedScale = Input { Value = ${isHalation ? '1.000' : (0.7 + r * 0.3).toFixed(3)}, },
                        GreenScale = Input { Value = ${isHalation ? '0.420' : (0.7 + g * 0.3).toFixed(3)}, },
                        BlueScale = Input { Value = ${isHalation ? '0.190' : (0.7 + b * 0.3).toFixed(3)}, },${inputLine}
                    },
                    ViewInfo = OperatorInfo { Pos = { ${nodeCounter * 130 + 220}, 0 } },
                }`);
      if (!firstInputOp) {
        firstInputOp = glowId;
        exposedInputs.push(`                MainInput1 = InstanceInput { SourceOp = "${glowId}", Source = "Input" }`);
      }
      exposedInputs.push(
        `                ${glowId}_Gain = InstanceInput { SourceOp = "${glowId}", Source = "Gain", Name = "${escapeLuaString(layer.name)} · Brillo", Default = ${gain.toFixed(2)} }`,
        `                ${glowId}_Size = InstanceInput { SourceOp = "${glowId}", Source = "XGlowSize", Name = "${escapeLuaString(layer.name)} · Difusión", Default = ${spread.toFixed(1)} }`
      );
      prevOp = glowId;
    } else if (layer.kind === 'chromatic-aberration' || layer.kind === 'glitch') {
      const prismId = nextId('PrismBlur');
      const aberration = clamp((Number(layer.params.shiftPx ?? 10) / 24) * normInt, 0.02, 0.85);
      tools.push(`                ${prismId} = PrismBlur {
                    CtrlWZoom = false,
                    Inputs = {
                        BlurStrength = Input { Value = 0.06, },
                        Aberration = Input { Value = ${aberration.toFixed(3)}, },${inputLine}
                    },
                    ViewInfo = OperatorInfo { Pos = { ${nodeCounter * 130 + 220}, 0 } },
                }`);
      if (!firstInputOp) {
        firstInputOp = prismId;
        exposedInputs.push(`                MainInput1 = InstanceInput { SourceOp = "${prismId}", Source = "Input" }`);
      }
      exposedInputs.push(
        `                ${prismId}_Ab = InstanceInput { SourceOp = "${prismId}", Source = "Aberration", Name = "RGB Split · Desfase", Default = ${aberration.toFixed(3)} }`
      );
      prevOp = prismId;
    } else if (layer.kind === 'film-grain' || layer.kind === 'vhs-crt') {
      const grainId = nextId('FilmGrain');
      const stock = String(layer.params.stock ?? '35mm');
      const stockMult = stock === '8mm' ? 1.55 : stock === '16mm' ? 1.2 : 0.9;
      const power = clamp(normInt * 0.55 * stockMult, 0.04, 1);
      const size = clamp((Number(layer.params.grainSize ?? 38) / 22) * stockMult, 0.5, 4.5);
      tools.push(`                ${grainId} = FilmGrain {
                    CtrlWZoom = false,
                    Inputs = {
                        Power = Input { Value = ${power.toFixed(3)}, },
                        Size = Input { Value = ${size.toFixed(2)}, },${inputLine}
                    },
                    ViewInfo = OperatorInfo { Pos = { ${nodeCounter * 130 + 220}, 0 } },
                }`);
      if (!firstInputOp) {
        firstInputOp = grainId;
        exposedInputs.push(`                MainInput1 = InstanceInput { SourceOp = "${grainId}", Source = "Input" }`);
      }
      exposedInputs.push(
        `                ${grainId}_Power = InstanceInput { SourceOp = "${grainId}", Source = "Power", Name = "${escapeLuaString(layer.name)} · Intensidad", Default = ${power.toFixed(3)} }`
      );
      prevOp = grainId;
    } else if (layer.kind === 'lens-distortion') {
      const lensId = nextId('LensDistort');
      const dist = clamp((Number(layer.params.curvature ?? 30) / 100) * normInt * 0.6, -0.5, 0.5);
      tools.push(`                ${lensId} = LensDistort {
                    CtrlWZoom = false,
                    Inputs = {
                        LensDistortionModel = Input { Value = 0, },
                        Distortion = Input { Value = ${dist.toFixed(3)}, },${inputLine}
                    },
                    ViewInfo = OperatorInfo { Pos = { ${nodeCounter * 130 + 220}, 0 } },
                }`);
      if (!firstInputOp) {
        firstInputOp = lensId;
        exposedInputs.push(`                MainInput1 = InstanceInput { SourceOp = "${lensId}", Source = "Input" }`);
      }
      prevOp = lensId;
    } else if (layer.kind === 'vignette' || layer.kind === 'luma-fade' || layer.kind === 'lut') {
      const maskId = nextId('VignetteMask');
      const gradeId = nextId('GradeNode');
      const softEdge = clamp(Number(layer.params.spread ?? 55) / 140, 0.08, 0.5);
      const blendVal = layer.kind === 'lut' ? clamp((preset.lutMix ?? 75) / 100, 0, 1) : 1;
      const darkGain = layer.kind === 'lut' ? 1.04 : clamp(1 - normInt * 0.45, 0.2, 0.95);
      if (layer.kind === 'vignette') {
        tools.push(`                ${maskId} = EllipseMask {
                    CtrlWZoom = false,
                    Inputs = {
                        Filter = Input { Value = FuID { "Fast Gaussian" }, },
                        Invert = Input { Value = 1, },
                        SoftEdge = Input { Value = ${softEdge.toFixed(3)}, },
                        Center = Input { Value = { 0.5, 0.5 }, },
                        Width = Input { Value = 0.84, },
                        Height = Input { Value = 0.84, },
                    },
                    ViewInfo = OperatorInfo { Pos = { ${nodeCounter * 130 + 220}, 66 } },
                }`);
      }
      const maskRef =
        layer.kind === 'vignette'
          ? `\n                        EffectMask = Input { SourceOp = "${maskId}", Source = "Mask", },`
          : '';
      tools.push(`                ${gradeId} = BrightnessContrast {
                    CtrlWZoom = false,
                    Inputs = {
                        Gain = Input { Value = ${darkGain.toFixed(3)}, },
                        Gamma = Input { Value = 0.92, },
                        Contrast = Input { Value = ${layer.kind === 'lut' ? '0.08' : '0.02'}, },
                        Blend = Input { Value = ${blendVal.toFixed(3)}, },${maskRef}${inputLine}
                    },
                    ViewInfo = OperatorInfo { Pos = { ${nodeCounter * 130 + 220}, 0 } },
                }`);
      if (!firstInputOp) {
        firstInputOp = gradeId;
        exposedInputs.push(`                MainInput1 = InstanceInput { SourceOp = "${gradeId}", Source = "Input" }`);
      }
      exposedInputs.push(
        `                ${gradeId}_Blend = InstanceInput { SourceOp = "${gradeId}", Source = "Blend", Name = "${escapeLuaString(layer.name)} · Mezcla", Default = ${blendVal.toFixed(3)} }`
      );
      prevOp = gradeId;
    } else if (layer.kind === 'pip-frame') {
      const pipXformId = nextId('PiPTransform');
      const shadowId = nextId('DropShadow');
      const pipScale = clamp(Number(layer.params.pipScale ?? 84) / 100, 0.4, 1);
      tools.push(`                ${pipXformId} = Transform {
                    CtrlWZoom = false,
                    Inputs = {
                        Size = Input { Value = ${pipScale.toFixed(3)}, },${inputLine}
                    },
                    ViewInfo = OperatorInfo { Pos = { ${nodeCounter * 130 + 200}, 0 } },
                }`);
      tools.push(`                ${shadowId} = Shadow {
                    CtrlWZoom = false,
                    Inputs = {
                        ShadowOffset = Input { Value = { 0.012, -0.016 }, },
                        Softness = Input { Value = ${clamp(normInt * 0.04, 0.005, 0.06).toFixed(4)}, },
                        Input = Input { SourceOp = "${pipXformId}", Source = "Output", },
                    },
                    ViewInfo = OperatorInfo { Pos = { ${nodeCounter * 130 + 260}, 0 } },
                }`);
      if (!firstInputOp) {
        firstInputOp = pipXformId;
        exposedInputs.push(`                MainInput1 = InstanceInput { SourceOp = "${pipXformId}", Source = "Input" }`);
      }
      exposedInputs.push(
        `                ${pipXformId}_Size = InstanceInput { SourceOp = "${pipXformId}", Source = "Size", Name = "PiP · Escala", Default = ${pipScale.toFixed(3)} }`
      );
      prevOp = shadowId;
    }
  }

  // Fallback operator if stack had no visual nodes
  if (!prevOp) {
    const fallbackId = 'TransformBase1';
    tools.push(`                ${fallbackId} = Transform {
                    CtrlWZoom = false,
                    ViewInfo = OperatorInfo { Pos = { 0, 0 } },
                }`);
    firstInputOp = fallbackId;
    exposedInputs.push(`                MainInput1 = InstanceInput { SourceOp = "${fallbackId}", Source = "Input" }`);
    prevOp = fallbackId;
  }

  // 3B. Procedural Modulators, Mask Reveal, Trim Paths & Layer Blend Modes
  for (const layer of layers) {
    const mods = layer.modulators;

    if (mods?.spring?.enabled) {
      const springSplineId = nextId('SpringSpline');
      const baked = bakeSpringKeyframes(0, inEndFrame, 0.72, 1.0, mods.spring, 2);
      const springXformId = nextId('SpringTransform');
      tools.push(`                ${springSplineId} = BezierSpline {
                    SplineColor = { Red = 52, Green = 211, Blue = 153 },
                    CtrlWZoom = false,
                    KeyFrames = {
${baked.map((pt) => `                        [${pt.frame}] = { ${pt.value.toFixed(4)} }`).join(',\n')}
                    }
                }`);
      tools.push(`                ${springXformId} = Transform {
                    CtrlWZoom = false,
                    Inputs = {
                        Pivot = Input { Value = { ${globalPivot.fusionX.toFixed(3)}, ${globalPivot.fusionY.toFixed(3)} }, },
                        Size = Input { SourceOp = "${springSplineId}", Source = "Value", },
                        Input = Input { SourceOp = "${prevOp}", Source = "Output", },
                    },
                    ViewInfo = OperatorInfo { Pos = { ${nodeCounter * 130 + 240}, 66 } },
                }`);
      prevOp = springXformId;
    }

    if (mods?.wiggle?.enabled) {
      const targetProp = mods.wiggle.target;
      const perturbId = nextId('PerturbMod');
      const ampNorm = clamp(mods.wiggle.amplitude / 100, 0.01, 1);
      const strength =
        targetProp === 'rotation'
          ? Number((ampNorm * 14).toFixed(3))
          : targetProp === 'scale'
            ? Number((ampNorm * 0.25).toFixed(4))
            : targetProp === 'glow'
              ? Number((ampNorm * 1.2).toFixed(3))
              : Number((ampNorm * 0.06).toFixed(4));
      const baseValue = targetProp === 'rotation' ? 0 : 1;

      tools.push(`                ${perturbId} = Perturb {
                    CtrlWZoom = false,
                    Inputs = {
                        Value = Input { Value = ${baseValue}, },
                        Strength = Input { Value = ${strength}, },
                        Wobble = Input { Value = ${mods.wiggle.frequencyHz.toFixed(2)}, },
                        Seed = Input { Value = ${Math.round(mods.wiggle.seed)}, },
                    },
                }`);

      if (targetProp === 'glow') {
        const glowModId = nextId('WiggleGlow');
        tools.push(`                ${glowModId} = SoftGlow {
                    CtrlWZoom = false,
                    Inputs = {
                        Gain = Input { SourceOp = "${perturbId}", Source = "Value", },
                        XGlowSize = Input { Value = 14.0, },
                        Input = Input { SourceOp = "${prevOp}", Source = "Output", },
                    },
                    ViewInfo = OperatorInfo { Pos = { ${nodeCounter * 130 + 240}, 66 } },
                }`);
        prevOp = glowModId;
      } else {
        const wiggleXformId = nextId('WiggleTransform');
        let modInput = `Angle = Input { SourceOp = "${perturbId}", Source = "Value", }`;
        if (targetProp === 'scale') {
          modInput = `Size = Input { SourceOp = "${perturbId}", Source = "Value", }`;
        } else if (targetProp === 'position') {
          const perturbYId = nextId('PerturbModY');
          const xyPathId = nextId('WiggleXYPath');
          tools.push(`                ${perturbYId} = Perturb {
                    CtrlWZoom = false,
                    Inputs = {
                        Value = Input { Value = 0.5, },
                        Strength = Input { Value = ${strength}, },
                        Wobble = Input { Value = ${(mods.wiggle.frequencyHz * 0.91).toFixed(2)}, },
                        Seed = Input { Value = ${Math.round(mods.wiggle.seed + 13)}, },
                    },
                }`);
          tools.push(`                ${xyPathId} = XYPath {
                    ShowKeyPoints = false,
                    DrawMode = "ModifyOnly",
                    CtrlWZoom = false,
                    Inputs = {
                        X = Input { SourceOp = "${perturbId}", Source = "Value", },
                        Y = Input { SourceOp = "${perturbYId}", Source = "Value", },
                    },
                }`);
          modInput = `Center = Input { SourceOp = "${xyPathId}", Source = "Value", }`;
        }
        tools.push(`                ${wiggleXformId} = Transform {
                    CtrlWZoom = false,
                    Inputs = {
                        Pivot = Input { Value = { ${globalPivot.fusionX.toFixed(3)}, ${globalPivot.fusionY.toFixed(3)} }, },
                        ${modInput},
                        Input = Input { SourceOp = "${prevOp}", Source = "Output", },
                    },
                    ViewInfo = OperatorInfo { Pos = { ${nodeCounter * 130 + 240}, 66 } },
                }`);
        prevOp = wiggleXformId;
      }
    }

    if (mods?.lfo?.enabled) {
      const lfoTarget = mods.lfo.target;
      if (lfoTarget === 'glow') {
        const lfoGlowId = nextId('LfoSoftGlow');
        const expr = buildLfoLuaExpression(0.85, mods.lfo, 0.7);
        tools.push(`                ${lfoGlowId} = SoftGlow {
                    CtrlWZoom = false,
                    Inputs = {
                        Gain = Input { Value = 0.85, Expression = "${escapeLuaString(expr)}", },
                        XGlowSize = Input { Value = 16.0, },
                        Input = Input { SourceOp = "${prevOp}", Source = "Output", },
                    },
                    ViewInfo = OperatorInfo { Pos = { ${nodeCounter * 130 + 240}, 90 } },
                }`);
        prevOp = lfoGlowId;
      } else {
        const lfoXformId = nextId('LfoTransform');
        const paramName =
          lfoTarget === 'scale'
            ? 'Size'
            : lfoTarget === 'rotation'
              ? 'Angle'
              : 'Blend';
        const baseVal = lfoTarget === 'rotation' ? 0 : 1;
        const scaleAmt = lfoTarget === 'rotation' ? 12 : lfoTarget === 'opacity' ? 0.35 : 0.22;
        const expr = buildLfoLuaExpression(baseVal, mods.lfo, scaleAmt);
        tools.push(`                ${lfoXformId} = Transform {
                    CtrlWZoom = false,
                    Inputs = {
                        ${paramName} = Input { Value = ${baseVal}, Expression = "${escapeLuaString(expr)}", },
                        Input = Input { SourceOp = "${prevOp}", Source = "Output", },
                    },
                    ViewInfo = OperatorInfo { Pos = { ${nodeCounter * 130 + 240}, 90 } },
                }`);
        prevOp = lfoXformId;
      }
    }

    if (layer.maskReveal?.enabled) {
      const revealMaskId = nextId('RevealMask');
      const revealSplineId = nextId('RevealSpline');
      const revealFilterId = nextId('MaskRevealGrade');
      const featherNorm = Number(clamp(layer.maskReveal.featherPx / 1080, 0, 0.08).toFixed(4));
      const isHorizontal =
        layer.maskReveal.direction === 'left' || layer.maskReveal.direction === 'right';
      tools.push(
        buildBezierSplineBlock(
          revealSplineId,
          0,
          inEndFrame,
          0.0,
          1.0,
          layer.bezier ?? bezier
        )
      );
      tools.push(`                ${revealMaskId} = RectangleMask {
                    CtrlWZoom = false,
                    Inputs = {
                        Filter = Input { Value = FuID { "Fast Gaussian" }, },
                        SoftEdge = Input { Value = ${featherNorm}, },
                        Center = Input { Value = { 0.5, 0.5 }, },
                        ${isHorizontal ? `Width = Input { SourceOp = "${revealSplineId}", Source = "Value", },\n                        Height = Input { Value = 1.0, },` : `Width = Input { Value = 1.0, },\n                        Height = Input { SourceOp = "${revealSplineId}", Source = "Value", },`}
                    },
                    ViewInfo = OperatorInfo { Pos = { ${nodeCounter * 130 + 240}, 115 } },
                }`);
      tools.push(`                ${revealFilterId} = BrightnessContrast {
                    CtrlWZoom = false,
                    Inputs = {
                        EffectMask = Input { SourceOp = "${revealMaskId}", Source = "Mask", },
                        Input = Input { SourceOp = "${prevOp}", Source = "Output", },
                    },
                    ViewInfo = OperatorInfo { Pos = { ${nodeCounter * 130 + 260}, 115 } },
                }`);
      prevOp = revealFilterId;
    }

    if (layer.trimPaths?.enabled) {
      const trimSplineId = nextId('TrimWriteOn');
      const trimMaskId = nextId('TrimStrokeMask');
      const trimMergeId = nextId('TrimStrokeMerge');
      const startFrac = clamp(layer.trimPaths.startPct / 100, 0, 1);
      const endFrac = clamp(layer.trimPaths.endPct / 100, 0, 1);
      tools.push(
        buildBezierSplineBlock(
          trimSplineId,
          0,
          inEndFrame,
          startFrac * 0.008,
          Math.max(0.004, endFrac * 0.012),
          layer.bezier ?? bezier
        )
      );
      tools.push(`                ${trimMaskId} = RectangleMask {
                    CtrlWZoom = false,
                    Inputs = {
                        Solid = Input { Value = 0, },
                        BorderWidth = Input { SourceOp = "${trimSplineId}", Source = "Value", },
                        WriteOn = Input { Value = ${endFrac.toFixed(3)}, },
                        Center = Input { Value = { 0.5, 0.5 }, },
                        Width = Input { Value = 0.72, },
                        Height = Input { Value = 0.24, },
                    },
                    ViewInfo = OperatorInfo { Pos = { ${nodeCounter * 130 + 240}, 140 } },
                }`);
      tools.push(`                ${trimMergeId} = Merge {
                    CtrlWZoom = false,
                    Inputs = {
                        Background = Input { SourceOp = "${prevOp}", Source = "Output", },
                        EffectMask = Input { SourceOp = "${trimMaskId}", Source = "Mask", },
                    },
                    ViewInfo = OperatorInfo { Pos = { ${nodeCounter * 130 + 260}, 140 } },
                }`);
      prevOp = trimMergeId;
    }

    if (layer.type !== 'typography' && layer.blendMode && layer.blendMode !== 'normal') {
      const blendMergeId = nextId('LayerBlendMerge');
      const blendInputs = buildBlendModeInputs(layer.blendMode);
      tools.push(`                ${blendMergeId} = Merge {
                    CtrlWZoom = false,
                    Inputs = {
                        Background = Input { SourceOp = "${prevOp}", Source = "Output", },
                        Foreground = Input { SourceOp = "${prevOp}", Source = "Output", },${blendInputs}
                    },
                    ViewInfo = OperatorInfo { Pos = { ${nodeCounter * 130 + 260}, 165 } },
                }`);
      prevOp = blendMergeId;
    }
  }

  // 3C. Multi-Track Dope Sheet Keyframes (XYPath + Transform / Blend / Gain BezierSplines)
  const tracks = preset.keyframeTracks ?? [];
  const xTrack = tracks.find((t) => t.property === 'positionX' && t.keyframes.length > 0);
  const yTrack = tracks.find((t) => t.property === 'positionY' && t.keyframes.length > 0);
  const scaleTrack = tracks.find((t) => t.property === 'scale' && t.keyframes.length > 0);
  const rotTrack = tracks.find((t) => t.property === 'rotation' && t.keyframes.length > 0);
  const opacityTrack = tracks.find((t) => t.property === 'opacity' && t.keyframes.length > 0);
  const opticalTrack = tracks.find((t) => t.property === 'opticalIntensity' && t.keyframes.length > 0);

  if (xTrack || yTrack || scaleTrack || rotTrack || opacityTrack) {
    const kfXformId = 'KeyframeMotionTransform1';
    const xformInputs: string[] = [
      `                        Pivot = Input { Value = { ${globalPivot.fusionX.toFixed(3)}, ${globalPivot.fusionY.toFixed(3)} }, },`,
    ];

    if (xTrack && yTrack) {
      const spXId = 'MotionPathX';
      const spYId = 'MotionPathY';
      const xyId = 'CenterXYPath';
      tools.push(buildKeyframeTrackSplineBlock(spXId, xTrack, bezier, (v) => clamp(v, 0, 1)));
      tools.push(buildKeyframeTrackSplineBlock(spYId, yTrack, bezier, (v) => clamp(v, 0, 1)));
      tools.push(`                ${xyId} = XYPath {
                    ShowKeyPoints = false,
                    DrawMode = "ModifyOnly",
                    CtrlWZoom = false,
                    Inputs = {
                        X = Input { SourceOp = "${spXId}", Source = "Value", },
                        Y = Input { SourceOp = "${spYId}", Source = "Value", },
                    },
                }`);
      xformInputs.push(`                        Center = Input { SourceOp = "${xyId}", Source = "Value", },`);
    }

    if (scaleTrack) {
      const spScaleId = 'KeyframeScaleSpline';
      tools.push(buildKeyframeTrackSplineBlock(spScaleId, scaleTrack, bezier, (v) => clamp(v, 0.1, 4)));
      xformInputs.push(`                        Size = Input { SourceOp = "${spScaleId}", Source = "Value", },`);
    }

    if (rotTrack) {
      const spRotId = 'KeyframeAngleSpline';
      tools.push(buildKeyframeTrackSplineBlock(spRotId, rotTrack, bezier));
      xformInputs.push(`                        Angle = Input { SourceOp = "${spRotId}", Source = "Value", },`);
    }

    if (opacityTrack) {
      const spOpId = 'KeyframeBlendSpline';
      tools.push(
        buildKeyframeTrackSplineBlock(spOpId, opacityTrack, bezier, (v) => clamp(v / 100, 0, 1))
      );
      xformInputs.push(`                        Blend = Input { SourceOp = "${spOpId}", Source = "Value", },`);
    }

    xformInputs.push(`                        Input = Input { SourceOp = "${prevOp}", Source = "Output", },`);
    tools.push(`                ${kfXformId} = Transform {
                    CtrlWZoom = false,
                    Inputs = {
${xformInputs.join('\n')}
                    },
                    ViewInfo = OperatorInfo { Pos = { ${(nodeCounter + 2) * 130}, 0 } },
                }`);
    prevOp = kfXformId;
  }

  if (opticalTrack) {
    const spOptId = 'KeyframeOpticalSpline';
    const optGlowId = 'KeyframeOpticalGlow1';
    tools.push(
      buildKeyframeTrackSplineBlock(spOptId, opticalTrack, bezier, (v) => clamp((v / 100) * 1.4, 0, 2))
    );
    tools.push(`                ${optGlowId} = SoftGlow {
                    CtrlWZoom = false,
                    Inputs = {
                        Gain = Input { SourceOp = "${spOptId}", Source = "Value", },
                        XGlowSize = Input { Value = 16.0, },
                        Input = Input { SourceOp = "${prevOp}", Source = "Output", },
                    },
                    ViewInfo = OperatorInfo { Pos = { ${(nodeCounter + 2) * 130 + 60}, 0 } },
                }`);
    prevOp = optGlowId;
  }

  // 4. KeyframeStretcher for responsive 3-phase timing (In / Sustain / Out)
  if (phases.autoScaleDuration) {
    const stretcherId = 'KeyframeStretcher1';
    tools.push(`                ${stretcherId} = KeyframeStretcher {
                    CtrlWZoom = false,
                    Inputs = {
                        SourceStart = Input { Value = 0, },
                        SourceEnd = Input { Value = ${totalFrames}, },
                        StretchStart = Input { Value = ${inEndFrame}, },
                        StretchEnd = Input { Value = ${outStartFrame}, },
                        Input = Input { SourceOp = "${prevOp}", Source = "Output", },
                    },
                    ViewInfo = OperatorInfo { Pos = { ${(nodeCounter + 3) * 130}, 0 } },
                }`);
    prevOp = stretcherId;
  }

  return `{
    Tools = ordered() {
        ${macroName} = MacroOperator {
            Inputs = ordered() {
${exposedInputs.join(',\n')}
            },
            Outputs = {
                MainOutput1 = InstanceOutput { SourceOp = "${prevOp}", Source = "Output" }
            },
            ViewInfo = GroupInfo { Pos = { 0, 0 } },
            Tools = ordered() {
${tools.join(',\n')}
            },
        }
    },
    ActiveTool = "${macroName}"
}
`;
}

export function compilePremiereStackXml(preset: PresetRecord): string {
  const layers = (preset.layers ?? []).filter((l) => l.enabled);
  const bezier = resolveBezierHandles(preset);
  const phases = resolveTimelinePhases(preset);
  const durationTicks = Math.round(clamp(preset.durationSeconds || 1.5, 0.5, 8) * 254016000000);
  const inEndTicks = Math.round(durationTicks * clamp(phases.inRatio, 0.05, 0.45));
  const outStartTicks = Math.round(durationTicks * (1 - clamp(phases.outRatio, 0.05, 0.45)));

  const components: string[] = [];
  let objectId = 10;

  const pushComponent = (matchName: string, displayName: string, paramsXml: string) => {
    const compId = objectId;
    objectId += 1;
    components.push(`    <VideoFilterComponent ObjectID="${compId}" ClassID="${escapeXml(matchName)}">
      <DisplayName>${escapeXml(displayName)}</DisplayName>
      <MatchName>${escapeXml(matchName)}</MatchName>
      <Params>
${paramsXml}
      </Params>
    </VideoFilterComponent>`);
  };

  const tracks = preset.keyframeTracks ?? [];
  const TICKS_PER_SEC = 254016000000;

  const formatKeyframesXml = (trackList: KeyframeTrack[], indent = '        '): string => {
    if (trackList.length === 0) return '';
    const blocks = trackList
      .filter((tr) => tr.keyframes.length > 0)
      .map((tr) => {
        const sorted = sortKeyframes(tr.keyframes);
        const kfNodes = sorted
          .map((kf, idx) => {
            const ticks = Math.round(kf.time * TICKS_PER_SEC);
            const { inTangent, outTangent, interp } = keyframeTangents(
              kf,
              sorted[idx + 1],
              bezier
            );
            return `${indent}  <Keyframe TimeTicks="${ticks}" TimeSeconds="${kf.time.toFixed(3)}" Value="${kf.value.toFixed(4)}" Interpolation="${interp}" InTangent="${inTangent}" OutTangent="${outTangent}" />`;
          })
          .join('\n');
        return `${indent}<Keyframes Property="${escapeXml(tr.property)}">\n${kfNodes}\n${indent}</Keyframes>`;
      });
    return blocks.length > 0 ? `\n${blocks.join('\n')}` : '';
  };

  for (const layer of layers) {
    const intensity = clamp(layer.intensity, 0, 100);
    const layerBezier = (layer.bezier ?? bezier).join(',');
    const compositionXml = [
      layer.blendMode && layer.blendMode !== 'normal'
        ? `\n        <BlendMode>${escapeXml(layer.blendMode)}</BlendMode>`
        : '',
      layer.trimPaths?.enabled
        ? `\n        <TrimPaths StartPct="${layer.trimPaths.startPct}" EndPct="${layer.trimPaths.endPct}" OffsetDeg="${layer.trimPaths.offsetDeg}" />`
        : '',
      layer.modulators?.spring?.enabled
        ? `\n        <SpringPhysics Stiffness="${layer.modulators.spring.stiffness}" Damping="${layer.modulators.spring.damping}" Mass="${layer.modulators.spring.mass}" />`
        : '',
      layer.modulators?.wiggle?.enabled
        ? `\n        <Wiggle Target="${escapeXml(layer.modulators.wiggle.target)}" FrequencyHz="${layer.modulators.wiggle.frequencyHz}" Amplitude="${layer.modulators.wiggle.amplitude}" Seed="${layer.modulators.wiggle.seed}" />`
        : '',
      layer.modulators?.lfo?.enabled
        ? `\n        <LfoOscillator Waveform="${escapeXml(layer.modulators.lfo.waveform)}" Target="${escapeXml(layer.modulators.lfo.target)}" FrequencyHz="${resolveLfoFrequencyHz(layer.modulators.lfo).toFixed(3)}" Bpm="${layer.modulators.lfo.bpm}" Amplitude="${layer.modulators.lfo.amplitude}" />`
        : '',
    ]
      .filter(Boolean)
      .join('');

    if (
      layer.kind === 'punch-in' ||
      layer.kind === 'zoom' ||
      layer.kind === 'float-drift' ||
      layer.kind === 'whip' ||
      layer.kind === 'spin' ||
      layer.kind === 'speed-ramp'
    ) {
      const startScale = Number(layer.params.startScale ?? 100);
      const endScale = layer.kind === 'punch-in' ? Number(layer.params.endScale ?? 128) : 100 + intensity * 0.35;
      pushComponent(
        'AE.ADBE Motion',
        layer.name,
        `        <Param Name="Scale" StartValue="${startScale}" EndValue="${endScale.toFixed(1)}" EndTicks="${inEndTicks}" Bezier="${layerBezier}" />
        <Param Name="AnchorPoint" X="${Number(layer.params.anchorX ?? 50)}" Y="${Number(layer.params.anchorY ?? 50)}" />
        <Param Name="ShutterAngle" Value="${Number(layer.params.shutterAngle ?? 180)}" />${compositionXml}`
      );
    } else if (layer.kind === 'camera-shake' || layer.kind === 'pip-frame') {
      pushComponent(
        layer.kind === 'pip-frame' ? 'AE.ADBE Drop Shadow' : 'AE.ADBE Transform',
        layer.name,
        `        <Param Name="Intensity" Value="${intensity}" />
        <Param Name="FrequencyHz" Value="${Number(layer.params.frequencyHz ?? 8)}" />
        <Param Name="Rotation" Value="${Number(layer.params.rotationDeg ?? 0)}" />${compositionXml}`
      );
    } else if (layer.kind === 'motion-blur' || layer.kind === 'blur' || layer.kind === 'directional-swish') {
      pushComponent(
        'AE.ADBE Gaussian Blur 2',
        layer.name,
        `        <Param Name="Blurriness" Value="${Number(layer.params.radiusPx ?? intensity * 0.4).toFixed(1)}" />
        <Param Name="ShutterAngle" Value="${Number(layer.params.shutterAngle ?? 180)}" />${compositionXml}`
      );
    } else if (layer.kind === 'chromatic-aberration' || layer.kind === 'glitch') {
      pushComponent(
        'PR.ADBE VR Chromatic Aberrations',
        layer.name,
        `        <Param Name="RedShift" Value="${Number(layer.params.shiftPx ?? intensity * 0.15).toFixed(1)}" />${compositionXml}`
      );
    } else {
      pushComponent(
        'AE.ADBE Lumetri',
        layer.name,
        `        <Param Name="Intensity" Value="${intensity}" />
        <Param Name="LUTName" Value="${escapeXml(preset.lutName ?? '')}" />
        <Param Name="LUTMix" Value="${Number(preset.lutMix ?? 75)}" />${compositionXml}`
      );
    }
  }

  const motionTracks = tracks.filter((t) =>
    ['positionX', 'positionY', 'scale', 'rotation'].includes(t.property)
  );
  if (motionTracks.length > 0 || components.length === 0) {
    const kfsXml = formatKeyframesXml(motionTracks);
    const pivot = resolveNormalizedPivot(preset);
    pushComponent(
      'AE.ADBE Motion',
      preset.name,
      `        <Param Name="Scale" StartValue="100" EndValue="115" EndTicks="${inEndTicks}" Bezier="${bezier.join(',')}" />
        <Param Name="AnchorPoint" X="${(pivot.cssX).toFixed(1)}" Y="${(pivot.cssY).toFixed(1)}" />${kfsXml}`
    );
  }

  const opacityTracks = tracks.filter((t) => t.property === 'opacity');
  if (opacityTracks.length > 0) {
    pushComponent(
      'AE.ADBE Opacity',
      'Opacidad Dope Sheet',
      `        <Param Name="Opacity" Value="100" />${formatKeyframesXml(opacityTracks)}`
    );
  }

  const maskLayers = layers.filter((l) => l.maskReveal?.enabled);
  if (maskLayers.length > 0) {
    const mr = maskLayers[0].maskReveal!;
    pushComponent(
      'AE.ADBE Crop',
      'Máscara de Revelado',
      `        <Param Name="Direction" Value="${escapeXml(mr.direction)}" />
        <Param Name="Feather" Value="${mr.featherPx}" />
        <Param Name="StartReveal" StartValue="100" EndValue="0" EndTicks="${inEndTicks}" Bezier="${bezier.join(',')}" />`
    );
  }

  const pivotGlobal = resolveNormalizedPivot(preset);

  return `<?xml version="1.0" encoding="UTF-8"?>
<PremiereData Version="3">
  <PresetMetadata>
    <Name>${escapeXml(preset.name)}</Name>
    <Category>${escapeXml(preset.category)}</Category>
    <DurationTicks>${durationTicks}</DurationTicks>
    <IntroEndTicks>${inEndTicks}</IntroEndTicks>
    <OutroStartTicks>${outStartTicks}</OutroStartTicks>
    <TimelineMode>${escapeXml(preset.timelineMode ?? (tracks.length > 0 ? 'keyframes' : 'phases'))}</TimelineMode>
    <AutoScaleDuration>${phases.autoScaleDuration ? 'true' : 'false'}</AutoScaleDuration>
    <AspectRatio>${escapeXml(preset.aspectRatio ?? '16:9')}</AspectRatio>
    <AnchorPoint9>${escapeXml(preset.anchorPoint ?? 'center')}</AnchorPoint9>
    <Pivot X="${pivotGlobal.fusionX.toFixed(3)}" Y="${pivotGlobal.fusionY.toFixed(3)}" />${
      preset.secondaryAccent
        ? `\n    <SecondaryAccent>${escapeXml(preset.secondaryAccent)}</SecondaryAccent>`
        : ''
    }
    <AudioSfx Id="${escapeXml(preset.audioSfx?.sfxId ?? 'none')}" OffsetMs="${Number(preset.audioSfx?.offsetMs ?? 0)}" GainDb="${Number(preset.audioSfx?.gainDb ?? 0)}" />
  </PresetMetadata>
  <Components>
${components.join('\n')}
  </Components>
</PremiereData>
`;
}
