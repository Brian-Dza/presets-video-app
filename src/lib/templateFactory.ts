import type { AnimationCurve, PresetCategory, PresetRecord } from '../domain/preset';
import { defaultCurveFor, defaultPositionFor } from '../domain/preset';
import { compileFusionMacroFromStack } from './nleCompiler';

function safeName(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'Framebase_Preset';
}

function quoteLua(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]/g, ' ');
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function rgb(hex: string): [number, number, number] {
  const cleaned = hex.replace('#', '');
  const full = cleaned.length === 3 ? [...cleaned].map((part) => `${part}${part}`).join('') : cleaned;
  const value = Number.parseInt(full, 16);
  if (!Number.isFinite(value)) return [0.486, 0.361, 1];
  return [(value >> 16 & 255) / 255, (value >> 8 & 255) / 255, (value & 255) / 255];
}

function frameCount(preset: PresetRecord): number {
  return Math.max(12, Math.round(preset.durationSeconds * 24));
}

function fadeAnimationNodes(frames: number, curve: AnimationCurve): string {
  const end = frames - 1;
  const reveal = Math.min(Math.max(1, end - 2), Math.max(6, Math.round(frames * 0.18)));
  const stretchStart = Math.min(end - 1, reveal);
  const stretchEnd = Math.max(stretchStart + 1, end - Math.min(4, Math.floor((end - stretchStart) / 2)));
  const outHandleY = curve === 'expo' ? 0.65 : curve === 'linear' ? 0.33 : 0.18;
  const inHandleY = curve === 'expo' ? 0.96 : curve === 'linear' ? 0.67 : 0.85;
  return `
                RevealStretcher = KeyStretcherMod {
                    CtrlWZoom = false,
                    Inputs = {
                        Keyframes = Input { SourceOp = "RevealKeyframes", Source = "Value", },
                        SourceStart = Input { Value = 0, },
                        SourceEnd = Input { Value = ${end}, },
                        StretchStart = Input { Value = ${stretchStart}, },
                        StretchEnd = Input { Value = ${stretchEnd}, },
                    },
                },
                RevealKeyframes = BezierSpline {
                    SplineColor = { Red = 124, Green = 92, Blue = 255 },
                    NameSet = true,
                    KeyFrames = {
                        [0] = { 0, RH = { ${Math.max(1, Math.round(reveal * 0.35))}, ${outHandleY} }, Flags = { Linear = true } },
                        [${reveal}] = { 1, LH = { ${Math.max(1, reveal - Math.max(2, Math.round(reveal * 0.35)))}, ${inHandleY} }, RH = { ${Math.min(end - 1, reveal + 2)}, 1 }, Flags = { Linear = true } },
                        [${end}] = { 1, LH = { ${Math.max(reveal + 1, end - 2)}, 1 }, Flags = { Linear = true } },
                    },
                },`;
}

