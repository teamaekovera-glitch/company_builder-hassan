# Company dossier

Run: `run-golden`
Idea: A solar-powered cold chain for rural pharmacies
Config: depth standard · languages en, es · score gate 9.5 · strategy angle none

## Contents

- Market Analysis (`market-analysis`) — English, Spanish
- Competitor Analysis (`competitor-analysis`) — English
- Brand Identity (`brand-identity`) — English
- Pricing Strategy (`pricing-strategy`)
- Cross-Stage Consistency Audit (`consistency-audit`)
- Auto Re-run (`auto-rerun`)
- Localisation (`localisation`) — German, Hindi

Cross-references: every prompt and response verbatim in the run log (`run-log.md`).

---

## Market Analysis (`market-analysis`)

### English

```
Verdict: the cold chain wins on unit economics — pharmacy margins absorb the capex.
```

### Spanish (`es`)

```
Veredicto: la cadena de frío gana en economía unitaria.
```

---

## Competitor Analysis (`competitor-analysis`)

### English

````
```mermaid
flowchart LR
  A[incumbents] --> B[us]
```
````

---

## Brand Identity (`brand-identity`)

### English

```
Palette: solar amber on clinical white; wordmark set in a grotesque.
```

---

## Pricing Strategy (`pricing-strategy`)

> MISSING: the winning improved draft for this stage was not found in the store (stage status: done).

---

## Cross-Stage Consistency Audit (`consistency-audit`)

### Pair audit 1 of 6 — pricing ↔ financial model (`audit-pair:1`)

```
Pair audit 1 — PRD ↔ GTM timeline.
CONTRADICTION: the PRD promises Q3 launch, the GTM timeline says Q4.
```

### Resolution 1 (`audit-resolution:1`)

```
Resolved: the launch is Q4 — the GTM timeline is authoritative; the PRD's roadmap section was corrected.
```

---

## Auto Re-run (`auto-rerun`)

### Auto re-run — weakest-stage selection (`rerun-selection`)

```
Weakest stages selected for re-run under the strict 9.5 gate:
1. Market Analysis (market-analysis) — reconciled score 9.4
```

### Re-run outcome — Market Analysis (`rerun-outcome:market-analysis`)

```
Re-run outcome for stage 1 — Market Analysis:
Before: 9.4 · After: 9.5 · Rounds: 1 · Gate: 9.5
The re-run cleared the strict gate.
```

### Re-run winner — Market Analysis (`rerun:market-analysis:improved`)

```
Re-run winner text for the market analysis (verbatim copy of the adopted draft).
```

### Recheck — Executive Synthesis — Executive Synthesis (`recheck:executive-synthesis:executive-synthesis`)

```
Recheck of the executive synthesis after the re-run: conclusions unchanged.
```

---

## Localisation (`localisation`)

### German (`de`)

```
Lokalisierte Fassung des Dossiers.
```

### Hindi (`hi`)

```
लोकल की गई फाइल।
```

### Localisation QA — Spanish (`localisation-qa:es`)

```
VERDICT: PASS
The Spanish translations preserve clinical terminology and tone; no truncation found.
```

### Cultural adaptation — Spanish (`cultural-adaptation:es`)

```
Adaptation: rural-pharmacy framing localized for Spanish-speaking markets; units kept metric.
```
