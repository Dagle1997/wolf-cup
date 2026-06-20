// ---------------------------------------------------------------------------
// Email — Gmail SMTP via nodemailer.
// ---------------------------------------------------------------------------
//
// Single job: on finalize, email the updated season xlsx to Jason (and anyone
// else in EMAIL_RECIPIENTS). The xlsx is the same file admin can download —
// disaster-recovery mirror, nothing fancy.
//
// All failures are swallowed by the caller's try/catch (non-fatal) so a bad
// smtp day never blocks finalization.
// ---------------------------------------------------------------------------

import nodemailer from 'nodemailer';

const EMAIL_USER = process.env['EMAIL_USER'] ?? '';
const EMAIL_APP_PASSWORD = (process.env['EMAIL_APP_PASSWORD'] ?? '').replace(/\s+/g, '');
const EMAIL_RECIPIENTS = process.env['EMAIL_RECIPIENTS'] ?? '';

export const emailConfigured = Boolean(
  EMAIL_USER && EMAIL_APP_PASSWORD && EMAIL_RECIPIENTS,
);

const transporter = emailConfigured
  ? nodemailer.createTransport({
      service: 'gmail',
      auth: { user: EMAIL_USER, pass: EMAIL_APP_PASSWORD },
    })
  : null;

function parseRecipients(): string[] {
  return EMAIL_RECIPIENTS.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface SendRoundResultsInput {
  roundDate: string;
  seasonYear: number;
  xlsxBuffer: Buffer;
  xlsxFilename: string;
  topLine?: string;
}

export async function sendRoundResultsEmail(
  input: SendRoundResultsInput,
): Promise<{ accepted: string[]; rejected: string[] } | null> {
  if (!transporter) return null;

  const recipients = parseRecipients();
  if (recipients.length === 0) return null;

  const subject = `Wolf Cup — ${input.roundDate} results`;
  const text = [
    `The ${input.roundDate} round has been finalized.`,
    '',
    input.topLine ?? '',
    '',
    `Attached: updated ${input.seasonYear} season workbook — per round a summary sheet (name, gross, stableford, money) plus a "detail" sheet with the full hole-by-hole for each foursome (scores, wolf calls, greenies/polies/sandies).`,
    '',
    'This is an automated disaster-recovery archive — the live leaderboard at https://wolf.dagle.cloud is always authoritative.',
  ].join('\n');

  const info = await transporter.sendMail({
    from: EMAIL_USER,
    to: recipients.join(', '),
    subject,
    text,
    attachments: [
      {
        filename: input.xlsxFilename,
        content: input.xlsxBuffer,
        contentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
    ],
  });

  return { accepted: info.accepted as string[], rejected: info.rejected as string[] };
}
