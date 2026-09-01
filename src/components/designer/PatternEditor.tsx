'use client';

import {
  ColorInput,
  Field,
  NumberInput,
  Segmented,
  SectionLabel,
  Select,
  Slider,
  Toggle,
} from '@/components/ui/controls';
import {
  PATTERN_LABELS,
  PATTERN_TYPES,
  defaultPatternSpec,
  type Pattern,
  type PatternSpec,
  type PatternType,
} from '@/lib/types/pattern';

type Spec<T extends PatternType> = Extract<PatternSpec, { type: T }>;

export function PatternEditor({
  pattern,
  onChange,
  showPlacement = true,
}: {
  pattern: Pattern;
  onChange: (next: Pattern) => void;
  showPlacement?: boolean;
}) {
  const spec = pattern.spec;

  const setSpec = (patch: Partial<PatternSpec>) =>
    onChange({ ...pattern, spec: { ...spec, ...patch } as PatternSpec });

  return (
    <div className="space-y-3">
      <Field label="Ruling">
        <Select
          value={spec.type}
          onChange={(event) =>
            onChange({ ...pattern, spec: defaultPatternSpec(event.target.value as PatternType) })
          }
        >
          {PATTERN_TYPES.map((type) => (
            <option key={type} value={type}>
              {PATTERN_LABELS[type]}
            </option>
          ))}
        </Select>
      </Field>

      {spec.type !== 'blank' && <SpecFields spec={spec} setSpec={setSpec} />}

      {showPlacement && spec.type !== 'blank' && (
        <>
          <div className="border-t border-ink-200 pt-3">
            <SectionLabel>Placement</SectionLabel>
            <div className="space-y-2.5">
              <Segmented
                value={pattern.area}
                onChange={(area) => onChange({ ...pattern, area })}
                options={[
                  { value: 'content', label: 'Inside margins' },
                  { value: 'full', label: 'Full bleed' },
                ]}
              />
              <Segmented
                value={pattern.align}
                onChange={(align) => onChange({ ...pattern, align })}
                options={[
                  { value: 'start', label: 'Anchor to edge' },
                  { value: 'center', label: 'Centre' },
                ]}
              />
              <div className="grid grid-cols-2 gap-2">
                <Field label="Offset X">
                  <NumberInput
                    value={pattern.offsetX}
                    min={-100}
                    max={100}
                    step={0.5}
                    suffix="mm"
                    onChange={(offsetX) => onChange({ ...pattern, offsetX })}
                  />
                </Field>
                <Field label="Offset Y">
                  <NumberInput
                    value={pattern.offsetY}
                    min={-100}
                    max={100}
                    step={0.5}
                    suffix="mm"
                    onChange={(offsetY) => onChange({ ...pattern, offsetY })}
                  />
                </Field>
              </div>
              <Field label="Opacity">
                <Slider
                  value={pattern.opacity}
                  min={0.05}
                  max={1}
                  step={0.05}
                  onChange={(opacity) => onChange({ ...pattern, opacity })}
                />
              </Field>
              <Toggle
                checked={pattern.scaleWithPage}
                onChange={(scaleWithPage) => onChange({ ...pattern, scaleWithPage })}
                label="Scale spacing with page size"
                hint="Off keeps 5 mm at 5 mm on every page size, which is usually what ruled paper wants."
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------ */

function SpecFields({
  spec,
  setSpec,
}: {
  spec: PatternSpec;
  setSpec: (patch: Partial<PatternSpec>) => void;
}) {
  const set = setSpec as (patch: Record<string, unknown>) => void;

  switch (spec.type) {
    case 'ruled':
      return <RuledFields spec={spec} set={set} />;

    case 'dots':
      return (
        <>
          <Pair>
            <Field label="Spacing X">
              <Mm value={spec.spacingX} min={1} max={40} onChange={(spacingX) => set({ spacingX })} />
            </Field>
            <Field label="Spacing Y">
              <Mm value={spec.spacingY} min={1} max={40} onChange={(spacingY) => set({ spacingY })} />
            </Field>
          </Pair>
          <Field label="Dot shape">
            <Segmented
              value={spec.shape}
              onChange={(shape) => set({ shape })}
              options={[
                { value: 'round', label: 'Round' },
                { value: 'square', label: 'Square' },
                { value: 'cross', label: 'Cross' },
              ]}
            />
          </Field>
          <Field label="Dot size">
            <Mm value={spec.size} min={0.05} max={4} step={0.05} onChange={(size) => set({ size })} />
          </Field>
          <Colour label="Colour" value={spec.color} onChange={(color) => set({ color })} />
        </>
      );

    case 'grid':
      return (
        <>
          <Pair>
            <Field label="Spacing X">
              <Mm value={spec.spacingX} min={1} max={40} onChange={(spacingX) => set({ spacingX })} />
            </Field>
            <Field label="Spacing Y">
              <Mm value={spec.spacingY} min={1} max={40} onChange={(spacingY) => set({ spacingY })} />
            </Field>
          </Pair>
          <LineFields width={spec.width} color={spec.color} set={set} />
        </>
      );

    case 'graph':
      return (
        <>
          <Pair>
            <Field label="Minor spacing">
              <Mm value={spec.minor} min={0.5} max={20} step={0.5} onChange={(minor) => set({ minor })} />
            </Field>
            <Field label="Major every">
              <NumberInput
                value={spec.majorEvery}
                min={2}
                max={20}
                step={1}
                suffix="sq"
                onChange={(majorEvery) => set({ majorEvery })}
              />
            </Field>
          </Pair>
          <Pair>
            <Colour label="Minor" value={spec.minorColor} onChange={(minorColor) => set({ minorColor })} />
            <Colour label="Major" value={spec.majorColor} onChange={(majorColor) => set({ majorColor })} />
          </Pair>
          <Pair>
            <Field label="Minor width">
              <Mm value={spec.minorWidth} min={0.02} max={2} step={0.02} onChange={(minorWidth) => set({ minorWidth })} />
            </Field>
            <Field label="Major width">
              <Mm value={spec.majorWidth} min={0.02} max={3} step={0.02} onChange={(majorWidth) => set({ majorWidth })} />
            </Field>
          </Pair>
        </>
      );

    case 'isometric':
      return (
        <>
          <Field label="Spacing">
            <Mm value={spec.spacing} min={1} max={30} step={0.5} onChange={(spacing) => set({ spacing })} />
          </Field>
          <LineFields width={spec.width} color={spec.color} set={set} />
          <Toggle
            checked={spec.showVerticals}
            onChange={(showVerticals) => set({ showVerticals })}
            label="Vertical lines"
          />
        </>
      );

    case 'hexagon':
      return (
        <>
          <Field label="Hexagon size" hint="Distance from centre to a corner.">
            <Mm value={spec.size} min={1} max={40} step={0.5} onChange={(size) => set({ size })} />
          </Field>
          <Field label="Orientation">
            <Segmented
              value={spec.orientation}
              onChange={(orientation) => set({ orientation })}
              options={[
                { value: 'pointy', label: 'Pointy top' },
                { value: 'flat', label: 'Flat top' },
              ]}
            />
          </Field>
          <LineFields width={spec.width} color={spec.color} set={set} />
        </>
      );

    case 'triangle':
      return (
        <>
          <Field label="Spacing">
            <Mm value={spec.spacing} min={1} max={30} step={0.5} onChange={(spacing) => set({ spacing })} />
          </Field>
          <LineFields width={spec.width} color={spec.color} set={set} />
        </>
      );

    case 'polar':
      return (
        <>
          <Pair>
            <Field label="Rings">
              <NumberInput value={spec.rings} min={1} max={40} step={1} onChange={(rings) => set({ rings })} />
            </Field>
            <Field label="Sectors">
              <NumberInput value={spec.sectors} min={2} max={72} step={1} onChange={(sectors) => set({ sectors })} />
            </Field>
          </Pair>
          <LineFields width={spec.width} color={spec.color} set={set} />
          <Pair>
            <Colour label="Axis colour" value={spec.axisColor} onChange={(axisColor) => set({ axisColor })} />
            <Field label="Axis width">
              <Mm value={spec.axisWidth} min={0.02} max={2} step={0.02} onChange={(axisWidth) => set({ axisWidth })} />
            </Field>
          </Pair>
        </>
      );

    case 'logscale':
      return (
        <>
          <Field label="Axes">
            <Select value={spec.kind} onChange={(event) => set({ kind: event.target.value })}>
              <option value="semilog-y">Log vertical, linear horizontal</option>
              <option value="semilog-x">Log horizontal, linear vertical</option>
              <option value="loglog">Log on both axes</option>
            </Select>
          </Field>
          <Pair>
            <Field label="Decades">
              <NumberInput value={spec.decades} min={1} max={8} step={1} onChange={(decades) => set({ decades })} />
            </Field>
            <Field label="Linear divisions">
              <NumberInput
                value={spec.linearDivisions}
                min={2}
                max={50}
                step={1}
                onChange={(linearDivisions) => set({ linearDivisions })}
              />
            </Field>
          </Pair>
          <Pair>
            <Colour label="Minor" value={spec.color} onChange={(color) => set({ color })} />
            <Colour label="Major" value={spec.majorColor} onChange={(majorColor) => set({ majorColor })} />
          </Pair>
        </>
      );

    case 'music':
      return (
        <>
          <Pair>
            <Field label="Staves">
              <NumberInput value={spec.staves} min={1} max={20} step={1} onChange={(staves) => set({ staves })} />
            </Field>
            <Field label="Line spacing">
              <Mm value={spec.lineSpacing} min={1} max={8} step={0.1} onChange={(lineSpacing) => set({ lineSpacing })} />
            </Field>
          </Pair>
          <Field label="Gap between staves">
            <Mm value={spec.staffGap} min={2} max={60} step={0.5} onChange={(staffGap) => set({ staffGap })} />
          </Field>
          <LineFields width={spec.width} color={spec.color} set={set} />
        </>
      );

    case 'tablature':
      return (
        <>
          <Pair>
            <Field label="Systems">
              <NumberInput value={spec.systems} min={1} max={16} step={1} onChange={(systems) => set({ systems })} />
            </Field>
            <Field label="Strings">
              <NumberInput value={spec.strings} min={3} max={8} step={1} onChange={(strings) => set({ strings })} />
            </Field>
          </Pair>
          <Pair>
            <Field label="Line spacing">
              <Mm value={spec.lineSpacing} min={1} max={10} step={0.1} onChange={(lineSpacing) => set({ lineSpacing })} />
            </Field>
            <Field label="System gap">
              <Mm value={spec.systemGap} min={2} max={60} step={0.5} onChange={(systemGap) => set({ systemGap })} />
            </Field>
          </Pair>
          <LineFields width={spec.width} color={spec.color} set={set} />
        </>
      );

    case 'handwriting':
      return <HandwritingFields spec={spec} set={set} />;

    case 'seyes':
      return (
        <>
          <Pair>
            <Field label="Line height">
              <Mm value={spec.unit} min={4} max={20} step={0.5} onChange={(unit) => set({ unit })} />
            </Field>
            <Field label="Sub-divisions">
              <NumberInput
                value={spec.subDivisions}
                min={2}
                max={8}
                step={1}
                onChange={(subDivisions) => set({ subDivisions })}
              />
            </Field>
          </Pair>
          <Field label="Vertical spacing">
            <Mm value={spec.verticalSpacing} min={4} max={40} step={0.5} onChange={(verticalSpacing) => set({ verticalSpacing })} />
          </Field>
          <Pair>
            <Colour label="Main" value={spec.mainColor} onChange={(mainColor) => set({ mainColor })} />
            <Colour label="Sub" value={spec.subColor} onChange={(subColor) => set({ subColor })} />
          </Pair>
          <Colour label="Vertical" value={spec.verticalColor} onChange={(verticalColor) => set({ verticalColor })} />
        </>
      );

    case 'genkoyoshi':
      return (
        <>
          <Pair>
            <Field label="Columns">
              <NumberInput value={spec.columns} min={4} max={40} step={1} onChange={(columns) => set({ columns })} />
            </Field>
            <Field label="Rows">
              <NumberInput value={spec.rows} min={4} max={40} step={1} onChange={(rows) => set({ rows })} />
            </Field>
          </Pair>
          <Field label="Furigana gutter">
            <Mm value={spec.gutter} min={0} max={8} step={0.25} onChange={(gutter) => set({ gutter })} />
          </Field>
          <LineFields width={spec.width} color={spec.color} set={set} />
        </>
      );

    case 'dottedthirds':
      return (
        <>
          <Field label="Band height">
            <Mm value={spec.bandHeight} min={4} max={40} step={0.5} onChange={(bandHeight) => set({ bandHeight })} />
          </Field>
          <Field label="Dot spacing">
            <Mm value={spec.dotSpacing} min={0.5} max={6} step={0.1} onChange={(dotSpacing) => set({ dotSpacing })} />
          </Field>
          <LineFields width={spec.width} color={spec.color} set={set} />
        </>
      );

    default:
      return null;
  }
}

function RuledFields({
  spec,
  set,
}: {
  spec: Spec<'ruled'>;
  set: (patch: Record<string, unknown>) => void;
}) {
  return (
    <>
      <Pair>
        <Field label="Line spacing">
          <Mm value={spec.spacing} min={2} max={40} step={0.5} onChange={(spacing) => set({ spacing })} />
        </Field>
        <Field label="Top offset">
          <Mm value={spec.topOffset} min={0} max={100} step={0.5} onChange={(topOffset) => set({ topOffset })} />
        </Field>
      </Pair>
      <LineFields width={spec.width} color={spec.color} set={set} />
      <Toggle checked={spec.dashed} onChange={(dashed) => set({ dashed })} label="Dashed rules" />

      <div className="rounded-md border border-ink-200 p-2.5">
        <Toggle
          checked={spec.marginRule.enabled}
          onChange={(enabled) => set({ marginRule: { ...spec.marginRule, enabled } })}
          label="Margin rule"
        />
        {spec.marginRule.enabled && (
          <div className="mt-2 space-y-2">
            <Segmented
              value={spec.marginRule.side}
              onChange={(side) => set({ marginRule: { ...spec.marginRule, side } })}
              options={[
                { value: 'left', label: 'Left' },
                { value: 'right', label: 'Right' },
                { value: 'both', label: 'Both' },
              ]}
            />
            <Pair>
              <Field label="Offset">
                <Mm
                  value={spec.marginRule.offset}
                  min={0}
                  max={100}
                  step={0.5}
                  onChange={(offset) => set({ marginRule: { ...spec.marginRule, offset } })}
                />
              </Field>
              <Colour
                label="Colour"
                value={spec.marginRule.color}
                onChange={(color) => set({ marginRule: { ...spec.marginRule, color } })}
              />
            </Pair>
          </div>
        )}
      </div>

      <div className="rounded-md border border-ink-200 p-2.5">
        <Toggle
          checked={spec.headerRule.enabled}
          onChange={(enabled) => set({ headerRule: { ...spec.headerRule, enabled } })}
          label="Header rule"
        />
        {spec.headerRule.enabled && (
          <div className="mt-2">
            <Pair>
              <Field label="Offset from top">
                <Mm
                  value={spec.headerRule.offset}
                  min={0}
                  max={100}
                  step={0.5}
                  onChange={(offset) => set({ headerRule: { ...spec.headerRule, offset } })}
                />
              </Field>
              <Colour
                label="Colour"
                value={spec.headerRule.color}
                onChange={(color) => set({ headerRule: { ...spec.headerRule, color } })}
              />
            </Pair>
          </div>
        )}
      </div>
    </>
  );
}

function HandwritingFields({
  spec,
  set,
}: {
  spec: Spec<'handwriting'>;
  set: (patch: Record<string, unknown>) => void;
}) {
  return (
    <>
      <Field label="Band height" hint="Baseline to baseline of one writing line.">
        <Mm value={spec.bandHeight} min={4} max={40} step={0.5} onChange={(bandHeight) => set({ bandHeight })} />
      </Field>
      <Field label="x-height ratio">
        <Slider
          value={spec.xHeightRatio}
          min={0.1}
          max={0.9}
          step={0.02}
          onChange={(xHeightRatio) => set({ xHeightRatio })}
        />
      </Field>
      <div className="space-y-1.5">
        <Toggle checked={spec.showAscender} onChange={(showAscender) => set({ showAscender })} label="Ascender line" />
        <Toggle checked={spec.showDescender} onChange={(showDescender) => set({ showDescender })} label="Descender line" />
        <Toggle checked={spec.dashedMidline} onChange={(dashedMidline) => set({ dashedMidline })} label="Dashed midline" />
      </div>
      <Pair>
        <Colour label="Baseline" value={spec.baselineColor} onChange={(baselineColor) => set({ baselineColor })} />
        <Colour label="Guides" value={spec.guideColor} onChange={(guideColor) => set({ guideColor })} />
      </Pair>

      <div className="rounded-md border border-ink-200 p-2.5">
        <Toggle
          checked={spec.slant.enabled}
          onChange={(enabled) => set({ slant: { ...spec.slant, enabled } })}
          label="Slant guides"
          hint="Diagonal guides for italic and cursive hands."
        />
        {spec.slant.enabled && (
          <div className="mt-2 space-y-2">
            <Field label="Angle from vertical">
              <Slider
                value={spec.slant.angleDeg}
                min={0}
                max={45}
                step={1}
                suffix="°"
                onChange={(angleDeg) => set({ slant: { ...spec.slant, angleDeg } })}
              />
            </Field>
            <Pair>
              <Field label="Spacing">
                <Mm
                  value={spec.slant.spacing}
                  min={3}
                  max={60}
                  step={0.5}
                  onChange={(spacing) => set({ slant: { ...spec.slant, spacing } })}
                />
              </Field>
              <Colour
                label="Colour"
                value={spec.slant.color}
                onChange={(color) => set({ slant: { ...spec.slant, color } })}
              />
            </Pair>
          </div>
        )}
      </div>
    </>
  );
}

/* ------------------------------------------------------------- primitives */

const Pair = ({ children }: { children: React.ReactNode }) => (
  <div className="grid grid-cols-2 gap-2">{children}</div>
);

const Mm = ({
  value,
  onChange,
  min,
  max,
  step = 0.5,
}: {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
}) => <NumberInput value={value} min={min} max={max} step={step} suffix="mm" onChange={onChange} />;

const Colour = ({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) => (
  <Field label={label}>
    <ColorInput value={value} onChange={onChange} />
  </Field>
);

function LineFields({
  width,
  color,
  set,
}: {
  width: number;
  color: string;
  set: (patch: Record<string, unknown>) => void;
}) {
  return (
    <Pair>
      <Field label="Line width">
        <Mm value={width} min={0.02} max={3} step={0.02} onChange={(w) => set({ width: w })} />
      </Field>
      <Colour label="Colour" value={color} onChange={(c) => set({ color: c })} />
    </Pair>
  );
}