function scaleAnimationNodes(frames: number, mode: 'bounce' | 'zoom', curve: AnimationCurve): string {
  const end = frames - 1;
  const overshoot = curve === 'elastic' ? 1.15 : 1.12;
  const rawPoints = mode === 'bounce'
    ? [
        { frame: 0, value: 0.78 },
        { frame: Math.min(end - 3, Math.max(2, Math.round(frames * 0.08))), value: overshoot },
        { frame: Math.min(end - 2, Math.max(4, Math.round(frames * 0.16))), value: 0.94 },
        { frame: Math.min(end - 1, Math.max(6, Math.round(frames * 0.24))), value: 1 },
        { frame: end, value: 1 },
      ]
    : [
        { frame: 0, value: 0.84 },
        { frame: Math.min(end - 1, Math.max(6, Math.round(frames * 0.22))), value: 1 },
        { frame: end, value: 1 },
      ];
  const points = rawPoints.reduce<Array<{ frame: number; value: number }>>((result, point) => {
    const last = result.at(-1);
    if (last?.frame === point.frame) result[result.length - 1] = point;
    else if (!last || point.frame > last.frame) result.push(point);
    return result;
  }, []);
  const settleFrame = points.length >= 2 ? points[points.length - 2].frame : Math.max(1, end - 2);
  const stretchStart = Math.min(end - 1, settleFrame);
  const stretchEnd = Math.max(stretchStart + 1, end);
  const keyframes = points.map((point, index) => {
    const previous = points[index - 1];
    const next = points[index + 1];
    const handles = [
      previous ? `LH = { ${Math.max(previous.frame, point.frame - 2)}, ${((previous.value + point.value) / 2).toFixed(5)} }` : '',
      next ? `RH = { ${Math.min(next.frame, point.frame + 2)}, ${((next.value + point.value) / 2).toFixed(5)} }` : '',
    ].filter(Boolean).join(', ');
    return `                        [${point.frame}] = { ${point.value.toFixed(5)}${handles ? `, ${handles}` : ''}, Flags = { Linear = true } },`;
  }).join('\n');
  return `
                ScaleStretcher = KeyStretcherMod {
                    CtrlWZoom = false,
                    Inputs = {
                        Keyframes = Input { SourceOp = "ScaleKeyframes", Source = "Value", },
                        SourceStart = Input { Value = 0, },
                        SourceEnd = Input { Value = ${end}, },
                        StretchStart = Input { Value = ${stretchStart}, },
                        StretchEnd = Input { Value = ${stretchEnd}, },
                    },
                },
                ScaleKeyframes = BezierSpline {
                    SplineColor = { Red = 124, Green = 92, Blue = 255 },
                    NameSet = true,
                    KeyFrames = {
${keyframes}
                    },
                },`;
}

