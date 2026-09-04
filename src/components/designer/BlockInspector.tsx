'use client';

import { useState } from 'react';

import { AssetPicker } from '@/components/designer/AssetPicker';
import { PatternEditor } from '@/components/designer/PatternEditor';
import {
  Button,
  ColorInput,
  Field,
  NumberInput,
  Notice,
  Panel,
  SectionLabel,
  Segmented,
  Select,
  Slider,
  StringListInput,
  TextArea,
  TextInput,
  Toggle,
} from '@/components/ui/controls';
import { useNotebook } from '@/lib/client/store';
import type { Block, BlockContent } from '@/lib/types/page';
import type { FontValue } from '@/lib/types/common';
import type { Rect } from '@/lib/units';

type Content<T extends BlockContent['type']> = Extract<BlockContent, { type: T }>;

export function BlockInspector({
  block,
  content,
  onChange,
  onDelete,
  onDuplicate,
}: {
  block: Block;
  /** Content box of the page, so fractional rects can be shown in millimetres. */
  content: Rect;
  onChange: (next: Block) => void;
  onDelete: () => void;
  onDuplicate: () => void;
}) {
  const setContent = (patch: Record<string, unknown>) =>
    onChange({ ...block, content: { ...block.content, ...patch } as BlockContent });

  return (
    <div className="space-y-3">
      <Panel
        title={block.name || labelFor(block.content)}
        description="Position is stored as a fraction of the content box, so it survives a change of page size."
        actions={
          <>
            <Button size="sm" variant="ghost" onClick={onDuplicate}>
              Duplicate
            </Button>
            <Button size="sm" variant="ghost" onClick={onDelete}>
              Delete
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Name">
            <TextInput
              value={block.name}
              placeholder={labelFor(block.content)}
              onChange={(event) => onChange({ ...block, name: event.target.value })}
            />
          </Field>

          <GeometryFields block={block} content={content} onChange={onChange} />

          <div className="grid grid-cols-2 gap-2">
            <Field label="Rotation">
              <NumberInput
                value={block.rotation}
                min={-360}
                max={360}
                step={1}
                suffix="°"
                onChange={(rotation) => onChange({ ...block, rotation })}
              />
            </Field>
            <Field label="Padding">
              <NumberInput
                value={block.padding}
                min={0}
                max={50}
                step={0.5}
                suffix="mm"
                onChange={(padding) => onChange({ ...block, padding })}
              />
            </Field>
          </div>

          <Field label="Opacity">
            <Slider
              value={block.opacity}
              min={0.05}
              max={1}
              step={0.05}
              onChange={(opacity) => onChange({ ...block, opacity })}
            />
          </Field>

          <Field label="Background fill">
            <div className="flex items-center gap-2">
              <ColorInput
                value={block.background ?? '#ffffff'}
                onChange={(background) => onChange({ ...block, background })}
              />
              {block.background && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onChange({ ...block, background: undefined })}
                >
                  Clear
                </Button>
              )}
            </div>
          </Field>

          <div className="flex gap-4">
            <Toggle
              checked={block.visible}
              onChange={(visible) => onChange({ ...block, visible })}
              label="Visible"
            />
            <Toggle
              checked={block.locked}
              onChange={(locked) => onChange({ ...block, locked })}
              label="Locked"
            />
          </div>
        </div>
      </Panel>

      <Panel title={`${labelFor(block.content)} settings`}>
        <ContentFields content={block.content} set={setContent} />
      </Panel>
    </div>
  );
}

/** Alignment stops as fractions of the free space along an axis. */
const ALIGN_STOPS_X = [
  { value: 0, label: 'Left', title: 'Flush with the left edge' },
  { value: 1, label: '\u00bc', title: 'Centred on the left quarter' },
  { value: 2, label: 'Center', title: 'Centred on the axis \u2014 x = (W \u2212 w) / 2' },
  { value: 3, label: '\u00be', title: 'Centred on the right quarter' },
  { value: 4, label: 'Right', title: 'Flush with the right edge' },
] as const;

