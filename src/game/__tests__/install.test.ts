import { describe, expect, it } from 'vitest';
import { installOffer, isIos } from '../../ui/install';

describe('installing the game', () => {
  it('offers nothing once installed, the browser dialog when it offered one, and the how-to on iOS', () => {
    expect(installOffer({ installed: true, canPrompt: true, ios: false })).toBeNull();
    expect(installOffer({ installed: true, canPrompt: false, ios: true })).toBeNull();
    expect(installOffer({ installed: false, canPrompt: true, ios: false })).toBe('prompt');
    expect(installOffer({ installed: false, canPrompt: false, ios: true })).toBe('ios');
    // A browser with neither (Firefox on a desktop, say): no button.
    expect(installOffer({ installed: false, canPrompt: false, ios: false })).toBeNull();
  });

  it('knows an iPhone, an iPod and an iPad, even one that says it is a Mac', () => {
    const safari = (device: string) => `Mozilla/5.0 (${device}; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1`;
    expect(isIos(safari('iPhone'), 'iPhone', 5)).toBe(true);
    expect(isIos(safari('iPod touch'), 'iPod', 5)).toBe(true);
    expect(isIos(safari('iPad'), 'iPad', 5)).toBe(true);
    const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
    expect(isIos(mac, 'MacIntel', 5)).toBe(true);
    expect(isIos(mac, 'MacIntel', 0)).toBe(false);
    expect(isIos('Mozilla/5.0 (Linux; Android 15; SM-S948B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36', 'Linux armv8l', 5)).toBe(false);
  });
});
