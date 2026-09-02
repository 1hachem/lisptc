// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeAll, describe, expect, it } from 'vitest'
import { BloubBot } from './BloubBot'
import { BotEngine } from './bot/engine'
import { DEFAULT_EXPRESSION, EXPRESSION_BY_ID } from './bot/expressions'
import { DEMI_VIEWBOX, RAYON } from './bot/repere'
import { DEFAULT_SHAPE, SHAPE_BY_ID } from './bot/skins'
import type { StateId } from './bot/states'

/*
 * Le seul fichier du paquet qui demande un DOM, et il le demande en tete de
 * fichier : le moteur, lui, se teste sans rien monter.
 *
 * Ce qu'il verrouille : le composant rend l'image DU MOTEUR, il ne redessine pas
 * la boule a cote. C'est le defaut que le portage React pouvait introduire sans
 * qu'aucun test de `src/bot/` ne le voie — ils ne passent jamais par le rendu.
 */

/** Moteur de reference : les memes reglages que ceux que le composant se donne par defaut. */
function moteurTemoin(state: StateId = 'idle') {
  return new BotEngine(
    RAYON,
    state,
    SHAPE_BY_ID.get(DEFAULT_SHAPE)?.radii ?? null,
    EXPRESSION_BY_ID.get(DEFAULT_EXPRESSION) ?? null
  )
}

async function monter(node: React.ReactNode) {
  const hote = document.createElement('div')
  document.body.append(hote)
  const root = createRoot(hote)
  await act(async () => {
    root.render(node)
  })
  return {
    svg: () => hote.querySelector('svg')!,
    rendre: async (suivant: React.ReactNode) => {
      await act(async () => {
        root.render(suivant)
      })
    },
    demonter: async () => {
      await act(async () => {
        root.unmount()
      })
    }
  }
}

beforeAll(() => {
  // `act` refuse de s'executer sans ce drapeau, que seuls les harnais de test posent
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

describe('BloubBot', () => {
  it('rend le repere du moteur, pas le sien', async () => {
    const { svg } = await monter(<BloubBot frozenAt={0} />)
    expect(svg().getAttribute('viewBox')).toBe(
      `${-DEMI_VIEWBOX} ${-DEMI_VIEWBOX} ${DEMI_VIEWBOX * 2} ${DEMI_VIEWBOX * 2}`
    )
  })

  it('rend exactement le corps echantillonne par le moteur', async () => {
    const { svg } = await monter(<BloubBot frozenAt={0} />)
    const attendu = moteurTemoin().sample(0)
    const corps = svg().querySelector('mask > path')
    expect(corps?.getAttribute('d')).toBe(attendu.bodyPath)
  })

  it('percerait les yeux dans le masque et non par-dessus le corps', async () => {
    const { svg } = await monter(<BloubBot frozenAt={0} />)
    const attendu = moteurTemoin().sample(0)
    // le corps blanc, puis un trou noir par oeil
    expect(svg().querySelectorAll('mask path')).toHaveLength(1 + attendu.eyes.length)
    expect(attendu.eyes.length).toBeGreaterThan(0)
  })

  /*
   * `frozenAt` n'etait bouge par personne au depart, et une image figee qui reste
   * sur la premiere date fait une animation exportee immobile. La prop doit donc
   * redessiner.
   */
  it('redessine quand `frozenAt` bouge', async () => {
    const { svg, rendre } = await monter(<BloubBot frozenAt={0} />)
    const premier = svg().querySelector('mask > path')?.getAttribute('d')
    await rendre(<BloubBot frozenAt={0.8} />)
    const attendu = moteurTemoin().sample(0.8)
    expect(svg().querySelector('mask > path')?.getAttribute('d')).toBe(attendu.bodyPath)
    expect(attendu.bodyPath).not.toBe(premier)
  })

  it('rend les anneaux de l orbite avec un degrade par arc', async () => {
    const { svg } = await monter(<BloubBot frozenAt={0.5} state="orbit" />)
    const attendu = moteurTemoin('orbit').sample(0.5)
    expect(attendu.arcs.length).toBeGreaterThan(0)
    expect(svg().querySelectorAll('linearGradient')).toHaveLength(attendu.arcs.length)
  })

  it('accepte une couleur d interface a la place de celles du catalogue', async () => {
    const { svg } = await monter(<BloubBot frozenAt={0} ink="var(--fg)" />)
    // le corps est un rectangle plein rogne par le masque : c'est lui qui porte l'encre
    expect(svg().querySelector('rect')?.getAttribute('fill')).toBe('var(--fg)')
  })

  /*
   * Le montage par defaut commence par `idle`. Un appelant qui pose `state`
   * sans jouer voulait cet etat-la, pas le premier bloc du cycle : la boule
   * repartait a `idle` au montage, et le callback l'annoncait.
   */
  it('ne laisse pas le montage ecraser un etat pose a l arret', async () => {
    const vus: StateId[] = []
    /*
     * La boucle est neutralisee pendant le montage : elle redessine a chaque
     * image, donc `act` — qui attend que la file de rendu se vide — ne rendrait
     * jamais la main. C'est le seul test qui monte le composant ANIME.
     */
    const vraiRaf = globalThis.requestAnimationFrame
    globalThis.requestAnimationFrame = () => 0
    try {
      const { demonter } = await monter(
        <BloubBot state="thinking" onStateChange={(id) => vus.push(id)} />
      )
      expect(vus).toEqual([])
      await demonter()
    } finally {
      globalThis.requestAnimationFrame = vraiRaf
    }
  })

  it('porte l etiquette qu on lui donne', async () => {
    const { svg } = await monter(<BloubBot frozenAt={0} ariaLabel="Bloub" />)
    expect(svg().getAttribute('role')).toBe('img')
    expect(svg().getAttribute('aria-label')).toBe('Bloub')
  })
})
