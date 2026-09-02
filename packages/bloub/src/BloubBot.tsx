import { type Ref, useEffect, useId, useImperativeHandle, useRef, useState } from 'react'
import { type Block, blockAt, defaultCycle, offsetOf } from './bot/cycles'
import { NOTIF_BLUE } from './bot/decor'
import { BotEngine, type BotFrame } from './bot/engine'
import { DEFAULT_EXPRESSION, EXPRESSION_BY_ID } from './bot/expressions'
import { clamp, easings } from './bot/math'
import { DEMI_VIEWBOX, RAYON } from './bot/repere'
import { COLOR_BY_ID, DEFAULT_COLOR, DEFAULT_SHAPE, mixHex, SHAPE_BY_ID } from './bot/skins'
import { STATE_BY_ID, type StateId } from './bot/states'
import { type GazeScript, lookTarget, TURN_TIME } from './gaze'

/**
 * Le montage par defaut est un module-constant et non une prop par defaut
 * calculee : une valeur par defaut `() => defaultCycle().blocks` rendrait un
 * NOUVEAU tableau a chaque rendu, donc une nouvelle identite, donc le watcher de
 * montage rejouerait a chaque rendu. Personne ne le mute.
 */
const CYCLE_PAR_DEFAUT: Block[] = defaultCycle().blocks

export interface BloubBotProps {
  size?: number
  /** identifiant de forme du personnalisateur */
  shape?: string
  /** identifiant de couleur du personnalisateur */
  color?: string
  /** identifiant d'expression de repos du personnalisateur */
  expression?: string
  /** couleur du fond, utilisee pour la brume de profondeur des particules */
  paper?: string
  /**
   * Fige le rendu a cette date (en secondes depuis le debut de l'etat).
   * Le moteur etant une fonction pure du temps, on obtient une image
   * reproductible au pixel pres, sans boucle d'animation : utile pour une
   * planche d'etats, une vignette de personnalisateur ou un test.
   */
  frozenAt?: number
  /**
   * Montage joue par le lecteur : une suite d'etats, chacun tenu la duree de
   * son bloc. Par defaut, le cycle releve sur la video.
   */
  cycle?: Block[]
  /**
   * Le regard suit le pointeur. Hors de portee des vignettes figees, qui n'ont
   * pas de boucle d'animation : les brancher reveillerait autant de boucles
   * qu'il y a de cases.
   */
  follow?: boolean
  /**
   * Regard scripte de l'arrivee : evalue a chaque image avec le temps ecoule
   * depuis qu'il a ete pose. Independant de `follow`, qui vise le pointeur —
   * ici c'est le script qui decide de tout, y compris de sa duree.
   */
  gaze?: GazeScript | null
  /** l'etiquette du `role="img"` : elle est au consommateur, le paquet ne traduit pas */
  ariaLabel?: string
  /**
   * Etat pose de l'exterieur : c'est le cas des vignettes figees, qui n'ont pas
   * de curseur. En lecture, c'est le montage qui decide et `onStateChange`
   * l'annonce.
   */
  state?: StateId
  /**
   * Index du bloc joue. Le curseur est un **index de bloc**, pas un etat : un
   * montage peut jouer deux fois le meme etat, et il faut alors savoir dans
   * lequel des deux on se trouve.
   */
  block?: number
  /**
   * Le stop ne gele pas l'horloge : arrete, le bot continue de respirer et de
   * cligner. Seuls l'enchainement du montage et la tete de lecture sont
   * suspendus.
   */
  playing?: boolean
  onStateChange?: (id: StateId) => void
  onBlockChange?: (index: number) => void
  /** temps ecoule dans le bloc courant, pour une tete de lecture */
  onElapsedChange?: (seconds: number) => void
  ref?: Ref<BloubBotHandle | null>
}

export interface BloubBotHandle {
  /**
   * Deplace la tete de lecture : on tombe au milieu d'un bloc, pas a son debut.
   */
  seek(index: number, offset?: number): void
  /**
   * Rend le MONTAGE a la date absolue `t`, sans horloge. C'est ce qui permet de
   * capturer un cycle entier hors ecran, image par image et plus vite que le
   * temps reel.
   */
  rendAt(t: number): void
}