const ALIGN_STOPS_Y = [
  { value: 0, label: 'Top', title: 'Flush with the top edge' },
  { value: 1, label: '\u00bc', title: 'Centred on the top quarter' },
  { value: 2, label: 'Middle', title: 'Centred on the axis \u2014 y = (H \u2212 h) / 2' },
  { value: 3, label: '\u00be', title: 'Centred on the bottom quarter' },
  { value: 4, label: 'Bottom', title: 'Flush with the bottom edge' },
] as const;

function GeometryFields({
  block,
  content,
  onChange,
}: {
  block: Block;
  content: Rect;
  onChange: (next: Block) => void;
}) {
  // The inspector speaks millimetres because that is what a printed page is
  // measured in; the model keeps fractions so the design can be retargeted.
  // Percent is offered because the fractions *are* the stored value \u2014 25% is
  // 25% of the content box at every trim size.
  const [unit, setUnit] = useState<'mm' | 'pct'>('mm');

  const toMm = (fraction: number, axis: 'w' | 'h') => fraction * content[axis];
  const toFraction = (mm: number, axis: 'w' | 'h') =>
    content[axis] > 0 ? mm / content[axis] : 0;

  const set = (patch: Partial<Block['rect']>) =>
    onChange({ ...block, rect: { ...block.rect, ...patch } });

  /* Alignment: place the block so its centre sits on the chosen stop. With
   * A in 0..4, pos = A \u00b7 (1 \u2212 size) / 4 \u2014 A = 2 is the true centre
   * ((1 \u2212 size) / 2, equal gaps either side), A = 0/4 are flush edges, and the
   * quarters land between. A block wider than the content box still works:
   * the formula centres it with negative gaps. */
  const align = (axis: 'x' | 'y', stop: number) => {
    const size = axis === 'x' ? block.rect.w : block.rect.h;
    set({ [axis]: (stop * (1 - size)) / 4 } as Partial<Block['rect']>);
  };

  /** The stop the block already sits on, or -1 when it is off-grid. */
  const stopOf = (axis: 'x' | 'y'): number => {
    const size = axis === 'x' ? block.rect.w : block.rect.h;
    const pos = axis === 'x' ? block.rect.x : block.rect.y;
    const free = 1 - size;
    if (Math.abs(free) < 1e-6) return Math.abs(pos) < 1e-6 ? 2 : -1;
    const stop = (pos * 4) / free;
    return Math.abs(stop - Math.round(stop)) < 0.005 ? Math.round(stop) : -1;
  };

  const read = (fraction: number, axis: 'w' | 'h') =>
    unit === 'mm' ? round(toMm(fraction, axis)) : round(fraction * 100);
  const write = (value: number, axis: 'w' | 'h') =>
    unit === 'mm' ? toFraction(value, axis) : value / 100;
  const suffix = unit === 'mm' ? 'mm' : '%';
  const step = unit === 'mm' ? 0.5 : 1;

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-ink-500">Show in</span>
        <Segmented
          value={unit}
          onChange={setUnit}
          options={[
            { value: 'mm', label: 'Millimetres' },
            { value: 'pct', label: 'Percent' },
          ]}
          className="w-44"
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Field label="X (left edge)">
          <NumberInput
            value={read(block.rect.x, 'w')}
            step={step}
            suffix={suffix}
            onChange={(v) => set({ x: write(v, 'w') })}
          />
        </Field>
        <Field label="Y (top edge)">
          <NumberInput
            value={read(block.rect.y, 'h')}
            step={step}
            suffix={suffix}
            onChange={(v) => set({ y: write(v, 'h') })}
          />
        </Field>
        <Field label="Width">
          <NumberInput
            value={read(block.rect.w, 'w')}
            min={unit === 'mm' ? 1 : 0.5}
            step={step}
            suffix={suffix}
            onChange={(v) => set({ w: write(v, 'w') })}
          />
        </Field>
        <Field label="Height">
          <NumberInput
            value={read(block.rect.h, 'h')}
            min={unit === 'mm' ? 1 : 0.5}
            step={step}
            suffix={suffix}
            onChange={(v) => set({ h: write(v, 'h') })}
          />
        </Field>
      </div>

      <div className="space-y-1.5">
        <span className="text-[11px] font-medium text-ink-500">
          Align in the content box
        </span>
        <Segmented
          value={stopOf('x')}
          onChange={(stop) => align('x', stop)}
          options={[...ALIGN_STOPS_X]}
        />
        <Segmented
          value={stopOf('y')}
          onChange={(stop) => align('y', stop)}
          options={[...ALIGN_STOPS_Y]}
        />
      </div>
    </div>
  );
}

