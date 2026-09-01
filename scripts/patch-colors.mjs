import { readFileSync, writeFileSync } from 'node:fs';

const edit = (path, pairs) => {
  let s = readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
  for (const [from, to, label] of pairs) {
    if (!s.includes(from)) throw new Error(`${path}: not found — ${label}`);
    s = s.split(from).join(to);
  }
  writeFileSync(path, s);
  console.log('patched', path);
};

/* ---- BlockInspector: theme-aware pickers + the missing colours --------- */
edit('src/components/designer/BlockInspector.tsx', [
  // Generic: every <Field label="X"><ColorInput …/></Field> becomes a ColorField.
  [
    `        <Field label="Colour">
          <ColorInput value={c.stroke} onChange={(stroke) => set({ stroke })} />
        </Field>`,
    `        <ColorField label="Colour" value={c.stroke} onChange={(stroke) => set({ stroke })} />`,
    'shape stroke',
  ],
  [
    `      <Field label="Fill">
        <div className="flex items-center gap-2">
          <ColorInput value={c.fill ?? '#eef3f8'} onChange={(fill) => set({ fill })} />
          {c.fill && (
            <Button size="sm" variant="ghost" onClick={() => set({ fill: undefined })}>
              None
            </Button>
          )}
        </div>
      </Field>`,
    `      <ColorField
        label="Fill"
        value={c.fill ?? 'theme:secondaryAlt'}
        onChange={(fill) => set({ fill })}
        allowNone
        onClear={() => set({ fill: undefined })}
      />`,
    'shape fill',
  ],
  // Checklist: box + rule colour was missing entirely.
  [
    `      <FontControls font={c.font} size={c.size} color={c.color} set={set} sizeMax={30} />
      <Toggle checked={c.showRule} onChange={(showRule) => set({ showRule })} label="Rule for empty rows" />`,
    `      <FontControls font={c.font} size={c.size} color={c.color} set={set} sizeMax={30} />
      <ColorField
        label="Box and rule colour"
        hint="Colours the tick boxes and the write-on rules."
        value={c.lineColor}
        onChange={(lineColor) => set({ lineColor })}
      />
      <Toggle checked={c.showRule} onChange={(showRule) => set({ showRule })} label="Rule for empty rows" />`,
    'checklist line colour',
  ],
  // Table: zebra shading had no control.
  [
    `      <div className="grid grid-cols-2 gap-2">
        <Field label="Rule colour">
          <ColorInput value={c.lineColor} onChange={(lineColor) => set({ lineColor })} />
        </Field>
        <Field label="Header fill">
          <ColorInput value={c.headerFill} onChange={(headerFill) => set({ headerFill })} />
        </Field>
      </div>`,
    `      <div className="grid grid-cols-2 gap-2">
        <ColorField label="Rule colour" value={c.lineColor} onChange={(lineColor) => set({ lineColor })} />
        <ColorField label="Header fill" value={c.headerFill} onChange={(headerFill) => set({ headerFill })} />
      </div>
      <ColorField
        label="Alternate row shading"
        hint="Tints every other row. Clear it for plain rows."
        value={c.zebraFill ?? 'theme:secondaryAlt'}
        onChange={(zebraFill) => set({ zebraFill })}
        allowNone
        onClear={() => set({ zebraFill: undefined })}
      />`,
    'table colours',
  ],
  // Fields block rule colour.
  [
    `      <Field label="Rule colour">
        <ColorInput value={c.lineColor} onChange={(lineColor) => set({ lineColor })} />
      </Field>`,
    `      <ColorField label="Rule colour" value={c.lineColor} onChange={(lineColor) => set({ lineColor })} />`,
    'fields rule colour',
  ],
  // Font colour, used by text/latex/table/fields/checklist/pagenumber.
  [
    `      <Field label="Colour">
        <ColorInput value={color} onChange={(next) => set({ color: next })} />
      </Field>`,
    `      <ColorField label="Colour" value={color} onChange={(next) => set({ color: next })} />`,
    'font colour',
  ],
  // Block background.
  [
    `          <Field label="Background fill">
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
          </Field>`,
    `          <ColorField
            label="Background fill"
            value={block.background ?? '#ffffff'}
            onChange={(background) => onChange({ ...block, background })}
            allowNone
            onClear={() => onChange({ ...block, background: undefined })}
          />`,
    'block background',
  ],
  // Pattern-area border colour.
  [
    `                <Field label="Colour">
                  <ColorInput
                    value={content.border.color}
                    onChange={(color) => set({ border: { ...content.border, color } })}
                  />
                </Field>`,
    `                <ColorField
                  label="Colour"
                  value={content.border.color}
                  onChange={(color) => set({ border: { ...content.border, color } })}
                />`,
    'pattern border colour',
  ],
  [
    `import { PatternEditor } from '@/components/designer/PatternEditor';`,
    `import { PatternEditor } from '@/components/designer/PatternEditor';
import { ColorField } from '@/components/ui/ColorField';`,
    'inspector import',
  ],
]);

/* ---- PatternEditor: every ruling colour goes through the palette ------- */
edit('src/components/designer/PatternEditor.tsx', [
  [
    `const Colour = ({
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
);`,
    `const Colour = ({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) => <ColorField label={label} value={value} onChange={onChange} />;`,
    'pattern colour helper',
  ],
  [
    `import {
  ColorInput,
  Field,`,
    `import { ColorField } from '@/components/ui/ColorField';
import {
  Field,`,
    'pattern editor import',
  ],
]);

/* ---- GeneratorParams: generator colours too ---------------------------- */
edit('src/components/order/GeneratorParams.tsx', [
  [
    `    case 'color':
      return (
        <Field label={field.label} hint={field.help}>
          <ColorInput value={typeof value === 'string' ? value : '#000000'} onChange={onChange} />
        </Field>
      );`,
    `    case 'color':
      return (
        <ColorField
          label={field.label}
          hint={field.help}
          value={typeof value === 'string' ? value : '#000000'}
          onChange={onChange}
        />
      );`,
    'generator colour field',
  ],
  [
    `import {
  ColorInput,
  Field,`,
    `import { ColorField } from '@/components/ui/ColorField';
import {
  Field,`,
    'generator params import',
  ],
]);

/* ---- ExportPanel: page-number colour ---------------------------------- */
edit('src/components/export/ExportPanel.tsx', [
  [
    `                  <Field label="Colour">
                    <ColorInput value={numbering.color} onChange={(color) => setNumbering({ color })} />
                  </Field>`,
    `                  <ColorField
                    label="Colour"
                    value={numbering.color}
                    onChange={(color) => setNumbering({ color })}
                  />`,
    'page number colour',
  ],
  [
    `import {
  Button,
  ColorInput,
  Field,`,
    `import { ColorField } from '@/components/ui/ColorField';
import {
  Button,
  Field,`,
    'export panel import',
  ],
]);

console.log('colour controls rewired');
