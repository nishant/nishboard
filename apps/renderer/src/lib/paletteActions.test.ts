import { describe, expect, it } from 'vitest';
import { matchParamCommand } from './commandRegistry';
// Side-effect import: registers the parameterized commands.
import './paletteActions';

function preview(query: string): string | null {
  return matchParamCommand(query)?.parsed?.preview ?? null;
}

describe('paletteActions parameterized commands', () => {
  it('"timer 1h 5m tea" splits the duration from the label', () => {
    expect(preview('timer 1h 5m tea')).toBe('Start timer: 1h 05m — "tea"');
  });

  it('"alarm 7:30pm wake" parses the time of day and keeps the label', () => {
    const p = preview('alarm 7:30pm wake');
    expect(p).not.toBeNull();
    expect(p).toMatch(/^Set alarm: /);
    expect(p).toContain('— "wake"');
  });

  it('"countdown 12/25 party" parses the date and keeps the label', () => {
    const p = preview('countdown 12/25 party');
    expect(p).not.toBeNull();
    expect(p).toMatch(/^Add countdown: /);
    expect(p).toContain('— "party"');
  });

  it('"scale" accepts the documented range and rejects values outside it', () => {
    expect(preview('scale 80')).toBe('Set UI scale: 80%');
    expect(preview('scale 140')).toBe('Set UI scale: 140%');
    expect(preview('scale 150%')).toBeNull();
    expect(preview('scale 70')).toBeNull();
  });

  it('shows no preview while the arguments do not parse', () => {
    expect(matchParamCommand('timer')?.parsed).toBeNull();
    expect(matchParamCommand('timer soon')?.parsed).toBeNull();
  });
});
