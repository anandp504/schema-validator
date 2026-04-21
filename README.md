# Beckn Schema Validator Experiment

An experiment using [AJV](https://ajv.js.org/) (JSON Schema 2020-12) to explore the difference between `additionalProperties: false` and `unevaluatedProperties: false` when composing schemas via `allOf`.

The schemas are based on the [Beckn](https://becknprotocol.io/) `RetailResource` / `GroceryResource` hierarchy from [beckn/local-retail](https://github.com/beckn/local-retail).

---

## Setup

```bash
npm install
```

## Run tests

```bash
npm test
```

## Validate a file from the command line

```bash
npm run validate -- <schema-id> <data-file>
# or directly:
node src/validator.js <schema-id> <data-file>
```

`<schema-id>` is the filename of any schema in `schemas/`. `<data-file>` is a path to a JSON instance file.

Exits with code `0` on success and `1` on failure, printing each error with its instance path and keyword.

---

## Schema hierarchy

```
RetailResource  ←(allOf)─  GroceryResource  ←(allOf)─  ExtendedGrocery
```

All schemas live in `schemas/` as local JSON files (no remote `$ref` resolution required).

| Schema file | Restriction keyword | Role |
|---|---|---|
| `retail-resource-addl-props.json` | `additionalProperties: false` | Mirrors the beckn spec; the problematic base |
| `retail-resource-open.json` | _(none)_ | Composable base for Scenario 2 & 3 |
| `grocery-resource-addl-props.json` | `additionalProperties: false` | Broken composition (Scenario 1) |
| `grocery-resource-uneval-props.json` | `unevaluatedProperties: false` | Fixed composition (Scenario 2 & 3) |
| `extended-grocery.json` | _(none)_ | Attempts to extend GroceryResource (Scenario 3) |
| `quantity.json` | — | Shared `{ unitQuantity, unitText }` type |

---

## Scenarios

### Scenario 1 — `additionalProperties: false` blocks composition

**Data:** `data/grocery-resource.json`
**Schema:** `schemas/grocery-resource-addl-props.json`
**Result:** FAIL

```bash
npm run validate -- grocery-resource-addl-props.json data/grocery-resource.json
# FAIL  data/grocery-resource.json  →  grocery-resource-addl-props.json
#   [additionalProperties] (root) ("nutrition"): must NOT have additional properties
#   [additionalProperties] (root) ("@context"): must NOT have additional properties
#   ...
```

`additionalProperties` only considers `properties` defined **in the same schema object**. `GroceryResource` has `additionalProperties: false` at its top level but declares all its properties inside `allOf` subschemas, not in a top-level `properties` key. AJV treats every instance field as "additional" and rejects them all — including the base `identity` and `physical` fields inherited from `RetailResource`.

The same failure would occur even if `GroceryResource` added a top-level `properties` key, because `RetailResource`'s own `additionalProperties: false` would then reject the `nutrition` field that is not part of `RetailResource`'s property set.

```
grocery-resource-addl-props.json
  ├── additionalProperties: false   ← no top-level 'properties'; rejects EVERYTHING
  └── allOf
        ├── $ref: retail-resource-addl-props.json
        │     └── additionalProperties: false  ← would also reject 'nutrition'
        └── { properties: { nutrition, freshProduce } }
```

---

### Scenario 2 — `unevaluatedProperties: false` supports composition

**Data (pass):** `data/grocery-resource.json` → validated against `schemas/grocery-resource-uneval-props.json` → **PASS**
**Data (fail):** `data/grocery-resource-unknown-field.json` → same schema → **FAIL**

```bash
npm run validate -- grocery-resource-uneval-props.json data/grocery-resource.json
# PASS  data/grocery-resource.json  →  grocery-resource-uneval-props.json

npm run validate -- grocery-resource-uneval-props.json data/grocery-resource-unknown-field.json
# FAIL  data/grocery-resource-unknown-field.json  →  grocery-resource-uneval-props.json
#   [unevaluatedProperties] (root) ("unknownField"): must NOT have unevaluated properties
```

`unevaluatedProperties: false` (JSON Schema 2020-12) is aware of **all** properties evaluated by any `allOf` entry. Fields coming from `RetailResource` (via `allOf[0]`) and `nutrition`/`freshProduce` (via `allOf[1]`) are all considered "evaluated" and accepted. Only truly unrecognised fields are rejected.

The base schema must be **open** (`retail-resource-open.json`) so that `RetailResource`'s own validation does not reject `nutrition` when processing `allOf[0]`.

```
grocery-resource-uneval-props.json
  ├── unevaluatedProperties: false  ← sees properties from ALL allOf entries
  └── allOf
        ├── $ref: retail-resource-open.json   ← open base; no property restriction
        └── { properties: { nutrition, freshProduce } }
```

---

### Scenario 3 — `unevaluatedProperties: false` in GroceryResource blocks further extension

**Data (fail):** `data/grocery-resource-organic.json` → validated against `schemas/extended-grocery.json` → **FAIL**
**Data (pass):** `data/grocery-resource.json` → same schema → **PASS**

```bash
npm run validate -- extended-grocery.json data/grocery-resource-organic.json
# FAIL  data/grocery-resource-organic.json  →  extended-grocery.json
#   [unevaluatedProperties] (root) ("organic"): must NOT have unevaluated properties

npm run validate -- extended-grocery.json data/grocery-resource.json
# PASS  data/grocery-resource.json  →  extended-grocery.json
```

`ExtendedGrocery` tries to add an `organic` field by composing `GroceryResource` via `allOf`. When AJV validates the instance against `GroceryResource` (as `allOf[0]`), the `organic` field is not evaluated within `GroceryResource`'s own `allOf` scope. `GroceryResource`'s `unevaluatedProperties: false` therefore rejects it, causing the whole validation to fail.

This shows that **both** `additionalProperties: false` and `unevaluatedProperties: false` make a schema non-extensible from the outside. The keywords differ only in what they consider "evaluated" *within a single schema object's scope*; neither can be overridden by an outer composing schema.

```
extended-grocery.json
  └── allOf
        ├── $ref: grocery-resource-uneval-props.json
        │     └── unevaluatedProperties: false  ← rejects 'organic'; not in its allOf scope
        └── { properties: { organic } }          ← too late; inner schema already failed
```

**Take-away:** Schemas designed to be extended should not carry `additionalProperties: false` or `unevaluatedProperties: false`. Only leaf / terminal schemas should use these keywords.

---

## Solutions

Three approaches solve the tension between strict validation and schema extensibility.

### Option 1 — Thin "closed" wrappers _(most practical)_

Keep every schema **open** (no property restriction). For each level add a companion `-closed` variant whose only job is to add `unevaluatedProperties: false` on top.

```
schemas/
  retail-resource.json          ← open — defines properties, meant to be extended
  retail-resource-closed.json   ← strict — unevaluatedProperties: false + allOf [$ref retail-resource.json]

  grocery-resource.json         ← open — allOf [$ref retail-resource.json] + nutrition
  grocery-resource-closed.json  ← strict — unevaluatedProperties: false + allOf [$ref grocery-resource.json]

  extended-grocery.json         ← open — allOf [$ref grocery-resource.json] + organic
  extended-grocery-closed.json  ← strict — unevaluatedProperties: false + allOf [$ref extended-grocery.json]
```

Every closed wrapper is a two-line schema:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "grocery-resource-closed.json",
  "unevaluatedProperties": false,
  "allOf": [{ "$ref": "grocery-resource.json" }]
}
```

- **Composition** always references the **open** variant (`$ref: grocery-resource.json`).
- **Validation** always uses the **closed** variant (`grocery-resource-closed.json`).
- The closed wrapper's `unevaluatedProperties: false` sees the full property set from the entire `allOf` chain, so nothing valid gets rejected.

**Trade-off:** Schema file count doubles. The convention of always validating against the `-closed` variant must be followed consistently.

---

### Option 2 — `unevaluatedProperties: false` only in leaf schemas _(convention-based)_

Schemas **designed to be extended** stay open. Only the **most-derived / terminal** schema (the one not extended further) adds `unevaluatedProperties: false`. Whoever creates a new extension takes responsibility for closing it.

```
retail-resource.json      ← open (designed to be extended — no restriction)
grocery-resource.json     ← open (designed to be extended — no restriction)
extended-grocery.json     ← unevaluatedProperties: false (leaf, not extended further)
```

This is the pattern already used in this project for the RetailResource → GroceryResource step (`retail-resource-open.json` + `grocery-resource-uneval-props.json`). It just needs to be applied consistently at every new level.

**Trade-off:** Intermediate schemas are permissive if validated directly without a leaf wrapper. The convention must be documented and enforced by tooling or code review.

---

### Option 3 — `$dynamicRef` / `$dynamicAnchor` _(JSON Schema 2020-12, most elegant)_

The built-in 2020-12 mechanism for schemas that are **open by default but closeable by the consumer**. The base schema defines a named extension point via `$dynamicAnchor` that defaults to allowing all extra properties (`{}`). A consuming schema overrides that anchor to `false`, closing the schema without modifying the base.

`retail-resource.json` — open by default:
```json
{
  "$defs": {
    "extras": { "$dynamicAnchor": "extras" }
  },
  "properties": { "identity": {}, "physical": {}, "..." : {} },
  "unevaluatedProperties": { "$dynamicRef": "#extras" }
}
```
The anchor `"extras"` resolves to `{}` (allow all) unless overridden.

`grocery-resource.json` — open, for composition:
```json
{
  "allOf": [
    { "$ref": "retail-resource.json" },
    { "properties": { "nutrition": {}, "freshProduce": {} } }
  ]
}
```
No anchor override → unevaluated properties pass through freely.

`grocery-resource-closed.json` — strict, for validation:
```json
{
  "$defs": {
    "closed": { "$dynamicAnchor": "extras", "not": {} }
  },
  "allOf": [
    { "$ref": "retail-resource.json" },
    { "properties": { "nutrition": {}, "freshProduce": {} } }
  ]
}
```
The `$dynamicAnchor: "extras"` override is picked up when `retail-resource.json`'s `$dynamicRef: "#extras"` is resolved, making unevaluated properties fail — with no changes to the base schema.

**Trade-off:** Most powerful and avoids file proliferation, but `$dynamicRef` semantics are the most complex part of the 2020-12 spec and non-trivial to reason about.

---

### Comparison

| | Extension works | Strict at every level | Complexity |
|---|:---:|:---:|---|
| Option 1 — closed wrappers | Yes | Yes | Low — extra files per level |
| Option 2 — leaf-only convention | Yes | Leaf only | Low — naming convention |
| Option 3 — `$dynamicRef` | Yes | Yes | High — advanced spec feature |
