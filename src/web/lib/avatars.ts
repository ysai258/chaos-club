/** Emoji avatars offered at join. Anything single-grapheme is accepted by the server. */
export const AVATARS = [
  '😎', '🤠', '🥸', '🤓', '😈', '👻', '🤖', '👽', '🐸', '🐼',
  '🦊', '🐯', '🦁', '🐵', '🐧', '🦄', '🐙', '🦖', '🐝', '🦩',
  '🍕', '🌮', '🥭', '🌶️', '🧋', '🍩', '🔥', '⚡', '🌈', '💀',
  '🎸', '🏏', '🎯', '🛺', '🪩', '🧠',
]

export function randomAvatar(): string {
  return AVATARS[Math.floor(Math.random() * AVATARS.length)]!
}