const round = (n: number) => Math.round(n * 10) / 10;

/* ------------------------------------------------------------------------ */

function ContentFields({
  content,
  set,
}: {
  content: BlockContent;
  set: (patch: Record<string, unknown>) => void;
}) {
  switch (content.type) {
    case 'text':
      return <TextFields c={content} set={set} />;
    case 'latex':
      return <LatexFields c={content} set={set} />;
    case 'image':
      return <ImageFields c={content} set={set} />;
    case 'shape':
      return <ShapeFields c={content} set={set} />;
    case 'pattern':
      return (
        <div className="space-y-3">
          <PatternEditor
            pattern={content.pattern}
            showPlacement={false}
            onChange={(pattern) => set({ pattern })}
          />
          <div className="border-t border-ink-200 pt-3">
            <Toggle
              checked={content.border.enabled}
              onChange={(enabled) => set({ border: { ...content.border, enabled } })}
              label="Draw a border around the area"
            />
            {content.border.enabled && (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Field label="Colour">
                  <ColorInput
                    value={content.border.color}
                    onChange={(color) => set({ border: { ...content.border, color } })}
                  />
                </Field>
                <Field label="Corner radius">
                  <NumberInput
                    value={content.border.radius}
                    min={0}
                    max={30}
                    step={0.5}
                    suffix="mm"
                    onChange={(radius) => set({ border: { ...content.border, radius } })}
                  />
                </Field>
              </div>
            )}
          </div>
        </div>
      );
    case 'graph':
      return <GraphFields c={content} set={set} />;
    case 'table':
      return <TableFields c={content} set={set} />;
    case 'fields':
      return <FieldsFields c={content} set={set} />;
    case 'checklist':
      return <ChecklistFields c={content} set={set} />;
    case 'pagenumber':
      return <PageNumberFields c={content} set={set} />;
    default:
      return null;
  }
}

function FontControls({
  font,
  size,
  color,
  set,
  sizeMax = 40,
}: {
  font: FontValue;
  size: number;
  color: string;
  set: (patch: Record<string, unknown>) => void;
  sizeMax?: number;
}) {
  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Typeface">
          <Select
            value={font.family}
            onChange={(event) => set({ font: { ...font, family: event.target.value } })}
          >
            <option value="helvetica">Sans (Helvetica)</option>
            <option value="times">Serif (Times)</option>
            <option value="courier">Mono (Courier)</option>
          </Select>
        </Field>
        <Field label="Size">
          <NumberInput
            value={size}
            min={0.5}
            max={sizeMax}
            step={0.1}
            suffix="mm"
            onChange={(next) => set({ size: next })}
          />
        </Field>
      </div>
      <div className="flex items-center gap-4">
        <Toggle checked={!!font.bold} onChange={(bold) => set({ font: { ...font, bold } })} label="Bold" />
        <Toggle
          checked={!!font.italic}
          onChange={(italic) => set({ font: { ...font, italic } })}
          label="Italic"
        />
      </div>
      <Field label="Colour">
        <ColorInput value={color} onChange={(next) => set({ color: next })} />
      </Field>
    </>
  );
}

function TextFields({ c, set }: { c: Content<'text'>; set: (p: Record<string, unknown>) => void }) {
  return (
    <div className="space-y-3">
      <Field label="Text">
        <TextArea rows={4} value={c.text} onChange={(event) => set({ text: event.target.value })} />
      </Field>
      <FontControls font={c.font} size={c.size} color={c.color} set={set} sizeMax={80} />
      <div className="grid grid-cols-2 gap-2">
        <Field label="Horizontal">
          <Segmented
            value={c.align}
            onChange={(align) => set({ align })}
            options={[
              { value: 'left', label: 'L' },
              { value: 'center', label: 'C' },
              { value: 'right', label: 'R' },
            ]}
          />
        </Field>
        <Field label="Vertical">
          <Segmented
            value={c.valign}
            onChange={(valign) => set({ valign })}
            options={[
              { value: 'top', label: 'T' },
              { value: 'middle', label: 'M' },
              { value: 'bottom', label: 'B' },
            ]}
          />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Line height">
          <NumberInput
            value={c.lineHeight}
            min={0.6}
            max={4}
            step={0.05}
            onChange={(lineHeight) => set({ lineHeight })}
          />
        </Field>
        <Field label="Letter spacing">
          <NumberInput
            value={c.letterSpacing}
            min={-1}
            max={5}
            step={0.05}
            suffix="mm"
            onChange={(letterSpacing) => set({ letterSpacing })}
          />
        </Field>
      </div>
      <Toggle
        checked={c.autoFit}
        onChange={(autoFit) => set({ autoFit })}
        label="Shrink to fit the box"
        hint="Reduces the type size until the wrapped text fits."
      />
    </div>
  );
}