/**
 * `useEffect` qui ne joue PAS au montage : l'equivalent d'un `watch` Vue sans
 * `immediate`. Les etats de depart sont deja poses par le constructeur du
 * moteur, rejouer les watchers au montage les reappliquerait a l'instant 0 —
 * donc avec un ratio de melange nul, donc sur la pose precedente.
 */
function useWatch(effet: () => void, deps: unknown[]) {
  const precedentes = useRef<unknown[] | null>(null)
  useEffect(() => {
    const avant = precedentes.current
    precedentes.current = deps
    if (avant === null) return
    /*
     * Les deps sont RECOMPAREES a la main alors que React les compare deja : le
     * mode strict demonte et remonte chaque composant en developpement, ce qui
     * rejoue l'effet avec les memes deps. Un simple drapeau « premier passage »
     * y laisserait donc passer tous les watchers d'un coup, a l'instant 0.
     */
    if (avant.length === deps.length && avant.every((v, i) => v === deps[i])) return
    effet()
    // biome-ignore lint/correctness/useExhaustiveDependencies: les deps sont celles du watcher
  }, deps)
}

/**
 * Rattrapage court, la ou le suivi du pointeur prend celui du moteur : le script
 * EST l'animation, et laisser le moteur en lisser une seconde par-dessus
 * retarderait son depart d'un quart de seconde — un script qui commence par
 * regarder au loin verrait ses yeux partir de la pose, y revenir, puis repartir.
 *
 * Non nul quand meme : a zero, `lookAtTime` divise zero par zero a l'image ou la
 * cible est posee, et un `NaN` s'installe dans le moteur pour de bon.
 */
const SCRIPT_MORPH = 1 / 60

