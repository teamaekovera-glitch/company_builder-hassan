import { sdk } from 'obvious'

const ROOT = 'todo_eYEYkvG7'

const BRIEF = (list) => `ROLE: You are a staff writer for the Aurelith Encyclopedia, a reference work on an invented world. You are writing ${list.length} finished encyclopedia entries.

READ FIRST (canon, in priority order — names, dates, and spellings are LAW, never contradict):
- /home/user/work/aurelith/bible.md   (canon bible: cosmology, nations, figures, faiths, systems, style rules)
- /home/user/work/aurelith/timeline.md (master timeline)
- /home/user/work/aurelith/glossary.md (master glossary)
You may also read the other entries in /home/user/work/aurelith/entries/ for cross-reference if present.

YOUR ENTRIES:
${list.map(s => `- ${s.file} — ${s.title} (${s.angle})`).join('\n')}

FILE NAMES (exact): ${list.map(s => s.file).join(', ')} in /home/user/work/aurelith/entries/

HARD REQUIREMENTS — EVERY ENTRY:
1. Body length: at least 2,300 words by "wc -w", EXCLUDING the New Canon / New Timeline blocks at the end. Verify with wc -w before reporting; if short, keep writing. A 2,300-word floor is the minimum, not the target — richness is welcome.
2. Section template, in this exact order:
   # <Entry title>
   <One-line epigraph: an invented in-world quotation, attributed to a named source with a year in "X AR" form>
   ## Overview
   ## History
   ## Government and Society
   ## Culture
   ## Foreign Relations
   ## The Present Height (Year 1147)
   ## In-World Sources
   ## New Canon
   ## New Timeline
3. Overview states plainly what the subject is and why it matters in 1147 AR. History is chronological and cites dates "X AR". Government and Society covers power, law, daily life. Culture covers language(s), faith, arts, food, dress. Foreign Relations covers neighbors and rivals. The Present Height describes the subject's situation in the current year (see bible section 9 for world state). In-World Sources lists 2-4 invented sources (author, title, year AR) an in-world scholar might cite — with a one-line note on each source's bias.
4. CANON DISCIPLINE: every date, name, and spelling must match bible.md and timeline.md exactly. You are free to INVENT local detail (towns, families, customs, minor events, festivals, dishes) — that is the job — but:
   (a) log every new proper noun you invent under "## New Canon" as "**Term** — one-line definition";
   (b) log every new dated event under "## New Timeline" as "| YEAR | event |" table rows;
   (c) never invent anything that contradicts the bible, the timeline, or another assigned entry. When in doubt, extend sideways (new places, new people), never backward (re-dating established events).
5. PROSE QUALITY (writing skill, applied): confident encyclopedic voice; specifics over generalities — real-sounding names, quantities, and quoted in-world sources instead of vague color; varied sentence rhythm; no LLM-ese (no "Furthermore/Moreover/Additionally" paragraph openers, no hedging stacks, no filler); attribute contested facts to in-world historians ("Table apologists insist..., Maravandi jurists counter...") rather than hedging; no real-world places, faiths, or idioms; no bullets inside the entry prose — prose paragraphs, with tables only for genuine reference data.
6. Do NOT append the master timeline or glossary yourself — the integrator adds appendices at publish time.
7. Do NOT publish artifacts — the integrator publishes. Write files only, then verify.

CROSS-ENTRY RULE: The nations in your batch share one world and one timeline. Read each other's drafts as they appear if helpful; at minimum, ensure any event you mention that touches another assigned nation is consistent with the bible's account of it.

WHEN DONE: run "wc -w" on each file, report the counts plus any canon conflicts you noticed and any bible gaps you had to paper over. Report file paths in your completion message.`

const batches = [
  {
    title: 'Wave 1 — Writer A: Caldrith, Zharkun Khanate, Nine Banners of Tsek (3 entries)',
    complexity: 'high',
    entries: [
      { file: '01-caldrith.md', title: 'Caldrith', angle: 'maritime kingdom of the western capes; constitutional crown bound by the Merchant Tables (203), Table Rights (1012); capital Solvenna; salt-fish, shipwrights, charters; funds the Shard Rush expeditions; hosts post-famine Ashling migrants' },
      { file: '02-zharkun-khanate.md', title: 'The Zharkun Khanate', angle: 'steppe empire founded 88 AR by Khagan Burei (Battle of the Red Tent); settled at Ulzai in the 340s; the Kurultai; horse law, felt cities; memory culture; stance on the Shard Rush and the aerostat corridors' },
      { file: '03-nine-banners-of-tsek.md', title: 'The Nine Banners of Tsek', angle: 'examination empire of the eastern river plains; Yandu founded 151 by Diao Zhen; examinations 402, reformed by Empress Diao Wen (512-560); three registers of Tseki; granary state; the 1147 succession crisis of the childless Emperor Diao Kezhi' },
    ],
  },
  {
    title: 'Wave 1 — Writer B: Vessany, Maravand, Drathmark (3 entries)',
    complexity: 'high',
    entries: [
      { file: '04-vessany.md', title: 'Vessany', angle: 'boreal principalities of the Pinemarrow; Zimovets; Stewards\' Council (601); Iron Regency (1011-1061) under Yelena Vasko (regent 1023-1061); timber and iron; claims oversight of the Shard Rush veins in its north; hosts Ashling migrants' },
      { file: '05-maravand.md', title: 'Maravand', angle: 'desert guild-cities of the Qassis basin; Qasr-Ilim and Surafta; qanats; the Water Code of Mira of the Nine Wells (adopted 771); water-share standard (919); guest-law; position on the Rate War' },
      { file: '06-drathmark.md', title: 'Drathmark', angle: 'volcanic archipelago thalassocracy; Skarnholt; Kingsmoot; stormglass navigation; the Stormsaints; Ragnvald Ashsmouth and the Maw of Grief (796); sea-roads in the Rate War' },
    ],
  },
  {
    title: 'Wave 1 — Writer C: Liorne, Ashling Territories (2 entries)',
    complexity: 'standard',
    entries: [
      { file: '07-liorne.md', title: 'Liorne', angle: 'canal republic; the city is the state; Council of Ten; movable type from 438; joint-stock banks from the 840s; grain futures 874; glass, opera, compound interest; home of Captain Peregrine Vale and heart of the Aerostat Cartel' },
      { file: '08-ashling-territories.md', title: 'The Ashling Territories', angle: 'highland clan confederation, no capital, assembly at Caer Luth; weighers of words; the Quiet Assay; the Oath-ledger economy; the famine of 1128-1131 and the scattering; migration into Vessany and Caldrith' },
    ],
  },
  {
    title: 'Wave 1 — Writer D: Sanavere, Kettle Freeholds (2 entries)',
    complexity: 'standard',
    entries: [
      { file: '09-sanavere.md', title: 'Sanavere', angle: 'temple-state of the River Senn delta; Sovanel; the Tide-That-Remembers; bellfoundries and the BellFoundry method; Ilba the Younger (581-633); the Bell Tithe that began the Long Quarrel; the great peace bells of 831' },
      { file: '10-kettle-freeholds.md', title: 'The Kettle Freeholds', angle: 'miner commons under the Kettledeep Ridges; Hearth Delve; first syndical charter 1044; the hearth-vote; first arc battery 1121; trimmers and the memory-tithe; Old Ottokar (b. 1081) and the trimmer-rights movement; the Iron Sermon; the Rate War' },
    ],
  },
]