function LatexFields({ c, set }: { c: Content<'latex'>; set: (p: Record<string, unknown>) => void }) {
  const { mathErrors, mathPending } = useNotebook();
  const errors = Object.values(mathErrors);
  const [compiling, setCompiling] = useState(false);
  const [compileError, setCompileError] = useState<string | null>(null);

  const compileDocument = async () => {
    setCompiling(true);
    setCompileError(null);
    try {
      const response = await fetch('/api/latex/document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: c.source }),
      });
      if (!response.ok) {
        const detail = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(detail?.error ?? `LaTeX compilation failed (${response.status}).`);
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = 'latex-document.pdf';
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setCompileError(error instanceof Error ? error.message : 'LaTeX compilation failed.');
    } finally {
      setCompiling(false);
    }
  };

  return (
    <div className="space-y-3">
      <Field
        label="LaTeX source"
        hint="Maths via MathJax, plus sections, itemize/enumerate, textbf/textit and $…$ / $$…$$."
      >
        <TextArea
          rows={10}
          spellCheck={false}
          value={c.source}
          className="font-mono text-[11.5px]"
          onChange={(event) => set({ source: event.target.value })}
        />
      </Field>

      {mathPending && <p className="text-[10.5px] text-ink-400">Rendering formulas…</p>}
      {errors.length > 0 && (
        <Notice tone="warn">
          {errors.length} formula{errors.length > 1 ? 's' : ''} could not be rendered. First error:{' '}
          {errors[0]}
        </Notice>
      )}

      <div className="space-y-2">
        <Button onClick={compileDocument} disabled={compiling || !c.source.trim()}>
          {compiling ? 'Compiling document...' : 'Compile full document to PDF'}
        </Button>
        <p className="text-[10.5px] leading-relaxed text-ink-500">
          Uses the local latexmk/TeX installation. Tables, packages, macros, and page settings
          render in the downloaded PDF, not the editable canvas preview.
        </p>
        {compileError && <Notice tone="warn">{compileError}</Notice>}
      </div>

      <Field
        label="Fit to page size"
        hint="Applies when the notebook page differs from the size this was written for."
      >
        <Select value={c.fit} onChange={(event) => set({ fit: event.target.value })}>
          <option value="both">Scale, then shrink if it still overflows</option>
          <option value="scale">Scale proportionally — same line breaks, smaller type</option>
          <option value="reflow">Reflow — keep the type size, re-wrap the text</option>
        </Select>
      </Field>

      <FontControls font={c.font} size={c.size} color={c.color} set={set} sizeMax={60} />

      <div className="grid grid-cols-2 gap-2">
        <Field label="Align">
          <Segmented
            value={c.align}
            onChange={(align) => set({ align })}
            options={[
              { value: 'left', label: 'L' },
              { value: 'center', label: 'C' },
              { value: 'right', label: 'R' },
            ]}
          />
        </Field>
        <Field label="Line height">
          <NumberInput
            value={c.lineHeight}
            min={0.6}
            max={4}
            step={0.05}
            onChange={(lineHeight) => set({ lineHeight })}
          />
        </Field>
      </div>
    </div>
  );
}

