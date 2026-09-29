# Asset governance method

MaintenGraph turns lessons from real CMMS reconciliation work into an explicit,
repeatable release discipline. It does not decide physical truth. It checks that
the people building an asset hierarchy have recorded enough evidence and review
state to defend their decisions.

## Non-negotiable principles

1. **One physical asset, one current CMMS object.** Multiple source rows may
   describe one asset. Consolidate only when physical equivalence is supported,
   and retain former identifiers as migration history.
2. **A repeated tag is a clue, not proof of identity.** Tags, descriptions and
   quantities can repeat across locations, cabinets and assemblies.
3. **No evidence, no silent certainty.** Missing drawings, unknown ownership and
   unresolved matches stay `open` or `provisional`; they are not guessed away.
4. **Preserve source meaning.** Keep tags, serials, models, part numbers, ratings,
   dimensions and unusual source specifications unless stronger evidence
   explicitly corrects them.
5. **Place records with their owner.** Physical components, controls, signals,
   alarms and references belong beneath the evidenced equipment or functional
   owner. Cabinet-mounted devices remain cabinet-owned even when they control
   field equipment.
6. **Represent shared equipment once.** A shared power unit, panel or service is
   not duplicated beneath every consumer. Relationships can be documented
   without inventing physical copies.
7. **Quantity is not identity.** A BOM quantity does not automatically authorize
   the same number of maintainable CMMS objects.
8. **Structure is necessary, not sufficient.** Zero duplicates, orphans and
   cycles proves graph integrity—not source completeness or field truth.
9. **Uncertainty is data.** `confirmed`, `accepted`, `provisional`, `open` and
   `rejected` are explicit workflow states, not prose hidden in meeting notes.
10. **Release is a separate decision.** Review mode exposes uncertainty. Release
    mode blocks it.

## Evidence ladder

Use the strongest available evidence and retain its exact reference:

1. field verification tied to a physical identifier;
2. approved as-built drawing or controlled equipment register;
3. manufacturer drawing, BOM, datasheet or serial record;
4. approved engineering decision with named scope;
5. legacy CMMS record or uncontrolled working sheet;
6. text similarity or inferred placement.

The lower levels are useful for finding candidates. They do not, by themselves,
prove physical equivalence. MaintenGraph deliberately validates references and
states rather than pretending to score the truth of documents it cannot inspect.

## Reconciliation workflow

1. **Freeze the candidate sources.** Record filenames, revisions, hashes or
   controlled-document identifiers before editing the hierarchy.
2. **Inventory every source record.** Separate physical objects, assemblies,
   components, controls, signals, logical groupings, references and spares.
3. **Establish the structural backbone.** Define roots, parent ownership and the
   maximum supported depth before assigning final IDs.
4. **Match physical identities.** Use serials, equipment tags, drawing callouts,
   location and function together. Never merge on description alone.
5. **Record decisions.** Give each row a physical-identity key where applicable,
   evidence references, object class, review state and legacy IDs.
6. **Retain unresolved cases.** Keep them open with their source wording; do not
   fabricate a parent, signal, component or count.
7. **Run review mode.** Correct graph defects and expose weak or unresolved
   governance records without falsely declaring the dataset releasable.
8. **Obtain review or field confirmation.** Change status only when the evidence
   or explicit acceptance supports it.
9. **Run release mode.** Block provisional, open and rejected rows, missing
   evidence, missing physical identities, duplicated identities, ambiguous
   legacy ownership and prohibited catch-all buckets.
10. **Reopen and independently verify the export.** Recount rows, roots, missing
    parents, duplicate paths, ordering, depth and output equivalence after the
    final file is written.

## Governed columns

| Logical field | Purpose |
|---|---|
| `identity` | Stable physical-identity key for assemblies, equipment and components |
| `evidence` | One or more exact source, inspection or decision references |
| `reviewStatus` | `confirmed`, `accepted`, `provisional`, `open`, or `rejected` |
| `objectClass` | `system`, `location`, `assembly`, `equipment`, `component`, `signal`, `control`, `logical`, `reference`, or `spare` |
| `legacyIds` | Former identifiers retained for migration and history, never as active parent authority |

Evidence and legacy-ID lists use `;` by default. Separators are configurable.

## Review and release modes

- `off` runs the original structural and spreadsheet-safety rules.
- `review` reports missing evidence or physical identity as warnings and exposes
  unresolved states as notices. It is designed for active engineering work.
- `release` converts unresolved governance conditions into blockers. It is
  designed for approved imports and controlled handoffs.

MaintenGraph never auto-merges assets, rewrites descriptions, fabricates IDs or
claims field verification. Those decisions require accountable evidence.
