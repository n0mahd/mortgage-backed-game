const { normalizeEmail, isValidEmail, normalizeInviteCode } = require('../../helpers');

describe('helpers', () => {
    test('normalizes string emails and rejects non-string values', () => {
        expect(normalizeEmail('  User@Example.COM  ')).toBe('user@example.com');
        expect(normalizeEmail(null)).toBe('');
        expect(normalizeEmail(12345)).toBe('');
    });

    test('validates normalized email shape', () => {
        expect(isValidEmail('user@example.com')).toBe(true);
        expect(isValidEmail('missing-at')).toBe(false);
    });

    test('normalizes invite codes for lookups', () => {
        expect(normalizeInviteCode(' ab12cd ')).toBe('AB12CD');
        expect(normalizeInviteCode(null)).toBe('');
    });
});
