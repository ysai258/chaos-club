import { useState } from 'react'
import { loadProfile, loadToken, saveProfile, type Profile } from '../lib/storage.ts'
import { JoinForm } from './JoinForm.tsx'
import { RoomSession } from './RoomSession.tsx'

/** /r/:code — join form first, unless this browser already has a seat here. */
export function RoomPage({ code }: { code: string }) {
  const [profile, setProfile] = useState<Profile | null>(() => (loadToken(code) ? loadProfile() : null))
  if (!profile) {
    return (
      <JoinForm
        code={code}
        onJoin={(p) => {
          saveProfile(p)
          setProfile(p)
        }}
      />
    )
  }
  return <RoomSession code={code} profile={profile} />
}