function ImageFields({ c, set }: { c: Content<'image'>; set: (p: Record<string, unknown>) => void }) {
  return (
    <div className="space-y-3">
      <AssetPicker value={c.assetId} onChange={(assetId) => set({ assetId })} />
      <Field label="Fit">
        <Segmented
          value={c.fit}
          onChange={(fit) => set({ fit })}
          options={[
            { value: 'contain', label: 'Contain', title: 'Fit inside the box' },
            { value: 'cover', label: 'Cover', title: 'Fill the box and crop' },
            { value: 'fill', label: 'Stretch', title: 'Ignore the aspect ratio' },
          ]}
        />
      </Field>
      {c.fit !== 'fill' && (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Horizontal">
            <Segmented
              value={c.align}
              onChange={(align) => set({ align })}
              options={[
                { value: 'left', label: 'L' },
                { value: 'center', label: 'C' },
                { value: 'right', label: 'R' },
              ]}
            />
          </Field>
          <Field label="Vertical">
            <Segmented
              value={c.valign}
              onChange={(valign) => set({ valign })}
              options={[
                { value: 'top', label: 'T' },
                { value: 'middle', label: 'M' },
                { value: 'bottom', label: 'B' },
              ]}
            />
          </Field>
        </div>
      )}
      <Field label="Opacity" hint="Lower it to use the image as a tracing guide.">
        <Slider value={c.opacity} min={0.05} max={1} step={0.05} onChange={(opacity) => set({ opacity })} />
      </Field>
    </div>
  );
}

function ShapeFields({ c, set }: { c: Content<'shape'>; set: (p: Record<string, unknown>) => void }) {
  return (
    <div className="space-y-3">
      <Field label="Shape">
        <Segmented
          value={c.shape}
          onChange={(shape) => set({ shape })}
          options={[
            { value: 'rect', label: 'Rect' },
            { value: 'ellipse', label: 'Ellipse' },
            { value: 'line', label: 'Line' },
            { value: 'triangle', label: 'Triangle' },
          ]}
        />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Stroke">
          <ColorInput value={c.stroke} onChange={(stroke) => set({ stroke })} />
        </Field>
        <Field label="Stroke width">
          <NumberInput
            value={c.strokeWidth}
            min={0}
            max={10}
            step={0.05}
            suffix="mm"
            onChange={(strokeWidth) => set({ strokeWidth })}
          />
        </Field>
      </div>
      <Field label="Fill">
        <div className="flex items-center gap-2">
          <ColorInput value={c.fill ?? '#eef3f8'} onChange={(fill) => set({ fill })} />
          {c.fill && (
            <Button size="sm" variant="ghost" onClick={() => set({ fill: undefined })}>
              None
            </Button>
          )}
        </div>
      </Field>
      {c.shape === 'rect' && (
        <Field label="Corner radius">
          <NumberInput
            value={c.radius}
            min={0}
            max={50}
            step={0.5}
            suffix="mm"
            onChange={(radius) => set({ radius })}
          />
        </Field>
      )}
      <Toggle checked={c.dashed} onChange={(dashed) => set({ dashed })} label="Dashed outline" />
    </div>
  );
}

function GraphFields({ c, set }: { c: Content<'graph'>; set: (p: Record<string, unknown>) => void }) {
  return (
    <div className="space-y-3">
      <p className="text-[11px] leading-snug text-ink-500">
        A numbered Cartesian grid for plotting by hand. Resize the block to set the graph’s aspect ratio.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Field label="X maximum">
          <NumberInput value={c.xMax} min={1} max={100} step={1} onChange={(xMax) => set({ xMax })} />
        </Field>
        <Field label="Y maximum">
          <NumberInput value={c.yMax} min={1} max={100} step={1} onChange={(yMax) => set({ yMax })} />
        </Field>
        <Field label="Label every X">
          <NumberInput
            value={c.xLabelEvery}
            min={1}
            max={100}
            step={1}
            onChange={(xLabelEvery) => set({ xLabelEvery })}
          />
        </Field>
        <Field label="Label every Y">
          <NumberInput
            value={c.yLabelEvery}
            min={1}
            max={100}
            step={1}
            onChange={(yLabelEvery) => set({ yLabelEvery })}
          />
        </Field>
      </div>
      <div className="space-y-2 border-y border-ink-200 py-3">
        <Toggle checked={c.showGrid} onChange={(showGrid) => set({ showGrid })} label="Show grid" />
        <Toggle checked={c.showLabels} onChange={(showLabels) => set({ showLabels })} label="Show axis numbers" />
        <Toggle checked={c.showArrows} onChange={(showArrows) => set({ showArrows })} label="Arrowheads on axes" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Grid colour">
          <ColorInput value={c.gridColor} onChange={(gridColor) => set({ gridColor })} />
        </Field>
        <Field label="Grid width">
          <NumberInput value={c.gridWidth} min={0.02} max={3} step={0.01} suffix="mm" onChange={(gridWidth) => set({ gridWidth })} />
        </Field>
        <Field label="Axis colour">
          <ColorInput value={c.axisColor} onChange={(axisColor) => set({ axisColor })} />
        </Field>
        <Field label="Axis width">
          <NumberInput value={c.axisWidth} min={0.02} max={3} step={0.01} suffix="mm" onChange={(axisWidth) => set({ axisWidth })} />
        </Field>
        <Field label="Label colour">
          <ColorInput value={c.labelColor} onChange={(labelColor) => set({ labelColor })} />
        </Field>
        <Field label="Label size">
          <NumberInput value={c.labelSize} min={0.8} max={12} step={0.1} suffix="mm" onChange={(labelSize) => set({ labelSize })} />
        </Field>
      </div>
    </div>
  );
}

