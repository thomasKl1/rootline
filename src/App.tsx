import type { Session } from '@supabase/supabase-js'
import { useEffect, useRef, useState } from 'react'
import { isConfigured, supabase } from './lib/supabase'
import type { Plant } from './lib/types'
import { useGarden } from './lib/useGarden'
import { AddPlant } from './screens/AddPlant'
import { Home } from './screens/Home'
import { Login } from './screens/Login'
import { PlanScreen } from './screens/Plan'
import { RoomsContext } from './screens/PlantForm'
import { PlantSheet } from './screens/PlantSheet'
import { Settings } from './screens/Settings'
import { JoinInvite } from './screens/Sharing'

type Tab = 'plants' | 'plan' | 'settings'

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  if (!isConfigured) {
    return (
      <main className="login">
        <h1 className="display">Configuration manquante</h1>
        <p className="muted">Copie .env.example en .env.local et renseigne l'URL et la clé publique de ton projet Supabase.</p>
      </main>
    )
  }
  if (session === undefined) return null
  if (!session) return <Login />
  return <Garden session={session} />
}

function Garden({ session }: { session: Session }) {
  const garden = useGarden()
  const [tab, setTab] = useState<Tab>('plants')
  const [adding, setAdding] = useState(false)
  const [openPlant, setOpenPlant] = useState<Plant | null>(null)
  const [toast, setToast] = useState<{ text: string; eventId: string | null } | null>(null)
  const toastTimer = useRef<number | undefined>(undefined)

  const fullName = (session.user.user_metadata?.full_name as string | undefined) ?? null
  const firstName = fullName ? fullName.split(' ')[0] : null

  function showToast(text: string, eventId: string | null) {
    window.clearTimeout(toastTimer.current)
    setToast({ text, eventId })
    toastTimer.current = window.setTimeout(() => setToast(null), 5000)
  }

  async function handleWater(plant: Plant) {
    const { id, error } = await garden.water(plant)
    showToast(error ?? `${plant.name} : arrosage noté`, id)
  }

  return (
    <RoomsContext.Provider value={garden.rooms}>
    <div className="app">
      {tab === 'plants' && (
        <Home
          garden={garden}
          firstName={firstName}
          onAdd={() => setAdding(true)}
          onWater={handleWater}
          onOpen={setOpenPlant}
        />
      )}
      {tab === 'plan' && <PlanScreen garden={garden} onOpen={setOpenPlant} onToast={(t) => showToast(t, null)} />}
      {tab === 'settings' && <Settings email={session.user.email} garden={garden} onToast={(t) => showToast(t, null)} />}

      <JoinInvite garden={garden} onToast={(t) => showToast(t, null)} />

      {toast && (
        <div className="toast" role="status">
          <span>{toast.text}</span>
          {toast.eventId && (
            <button
              className="toast-action"
              onClick={() => {
                void garden.undoEvent(toast.eventId!)
                setToast(null)
              }}
            >
              Annuler
            </button>
          )}
        </div>
      )}

      {openPlant && (
        <PlantSheet
          plant={openPlant}
          garden={garden}
          onClose={() => setOpenPlant(null)}
          onToast={showToast}
          onDone={(message) => {
            setOpenPlant(null)
            showToast(message, null)
          }}
        />
      )}

      {adding && (
        <AddPlant
          onCancel={() => setAdding(false)}
          onSave={async (p, photo) => {
            const err = await garden.addPlant(p, photo)
            if (!err) {
              setAdding(false)
              setTab('plants')
              showToast(`${p.name} ajoutée`, null)
            }
            return err
          }}
        />
      )}

      <nav className="tabbar" aria-label="Navigation principale">
        <TabButton label="Plantes" active={tab === 'plants'} onClick={() => setTab('plants')} icon={ICONS.leaf} />
        <TabButton label="Plan" active={tab === 'plan'} onClick={() => setTab('plan')} icon={ICONS.map} />
        <TabButton label="Ajouter" active={false} onClick={() => setAdding(true)} icon={ICONS.plus} />
        <TabButton label="Réglages" active={tab === 'settings'} onClick={() => setTab('settings')} icon={ICONS.gear} />
      </nav>
    </div>
    </RoomsContext.Provider>
  )
}

function TabButton(props: { label: string; active: boolean; onClick: () => void; icon: string }) {
  return (
    <button className={`tab${props.active ? ' active' : ''}`} onClick={props.onClick} aria-current={props.active ? 'page' : undefined}>
      <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d={props.icon} />
      </svg>
      {props.label}
    </button>
  )
}

const ICONS = {
  leaf: 'M12 21V11M12 11C12 6 8 4 4 4c0 4 3 7 8 7zM12 14c0-4 3-6 7-6 0 4-3 6-7 6z',
  map: 'M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14',
  plus: 'M12 5v14M5 12h14',
  gear: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1',
}