function titleTemplate(preset: PresetRecord, macroName: string): string {
  const [red, green, blue] = rgb(preset.accent);
  const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  const rawDisplay = preset.text || preset.name;
  const displayValue = preset.uppercase ? rawDisplay.toLocaleUpperCase('es') : rawDisplay;
  const text = quoteLua(displayValue);
  const fontName = quoteLua(preset.fontFamily ?? 'Open Sans');
  const fontStyle = preset.fontFamily === 'Impact' || preset.fontFamily === 'Consolas' ? 'Regular' : 'Bold';
  const tracking = Number(clamp(Number(preset.tracking ?? 1), 0.85, 1.6).toFixed(3));

  const defaultBox = preset.category === 'graphic' || preset.category === 'sticker' || preset.category === 'subtitle';
  const withShape = typeof preset.backgroundBox === 'boolean' ? preset.backgroundBox : defaultBox;
  const isDarkCard = withShape && (preset.category === 'subtitle' || preset.category === 'title');
  const hasAccentBadge = withShape && !isDarkCard;

  const scaleFactor = clamp(Number(preset.scale ?? 1), 0.5, 2);
  const baseSize = preset.category === 'subtitle' ? 0.046 : preset.category === 'graphic' ? 0.05 : preset.category === 'sticker' ? 0.068 : 0.085;
  const size = Number((baseSize * scaleFactor).toFixed(4));
  const frames = frameCount(preset);
  const animation = preset.animation.toLocaleLowerCase('es');
  const curve = preset.curve ?? defaultCurveFor(preset.category, preset.animation);
  const isStatic = animation === 'constante' || animation === 'none';
  const isBounce = animation.includes('rebote') || animation.includes('bounce');
  const isZoom = animation.includes('zoom');
  const usesScaleTransform = isBounce || isZoom;
  const usesFade = !isStatic && !isBounce;
  const usesShadow = Boolean(preset.shadow);

  const animationNodes = [
    usesFade ? fadeAnimationNodes(frames, curve) : '',
    usesScaleTransform ? scaleAnimationNodes(frames, isBounce ? 'bounce' : 'zoom', curve) : '',
  ].join('');
  const blendInput = usesFade
    ? 'Blend = Input { SourceOp = "RevealStretcher", Source = "Result", },'
    : 'Blend = Input { Value = 1, },';
  const defaultPos = defaultPositionFor(preset.category);
  const posX = clamp(Number(preset.positionX ?? defaultPos.x), 0.05, 0.95);
  const posY = clamp(Number(preset.positionY ?? defaultPos.y), 0.05, 0.95);
  const center = `{ ${Number(posX.toFixed(4))}, ${Number(posY.toFixed(4))} }`;
  const textColor: [number, number, number] = hasAccentBadge
    ? (luminance > 0.52 ? [0.08, 0.09, 0.09] : [0.98, 0.98, 0.94])
    : isDarkCard
      ? (luminance > 0.35 ? [red, green, blue] : [0.96, 0.94, 0.9])
      : [red, green, blue];
  const badgeColor: [number, number, number] = isDarkCard ? [0.07, 0.08, 0.11] : [red, green, blue];
  const badgeAlpha = isDarkCard ? 0.84 : 0.96;
  const shapeWidth = Number(((preset.category === 'sticker' ? 0.28 : isDarkCard ? 0.64 : 0.42) * scaleFactor).toFixed(4));
  const shapeHeight = Number(((preset.category === 'sticker' ? 0.19 : isDarkCard ? 0.095 : 0.105) * scaleFactor).toFixed(4));
  const shapeRadius = preset.category === 'sticker' ? 0.13 : isDarkCard ? 0.03 : 0.035;

  const baseOutputName = withShape ? 'Merge1' : 'Text1';
  const postTransformName = usesScaleTransform ? 'Transform1' : baseOutputName;
  const finalOutputName = usesShadow ? 'Shadow1' : postTransformName;

  const shapeNodes = withShape ? `
                Rectangle1 = RectangleMask {
                    Inputs = {
                        Filter = Input { Value = FuID { "Fast Gaussian" }, },
                        MaskWidth = Input { Value = 1920, },
                        MaskHeight = Input { Value = 1080, },
                        PixelAspect = Input { Value = { 1, 1 }, },
                        UseFrameFormatSettings = Input { Value = 1, },
                        ClippingMode = Input { Value = FuID { "None" }, },
                        Center = Input { Value = ${center}, },
                        Width = Input { Value = ${shapeWidth}, },
                        Height = Input { Value = ${shapeHeight}, },
                        CornerRadius = Input { Value = ${shapeRadius}, },
                        Solid = Input { Value = 1, },
                    },
                    ViewInfo = OperatorInfo { Pos = { -132, 132 } },
                },
                Background1 = Background {
                    Inputs = {
                        GlobalOut = Input { Value = ${frames - 1}, },
                        Width = Input { Value = 1920, },
                        Height = Input { Value = 1080, },
                        UseFrameFormatSettings = Input { Value = 1, },
                        ["Gamut.SLogVersion"] = Input { Value = FuID { "SLog2" }, },
                        TopLeftRed = Input { Value = ${badgeColor[0].toFixed(4)}, },
                        TopLeftGreen = Input { Value = ${badgeColor[1].toFixed(4)}, },
                        TopLeftBlue = Input { Value = ${badgeColor[2].toFixed(4)}, },
                        TopLeftAlpha = Input { Value = ${badgeAlpha}, },
                        ${blendInput}
                        EffectMask = Input { SourceOp = "Rectangle1", Source = "Mask", },
                    },
                    ViewInfo = OperatorInfo { Pos = { 0, 132 } },
                },
                Merge1 = Merge {
                    Inputs = {
                        GlobalOut = Input { Value = ${frames - 1}, },
                        Background = Input { SourceOp = "Background1", Source = "Output", },
                        Foreground = Input { SourceOp = "Text1", Source = "Output", },
                        PerformDepthMerge = Input { Value = 0, },
                    },
                    ViewInfo = OperatorInfo { Pos = { 132, 0 } },
                },` : '';

  const scaleTransformNode = usesScaleTransform ? `
                Transform1 = Transform {
                    Inputs = {
                        Center = Input { Value = { 0.5, 0.5 }, },
                        Pivot = Input { Value = ${center}, },
                        Size = Input { SourceOp = "ScaleStretcher", Source = "Result", },
                        Input = Input { SourceOp = "${baseOutputName}", Source = "Output", },
                    },
                    ViewInfo = OperatorInfo { Pos = { 264, 0 } },
                },` : '';

  const shadowNode = usesShadow ? `
                Shadow1 = Shadow {
                    CtrlWZoom = false,
                    Inputs = {
                        ShadowOffset = Input { Value = { 0.505, 0.488 }, },
                        Softness = Input { Value = 0.016, },
                        Alpha = Input { Value = 0.62, },
                        Input = Input { SourceOp = "${postTransformName}", Source = "Output", },
                    },
                    ViewInfo = OperatorInfo { Pos = { 396, 0 } },
                },` : '';

  return `{
    Tools = ordered() {
        ${macroName} = MacroOperator {
            Inputs = ordered() {
                Input1 = InstanceInput { SourceOp = "Text1", Source = "StyledText", Name = "Texto", Default = "${text}" },
                Input2 = InstanceInput { SourceOp = "Text1", Source = "Font", ControlGroup = 2 },
                Input3 = InstanceInput { SourceOp = "Text1", Source = "Style", ControlGroup = 2 },
                Input4 = InstanceInput { SourceOp = "Text1", Source = "Size", Name = "Tamaño", Default = ${size} },
                Input5 = InstanceInput { SourceOp = "Text1", Source = "CharacterSpacingClone", Name = "Espaciado", Default = ${tracking} },
            },
            Outputs = {
                MainOutput1 = InstanceOutput { SourceOp = "${finalOutputName}", Source = "Output" }
            },
            ViewInfo = GroupInfo { Pos = { 0, 0 } },
            Tools = ordered() {
                Text1 = TextPlus {
                    CtrlWZoom = false,
                    Inputs = {
                        GlobalOut = Input { Value = ${frames - 1}, },
                        Width = Input { Value = 1920, },
                        Height = Input { Value = 1080, },
                        UseFrameFormatSettings = Input { Value = 1, },
                        ["Gamut.SLogVersion"] = Input { Value = FuID { "SLog2" }, },
                        Wrap = Input { Value = 1, },
                        StyledText = Input { Value = "${text}", },
                        Font = Input { Value = "${fontName}", },
                        Style = Input { Value = "${fontStyle}", },
                        Size = Input { Value = ${size}, },
                        CharacterSpacingClone = Input { Value = ${tracking}, },
                        Center = Input { Value = ${center}, },
                        VerticalJustificationNew = Input { Value = 3, },
                        HorizontalJustificationNew = Input { Value = 3, },
                        ${blendInput}
                        Red1 = Input { Value = ${textColor[0].toFixed(4)}, },
                        Green1 = Input { Value = ${textColor[1].toFixed(4)}, },
                        Blue1 = Input { Value = ${textColor[2].toFixed(4)}, },
                        Alpha1 = Input { Value = 1, },
                    },
                    ViewInfo = OperatorInfo { Pos = { 0, 0 } },
                },${shapeNodes}${scaleTransformNode}${shadowNode}${animationNodes}
            },
        }
    },
    ActiveTool = "${macroName}"
}
`;
}

