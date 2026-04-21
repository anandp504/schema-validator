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

### Option 1 — Keep all schemas fully open _(simplest)_

Remove every `additionalProperties: false` and `unevaluatedProperties: false` from all schemas. Every schema just defines its properties; nothing more. Extension works freely at every level with no schema changes needed.

```
schemas/
  retail-resource.json   ← defines identity, physical, food, … — no restriction
  grocery-resource.json  ← allOf [$ref retail-resource.json] + nutrition — no restriction
  extended-grocery.json  ← allOf [$ref grocery-resource.json] + organic — no restriction
```

**Trade-off:** Unknown fields in instance data are never rejected. A payload carrying arbitrary extra properties will pass validation silently. Suitable when the protocol trusts its participants, or when unknown-field checking is handled at a different layer (e.g. an API gateway or a separate linting step).

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

The base schema defines a named **extension point** via `$dynamicAnchor` whose default value is `{}` (allow all). Any schema that wants strict validation overrides that anchor to `{ "not": {} }` (deny all). Intermediate schemas that are meant to be extended further leave the anchor alone — they do not define it at all.

`$dynamicRef` resolution works by walking up the **evaluation call stack** and picking the outermost schema that defines the named anchor. This means the restriction is always applied by whoever is at the top of the chain — typically the final validation schema — without any change to the schemas below it.

#### Schema layout

`retail-resource.json` — base, defines the anchor and the dynamic ref:
```json
{
  "$defs": {
    "extras": { "$dynamicAnchor": "extras" }
  },
  "properties": { "identity": {}, "physical": {}, "...": {} },
  "unevaluatedProperties": { "$dynamicRef": "#extras" }
}
```
Default anchor value is `{}` → unevaluated properties pass. The anchor acts as an overrideable slot.

`grocery-resource.json` — open, for composition:
```json
{
  "allOf": [
    { "$ref": "retail-resource.json" },
    { "properties": { "nutrition": {}, "freshProduce": {} } }
  ]
}
```
No anchor override. `$dynamicRef` resolves to `retail-resource.json`'s own `{}` → permissive.

`grocery-resource-closed.json` — strict, for validating grocery data:
```json
{
  "$defs": {
    "noExtras": { "$dynamicAnchor": "extras", "not": {} }
  },
  "allOf": [{ "$ref": "grocery-resource.json" }]
}
```
Overrides the anchor to `{ "not": {} }`. When `retail-resource.json`'s `$dynamicRef: "#extras"` is evaluated inside this context, it resolves to `{ "not": {} }` → unevaluated properties rejected.

#### Extending further — e.g. adding an `organic` field

`extended-grocery.json` — open, for composition (no anchor):
```json
{
  "allOf": [
    { "$ref": "grocery-resource.json" },
    { "properties": { "organic": {} } }
  ]
}
```
Still no anchor override → permissive when used alone.

`extended-grocery-closed.json` — strict, for validating extended grocery data:
```json
{
  "$defs": {
    "noExtras": { "$dynamicAnchor": "extras", "not": {} }
  },
  "allOf": [{ "$ref": "extended-grocery.json" }]
}
```
Yes — **the closed schema at each new level must define the anchor override**. This is the one piece of boilerplate that cannot be avoided. The open schemas in the chain never carry the anchor; only the schema actually used for validation does.

#### How the anchor resolves at each level

| Schema used for validation | Anchor resolved to | Unknown fields |
|---|---|---|
| `retail-resource.json` (directly) | `{}` (own default) | allowed |
| `grocery-resource.json` | `{}` (no override) | allowed |
| `grocery-resource-closed.json` | `{ "not": {} }` (override) | **rejected** |
| `extended-grocery.json` | `{}` (no override) | allowed |
| `extended-grocery-closed.json` | `{ "not": {} }` (override) | **rejected** |

**Trade-off:** The most powerful option — open schemas stay completely untouched, and any consumer can close them by defining one anchor. However, `$dynamicRef` semantics are the most complex part of the 2020-12 spec and non-trivial to reason about.

---

### Comparison

| | Extension works | Unknown fields rejected | Complexity |
|---|:---:|:---:|---|
| Option 1 — all open | Yes | No | None |
| Option 2 — leaf-only convention | Yes | At leaf only | Low — naming convention |
| Option 3 — `$dynamicRef` | Yes | Yes, via closed schema | High — advanced spec feature |
