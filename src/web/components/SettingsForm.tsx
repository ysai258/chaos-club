import type { ReactNode } from 'react'
import type { SettingField } from '../../games/types.ts'
import { Segmented, Stepper, Toggle } from '../ui/index.ts'

/** Renders any game's settingsSpec. Read-only for non-hosts. */
export function SettingsForm({ spec, values, editable, onChange }: {
  spec: SettingField[]
  values: Record<string, unknown>
  editable: boolean
  onChange: (patch: Record<string, unknown>) => void
}) {
  if (spec.length === 0) return null
  return (
    <div className="flex flex-col divide-y-2 divide-dashed divide-ink/20">
      {spec.map((f) => {
        const raw = values[f.key]
        return (
          <div key={f.key} data-testid={`setting-${f.key}`} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
            <span className="min-w-0 font-display font-bold">{f.label}</span>
            {f.kind === 'number' ? (
              editable ? (
                <Stepper
                  label={f.label}
                  value={typeof raw === 'number' ? raw : f.default}
                  min={f.min}
                  max={f.max}
                  step={f.step ?? 1}
                  onChange={(v) => onChange({ [f.key]: v })}
                />
              ) : (
                <ReadOnly>{String(typeof raw === 'number' ? raw : f.default)}</ReadOnly>
              )
            ) : f.kind === 'select' ? (
              editable ? (
                <Segmented
                  label={f.label}
                  value={String(raw ?? f.default)}
                  options={f.options.map((o) => ({ value: String(o.value), label: o.label }))}
                  // Send back the option's own value, so numeric option values stay numbers.
                  onChange={(v) => onChange({ [f.key]: f.options.find((o) => String(o.value) === v)?.value ?? v })}
                />
              ) : (
                <ReadOnly>{f.options.find((o) => String(o.value) === String(raw ?? f.default))?.label ?? String(raw ?? '')}</ReadOnly>
              )
            ) : editable ? (
              <Toggle label={f.label} checked={typeof raw === 'boolean' ? raw : f.default} onChange={(v) => onChange({ [f.key]: v })} />
            ) : (
              <ReadOnly>{(typeof raw === 'boolean' ? raw : f.default) ? 'On' : 'Off'}</ReadOnly>
            )}
          </div>
        )
      })}
    </div>
  )
}

function ReadOnly({ children }: { children: ReactNode }) {
  return <span className="rounded-xl border-2 border-ink bg-paper px-3 py-1.5 font-display font-extrabold">{children}</span>
}