function transitionEaseIds(curve: AnimationCurve): { curveType: string; easeIn: string; easeOut: string } {
  if (curve === 'linear') return { curveType: 'Linear', easeIn: 'None', easeOut: 'None' };
  if (curve === 'expo') return { curveType: 'Easing', easeIn: 'Expo', easeOut: 'Expo' };
  if (curve === 'elastic') return { curveType: 'Easing', easeIn: 'Sine', easeOut: 'Elastic' };
  if (curve === 'ease-out') return { curveType: 'Easing', easeIn: 'None', easeOut: 'Cubic' };
  return { curveType: 'Easing', easeIn: 'Sine', easeOut: 'Sine' };
}

function transitionTemplate(preset: PresetRecord, macroName: string): string {
  const [red, green, blue] = rgb(preset.accent);
  const redScale = (0.72 + red * 0.28).toFixed(4);
  const greenScale = (0.72 + green * 0.28).toFixed(4);
  const blueScale = (0.72 + blue * 0.28).toFixed(4);
  const gain = Number(clamp(Number(preset.intensity ?? 0.65), 0, 2).toFixed(2));
  const glowSpread = Number(clamp(Number(preset.spread ?? 16), 2, 40).toFixed(1));
  const ease = transitionEaseIds(preset.curve ?? 'ease-in-out');
  const style = preset.transitionStyle ?? 'dissolve';

  if (style === 'whip') {
    const blurLength = Number(clamp(0.02 + gain * 0.04, 0.01, 0.12).toFixed(4));
    return `{
    Tools = ordered() {
        ${macroName} = GroupOperator {
            Inputs = ordered() {
                MainInput1 = InstanceInput { SourceOp = "SlideOut", Source = "Input" },
                MainInput2 = InstanceInput { SourceOp = "SlideIn", Source = "Input" },
                Amount = InstanceInput { SourceOp = "WhipBlur", Source = "Length", Name = "Desenfoque", Default = ${blurLength} },
            },
            Outputs = {
                MainOutput1 = InstanceOutput { SourceOp = "WhipBlur", Source = "Output" }
            },
            ViewInfo = GroupInfo { Pos = { 0, 0 } },
            Tools = ordered() {
                SlideOut = Transform {
                    CtrlWZoom = false,
                    Inputs = {
                        Center = Input { SourceOp = "VectorOut", Source = "Position", },
                        Edges = Input { Value = 3, },
                    },
                    ViewInfo = OperatorInfo { Pos = { -132, -33 } },
                },
                SlideIn = Transform {
                    CtrlWZoom = false,
                    Inputs = {
                        Center = Input { SourceOp = "VectorIn", Source = "Position", },
                        Edges = Input { Value = 3, },
                    },
                    ViewInfo = OperatorInfo { Pos = { -132, 33 } },
                },
                VectorOut = Vector {
                    Inputs = {
                        Distance = Input { SourceOp = "TransitionCurve", Source = "Value", },
                        Angle = Input { Value = 180, },
                        ImageAspect = Input { Value = 1.777778, },
                    },
                },
                VectorIn = Vector {
                    Inputs = {
                        Distance = Input { SourceOp = "SlideInCurve", Source = "Value", },
                        Angle = Input { Value = 0, },
                        ImageAspect = Input { Value = 1.777778, },
                    },
                },
                Dissolve1 = Dissolve {
                    Transitions = {
                        [0] = "DFTDissolve"
                    },
                    CtrlWZoom = false,
                    Inputs = {
                        Mix = Input { SourceOp = "TransitionCurve", Source = "Value", },
                        Background = Input { SourceOp = "SlideOut", Source = "Output", },
                        Foreground = Input { SourceOp = "SlideIn", Source = "Output", },
                    },
                    ViewInfo = OperatorInfo { Pos = { 0, 0 } },
                },
                WhipBlur = DirectionalBlur {
                    CtrlWZoom = false,
                    Inputs = {
                        Length = Input { SourceOp = "BlurCurve", Source = "Value", },
                        Angle = Input { Value = 0, },
                        Input = Input { SourceOp = "Dissolve1", Source = "Output", },
                    },
                    ViewInfo = OperatorInfo { Pos = { 132, 0 } },
                },
                TransitionCurve = LUTLookup {
                    CtrlWZoom = false,
                    Inputs = {
                        Source = Input { Value = FuID { "Transition" }, },
                        Curve = Input { Value = FuID { "${ease.curveType}" }, },
                        EaseIn = Input { Value = FuID { "${ease.easeIn}" }, },
                        EaseOut = Input { Value = FuID { "${ease.easeOut}" }, },
                        Lookup = Input { SourceOp = "TransitionLookup", Source = "Value", },
                    },
                },
                SlideInCurve = LUTLookup {
                    CtrlWZoom = false,
                    Inputs = {
                        Source = Input { Value = FuID { "Transition" }, },
                        Curve = Input { Value = FuID { "${ease.curveType}" }, },
                        EaseIn = Input { Value = FuID { "${ease.easeIn}" }, },
                        EaseOut = Input { Value = FuID { "${ease.easeOut}" }, },
                        Offset = Input { Value = 1, },
                        Scale = Input { Value = -1, },
                        Lookup = Input { SourceOp = "TransitionLookup", Source = "Value", },
                    },
                },
                BlurCurve = LUTLookup {
                    CtrlWZoom = false,
                    Inputs = {
                        Source = Input { Value = FuID { "Transition" }, },
                        Curve = Input { Value = FuID { "Easing" }, },
                        EaseIn = Input { Value = FuID { "Sine" }, },
                        EaseOut = Input { Value = FuID { "Sine" }, },
                        Mirror = Input { Value = 1, },
                        Scale = Input { Value = ${blurLength}, },
                        Lookup = Input { SourceOp = "TransitionLookup", Source = "Value", },
                    },
                },
                TransitionLookup = LUTBezier {
                    KeyColorSplines = {
                        [0] = {
                            [0] = { 0, RH = { 0.333333333333333, 0.333333333333333 }, Flags = { Linear = true } },
                            [1] = { 1, LH = { 0.666666666666667, 0.666666666666667 }, Flags = { Linear = true } }
                        }
                    },
                    SplineColor = { Red = 255, Green = 255, Blue = 255 },
                    CtrlWZoom = false,
                },
            },
        }
    },
    ActiveTool = "${macroName}"
}
`;
  }

  const zoomPunchNode = style === 'zoom' ? `
                ZoomTransform = Transform {
                    CtrlWZoom = false,
                    Inputs = {
                        Center = Input { Value = { 0.5, 0.5 }, },
                        Pivot = Input { Value = { 0.5, 0.5 }, },
                        Size = Input { SourceOp = "ZoomCurve", Source = "Value", },
                        Edges = Input { Value = 3, },
                        Input = Input { SourceOp = "Dissolve1", Source = "Output", },
                    },
                    ViewInfo = OperatorInfo { Pos = { 66, 0 } },
                },
                ZoomCurve = LUTLookup {
                    CtrlWZoom = false,
                    Inputs = {
                        Source = Input { Value = FuID { "Transition" }, },
                        Curve = Input { Value = FuID { "Easing" }, },
                        EaseIn = Input { Value = FuID { "Expo" }, },
                        EaseOut = Input { Value = FuID { "Expo" }, },
                        Mirror = Input { Value = 1, },
                        Offset = Input { Value = 1, },
                        Scale = Input { Value = ${Number(clamp(0.25 + gain * 0.25, 0.15, 0.7).toFixed(3))}, },
                        Lookup = Input { SourceOp = "TransitionLookup", Source = "Value", },
                    },
                },` : '';

  const glowInputOp = style === 'zoom' ? 'ZoomTransform' : 'Dissolve1';
  const glowScale = style === 'flash' ? 0.92 : 0.45;
  const glowThreshold = style === 'flash' ? 0.18 : 0.45;

  return `{
    Tools = ordered() {
        ${macroName} = GroupOperator {
            Inputs = ordered() {
                MainInput1 = InstanceInput { SourceOp = "Dissolve1", Source = "Background" },
                MainInput2 = InstanceInput { SourceOp = "Dissolve1", Source = "Foreground" },
                Amount = InstanceInput { SourceOp = "Glow1", Source = "Gain", Name = "Brillo", Default = ${gain} },
                Spread = InstanceInput { SourceOp = "Glow1", Source = "XGlowSize", Name = "Difusión", Default = ${glowSpread} },
            },
            Outputs = {
                MainOutput1 = InstanceOutput { SourceOp = "Glow1", Source = "Output" }
            },
            ViewInfo = GroupInfo { Pos = { 0, 0 } },
            Tools = ordered() {
                Dissolve1 = Dissolve {
                    Transitions = {
                        [0] = "DFTDissolve"
                    },
                    CtrlWZoom = false,
                    Inputs = {
                        Mix = Input { SourceOp = "TransitionCurve", Source = "Value", },
                    },
                    ViewInfo = OperatorInfo { Pos = { 0, 0 } },
                },${zoomPunchNode}
                TransitionCurve = LUTLookup {
                    CtrlWZoom = false,
                    Inputs = {
                        Source = Input { Value = FuID { "Transition" }, },
                        Curve = Input { Value = FuID { "${ease.curveType}" }, },
                        EaseIn = Input { Value = FuID { "${ease.easeIn}" }, },
                        EaseOut = Input { Value = FuID { "${ease.easeOut}" }, },
                        Lookup = Input { SourceOp = "TransitionLookup", Source = "Value", },
                    },
                },
                TransitionLookup = LUTBezier {
                    KeyColorSplines = {
                        [0] = {
                            [0] = { 0, RH = { 0.333333333333333, 0.333333333333333 }, Flags = { Linear = true } },
                            [1] = { 1, LH = { 0.666666666666667, 0.666666666666667 }, Flags = { Linear = true } }
                        }
                    },
                    SplineColor = { Red = 255, Green = 255, Blue = 255 },
                    CtrlWZoom = false,
                },
                Glow1 = SoftGlow {
                    CtrlWZoom = false,
                    Inputs = {
                        Filter = Input { Value = FuID { "Fast Gaussian" }, },
                        Threshold = Input { Value = ${glowThreshold}, },
                        Gain = Input { Value = ${gain}, },
                        XGlowSize = Input { Value = ${glowSpread}, },
                        RedScale = Input { Value = ${redScale}, },
                        GreenScale = Input { Value = ${greenScale}, },
                        BlueScale = Input { Value = ${blueScale}, },
                        Blend = Input { SourceOp = "GlowCurve", Source = "Value", },
                        Input = Input { SourceOp = "${glowInputOp}", Source = "Output", },
                    },
                    ViewInfo = OperatorInfo { Pos = { 165, 0 } },
                },
                GlowCurve = LUTLookup {
                    CtrlWZoom = false,
                    Inputs = {
                        Source = Input { Value = FuID { "Transition" }, },
                        Curve = Input { Value = FuID { "Easing" }, },
                        EaseIn = Input { Value = FuID { "Sine" }, },
                        EaseOut = Input { Value = FuID { "Sine" }, },
                        Mirror = Input { Value = 1, },
                        Scale = Input { Value = ${glowScale}, },
                        Lookup = Input { SourceOp = "GlowLookup", Source = "Value", },
                    },
                },
                GlowLookup = LUTBezier {
                    KeyColorSplines = {
                        [0] = {
                            [0] = { 0, RH = { 0.333333333333333, 0.333333333333333 }, Flags = { Linear = true } },
                            [1] = { 1, LH = { 0.666666666666667, 0.666666666666667 }, Flags = { Linear = true } }
                        }
                    },
                    SplineColor = { Red = 255, Green = 255, Blue = 255 },
                    CtrlWZoom = false,
                },
            },
        }
    },
    ActiveTool = "${macroName}"
}
`;
}