function TableFields({ c, set }: { c: Content<'table'>; set: (p: Record<string, unknown>) => void }) {
  const setColumn = (index: number, patch: Partial<(typeof c.columns)[number]>) => {
    const next = [...c.columns];
    next[index] = { ...next[index], ...patch };
    set({ columns: next });
  };

  return (
    <div className="space-y-3">
      <div>
        <SectionLabel>Columns</SectionLabel>
        <ul className="space-y-1.5">
          {c.columns.map((column, index) => (
            <li key={index} className="flex items-center gap-1.5">
              <TextInput
                value={column.label}
                placeholder="Heading"
                className="h-7 py-0.5 text-[12px]"
                onChange={(event) => setColumn(index, { label: event.target.value })}
              />
              <div className="w-16 shrink-0">
                <NumberInput
                  value={column.weight}
                  min={0.05}
                  max={20}
                  step={0.1}
                  onChange={(weight) => setColumn(index, { weight })}
                />
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="shrink-0 px-1.5"
                aria-label="Remove column"
                onClick={() => set({ columns: c.columns.filter((_, i) => i !== index) })}
              >
                ✕
              </Button>
            </li>
          ))}
        </ul>
        <Button
          size="sm"
          className="mt-1.5 w-full"
          onClick={() => set({ columns: [...c.columns, { label: '', weight: 1, align: 'left' }] })}
        >
          Add column
        </Button>
        <p className="mt-1 text-[10px] text-ink-400">
          The number is a relative width; columns are normalised against their total.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Field label="Rows">
          <NumberInput value={c.rows} min={0} max={200} step={1} onChange={(rows) => set({ rows })} />
        </Field>
        <Field label="Header height">
          <NumberInput
            value={c.headerHeight}
            min={0}
            max={40}
            step={0.5}
            suffix="mm"
            onChange={(headerHeight) => set({ headerHeight })}
          />
        </Field>
      </div>

      <Toggle
        checked={c.fillHeight}
        onChange={(fillHeight) => set({ fillHeight })}
        label="Stretch rows to fill the block"
        hint="Off uses a fixed row height and draws as many rows as fit."
      />
      {!c.fillHeight && (
        <Field label="Row height">
          <NumberInput
            value={c.rowHeight}
            min={1}
            max={60}
            step={0.5}
            suffix="mm"
            onChange={(rowHeight) => set({ rowHeight })}
          />
        </Field>
      )}

      <FontControls font={c.font} size={c.size} color={c.color} set={set} sizeMax={30} />

      <div className="grid grid-cols-2 gap-2">
        <Field label="Rule colour">
          <ColorInput value={c.lineColor} onChange={(lineColor) => set({ lineColor })} />
        </Field>
        <Field label="Header fill">
          <ColorInput value={c.headerFill} onChange={(headerFill) => set({ headerFill })} />
        </Field>
      </div>
      <Field label="Alternate row shading" hint="Tints every other row.">
        <ColorInput
          value={c.zebraFill ?? 'theme:secondaryAlt'}
          onChange={(zebraFill) => set({ zebraFill })}
          allowNone
          onClear={() => set({ zebraFill: undefined })}
        />
      </Field>

      <div className="space-y-1.5">
        <Toggle checked={c.outerBorder} onChange={(outerBorder) => set({ outerBorder })} label="Outer border" />
        <Toggle
          checked={c.verticalRules}
          onChange={(verticalRules) => set({ verticalRules })}
          label="Vertical rules"
        />
      </div>
    </div>
  );
}

