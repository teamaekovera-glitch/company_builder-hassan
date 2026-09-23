import { sdk } from 'obvious'

const BRIEF = (list, slugs) => `ROLE: You are a staff writer for the Aurelith Encyclopedia, a reference work on an invented world. You are writing ${list.length} finished encyclopedia entries.

READ FIRST (canon, in priority order — names, dates, and spellings are LAW, never contradict):
- /home/user/work/aurelith/bible.md   (canon bible: cosmology, nations, figures, faiths, systems, style rules)
- /home/user/work/aurelith/timeline.md (master timeline)
- /home/user/work/aurelith/glossary.md (master glossary)
You may also read the other entries in /home/user/work/aurelith/entries/ for cross-reference if present.

YOUR ENTRIES:
${slugs.map(s => `- ${s.file} — ${s.title} (${s.angle})`).join('\n')}

FILE NAMES (exact): ${slugs.map(s => s.file).join(', ')} in /home/user/work/aurelith/entries/

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
    title: 'Aurelith W1-A: Caldrith, Zharkun, Tsek (3 entries)',
    slugList: '01-caldrith, 02-zharkun-khanate, 03-nine-banners-of-tsek',
    complexity: 'high',
    entries: [
      { file: '01-caldrith.md', title: 'Caldrith', angle: 'maritime kingdom of the western capes; constitutional crown bound by the Merchant Tables (203), Table Rights (1012); capital Solvenna; salt-fish, shipwrights, charters; funds the Shard Rush expeditions; hosts post-famine Ashling migrants' },
      { file: '02-zharkun-khanate.md', title: 'The Zharkun Khanate', angle: 'steppe empire founded 88 AR by Khagan Burei (Battle of the Red Tent); settled at Ulzai in the 340s; the Kurultai; horse law, felt cities; memory culture; stance on the Shard Rush and the aerostat corridors' },
      { file: '03-nine-banners-of-tsek.md', title: 'The Nine Banners of Tsek', angle: 'examination empire of the eastern river plains; Yandu founded 151 by Diao Zhen; examinations 402, reformed by Empress Diao Wen (512-560); three registers of Tseki; granary state; the 1147 succession crisis of the childless Emperor Diao Kezhi' },
    ],
  },
  {
    title: 'Aurelith W1-B: Vessany, Maravand, Drathmark (3 entries)',
    slugList: '04-vessany, 05-maravand, 06-drathmark',
    complexity: 'high',
    entries: [
      { file: '04-vessany.md', title: 'Vessany', angle: 'boreal principalities of the Pinemarrow; Zimovets; Stewards\' Council (601); Iron Regency (1011-1061) under Yelena Vasko (regent 1023-1061); timber and iron; claims oversight of the Shard Rush veins in its north; hosts Ashling migrants' },
      { file: '05-maravand.md', title: 'Maravand', angle: 'desert guild-cities of the Qassis basin; Qasr-Ilim and Surafta; qanats; the Water Code of Mira of the Nine Wells (adopted 771); water-share standard (919); guest-law; position on the Rate War' },
      { file: '06-drathmark.md', title: 'Drathmark', angle: 'volcanic archipelago thalassocracy; Skarnholt; Kingsmoot; stormglass navigation; the Stormsaints; Ragnvald Ashsmouth and the Maw of Grief (796); sea-roads in the Rate War' },
    ],
  },
  {
    title: 'Aurelith W1-C: Liorne, Ashling Territories (2 entries)',
    slugList: '07-liorne, 08-ashling-territories',
    complexity: 'standard',
    entries: [
      { file: '07-liorne.md', title: 'Liorne', angle: 'canal republic; the city is the state; Council of Ten; movable type from 438; joint-stock banks from the 840s; grain futures 874; glass, opera, compound interest; home of Captain Peregrine Vale and heart of the Aerostat Cartel' },
      { file: '08-ashling-territories.md', title: 'The Ashling Territories', angle: 'highland clan confederation, no capital, assembly at Caer Luth; weighers of words; the Quiet Assay; the Oath-ledger economy; the famine of 1128-1131 and the scattering; migration into Vessany and Caldrith' },
    ],
  },
  {
    title: 'Aurelith W1-D: Sanavere, Kettle Freeholds (2 entries)',
    slugList: '09-sanavere, 10-kettle-freeholds',
    complexity: 'standard',
    entries: [
      { file: '09-sanavere.md', title: 'Sanavere', angle: 'temple-state of the River Senn delta; Sovanel; the Tide-That-Remembers; bellfoundries and the BellFoundry method; Ilba the Younger (581-633); the Bell Tithe that began the Long Quarrel; the great peace bells of 831' },
      { file: '10-kettle-freeholds.md', title: 'The Kettle Freeholds', angle: 'miner commons under the Kettledeep Ridges; Hearth Delve; first syndical charter 1044; the hearth-vote; first arc battery 1121; trimmers and the memory-tithe; Old Ottokar (b. 1081) and the trimmer-rights movement; the Iron Sermon; the Rate War' },
    ],
  },
]

const root = await sdk.tasks.create({
  parentId: 'self',
  title: 'Aurelith — 60-entry encyclopedia worldbook with running canon and 6 audits',
  description: 'Build the complete fictional world of Aurelith: 60 encyclopedia entries of 2,000+ words each (12 nations, 10 eras, 10 figures, 8 religions/philosophies, 8 technologies/magic systems, 6 languages with grammar and vocabulary tables, 6 economic systems). A running master timeline and glossary are maintained and reproduced in full at the end of every entry. Every ten entries receives a 5,000-word consistency audit that re-quotes every contradicting passage in full and rewrites affected entries. Canon is locked in the Series Bible; work runs in six waves of ten entries with audits between.',
})

const bible = await sdk.tasks.create({
  title: 'Series bible: canon, master timeline, glossary seed',
  parentId: root.id,
  assignee: 'self',
  description: 'Author the locked canon: cosmology, calendar, 12 nations, 10 eras, 10 figures, 8 faiths, 8 tech/magic systems, 6 languages, 6 economies, seed timeline and glossary, style rules. Files: /home/user/work/aurelith/{bible,timeline,glossary}.md; published as artifacts.',
})
await sdk.tasks.update({ taskId: bible.id, status: 'completed', completionNote: 'Canon locked. bible.md (cosmology, 12 nations, 10 eras, 10 figures, 8 faiths, 8 systems, 6 languages, 6 economies, style rules), timeline.md (~50 events, Year 0-1147 AR), glossary.md (~70 terms) written to /home/user/work/aurelith/ and published as artifacts.' })

const waveSpecs = [
  { wave: 1, entries: '01-10', label: 'nations 1-10 (Caldrith through Kettle Freeholds)' },
  { wave: 2, entries: '11-20', label: 'nations 11-12 (Sarhadd, Umbral Concord) + eras I-VIII' },
  { wave: 3, entries: '21-30', label: 'eras IX-X + figures 1-8' },
  { wave: 4, entries: '31-40', label: 'figures 9-10 + religions/philosophies 1-8' },
  { wave: 5, entries: '41-50', label: 'technologies/magic 1-8 + languages 1-2' },
  { wave: 6, entries: '51-60', label: 'languages 3-6 + economic systems 1-6' },
]
const waveIds = {}
for (const w of waveSpecs) {
  const t = await sdk.tasks.create({
    title: `Wave ${w.wave}: entries ${w.entries} (${w.label})`,
    parentId: root.id,
    assignee: 'self',
    description: `Write entries ${w.entries}: each >=2,300 words body, bible-compliant, then harvest New Canon/New Timeline into master files, append current timeline+glossary in full to each entry, publish each as a document artifact.`,
  })
  waveIds[w.wave] = t.id
}
const auditIds = {}
for (let i = 1; i <= 6; i++) {
  const t = await sdk.tasks.create({
    title: `Consistency audit ${i} (after entry ${i * 10})`,
    parentId: root.id,
    assignee: 'self',
    description: `5,000-word audit of entries ${(((i - 1) * 10) + 1).toString().padStart(2, '0')}-${i * 10}: re-quote every contradicting passage IN FULL, adjudicate each, provide full replacement text for affected passages, list affected entries for rewrite. Then apply rewrites and republish.`,
  })
  auditIds[i] = t.id
}
await sdk.tasks.create({
  title: 'Final review: read-through of all 60 entries and 6 audits',
  parentId: root.id,
  assignee: 'usr_kJKqgUTx',
  description: 'Acceptance criteria from the request: 60 entries (12 nations, 10 eras, 10 figures, 8 religions, 8 tech/magic, 6 languages with grammar+vocabulary tables, 6 economic systems), each 2,000+ words; master timeline and glossary reproduced in full at the end of every entry; six 5,000-word audits re-quoting contradictions in full with affected entries rewritten. Deliverables: published artifacts per entry plus the master timeline and glossary artifacts.',
})

let started = []
for (const b of batches) {
  const t = await sdk.tasks.create({
    title: b.title,
    parentId: waveIds[1],
    assignee: 'agent',
    description: `Write ${b.entries.length} encyclopedia entries per the writers-room brief and the locked canon. Files: ${b.entries.map(e => e.file).join(', ')} in /home/user/work/aurelith/entries/. Entries: ${b.slugList}.`,
  })
  await sdk.tasks.start({
    taskId: t.id,
    title: b.title,
    prompt: BRIEF(b.entries, b.entries),
    complexity: b.complexity,
  })
  started.push(t.id)
}

console.log(JSON.stringify({ root: root.id, waveIds, auditIds, started }, null, 2))
