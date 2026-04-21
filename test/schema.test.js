'use strict';

/**
 * Experiment: additionalProperties vs unevaluatedProperties in JSON Schema composition
 *
 * Schema hierarchy under test:
 *   RetailResource  ←  GroceryResource  ←  ExtendedGrocery
 *
 * Three scenarios:
 *   1. additionalProperties: false in base  → blocks composition (grocery fields rejected)
 *   2. unevaluatedProperties: false at composition boundary → composition works
 *   3. unevaluatedProperties: false in GroceryResource → still blocks further extension
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { validate } = require('../src/validator');

// ---------------------------------------------------------------------------
// Shared test data
// ---------------------------------------------------------------------------

const retailData = {
  '@context': 'https://schema.beckn.io/RetailResource/v2.1/context.jsonld',
  '@type': 'RetailResource',
  identity: { brand: 'Bru', originCountry: 'IN' },
  physical: { weight: { unitQuantity: 200, unitText: 'G' } },
  food: { classification: 'VEG' }
};

const groceryData = {
  '@context': 'https://schema.beckn.io/GroceryResource/v2.1/context.jsonld',
  '@type': 'GroceryResource',
  identity: { brand: 'Bru', originCountry: 'IN' },
  physical: { weight: { unitQuantity: 200, unitText: 'G' } },
  food: { classification: 'VEG' },
  packagedGoodsDeclaration: {
    manufacturerOrPacker: {
      type: 'MANUFACTURER',
      name: 'Hindustan Unilever Limited',
      id: 'HUL-KA-1001',
      address: 'HUL House, Mumbai, Maharashtra 400020'
    },
    commonOrGenericName: 'Instant Coffee and Chicory Powder',
    netQuantity: { unitQuantity: 200, unitText: 'G' },
    manufacturePackingImportDate: { month: 1, year: 2026 }
  },
  foodRegulatoryDeclaration: {
    registrations: [
      { scheme: 'FSSAI', id: '10013022002253', role: 'MANUFACTURER' }
    ],
    additives: [
      { type: 'FREE_FROM', quantity: 'Artificial colours' },
      { type: 'FREE_FROM', quantity: 'Preservatives' }
    ]
  },
  nutrition: [
    { nutrient: 'Energy',  value: { unitQuantity: 287,  unitText: 'KCAL' } },
    { nutrient: 'Protein', value: { unitQuantity: 13.5, unitText: 'G'    } }
  ]
};

// ---------------------------------------------------------------------------
// Scenario 1 — additionalProperties: false blocks composition
// ---------------------------------------------------------------------------

describe('Scenario 1 — additionalProperties: false blocks composition', () => {

  test('RetailResource (additionalProperties: false) accepts valid retail data', () => {
    const { valid, errors } = validate('retail-resource-addl-props.json', retailData);
    assert.equal(valid, true, `Unexpected errors:\n${JSON.stringify(errors, null, 2)}`);
  });

  /**
   * GroceryResource has `additionalProperties: false` at its own level but NO
   * top-level `properties` — only allOf subschemas define properties.
   * Per JSON Schema spec, `additionalProperties` only sees properties/patternProperties
   * at the SAME schema object level, so ALL instance properties are "additional" → rejected.
   */
  test('GroceryResource (additionalProperties: false, no top-level properties) rejects ALL instance data', () => {
    const { valid, errors } = validate('grocery-resource-addl-props.json', groceryData);
    assert.equal(valid, false,
      'Expected invalid: additionalProperties: false with no top-level properties key rejects everything');
    const keywords = errors.map(e => e.keyword);
    assert.ok(
      keywords.includes('additionalProperties'),
      `Expected "additionalProperties" error; got: ${JSON.stringify(keywords)}`
    );
  });

  /**
   * Even a minimal object with only RetailResource fields fails for the same reason.
   */
  test('GroceryResource (additionalProperties: false) rejects even a retail-only subset', () => {
    const { valid } = validate('grocery-resource-addl-props.json', retailData);
    assert.equal(valid, false,
      'Expected invalid: no properties survive additionalProperties: false at grocery level');
  });
});

// ---------------------------------------------------------------------------
// Scenario 2 — unevaluatedProperties: false supports composition
// ---------------------------------------------------------------------------

describe('Scenario 2 — unevaluatedProperties: false supports composition', () => {

  /**
   * GroceryResource uses `unevaluatedProperties: false` (not additionalProperties).
   * This keyword is aware of properties evaluated by EVERY allOf subschema, so:
   *   - RetailResource fields (identity, physical, …) evaluated by allOf[0] → accepted
   *   - nutrition / freshProduce evaluated by allOf[1] → accepted
   *   - Truly unknown fields → rejected
   */
  test('GroceryResource (unevaluatedProperties: false) accepts valid grocery data including nutrition', () => {
    const { valid, errors } = validate('grocery-resource-uneval-props.json', groceryData);
    assert.equal(valid, true, `Unexpected errors:\n${JSON.stringify(errors, null, 2)}`);
  });

  test('GroceryResource (unevaluatedProperties: false) rejects truly unknown extra fields', () => {
    const dataWithExtra = { ...groceryData, unknownField: 'should not be here' };
    const { valid, errors } = validate('grocery-resource-uneval-props.json', dataWithExtra);
    assert.equal(valid, false,
      'Expected invalid: unknownField is not defined in any allOf subschema');
    const keywords = errors.map(e => e.keyword);
    assert.ok(
      keywords.includes('unevaluatedProperties'),
      `Expected "unevaluatedProperties" error; got: ${JSON.stringify(keywords)}`
    );
  });
});

// ---------------------------------------------------------------------------
// Scenario 3 — unevaluatedProperties: false in GroceryResource blocks further extension
// ---------------------------------------------------------------------------

describe('Scenario 3 — unevaluatedProperties: false in base still blocks further extension', () => {

  /**
   * ExtendedGrocery tries to add an "organic" field via allOf on top of GroceryResource.
   * When the instance is validated against GroceryResource (allOf[0]):
   *   - "organic" is not evaluated by any of GroceryResource's own allOf entries
   *   - GroceryResource's unevaluatedProperties: false therefore rejects "organic"
   *   - allOf[0] fails → extended-grocery.json validation fails
   *
   * Conclusion: unevaluatedProperties: false has the same composability problem as
   * additionalProperties: false when placed in a base schema that others extend.
   */
  test('ExtendedGrocery cannot add new fields — GroceryResource\'s unevaluatedProperties: false blocks "organic"', () => {
    const extendedData = {
      ...groceryData,
      organic: { certified: true, certificationBody: 'India Organic / NPOP' }
    };
    const { valid, errors } = validate('extended-grocery.json', extendedData);
    assert.equal(valid, false,
      'Expected invalid: GroceryResource\'s unevaluatedProperties: false rejects "organic"');
    const keywords = errors.map(e => e.keyword);
    assert.ok(
      keywords.includes('unevaluatedProperties'),
      `Expected "unevaluatedProperties" error from GroceryResource; got: ${JSON.stringify(keywords)}`
    );
  });

  /**
   * Confirming that extended-grocery.json WOULD pass if the "organic" field
   * were absent — the base grocery data is fine.
   */
  test('ExtendedGrocery accepts data without the new field (grocery data alone passes)', () => {
    const { valid, errors } = validate('extended-grocery.json', groceryData);
    assert.equal(valid, true, `Unexpected errors:\n${JSON.stringify(errors, null, 2)}`);
  });
});
