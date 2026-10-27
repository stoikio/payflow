/** Moves the country code and check digits to the end and reduces modulo 97 (ISO 13616). */
const mod97 = (rearranged: string) => {
  let remainder = 0;
  for (const character of rearranged) {
    const digits = /[A-Z]/.test(character)
      ? String(character.charCodeAt(0) - 55)
      : character;
    for (const digit of digits) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }
  return remainder;
};

export const normalizeIban = (input: string) =>
  input.replaceAll(/\s+/g, '').toUpperCase();

export const isValidIban = (input: string) => {
  const iban = normalizeIban(input);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) {
    return false;
  }
  return mod97(iban.slice(4) + iban.slice(0, 4)) === 1;
};

/** Builds a valid IBAN from a country code and a BBAN by computing its check digits. */
export const ibanFor = (country: string, bban: string) => {
  const check = 98 - mod97(`${bban}${country}00`);
  return `${country}${String(check).padStart(2, '0')}${bban}`;
};

export const formatIban = (iban: string) => iban.replaceAll(/(.{4})/g, '$1 ').trim();