function effectTemplate(preset: PresetRecord, macroName: string): string {
  const [red, green, blue] = rgb(preset.accent);
  const gain = Number(clamp(Number(preset.intensity ?? 0.85), 0, 2).toFixed(2));
  const glowSpread = Number(clamp(Number(preset.spread ?? 14), 2, 40).toFixed(1));
  const style = preset.effectStyle ?? 'glow';

  if (style === 'vignette') {
    const softEdge = Number(clamp(glowSpread / 95, 0.06, 0.45).toFixed(3));
    const darkGain = Number(clamp(1 - gain * 0.48, 0.14, 0.95).toFixed(3));
    return `{
    Tools = ordered() {
        ${macroName} = MacroOperator {
            Inputs = ordered() {
                MainInput1 = InstanceInput { SourceOp = "VignetteGrade", Source = "Input" },
                Amount = InstanceInput { SourceOp = "VignetteGrade", Source = "Gain", Name = "Exposición borde", Default = ${darkGain} },
                Spread = InstanceInput { SourceOp = "VignetteMask", Source = "SoftEdge", Name = "Suavidad", Default = ${softEdge} },
            },
            Outputs = {
                MainOutput1 = InstanceOutput { SourceOp = "VignetteGrade", Source = "Output" }
            },
            ViewInfo = GroupInfo { Pos = { 0, 0 } },
            Tools = ordered() {
                VignetteMask = EllipseMask {
                    CtrlWZoom = false,
                    Inputs = {
                        Filter = Input { Value = FuID { "Fast Gaussian" }, },
                        Invert = Input { Value = 1, },
                        SoftEdge = Input { Value = ${softEdge}, },
                        MaskWidth = Input { Value = 1920, },
                        MaskHeight = Input { Value = 1080, },
                        PixelAspect = Input { Value = { 1, 1 }, },
                        UseFrameFormatSettings = Input { Value = 1, },
                        Center = Input { Value = { 0.5, 0.5 }, },
                        Width = Input { Value = 0.84, },
                        Height = Input { Value = 0.84, },
                    },
                    ViewInfo = OperatorInfo { Pos = { -132, 66 } },
                },
                VignetteGrade = BrightnessContrast {
                    CtrlWZoom = false,
                    Inputs = {
                        Gain = Input { Value = ${darkGain}, },
                        Gamma = Input { Value = 0.88, },
                        EffectMask = Input { SourceOp = "VignetteMask", Source = "Mask", },
                    },
                    ViewInfo = OperatorInfo { Pos = { 0, 0 } },
                }
            },
        }
    },
    ActiveTool = "${macroName}"
}
`;
  }

  const redScale = style === 'halation' ? '1.0000' : (0.7 + red * 0.3).toFixed(4);
  const greenScale = style === 'halation' ? '0.4200' : (0.7 + green * 0.3).toFixed(4);
  const blueScale = style === 'halation' ? '0.2100' : (0.7 + blue * 0.3).toFixed(4);
  const threshold = style === 'halation' ? 0.54 : 0.38;

  return `{
    Tools = ordered() {
        ${macroName} = MacroOperator {
            Inputs = ordered() {
                MainInput1 = InstanceInput { SourceOp = "Glow1", Source = "Input" },
                Amount = InstanceInput { SourceOp = "Glow1", Source = "Gain", Name = "Intensidad", Default = ${gain} },
                Spread = InstanceInput { SourceOp = "Glow1", Source = "XGlowSize", Name = "Difusión", Default = ${glowSpread} },
                Mix = InstanceInput { SourceOp = "Glow1", Source = "Blend", Name = "Mezcla", Default = 0.45 },
            },
            Outputs = {
                MainOutput1 = InstanceOutput { SourceOp = "Glow1", Source = "Output" }
            },
            ViewInfo = GroupInfo { Pos = { 0, 0 } },
            Tools = ordered() {
                Glow1 = SoftGlow {
                    CtrlWZoom = false,
                    Inputs = {
                        Filter = Input { Value = FuID { "Fast Gaussian" }, },
                        Threshold = Input { Value = ${threshold}, },
                        Gain = Input { Value = ${gain}, },
                        XGlowSize = Input { Value = ${glowSpread}, },
                        Blend = Input { Value = 0.45, },
                        RedScale = Input { Value = ${redScale}, },
                        GreenScale = Input { Value = ${greenScale}, },
                        BlueScale = Input { Value = ${blueScale}, },
                    },
                    ViewInfo = OperatorInfo { Pos = { 0, 0 } },
                }
            },
        }
    },
    ActiveTool = "${macroName}"
}
`;
}

