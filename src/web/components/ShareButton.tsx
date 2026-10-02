import { Button, toast, type ButtonProps } from '../ui/index.ts'

export function roomLink(code: string): string {
  return `${location.origin}/r/${code}`
}

/** Native share sheet on phones, copy-to-clipboard elsewhere. */
export function ShareButton({ code, ...rest }: { code: string } & Omit<ButtonProps, 'onClick'>) {
  const share = async () => {
    const url = roomLink(code)
    if (navigator.share && matchMedia('(pointer: coarse)').matches) {
      try {
        await navigator.share({ title: 'Chaos Club', text: `Join my Chaos Club room — code ${code} 🎉`, url })
        return
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return
      }
    }
    try {
      await navigator.clipboard.writeText(url)
      toast('Link copied! Paste it in the Meet chat.', { kind: 'success', emoji: '🔗' })
    } catch {
      toast(`Share this: ${url}`, { emoji: '🔗', durationMs: 6000 })
    }
  }
  return (
    <Button icon="📣" onClick={share} {...rest}>
      {rest.children ?? 'Invite'}
    </Button>
  )
}