export function BloubBot({
  size = 320,
  shape = DEFAULT_SHAPE,
  color = DEFAULT_COLOR,
  expression = DEFAULT_EXPRESSION,
  paper = '#f9f9f9',
  frozenAt,
  cycle = CYCLE_PAR_DEFAUT,
  follow = false,
  gaze = null,
  ariaLabel = 'Avatar bloub anime',
  state,
  block,
  playing = false,
  onStateChange,
  onBlockChange,
  onElapsedChange,
  ref
}: BloubBotProps) {
  // Le repere vient de `src/bot/` : c'est lui qui definit ce que le moteur rend, le
  // composant n'en est qu'un client. Les noms courts restent, ils sont partout dans le
  // gabarit.
  const R = RAYON
  const VB = DEMI_VIEWBOX

  const shapeRadii = SHAPE_BY_ID.get(shape)?.radii ?? null
  const ink = COLOR_BY_ID.get(color)?.hex ?? '#0a0a0c'
  const expressionDef = EXPRESSION_BY_ID.get(expression) ?? null

  const svg = useRef<SVGSVGElement | null>(null)

  const moteur = useRef<BotEngine | null>(null)
  moteur.current ??= new BotEngine(R, state ?? 'idle', shapeRadii, expressionDef)
  const engine = moteur.current

  /*
   * Une image de moteur est un objet NEUF a chaque appel de `sample` : poser la
   * derniere dans un `useState` suffit donc a redessiner, sans compteur de
   * version a cote.
   */
  const [frame, setFrame] = useState<BotFrame>(() => engine.sample(frozenAt ?? 0))

  /*
   * Les identifiants du `<mask>` et des degrades doivent etre uniques par
   * instance — plusieurs bots cohabitent sur une planche — et STABLES entre le
   * serveur et le client : un `Math.random()` de rendu donnerait deux valeurs
   * differentes et casserait l'hydratation. Les caracteres decoratifs que React
   * ajoute autour ne passent pas dans un `url(#...)`, d'ou le filtrage.
   */
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const maskId = `bot-mask-${uid}`

  /**
   * Tout ce que la boucle ecrit. Dans une reference et non dans un etat : ces
   * valeurs changent a chaque image et ne sont pas rendues, les poser dans un
   * etat declencherait un rendu de plus par image pour rien.
   */
  const l = useRef({
    raf: 0,
    /** date d'horloge a laquelle le bloc courant se termine */
    nextAt: Number.POSITIVE_INFINITY,
    last: 0,
    clock: 0,
    /** date d'horloge a laquelle le bloc courant a commence */
    blockStart: 0,
    dernierBloc: -1,
    block: block ?? 0,
    state: state ?? 'idle',
    elapsed: 0,
    /** derniere position connue du pointeur, en coordonnees client */
    pointer: null as { x: number; y: number } | null,
    /** true = une cible est posee sur le moteur, donc il y a de quoi relacher */
    aiming: false,
    /** date d'horloge a laquelle le demi-tour a commence */
    turnSince: 0,
    /** date d'horloge a laquelle le script de regard a ete pose */
    gazeSince: 0,
    /** true = un script tourne, donc il y a de quoi relacher */
    scripted: false
  }).current

  /**
   * Les props telles que la BOUCLE les voit. Elle est montee une fois pour
   * toutes, donc ses fermetures gardent celles du premier rendu : tout ce qu'elle
   * lit passe par ici. Les watchers ci-dessous, eux, lisent les props
   * directement — ce sont celles de leur propre rendu.
   */
  const p = useRef({ cycle, playing, follow, gaze, onStateChange, onBlockChange, onElapsedChange })
  p.current = { cycle, playing, follow, gaze, onStateChange, onBlockChange, onElapsedChange }

  function poseElapsed(v: number) {
    if (l.elapsed === v) return
    l.elapsed = v
    p.current.onElapsedChange?.(v)
  }

  function poseState(id: StateId) {
    if (l.state === id) return
    l.state = id
    p.current.onStateChange?.(id)
  }

  function poseBlock(i: number) {
    if (l.block === i) return
    l.block = i
    p.current.onBlockChange?.(i)
  }

  /**
   * Pose le bloc `i` : etat, moteur, et date de fin. Appele aussi bien par la
   * boucle que par le watcher, d'ou l'absence d'effet de bord sur le curseur —
   * c'est l'appelant qui decide s'il le deplace.
   */
  function apply(i: number, from = 0) {
    const b = p.current.cycle[i]
    if (!b) {
      l.nextAt = Number.POSITIVE_INFINITY
      return
    }
    l.blockStart = l.clock - from
    poseElapsed(from)
    poseState(b.state)
    engine.setState(b.state, l.clock)
    l.nextAt = p.current.playing ? l.blockStart + b.duration : Number.POSITIVE_INFINITY
  }

  /** Deplace le curseur et recale le moteur dans la foulee. */
  function goToBlock(i: number) {
    poseBlock(i)
    apply(i)
  }

  /*
   * Pas d'offset en attente comme dans la version Vue : le curseur est tenu ici,
   * donc `apply` peut etre appele tout de suite. C'est le watcher de `block` qui
   * porte la garde symetrique — la prop qui revient d'un parent controle vaut
   * deja `l.block`, il n'a donc rien a faire, et ne remet pas le bloc a zero
   * sous la tete de lecture qu'on vient de poser.
   */
  function seek(index: number, offset = 0) {
    poseBlock(index)
    apply(index, offset)
  }

  /**
   * Pourquoi une methode a part, et pas `frozenAt` : `frozenAt` fige le temps DANS
   * l'etat courant, il ne parcourt pas les blocs. Et passer par `seek` ne suffirait
   * pas — `apply` cale le moteur sur l'horloge, qui n'avance que dans la boucle et
   * reste donc a zero en mode fige. Tous les changements d'etat s'enregistreraient
   * a l'instant 0, et les fondus aux jointures de blocs seraient faux.
   *
   * D'ou le `setState` a l'offset ABSOLU du bloc : le moteur date ainsi la
   * transition la ou elle a vraiment lieu dans le cycle, et `sample(t)` retombe sur
   * la meme image que la lecture temps reel aurait produite.
   */
  function rendAt(t: number) {
    const blocs = p.current.cycle
    if (!blocs.length) return
    const { index } = blockAt(blocs, t)
    if (index !== l.dernierBloc) {
      const b = blocs[index]!
      poseState(b.state)
      /*
       * Un RETOUR EN ARRIERE repart sans historique, la ou une avancee normale garde l'etat
       * quitte pour le fondre. Sans cette distinction, rejouer l'image 0 apres une passe
       * complete datait le premier etat a l'instant 0 avec le DERNIER en etat precedent, et
       * rendait donc la pose de celui-la : un export en deux passes s'ouvrait sur une boule
       * sans yeux. Le lecteur est ainsi idempotent, et une passe peut etre rejouee autant de
       * fois qu'on veut.
       */
      if (index < l.dernierBloc) engine.reset(b.state, offsetOf(blocs, index))
      else engine.setState(b.state, offsetOf(blocs, index))
      l.dernierBloc = index
    }
    setFrame(engine.sample(t))
  }

  useImperativeHandle(ref, () => ({ seek, rendAt }), [])

  /* ------------------------------------------------------- regard qui suit */

  function onPointerMove(event: PointerEvent) {
    // Le tactile n'a pas de curseur qui traine : un doigt leve laisserait le
    // regard fige sur le dernier point touche, ce qui se lit comme un bug.
    if (event.pointerType === 'touch') return
    l.pointer = { x: event.clientX, y: event.clientY }
  }

  function onPointerLeave() {
    l.pointer = null
  }

  function release() {
    if (!l.aiming) return
    // meme duree qu'a l'aller : la tete revient pendant que la boule redescend
    engine.setLook(null, l.clock, TURN_TIME)
    l.aiming = false
  }

  function detach() {
    window.removeEventListener('pointermove', onPointerMove)
    document.removeEventListener('pointerleave', onPointerLeave)
  }

  /**
   * Vise le pointeur. Ne fait que la part DOM du travail — mesurer ou est la boule
   * et ou est le curseur — la regle de regard elle-meme etant dans `./gaze`.
   *
   * Le rectangle est relu a chaque image plutot que memorise : l'avatar glisse et
   * grandit pendant une transition de vue, un centre garde en cache ferait viser a
   * cote pendant tout le mouvement. La normalisation se fait sur la demi-fenetre et
   * non sur la taille de l'avatar : le regard doit saturer quand le curseur atteint
   * le bord de l'ecran, quelle que soit la place que la boule occupe.
   */
  function aim() {
    // Le regard ne se pilote que sur les etats a VISAGE DE REPOS. Ailleurs la pose
    // du regard EST l'animation relevee — l'orbite fait deja filer les yeux autour
    // de la sphere — et s'y superposer la brouillerait.
    if (!STATE_BY_ID.get(l.state)?.baseFace) {
      release()
      return
    }
    const box = svg.current?.getBoundingClientRect()
    /*
     * Une boite sans surface : il n'y a rien a viser, et surtout la normalisation
     * ci-dessous deviendrait `0 / 0`, donc `NaN`. Or le moteur GARDE la derniere
     * cible : un seul NaN pose une fois y reste pour toujours, et le bot ne se
     * repose plus jamais. Ca arrive pour de vrai quand le volet du navigateur est
     * masque — `getBoundingClientRect` rend alors des zeros.
     */
    if (!box || box.width === 0 || box.height === 0) return
    // le tour part a l'entree dans la vue, en meme temps que les anneaux
    if (!l.aiming) l.turnSince = l.clock
    const demiLargeur = Math.max(1, window.innerWidth / 2)
    const demiHauteur = Math.max(1, window.innerHeight / 2)
    const pointer = l.pointer
    engine.setLook(
      lookTarget({
        nx: pointer ? clamp((pointer.x - (box.left + box.width / 2)) / demiLargeur, -1, 1) : 0,
        ny: pointer ? clamp((pointer.y - (box.top + box.height / 2)) / demiHauteur, -1, 1) : 0,
        tour: easings.easeOutQuint(clamp((l.clock - l.turnSince) / TURN_TIME)),
        pointer: pointer !== null
      }),
      l.clock
    )
    l.aiming = true
  }

  /**
   * Le script decide de tout, y compris de sa duree : on ne fait que lui donner le
   * temps ecoule. La regle elle-meme est dans `./gaze`, comme celle du suivi.
   */
  function scriptedGaze(run: GazeScript) {
    engine.setLook(run(l.clock - l.gazeSince), l.clock, SCRIPT_MORPH)
  }

  /** Redessine sans la boucle : sert aux vignettes figees quand la forme change. */
  function redrawFrozen() {
    if (frozenAt === undefined) return
    setFrame(engine.sample(frozenAt))
  }

  function tick(ms: number) {
    l.raf = requestAnimationFrame(tick)
    // Horloge de scene a delta borne : un onglet masque puis reaffiche reprend
    // sans sauter en avant (rAF est suspendu pendant ce temps-la).
    const dt = l.last ? Math.min((ms - l.last) / 1000, 0.064) : 0
    l.last = ms
    l.clock += dt

    if (p.current.playing) {
      if (l.clock >= l.nextAt && p.current.cycle.length) {
        goToBlock((l.block + 1) % p.current.cycle.length)
      } else {
        poseElapsed(l.clock - l.blockStart)
      }
    }

    // Le suivi prime : les deux ecrivent la meme cible, et l'arrivee est terminee
    // bien avant qu'une vue a suivi ne s'ouvre.
    if (p.current.follow) aim()
    else if (p.current.gaze) scriptedGaze(p.current.gaze)

    setFrame(engine.sample(l.clock))
  }

  /*
   * La boucle est montee une seule fois, pour toute la vie de l'instance : elle
   * lit les props par `p`. Le passage fige <-> anime, lui, la (re)demarre — une
   * vignette figee n'a pas de boucle du tout.
   */
  const anime = frozenAt === undefined
  useEffect(() => {
    if (!anime) return
    // le curseur peut arriver deja pose
    apply(l.block, l.elapsed)
    l.raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(l.raf)
      l.last = 0
    }
    // biome-ignore lint/correctness/useExhaustiveDependencies: la boucle lit les props par `p`
  }, [anime])

  /**
   * L'ecoute du pointeur ne vit que le temps du suivi. Le garde sur `frozenAt`
   * parce qu'une vignette figee n'a pas de boucle pour consommer la cible, donc
   * rien a ecouter.
   */
  const ecoute = follow && anime
  useEffect(() => {
    if (!ecoute) return
    window.addEventListener('pointermove', onPointerMove)
    document.addEventListener('pointerleave', onPointerLeave)
    return () => {
      detach()
      release()
    }
    // biome-ignore lint/correctness/useExhaustiveDependencies: les fonctions ne lisent que `l`
  }, [ecoute])

  /**
   * Depart et relachement du script. Sans `useWatch` : la page peut s'ouvrir DEJA
   * en arrivee — c'est meme son seul usage. Le relachement parce qu'un script
   * coupe avant sa fin (bloc raccourci, changement de vue) laisserait sinon les
   * yeux figes la ou il s'est arrete : le moteur GARDE la derniere cible.
   */
  useEffect(() => {
    if (gaze) {
      l.gazeSince = l.clock
      l.scripted = true
      /*
       * Valeur de depart posee DATEE D'UN RATTRAPAGE PLUS TOT, pour qu'elle soit
       * deja pleinement appliquee a la premiere image.
       *
       * Sans ca, le moteur rend la premiere image avec le regard neutre et la
       * seconde avec celui du script : les yeux sautent d'un coup entre les deux.
       * Discret pour un script qui commence au repos, spectaculaire pour un qui
       * commence en regardant au loin — 127 px d'un coup sur une boule de 100 de
       * rayon, ce qui est exactement le defaut que ces scripts corrigent.
       */
      engine.setLook(gaze(0), l.clock - SCRIPT_MORPH, SCRIPT_MORPH)
      return
    }
    if (!l.scripted) return
    engine.setLook(null, l.clock)
    l.scripted = false
    // biome-ignore lint/correctness/useExhaustiveDependencies: watcher sur `gaze`
  }, [gaze])

  /*
   * Curseur deplace de l'exterieur. Quand c'est nous qui l'avons bouge, la prop
   * revient egale a `l.block` et il n'y a rien a faire : `apply` est deja passe,
   * a la bonne date.
   */
  useWatch(() => {
    if (block === undefined || block === l.block) return
    l.block = block
    apply(block)
  }, [block])

  /*
   * Changement d'etat venu d'une prop : c'est le cas des vignettes figees, qui
   * n'ont pas de curseur. En lecture, `apply` a deja fait le travail.
   *
   * Le garde n'est pas une optimisation, il corrompait une image a CHAQUE jointure
   * de bloc a l'export : `rendAt` pose l'etat sur le moteur a son offset ABSOLU
   * puis echantillonne a la bonne date, mais le watcher repassait ensuite un
   * `redrawFrozen()` non inerte (un lecteur hors ecran est monte avec
   * `frozenAt: 0`). Or `sample(0)` juste apres un changement date a l'offset donne
   * un ratio de melange nul, donc la pose de l'etat PRECEDENT : le point
   * d'exclamation revenait au depart de sa course pendant une image, treize fois
   * dans le montage par defaut.
   */
  useWatch(() => {
    if (state === undefined) return
    l.state = state
    if (engine.state === state) return
    engine.setState(state, l.clock)
    redrawFrozen()
  }, [state])

  // Reprise la ou la tete de lecture s'est arretee, pas au debut du bloc.
  useWatch(() => {
    if (playing) apply(l.block, l.elapsed)
    else l.nextAt = Number.POSITIVE_INFINITY
  }, [playing])

  // Le montage a change sous nos pieds : bloc supprime, duree tiree, autre cycle
  // choisi. On garde le curseur dans les bornes et on recale la date de fin sur
  // la nouvelle duree — si le bloc a ete raccourci sous la position courante, la
  // boucle passe au suivant des la frame suivante, ce qui est le comportement
  // voulu.
  useWatch(() => {
    if (!cycle.length) {
      l.nextAt = Number.POSITIVE_INFINITY
      return
    }
    const i = Math.min(l.block, cycle.length - 1)
    if (i !== l.block) {
      goToBlock(i)
      return
    }
    l.nextAt = playing ? l.blockStart + cycle[i]!.duration : Number.POSITIVE_INFINITY
  }, [cycle])

  useWatch(() => {
    // on passe l'horloge : le moteur morphe vers la nouvelle forme au lieu de
    // l'appliquer d'un coup
    engine.setShape(shapeRadii, l.clock)
    redrawFrozen()
  }, [shapeRadii])

  useWatch(() => {
    engine.setExpression(expressionDef, l.clock)
    redrawFrozen()
  }, [expressionDef])

  /*
   * Deplacer `frozenAt` redessine. La prop ne servait qu'a poser une vignette une
   * fois pour toutes, donc personne ne la bougeait ; un export anime, lui, avance
   * image par image sur une instance hors ecran. Sans ce watcher elle reste sur sa
   * premiere image et l'animation exportee ne bouge pas.
   */
  useWatch(redrawFrozen, [frozenAt])

  /**
   * Un point est un simple disque, sauf quand l'etat fournit une forme (la
   * goutte du "!" penche) : le path est alors en unites de rayon de boule et
   * centre sur l'origine, donc on le pose avec translate/rotate/scale.
   *
   * La couleur suit celle du corps par defaut ; `depth` sert aux particules, qui
   * se fondent dans le fond a mesure qu'elles s'eloignent.
   */
  function renderDot(dot: BotFrame['dots'][number], key: string) {
    const fill = dot.color ?? (dot.depth === undefined ? ink : mixHex(paper, ink, dot.depth))
    return dot.d ? (
      <path
        key={key}
        d={dot.d}
        fill={fill}
        opacity={dot.opacity}
        transform={`translate(${dot.x} ${dot.y}) rotate(${dot.rot ?? 0}) scale(${R})`}
      />
    ) : (
      <circle key={key} cx={dot.x} cy={dot.y} r={dot.r} fill={fill} opacity={dot.opacity} />
    )
  }

  return (
    <svg
      ref={svg}
      width={size}
      height={size}
      viewBox={`${-VB} ${-VB} ${VB * 2} ${VB * 2}`}
      role="img"
      aria-label={ariaLabel}
    >
      <defs>
        {/*
          Les yeux sont de vrais trous perces dans le corps (comme sur x.ai), pas
          des formes blanches posees dessus : ils restent donc automatiquement
          rognes par la silhouette quand ils glissent vers le bord.
        */}
        <mask id={maskId} maskUnits="userSpaceOnUse" x={-VB} y={-VB} width={VB * 2} height={VB * 2}>
          <path d={frame.bodyPath} fill="#fff" />
          {frame.eyes.map((eye, i) => (
            <path key={i} d={eye.d} transform={eye.matrix} opacity={eye.alpha} fill="#000" />
          ))}
          {frame.notch && (
            <circle cx={frame.notch.x} cy={frame.notch.y} r={frame.notch.r} fill="#000" />
          )}
        </mask>

        {frame.arcs.map((arc) => (
          <linearGradient
            key={arc.id}
            id={`${uid}-${arc.id}`}
            gradientUnits="userSpaceOnUse"
            x1={arc.grad.x1}
            y1={arc.grad.y1}
            x2={arc.grad.x2}
            y2={arc.grad.y2}
          >
            {arc.grad.stops.map((c, i) => (
              <stop key={i} offset={i / (arc.grad.stops.length - 1)} stopColor={c} />
            ))}
          </linearGradient>
        ))}
      </defs>

      {/* moitie arriere des orbites : dessinee avant le corps, donc occultee */}
      <g fill="none" strokeLinecap="round">
        {frame.arcs.map((arc) => (
          <path
            key={arc.id}
            d={arc.back}
            stroke={`url(#${uid}-${arc.id})`}
            strokeWidth={arc.width}
            opacity={arc.opacity}
          />
        ))}
      </g>

      {/* particules de l'eclatement : elles passent derriere le noyau */}
      {frame.dotsBehind && <g>{frame.dots.map((dot, i) => renderDot(dot, `pb${i}`))}</g>}

      <g opacity={frame.bodyAlpha}>
        {/*
          Fond opaque a la forme exacte du corps, sous le corps lui-meme.

          Les yeux sont des TROUS perces dans le corps, pas des formes blanches
          posees dessus : c'est ce qui les fait rogner tout seuls au bord de la
          silhouette, et ca ne change pas. Mais un trou laisse voir ce qui est
          dessine derriere — or la moitie arriere des anneaux et les particules de
          l'eclatement le sont justement, pour etre occultees par le corps. Sans ce
          fond, un anneau qui passe derriere la boule reapparait DANS les yeux.

          Rempli avec `paper` et non en blanc pur : c'est exactement ce que les yeux
          laissaient voir jusqu'ici, le fond de la page. Les mettre en blanc les
          rendrait plus clairs que le fond, ce qui se verrait sur une grande boule.
        */}
        <path d={frame.bodyPath} fill={paper} />
        <g mask={`url(#${maskId})`}>
          <rect x={-VB} y={-VB} width={VB * 2} height={VB * 2} fill={ink} />
        </g>
      </g>

      {!frame.dotsBehind && <g>{frame.dots.map((dot, i) => renderDot(dot, `pf${i}`))}</g>}

      {frame.notif && (
        <circle cx={frame.notif.x} cy={frame.notif.y} r={frame.notif.r} fill={NOTIF_BLUE} />
      )}

      {/* moitie avant des orbites */}
      <g fill="none" strokeLinecap="round">
        {frame.arcs.map((arc) => (
          <path
            key={arc.id}
            d={arc.front}
            stroke={`url(#${uid}-${arc.id})`}
            strokeWidth={arc.width}
            opacity={arc.opacity}
          />
        ))}
      </g>
    </svg>
  )
}