function FieldsFields({ c, set }: { c: Content<'fields'>; set: (p: Record<string, unknown>) => void }) {
  return (
    <div className="space-y-3">
      <Field label="Labels">
        <StringListInput value={c.items} onChange={(items) => set({ items })} placeholder="Date" />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Columns">
          <NumberInput value={c.columns} min={1} max={6} step={1} onChange={(columns) => set({ columns })} />
        </Field>
        <Field label="Gap">
          <NumberInput value={c.gap} min={0} max={40} step={0.5} suffix="mm" onChange={(gap) => set({ gap })} />
        </Field>
      </div>
      <FontControls font={c.font} size={c.size} color={c.color} set={set} sizeMax={30} />
      <Field label="Rule colour">
        <ColorInput value={c.lineColor} onChange={(lineColor) => set({ lineColor })} />
      </Field>
    </div>
  );
}

function ChecklistFields({
  c,
  set,
}: {
  c: Content<'checklist'>;
  set: (p: Record<string, unknown>) => void;
}) {
  return (
    <div className="space-y-3">
      <Field label="Pre-filled items">
        <StringListInput value={c.items} onChange={(items) => set({ items })} placeholder="Task" />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Blank rows">
          <NumberInput
            value={c.blankRows}
            min={0}
            max={100}
            step={1}
            onChange={(blankRows) => set({ blankRows })}
          />
        </Field>
        <Field label="Row height">
          <NumberInput
            value={c.rowHeight}
            min={2}
            max={40}
            step={0.5}
            suffix="mm"
            onChange={(rowHeight) => set({ rowHeight })}
          />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Box shape">
          <Segmented
            value={c.boxShape}
            onChange={(boxShape) => set({ boxShape })}
            options={[
              { value: 'square', label: 'Square' },
              { value: 'circle', label: 'Circle' },
            ]}
          />
        </Field>
        <Field label="Box size">
          <NumberInput
            value={c.boxSize}
            min={1}
            max={20}
            step={0.25}
            suffix="mm"
            onChange={(boxSize) => set({ boxSize })}
          />
        </Field>
      </div>
      <FontControls font={c.font} size={c.size} color={c.color} set={set} sizeMax={30} />
      <Field label="Box and rule colour" hint="Colours the tick boxes and the write-on rules.">
        <ColorInput value={c.lineColor} onChange={(lineColor) => set({ lineColor })} />
      </Field>
      <Toggle checked={c.showRule} onChange={(showRule) => set({ showRule })} label="Rule for empty rows" />
    </div>
  );
}

function PageNumberFields({
  c,
  set,
}: {
  c: Content<'pagenumber'>;
  set: (p: Record<string, unknown>) => void;
}) {
  return (
    <div className="space-y-3">
      <Notice tone="info">
        This draws the number for whichever page the design lands on. For numbering the whole
        notebook at once, use the option on the Export step instead.
      </Notice>
      <Field label="Format" hint="{n} page number · {total} page count · {title} notebook name">
        <TextInput value={c.format} onChange={(event) => set({ format: event.target.value })} />
      </Field>
      <FontControls font={c.font} size={c.size} color={c.color} set={set} sizeMax={30} />
      <Field label="Align">
        <Segmented
          value={c.align}
          onChange={(align) => set({ align })}
          options={[
            { value: 'left', label: 'L' },
            { value: 'center', label: 'C' },
            { value: 'right', label: 'R' },
          ]}
        />
      </Field>
    </div>
  );
}

export function labelFor(content: BlockContent): string {
  const labels: Record<BlockContent['type'], string> = {
    text: 'Text',
    latex: 'LaTeX',
    image: 'Image',
    shape: 'Shape',
    pattern: 'Pattern area',
    graph: 'Graph',
    table: 'Table',
    fields: 'Labelled fields',
    checklist: 'Checklist',
    pagenumber: 'Page number',
  };
  return labels[content.type];
}