// Clean up the duplicate node created during shape discovery.
await sdk.tasks.update({ taskId: 'todo_3QXwpa58', status: 'cancelled', completionNote: 'Duplicate of the auto-seeded root created during task-shape discovery; the real root is todo_eYEYkvG7.' })

const bible = await sdk.tasks.create({
  parentId: ROOT,
  title: 'Series bible: canon, master timeline, glossary seed',
  assignee: 'self',
  description: 'Author the locked canon: cosmology, calendar, 12 nations, 10 eras, 10 figures, 8 faiths, 8 tech/magic systems, 6 languages, 6 economies, seed timeline and glossary, style rules. Files: /home/user/work/aurelith/{bible,timeline,glossary}.md; published as artifacts.',
})
await sdk.tasks.update({ taskId: bible.id, status: 'completed', completionNote: 'Canon locked. bible.md (cosmology, 12 nations, 10 eras, 10 figures, 8 faiths, 8 systems, 6 languages, 6 economies, style rules), timeline.md (~50 events, Year 0-1147 AR), glossary.md (~70 terms) written to /home/user/work/aurelith/ and published as artifacts.' })

// Wave tracking nodes (orchestrator-owned).
const waveSpecs = [
  { wave: 1, entries: '01-10', label: 'nations 1-10 (Caldrith through Kettle Freeholds)' },
  { wave: 2, entries: '11-20', label: 'nations 11-12 (Sarhadd, Umbral Concord) + eras I-VIII' },
  { wave: 3, entries: '21-30', label: 'eras IX-X + figures 1-8' },
  { wave: 4, entries: '31-40', label: 'figures 9-10 + religions/philosophies 1-8' },
  { wave: 5, entries: '41-50', label: 'technologies/magic 1-8 + languages 1-2' },
  { wave: 6, entries: '51-60', label: 'languages 3-6 + economic systems 1-6' },
]
for (const w of waveSpecs) {
  await sdk.tasks.create({
    parentId: ROOT,
    title: `Wave ${w.wave} — entries ${w.entries} (${w.label})`,
    assignee: 'self',
    description: `Write entries ${w.entries}: each >=2,300 words body, bible-compliant; harvest New Canon/New Timeline into master files; append current timeline+glossary in full to each entry; publish each as a document artifact.`,
  })
  await sdk.tasks.create({
    parentId: ROOT,
    title: `Audit ${w.wave} — 5,000-word consistency audit of entries ${w.entries}`,
    assignee: 'self',
    description: `After entries ${w.entries} are published: re-quote every contradicting passage IN FULL, adjudicate each, provide full replacement text for affected passages, rewrite affected entries, republish. Publish the audit as a document artifact.`,
  })
}

await sdk.tasks.create({
  parentId: ROOT,
  title: 'Final review — read-through of all 60 entries and 6 audits',
  assignee: 'usr_kJKqgUTx',
  description: 'Acceptance criteria from the request: 60 entries (12 nations, 10 eras, 10 figures, 8 religions, 8 tech/magic, 6 languages with grammar+vocabulary tables, 6 economic systems), each 2,000+ words; master timeline and glossary reproduced in full at the end of every entry; six 5,000-word audits re-quoting contradictions in full with affected entries rewritten. Deliverables: published artifacts per entry plus the master timeline and glossary artifacts.',
})

const started = []
for (const b of batches) {
  const t = await sdk.tasks.create({
    parentId: ROOT,
    title: b.title,
    assignee: 'agent',
    description: `Write ${b.entries.length} encyclopedia entries per the writers-room brief and the locked canon. Entries: ${b.entries.map(e => e.file).join(', ')} in /home/user/work/aurelith/entries/.`,
  })
  await sdk.tasks.start({
    taskId: t.id,
    title: b.title,
    prompt: BRIEF(b.entries),
    complexity: b.complexity,
  })
  started.push(t.id)
}

console.log(JSON.stringify({ root: ROOT, bible: bible.id, started }, null, 2))
