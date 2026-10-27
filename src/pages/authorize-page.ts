import type { Mandate } from '#src/domain/types.ts';

import { escape, layout } from './html.ts';

export const authorizePage = ({
  mandate,
  merchantName,
  error,
  values = {},
}: {
  mandate: Mandate;
  merchantName: string;
  error?: string;
  values?: { accountHolderName?: string; iban?: string };
}) =>
  layout({
    title: 'Set up a bank debit',
    body: `<div class="card narrow">
  <h1 style="font-size:18px;margin:0">Set up a bank debit</h1>
  <p class="muted">By confirming, you authorize <strong>${escape(merchantName)}</strong> to send instructions
  to your bank to debit your account, and your bank to debit your account accordingly.
  Reference: <code>${escape(mandate.customerReference)}</code></p>
  <form method="post">
    <label for="accountHolderName">Account holder name</label>
    <input id="accountHolderName" name="accountHolderName" autocomplete="name" required value="${escape(values.accountHolderName)}">
    <label for="iban">IBAN</label>
    <input id="iban" name="iban" required placeholder="NL00 BANK 0000 0000 00" value="${escape(values.iban)}">
    ${error ? `<p class="error">${escape(error)}</p>` : ''}
    <button type="submit">Confirm</button>
  </form>
</div>`,
  });

export const messagePage = (title: string, message: string) =>
  layout({
    title,
    body: `<div class="card narrow"><h1 style="font-size:18px;margin:0">${escape(title)}</h1><p>${escape(message)}</p></div>`,
  });
