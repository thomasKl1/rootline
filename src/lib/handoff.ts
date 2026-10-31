import { clearInvite, pendingInvite, storeInvite } from './sharing'
import { openedFromEmailLink, supabase } from './supabase'

// ---------------------------------------------------------------------------
// Transfert de session Safari → app installée (iPhone).
// Sur iOS, l'app ajoutée à l'écran d'accueil a son propre stockage, séparé de
// Safari, et les liens des e-mails s'ouvrent toujours dans Safari. La connexion
// faite par le lien reste donc dans Safari. Safari affiche alors une « clé »
// (le jeton de rafraîchissement de la session) à coller dans l'app.
// ---------------------------------------------------------------------------

const nav = navigator as Navigator & { standalone?: boolean }

export const isStandalone = window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true

export const isIOS =
  /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

/** Safari vient d'être ouvert par le lien de l'e-mail : proposer de passer la connexion à l'app. */
export const shouldOfferHandoff = isIOS && !isStandalone && openedFromEmailLink

/** Dans l'app installée sur iPhone : le lien de l'e-mail ne peut pas la connecter directement. */
export const needsHandoff = isIOS && isStandalone

const SEP = '~'

/**
 * Copie la clé de la session Safari, puis fait oublier la session à Safari :
 * Safari ne doit plus utiliser ce jeton, sinon Supabase y verrait une
 * réutilisation et fermerait aussi la session de l'app.
 */
export async function copyHandoffKey(onCopied: () => void): Promise<string | null> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.refresh_token
  if (!token) return 'Session introuvable : rouvre le lien de l’e-mail.'
  const invite = pendingInvite()
  try {
    await navigator.clipboard.writeText(invite ? `${token}${SEP}${invite}` : token)
  } catch {
    return 'Copie impossible. Réessaie en touchant le bouton.'
  }
  clearInvite()
  onCopied() // avant d'oublier la session, pour passer directement à l'écran « Clé copiée »
  forgetSessionLocally()
  return null
}

/**
 * Oublie la session dans Safari SANS prévenir Supabase : signOut(), même en
 * scope « local », révoque la session côté serveur, donc la clé copiée avec.
 */
function forgetSessionLocally() {
  void supabase.auth.stopAutoRefresh()
  try {
    for (const k of Object.keys(localStorage)) {
      if (/^sb-.*-auth-token/.test(k)) localStorage.removeItem(k)
    }
  } catch {
    // Stockage indisponible : rien à oublier.
  }
}

/** Dans l'app : ouvre la session à partir de la clé copiée dans Safari. */
export async function redeemHandoffKey(raw: string): Promise<string | null> {
  const [token, invite] = raw.trim().split(SEP)
  if (!token) return 'Colle la clé copiée dans Safari.'
  if (invite) storeInvite(invite)
  const { error } = await supabase.auth.refreshSession({ refresh_token: token })
  if (error) return 'Clé invalide ou déjà utilisée. Rouvre le lien de l’e-mail dans Safari pour en obtenir une nouvelle.'
  return null
}
