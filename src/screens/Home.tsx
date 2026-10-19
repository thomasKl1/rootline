import { computeStatus, plural, URGENCY_LABEL, URGENCY_ORDER, type PlantStatus, type Urgency } from '../lib/status'
import type { Plant } from '../lib/types'
import type { useGarden } from '../lib/useGarden'

type Garden = ReturnType<typeof useGarden>
type Row = { plant: Plant; status: PlantStatus }

type Props = {
  garden: Garden
  firstName: string | null
  onAdd: () => void
  onWater: (plant: Plant) => void
}

export function Home({ garden, firstName, onAdd, onWater }: Props) {
  const today = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })

  const rows: Row[] = garden.plants.map((plant) => ({
    plant,
    status: computeStatus(
      plant,
      plant.sensor_mac ? garden.latestReading.get(plant.sensor_mac) : undefined,
      garden.lastWatered.get(plant.id),
    ),
  }))
  const groups = new Map<Urgency, Row[]>(URGENCY_ORDER.map((u) => [u, []]))
  for (const r of rows) groups.get(r.status.urgency)!.push(r)

  const thirsty = groups.get('late')!.length + groups.get('today')!.length
  const fine = rows.length - thirsty

  return (
    <main className="screen">
      <header className="home-header">
        <p className="muted capitalize">{today}</p>
        <h1 className="display">{firstName ? `Bonjour ${firstName}` : 'Bonjour'}</h1>
        {rows.length > 0 && (
          <p className="lead">
            {thirsty === 0
              ? 'Toutes tes plantes vont bien.'
              : `${plural(thirsty, 'plante')} ${thirsty > 1 ? 'ont' : 'a'} soif, ${fine} ${fine > 1 ? 'vont' : 'va'} bien.`}
          </p>
        )}
      </header>

      {garden.loading && <p className="muted pad">Chargement…</p>}
      {garden.error && (
        <p className="error pad" role="alert">
          {garden.error}
        </p>
      )}

      {!garden.loading && !garden.error && rows.length === 0 && (
        <section className="empty">
          <h2 className="display small">Aucune plante pour l'instant</h2>
          <p className="muted">Ajoute ta première plante pour recevoir tes rappels d'arrosage.</p>
          <button className="btn primary" onClick={onAdd}>
            Ajouter une plante
          </button>
        </section>
      )}

      {URGENCY_ORDER.map((u) => {
        const list = groups.get(u)!
        if (list.length === 0) return null
        return (
          <section key={u} className="group">
            <h2 className={`group-title tone-${u}`}>{URGENCY_LABEL[u]}</h2>
            {u === 'ok' ? (
              <ul className="compact-list">
                {list.map(({ plant, status }) => (
                  <li key={plant.id}>
                    <span className="name">{plant.name}</span>
                    <span className="muted">
                      {plant.room ? `${plant.room} · ` : ''}
                      {status.short}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              list.map(({ plant, status }) => (
                <PlantCard
                  key={plant.id}
                  plant={plant}
                  status={status}
                  photoUrl={garden.photoUrls.get(plant.id)}
                  onWater={() => onWater(plant)}
                />
              ))
            )}
          </section>
        )
      })}
    </main>
  )
}

function PlantCard(props: { plant: Plant; status: PlantStatus; photoUrl: string | undefined; onWater: () => void }) {
  const { plant, status, photoUrl, onWater } = props
  const u = status.urgency
  return (
    <article className="card plant-card">
      {photoUrl ? (
        <img className="thumb" src={photoUrl} alt="" loading="lazy" />
      ) : (
        <div className="thumb" aria-hidden="true">
          {plant.name.slice(0, 1).toUpperCase()}
        </div>
      )}
      <div className="plant-body">
        <div className="plant-head">
          <span className="name">{plant.name}</span>
          {plant.room && <span className="muted small">{plant.room}</span>}
        </div>
        {status.moisture != null && (
          <div
            className="meter"
            role="meter"
            aria-label="Humidité du sol"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={status.moisture}
          >
            <div className={`meter-fill tone-bg-${u}`} style={{ width: `${status.moisture}%` }} />
          </div>
        )}
        <span className={`small tone-${u}`}>{status.detail}</span>
      </div>
      {status.manual && (
        <button className="btn primary pill" onClick={onWater}>
          Arrosée
        </button>
      )}
    </article>
  )
}
