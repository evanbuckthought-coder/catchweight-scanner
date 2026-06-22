/**
 * Real-label test strings, wired into the UI as "simulated scan" buttons so the
 * whole loop is testable without a physical carton. The Smithfield label is in
 * pounds (AI 3202) and must normalise to kg — it proves unit handling.
 */

export interface SampleLabel {
  /** Parenthesised GS1-128 string (what a scanner would emit, minus the GS). */
  code: string;
  /** Short label for the dev button. */
  label: string;
  /** Expected supplier (for the dev panel hint / sanity). */
  supplier: string;
  /** Expected product (free text — not encoded in the barcode). */
  product: string;
  /** Expected net weight in kg after normalisation (for quick eyeballing). */
  expectedKg: number;
}

export const SAMPLE_LABELS: SampleLabel[] = [
  {
    code: '(01)98420945601325(15)280203(3102)000705(10)602030219',
    label: 'Fribin pork (kg, batch)',
    supplier: 'Fribin Foods (ES)',
    product: 'Pork',
    expectedKg: 7.05,
  },
  {
    code: '(01)99420023200173(3102)001324(11)260202(10)6034080028',
    label: 'Davmet lamb (kg, prod date)',
    supplier: 'Davmet NZ',
    product: 'Lamb',
    expectedKg: 13.24,
  },
  {
    code: '(01)99332218021206(3102)002113(13)251211(21)050073950220',
    label: 'Teys beef (kg, serial)',
    supplier: 'Teys Australia',
    product: 'Beef',
    expectedKg: 21.13,
  },
  {
    code: '(01)99418220351538(3102)001362(11)251008(21)365281020745',
    label: 'Silver Fern beef (kg)',
    supplier: 'Silver Fern Farms',
    product: 'Beef',
    expectedKg: 13.62,
  },
  {
    code: '(01)90070247165421(3202)002165(13)260310(21)116069056422',
    label: 'Smithfield pork (LB -> kg)',
    supplier: 'Smithfield (US)',
    product: 'Pork',
    expectedKg: 21.65 * 0.45359237, // 9.8202... kg
  },
];