export function templateFileName(preset: Pick<PresetRecord, 'name' | 'category'>): string {
  return `${safeName(preset.name)}_${preset.category}.setting`;
}

export function createFusionTemplate(preset: PresetRecord): Uint8Array {
  if (preset.layers && preset.layers.some((layer) => layer.enabled)) {
    return new TextEncoder().encode(compileFusionMacroFromStack(preset));
  }
  const macroName = safeName(preset.name);
  const textTemplate = ['title', 'subtitle', 'graphic', 'sticker'].includes(preset.category);
  const content = textTemplate
    ? titleTemplate(preset, macroName)
    : preset.category === 'transition'
      ? transitionTemplate(preset, macroName)
      : effectTemplate(preset, macroName);
  return new TextEncoder().encode(content);
}

export function categoryFromTemplatePath(path: string): PresetCategory | undefined {
  const normalized = path.replace(/\\/g, '/').toLowerCase();
  if (normalized.includes('/transitions/')) return 'transition';
  if (normalized.includes('/effects/')) return 'effect';
  if (normalized.includes('/generators/')) return 'graphic';
  if (normalized.includes('/titles/')) return 'title';
  return undefined;
}

export function normalizeCategoryForFolder(category: PresetCategory): string {
  if (category === 'transition') return 'Transitions';
  if (category === 'effect') return 'Effects';
  if (category === 'graphic' || category === 'sticker') return 'Generators';
  return 'Titles';
}

export function safePresetFileName(name: string): string {
  return safeName(name);
}
