import { describe, expect, it } from 'vitest';
import { escapeCsvCell, neutralizeCsvFormula } from './csv';

describe('CSV export safety', () => {
  it.each(['=cmd()', '+SUM(1,2)', '-1+2', '@IMPORTXML()', '  =1+1'])(
    'neutralizes spreadsheet formula %s',
    (payload) => expect(neutralizeCsvFormula(payload)).toBe(`'${payload}`),
  );

  it('quotes embedded delimiters and quote characters', () => {
    expect(escapeCsvCell('a,"b"')).toBe('"a,""b"""');
  });
});
